// Laporan Harian: QC pagi dan daftar order yang dicek per shift, pengganti laporan di grup WhatsApp.
import { Hono } from 'hono';
import { allow, audit, authn, bad, calendarOf, loadSettings, now, oneOf, optStr, readJson, reqStr, type AppEnv } from '../core.ts';
import type { Role } from '../domain.ts';
import { localDay } from '../lib/calendar.ts';

const VIEWERS: Role[] = ['manager', 'spv', 'op', 'qc', 'cs', 'store', 'fat'];
export const SHIFT2_DEFAULT = '16:30';

function dayOf(b: Record<string, any>, key = 'date') {
  const date = reqStr(b, key, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) throw bad('Tanggal tidak valid');
  return date;
}

export const dailyRoutes = new Hono<AppEnv>();
dailyRoutes.use('*', authn);

dailyRoutes.post('/', async (c) => {
  await allow(c, VIEWERS, 'harian');
  // Satu tanggal (date), atau rentang (from, to) paling lama 31 hari.
  const b = await readJson(c);
  const date = b.from ? dayOf(b, 'from') : dayOf(b);
  const last = b.to ? dayOf(b, 'to') : date;
  const length = (Date.parse(last + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 864e5 + 1;
  if (length < 1 || length > 31) throw bad('Rentang tanggal 1 sampai 31 hari, tanggal akhir tidak boleh sebelum tanggal awal');
  const db = c.env.DB;
  const raw = await loadSettings(db);
  const cal = calendarOf(raw);
  const shift2Start = raw.shift2_start || SHIFT2_DEFAULT;
  const from = Date.parse(date + 'T00:00:00Z') - cal.offsetMin * 60000;
  const to = from + length * 864e5;
  const split = (Number(shift2Start.slice(0, 2)) * 60 + Number(shift2Start.slice(3))) * 60000;
  const shiftOf = (t: number) => ((t - from) % 864e5 < split ? 1 : 2);
  const dayName = (t: number) => localDay(t, cal);
  const all = async <T>(sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).all<T>()).results;

  const morning = await all<any>('SELECT * FROM qc_reports WHERE day >= ? AND day <= ? ORDER BY day, id', date, last);
  const rows = await all<any>(
    `SELECT a.action, a.at, u.code AS by, o.order_no, o.track_code, o.customer_name, o.service, o.meter
     FROM audit_log a JOIN orders o ON o.id = a.entity_id::bigint LEFT JOIN users u ON u.id = a.user_id
     WHERE a.action IN ('qc_pass','qc_reject') AND a.at >= o.created_at AND a.at >= ? AND a.at < ? ORDER BY a.at, a.id`, from, to);
  const rejects = await all<any>("SELECT order_no, reason, at FROM logs WHERE type = 'Reject' AND at >= ? AND at < ?", from, to);
  const checks = rows.map((r) => {
    const reject = r.action === 'qc_reject' ? rejects.find((x) => x.order_no === r.order_no && Math.abs(x.at - r.at) < 5000) : null;
    return {
      order_no: r.order_no, resi: r.track_code, customer: r.customer_name, service: r.service, meter: r.meter,
      result: r.action === 'qc_pass' ? 'lolos' : 'reject', rejectM: reject ? Number(/([0-9]+(?:\.[0-9]+)?) m /.exec(reject.reason)?.[1] ?? 0) : null,
      by: r.by, at: r.at, shift: shiftOf(r.at), day: dayName(r.at),
    };
  });
  // Rekap otomatis: semua order yang selesai produksi hari ini, ditambah hasil QC-nya.
  const finished = await all<any>('SELECT order_no, track_code, customer_name, service, meter, finished_at FROM orders WHERE finished_at >= ? AND finished_at < ? ORDER BY finished_at, id', from, to);
  const items = new Map<string, any>(finished.map((o) => [o.order_no, {
    order_no: o.order_no, resi: o.track_code, customer: o.customer_name, service: o.service, meter: o.meter,
    finishedAt: o.finished_at, result: 'menunggu', rejectM: null, by: null, at: null,
  }]));
  for (const x of checks) {
    const item = items.get(x.order_no) ?? items.set(x.order_no, { order_no: x.order_no, resi: x.resi, customer: x.customer, service: x.service, meter: x.meter, finishedAt: null, result: 'menunggu', rejectM: null, by: null, at: null }).get(x.order_no);
    Object.assign(item, { result: x.result, by: x.by, at: x.at });
    if (x.rejectM !== null) item.rejectM = (item.rejectM ?? 0) + x.rejectM;
  }
  const recap = [...items.values()].map((i) => {
    const done = i.finishedAt ?? i.at;
    // Dicetak ulang setelah pemeriksaan terakhir: menunggu QC lagi.
    return { ...i, result: i.at !== null && i.finishedAt !== null && i.finishedAt > i.at ? 'menunggu' : i.result, done, shift: shiftOf(done), day: dayName(done) };
  }).sort((a, b) => a.done - b.done || (a.order_no < b.order_no ? -1 : 1));
  const sent = await all<any>('SELECT day, shift, service, note, by_user AS by, at FROM shift_reports WHERE day >= ? AND day <= ? ORDER BY id', date, last);
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    date, from: date, to: last, shift2Start, checks, items: recap,
    submissions: sent.filter((s, i) => !sent.slice(i + 1).some((x) => x.day === s.day && x.shift === s.shift && x.service === s.service)),
    morning: morning.map((r) => ({
      id: r.id, day: r.day, machine: r.machine, status: r.status, by: r.by_user, at: r.at, approvedBy: r.approved_by, leaderNote: r.leader_note ?? '',
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
