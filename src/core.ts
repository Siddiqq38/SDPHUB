import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { sha256 } from './lib/auth.ts';
import type { Db } from './db.ts';
import type { Storage } from './storage.ts';
import { ACCESS_DEFAULT, RuleError, type Page, type Role } from './domain.ts';
import { DEFAULT_CALENDAR, parseBlocks, withOvertime, type CalendarConfig } from './lib/calendar.ts';

export type Env = {
  DB: Db;
  FILES: Storage;
  BOOTSTRAP_TOKEN?: string;
};
export type AuthUser = { id: number; code: string; name: string; role: Role; store: string | null; must_change: boolean };
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

/** Ubah galat aturan bisnis menjadi 400. */
export function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RuleError) throw bad(e.message);
    throw e;
  }
}

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
  return v.trim() || null;
}
export function reqNum(o: Record<string, any>, k: string, min = 0, allowEqual = false): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`Field "${k}" harus angka`);
  if (allowEqual ? v < min : v <= min) throw bad(`Field "${k}" harus lebih ${allowEqual ? 'besar atau sama dengan' : 'besar dari'} ${min}`);
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

export async function loadSettings(db: Db): Promise<Record<string, string>> {
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  return Object.fromEntries(rows.results.map((r) => [r.key, r.value]));
}
/** Harga dan norma: kosong berarti belum diatur (null). */
export function numericSettings(s: Record<string, string>): Record<string, number | null> {
  const keys = ['priceDtf', 'priceSub120', 'priceSub160', 'priceSub180', 'normDtf', 'normSubPrint', 'normPress'];
  return {
    ...Object.fromEntries(keys.map((k) => [k, s[k] ? Number(s[k]) : null])),
    ...Object.fromEntries(Object.entries(PLAN_DEFAULT).map(([k, d]) => [k, s[k] ? Number(s[k]) : d])),
  };
}
/** Angka perencanaan kapasitas: persen kapasitas dijual, menit tahan slot, estimasi menit finishing. */
export const PLAN_DEFAULT: Record<string, number> = { capPct: 90, holdMin: 120, finDtf: 30, finSub: 60 };
/** Jam produksi efektif (menit prepare dan test print sudah dikeluarkan). */
export const WORK_BLOCKS_DEFAULT = '09:00-12:00,13:00-21:30';
export function overtimeOf(s: Record<string, string>): { day: string; start: string; end: string; reason: string; by: string }[] {
  try {
    const list = JSON.parse(s.overtime || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export function calendarOf(s: Record<string, string>): CalendarConfig {
  try {
    return withOvertime({
      offsetMin: s.tz_offset_min ? Number(s.tz_offset_min) : DEFAULT_CALENDAR.offsetMin,
      blocks: parseBlocks(s.work_blocks || WORK_BLOCKS_DEFAULT),
      closedWeekdays: s.closed_weekdays !== undefined ? s.closed_weekdays.split(',').filter((x) => x !== '').map(Number) : DEFAULT_CALENDAR.closedWeekdays,
    }, overtimeOf(s));
  } catch {
    return DEFAULT_CALENDAR;
  }
}

/** Menu yang boleh dibuka sebuah peran (pengaturan master, atau bawaan). */
export async function pagesOf(db: Db, role: Role): Promise<Page[]> {
  if (role === 'master') return [];
  const row = await db.prepare('SELECT pages FROM role_access WHERE role = ?').bind(role).first<{ pages: string }>();
  return row ? (JSON.parse(row.pages) as Page[]) : ACCESS_DEFAULT[role];
}

/**
 * Izin tindakan: peran harus termasuk daftar DAN masih punya menu terkait (bila disebut).
 * Mencabut menu juga mencabut tindakannya. Master selalu boleh.
 */
export async function allow(c: Ctx, roles: Role[], page?: Page) {
  const u = c.get('user');
  if (u.role === 'master') return;
  if (!roles.includes(u.role)) throw forbidden();
  if (page && !(await pagesOf(c.env.DB, u.role)).includes(page)) throw forbidden('Menu ini tidak diizinkan untuk peran Anda');
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
    `SELECT s.csrf, s.epoch, s.expires_at, u.id, u.code, u.name, u.role, u.store, u.active, u.must_change_password, u.session_epoch
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
  const user: AuthUser = { id: row.id, code: row.code, name: row.name, role: row.role, store: row.store, must_change: !!row.must_change_password };
  c.set('user', user);
  c.set('sid', sid);
  c.set('csrf', row.csrf);
  const path = new URL(c.req.url).pathname;
  if (user.must_change && !['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'].includes(path)) {
    throw forbidden('Password awal wajib diganti terlebih dahulu');
  }
  await next();
};

export function clientIp(c: Ctx): string {
  // Vercel menimpa header ini dengan IP klien sebenarnya; klien tidak dapat memalsukannya.
  return c.req.header('x-vercel-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local';
}
