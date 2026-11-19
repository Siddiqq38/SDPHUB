import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { sha256 } from './lib/auth.ts';
import type { Db } from './db.ts';
import type { Storage } from './storage.ts';
import { can, type Perm, type Role } from './lib/rbac.ts';
import { DEFAULT_CALENDAR, parseBlocks, type CalendarConfig } from './lib/calendar.ts';

export type Env = {
  DB: Db;
  FILES: Storage;
  BOOTSTRAP_TOKEN?: string;
};
export type AuthUser = { id: number; username: string; role: Role; customer_id: number | null; must_change: boolean };
export type Vars = { user: AuthUser; sid: string; csrf: string };
export type AppEnv = { Bindings: Env; Variables: Vars };
export type Ctx = Context<AppEnv>;

export const COOKIE = 'sdp_session';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const bad = (m: string) => new HttpError(400, m);
export const forbidden = (m = 'Tidak punya hak akses') => new HttpError(403, m);
export const notFound = (m = 'Data tidak ditemukan') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

export const now = () => Date.now();

export async function readJson(c: Ctx): Promise<Record<string, any>> {
  try {
    const v = await c.req.json();
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw 0;
    return v;
  } catch {
    throw bad('Body JSON tidak valid');
  }
}

export function reqStr(o: Record<string, any>, k: string, max = 500): string {
  const v = o[k];
  if (typeof v !== 'string' || v.trim() === '') throw bad(`Field "${k}" wajib diisi`);
  if (v.length > max) throw bad(`Field "${k}" terlalu panjang`);
  return v.trim();
}
export function optStr(o: Record<string, any>, k: string, max = 2000): string | null {
  const v = o[k];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw bad(`Field "${k}" harus teks`);
  if (v.length > max) throw bad(`Field "${k}" terlalu panjang`);
  return v.trim();
}
export function reqNum(o: Record<string, any>, k: string, min = 0, allowEqual = false): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`Field "${k}" harus angka`);
  if (allowEqual ? v < min : v <= min) throw bad(`Field "${k}" harus lebih ${allowEqual ? 'besar atau sama dengan' : 'besar dari'} ${min}`);
  return v;
}
export function optNum(o: Record<string, any>, k: string): number | null {
  const v = o[k];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw bad(`Field "${k}" harus angka tidak negatif`);
  return v;
}
export function oneOf<T extends string>(o: Record<string, any>, k: string, allowed: readonly T[]): T {
  const v = o[k];
  if (!allowed.includes(v)) throw bad(`Field "${k}" harus salah satu dari: ${allowed.join(', ')}`);
  return v;
}
export function intParam(c: Ctx, name: string): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n <= 0) throw bad(`Parameter ${name} tidak valid`);
  return n;
}

export async function audit(db: Db, userId: number | null, action: string, entity?: string, entityId?: string | number, detail?: unknown) {
  await db
    .prepare('INSERT INTO audit_log (at, user_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)')
    .bind(now(), userId, action, entity ?? null, entityId == null ? null : String(entityId), detail === undefined ? null : JSON.stringify(detail))
    .run();
}

export async function loadCalendar(db: Db): Promise<CalendarConfig> {
  const rows = await db.prepare("SELECT key, value FROM settings WHERE key IN ('tz_offset_min','prod_blocks','closed_weekdays')").all<{ key: string; value: string }>();
  const m = Object.fromEntries(rows.results.map((r) => [r.key, r.value]));
  try {
    return {
      offsetMin: m.tz_offset_min ? Number(m.tz_offset_min) : DEFAULT_CALENDAR.offsetMin,
      blocks: m.prod_blocks ? parseBlocks(m.prod_blocks) : DEFAULT_CALENDAR.blocks,
      closedWeekdays: m.closed_weekdays ? m.closed_weekdays.split(',').filter((x) => x !== '').map(Number) : DEFAULT_CALENDAR.closedWeekdays,
    };
  } catch {
    return DEFAULT_CALENDAR;
  }
}

/** Origin harus sama dengan host untuk metode yang mengubah data. */
export const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const origin = c.req.header('Origin');
    if (origin) {
      let ok = false;
      try {
        ok = new URL(origin).host === new URL(c.req.url).host;
      } catch {
        ok = false;
      }
      if (!ok) throw forbidden('Origin tidak diizinkan');
    }
  }
  await next();
};

/** Autentikasi sesi, validasi CSRF, dan paksa ganti password awal. */
export const authn: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) throw new HttpError(401, 'Belum login');
  const sid = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT s.csrf, s.epoch, s.expires_at, u.id, u.username, u.role, u.active, u.customer_id, u.must_change_password, u.session_epoch
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
  )
    .bind(sid)
    .first<any>();
  if (!row || row.expires_at < now() || !row.active || row.epoch !== row.session_epoch) {
    throw new HttpError(401, 'Sesi tidak berlaku, silakan login lagi');
  }
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD') {
    const sent = c.req.header('X-CSRF-Token');
    if (!sent || sent !== row.csrf) throw forbidden('Token CSRF tidak valid');
  }
  const user: AuthUser = { id: row.id, username: row.username, role: row.role, customer_id: row.customer_id, must_change: !!row.must_change_password };
  c.set('user', user);
  c.set('sid', sid);
  c.set('csrf', row.csrf);
  const path = new URL(c.req.url).pathname;
  if (user.must_change && !['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'].includes(path)) {
    throw forbidden('Password awal wajib diganti terlebih dahulu');
  }
  await next();
};

export function need(perm: Perm): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!can(c.get('user').role, perm)) throw forbidden();
    await next();
  };
}

export function isStaff(u: AuthUser): boolean {
  return u.role !== 'customer';
}

/** Customer hanya boleh mengakses data bisnisnya sendiri. */
export function assertCustomerScope(u: AuthUser, customerId: number) {
  if (u.role === 'customer' && u.customer_id !== customerId) throw notFound();
}

export function clientIp(c: Ctx): string {
  // Vercel menimpa header ini dengan IP klien sebenarnya; klien tidak dapat memalsukannya.
  return c.req.header('x-vercel-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local';
}

/** Waktu/nominal bulat (kolom BIGINT): angka desimal dibulatkan agar Postgres tidak menolak. */
export function optTime(o: Record<string, any>, k: string): number | null {
  const v = optNum(o, k);
  return v === null ? null : Math.round(v);
}
