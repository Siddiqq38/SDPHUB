// Laporan Harian: QC pagi dan daftar order yang dicek per shift, pengganti laporan di grup WhatsApp.
import { Hono } from 'hono';
import { allow, audit, authn, bad, calendarOf, loadSettings, now, oneOf, optStr, readJson, reqStr, type AppEnv } from '../core.ts';
import type { Role } from '../domain.ts';
import { localDay } from '../lib/calendar.ts';

const VIEWERS: Role[] = ['manager', 'spv', 'op', 'qc', 'cs', 'store', 'fat'];
export const SHIFT2_DEFAULT = '16:30';

function dayOf(b: Record<string, any>) {
  const date = reqStr(b, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) throw bad('Tanggal tidak valid');
  return date;
}

export const dailyRoutes = new Hono<AppEnv>();
dailyRoutes.use('*', authn);

dailyRoutes.post('/', async (c) => {
  await allow(c, VIEWERS, 'harian');
  const date = dayOf(await readJson(c));
  const db = c.env.DB;
  const raw = await loadSettings(db);
  const cal = calendarOf(raw);
  const shift2Start = raw.shift2_start || SHIFT2_DEFAULT;
  const from = Date.parse(date + 'T00:00:00Z') - cal.offsetMin * 60000;
  const split = from + (Number(shift2Start.slice(0, 2)) * 60 + Number(shift2Start.slice(3))) * 60000;
  const all = async <T>(sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).all<T>()).results;

  const morning = await all<any>('SELECT * FROM qc_reports WHERE day = ? ORDER BY id', date);
  const rows = await all<any>(
    `SELECT a.action, a.at, u.code AS by, o.order_no, o.track_code, o.customer_name, o.service, o.meter
     FROM audit_log a JOIN orders o ON o.id = a.entity_id::bigint LEFT JOIN users u ON u.id = a.user_id
     WHERE a.action IN ('qc_pass','qc_reject') AND a.at >= o.created_at AND a.at >= ? AND a.at < ? ORDER BY a.at, a.id`, from, from + 864e5);
  const rejects = await all<any>("SELECT order_no, reason, at FROM logs WHERE type = 'Reject' AND at >= ? AND at < ?", from, from + 864e5);
  const checks = rows.map((r) => {
    const reject = r.action === 'qc_reject' ? rejects.find((x) => x.order_no === r.order_no && Math.abs(x.at - r.at) < 5000) : null;
    return {
      order_no: r.order_no, resi: r.track_code, customer: r.customer_name, service: r.service, meter: r.meter,
      result: r.action === 'qc_pass' ? 'lolos' : 'reject', rejectM: reject ? Number(/([0-9]+(?:\.[0-9]+)?) m /.exec(reject.reason)?.[1] ?? 0) : null,
      by: r.by, at: r.at, shift: r.at < split ? 1 : 2,
    };
  });
  const sent = await all<any>('SELECT shift, service, note, by_user AS by, at FROM shift_reports WHERE day = ? ORDER BY id', date);
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    date, shift2Start, checks,
    submissions: sent.filter((s, i) => !sent.slice(i + 1).some((x) => x.shift === s.shift && x.service === s.service)),
    morning: morning.map((r) => ({
      id: r.id, machine: r.machine, status: r.status, by: r.by_user, at: r.at, approvedBy: r.approved_by, leaderNote: r.leader_note ?? '',
      ng: JSON.parse(r.ng), note: r.note ?? '', action: r.action ?? '', photos: (JSON.parse(r.photos) as any[]).map((p) => ({ label: p.label, key: p.key, drive: null })), // tautan Drive hanya pada mode spreadsheet
    })),
  });
});

dailyRoutes.post('/submit', async (c) => {
  await allow(c, ['op', 'qc', 'spv'], 'harian');
  const b = await readJson(c);
  const date = dayOf(b);
  const shift = Number(oneOf(b, 'shift', ['1', '2'] as const));
  const service = oneOf(b, 'service', ['dtf', 'sub'] as const);
  const note = optStr(b, 'note', 500);
  const u = c.get('user');
  await c.env.DB.tx(async (db) => {
    if (date > localDay(now(), calendarOf(await loadSettings(db)))) throw bad('Tanggal belum berjalan');
    await db.prepare('INSERT INTO shift_reports (day, shift, service, note, by_user, at) VALUES (?,?,?,?,?,?)').bind(date, shift, service, note, u.code, now()).run();
    await audit(db, u.id, 'shift_report', 'daily', date, { shift, service });
  });
  return c.json({ ok: true }, 201);
});
