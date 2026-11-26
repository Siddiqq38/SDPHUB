// Cek kapasitas sebelum menerima order, loss sales karena penuh, dan lembur.
import { Hono } from 'hono';
import {
  allow, audit, authn, bad, calendarOf, loadSettings, now, numericSettings, optStr, overtimeOf, readJson, reqStr, oneOf, rule, type AppEnv,
} from '../core.ts';
import type { Db } from '../db.ts';
import { DEADLINE_RE, buildItems, meterOf, totalOf } from '../domain.ts';
import { localDay } from '../lib/calendar.ts';
import { candidates, freeOf } from '../lib/materials.ts';
import { materialPlan } from './inventory.ts';
import { deadlineTime, readyFor, showTime, slaDue, suggestDeadline, type Job, type PlanConfig } from '../lib/capacity.ts';

export function planConfig(raw: Record<string, string>): PlanConfig {
  const s = numericSettings(raw);
  return {
    cal: calendarOf(raw),
    norms: { dtf: s.normDtf ?? null, subp: s.normSubPrint ?? null, cal: s.normPress ?? null },
    pct: s.capPct!, holdMin: s.holdMin!, finDtf: s.finDtf!, finSub: s.finSub!,
  };
}

/** Order yang memakai kapasitas (aktif) dan yang selesai cetak dalam 24 jam terakhir. */
export async function activeJobs(db: Db): Promise<Job[]> {
  const rows = await db.prepare(
    `SELECT o.id, o.order_no, o.service, o.status, o.stage, o.meter, o.rework_m, o.priority, o.approved_at, o.started_at, o.created_at, o.finished_at, o.total, o.fabric_sku,
       (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id) AS paid_sum
     FROM orders o WHERE o.status IN ('cek','revisi','bayar','antrian','produksi','curing') OR o.finished_at >= ? ORDER BY o.id`,
  ).bind(now() - 864e5).all<any>();
  return rows.results.map((r) => ({ ...r, paid: Number(r.paid_sum) >= r.total }));
}

/** Bandingkan waktu selesai order baru dengan deadline (atau SLA standar bila kosong). */
export async function evaluate(db: Db, raw: Record<string, string>, service: 'dtf' | 'sub', meter: number, deadline: string | null) {
  const cfg = planConfig(raw);
  const t = now();
  const ready = readyFor(await activeJobs(db), t, cfg, service, meter);
  const target = deadline ? deadlineTime(deadline, cfg.cal) : slaDue(t, cfg.cal);
  const fits = ready === null || ready <= target;
  return {
    ready, target, fits, byDeadline: !!deadline,
    suggest: ready === null ? null : suggestDeadline(ready, cfg.cal),
    message: fits ? '' : `Kapasitas tidak cukup untuk ${deadline ? 'deadline' : 'SLA standar'} ${showTime(target, cfg.cal)}. Paling cepat selesai ${showTime(ready!, cfg.cal)}.`,
  };
}

async function quote(db: Db, b: Record<string, any>) {
  const service = oneOf(b, 'service', ['dtfr', 'dtfm', 'sub'] as const);
  const deadline = optStr(b, 'deadline', 16);
  if (deadline && !DEADLINE_RE.test(deadline)) throw bad('Format deadline tidak valid');
  const raw = await loadSettings(db);
  const items = rule(() => buildItems({ service, qty: b.qty, meter: b.meter, width: b.width }, numericSettings(raw)));
  const meter = meterOf(items);
  return { raw, meter, total: totalOf(items), deadline, result: await evaluate(db, raw, service === 'sub' ? 'sub' : 'dtf', meter, deadline), service };
}

export const capacityRoutes = new Hono<AppEnv>();
capacityRoutes.use('*', authn);

capacityRoutes.post('/check', async (c) => {
  await allow(c, ['cs', 'store'], 'input');
  const body = await readJson(c);
  const q = await quote(c.env.DB, body);
  // Peringatan bahan: sisa di rak yang belum terbooking order lain.
  const plan = await materialPlan(c.env.DB);
  const stages = q.service === 'sub' ? (['subp', 'cal'] as const) : (['dtf'] as const);
  const fabric = typeof body.fabric_sku === 'string' ? body.fabric_sku : null;
  const materials = stages.map((stage) => {
    const codes = candidates(plan.skus, stage, fabric);
    return { stage, need: q.meter, free: freeOf(codes, plan.lots, plan.booked) };
  });
  return c.json({ meter: q.meter, total: q.total, ...q.result, materials });
});

// Customer batal karena jadwal penuh: dicatat sebagai loss sales tanpa membuat order.
capacityRoutes.post('/loss', async (c) => {
  await allow(c, ['cs', 'store'], 'input');
  const b = await readJson(c);
  const name = reqStr(b, 'name', 150);
  const u = c.get('user');
  await c.env.DB.tx(async (db) => {
    const q = await quote(db, b);
    if (q.result.fits) throw bad('Kapasitas masih tersedia; loss sales kapasitas hanya dicatat bila penuh');
    const cal = calendarOf(q.raw);
    const reason = `Kapasitas penuh: ${name}, ${q.meter} m, target ${showTime(q.result.target, cal)}, tersedia ${showTime(q.result.ready!, cal)}`;
    await db.prepare("INSERT INTO logs (order_no, type, reason, value, counted, by_user, at) VALUES ('-', 'Loss Sales', ?, ?, 1, ?, ?)").bind(reason, q.total, u.code, now()).run();
    await audit(db, u.id, 'capacity_loss', 'log', undefined, { meter: q.meter, total: q.total });
  });
  return c.json({ ok: true }, 201);
});

// Lembur: SPV menambah jam kerja pada satu tanggal, sehingga kapasitasnya bertambah.
capacityRoutes.post('/overtime', async (c) => {
  await allow(c, ['spv'], 'produksi');
  const b = await readJson(c);
  const day = reqStr(b, 'day', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + 'T00:00:00Z'))) throw bad('Tanggal tidak valid');
  const u = c.get('user');
  await c.env.DB.tx(async (db) => {
    const raw = await loadSettings(db);
    const today = localDay(now(), calendarOf(raw));
    let list = overtimeOf(raw).filter((o) => o.day >= today);
    if (b.remove === true) list = list.filter((o) => o.day !== day);
    else {
      const start = reqStr(b, 'start', 5), end = reqStr(b, 'end', 5), reason = reqStr(b, 'reason', 200);
      const time = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!time.test(start) || !time.test(end) || start >= end) throw bad('Jam lembur tidak valid');
      if (day < today) throw bad('Tanggal lembur sudah lewat');
      list.push({ day, start, end, reason, by: u.code });
      if (list.length > 60) throw bad('Terlalu banyak jadwal lembur');
    }
    await db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind('overtime', JSON.stringify(list)).run();
    await audit(db, u.id, b.remove === true ? 'overtime_removed' : 'overtime_added', 'settings', day, b);
  });
  return c.json({ ok: true });
});
