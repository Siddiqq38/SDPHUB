// Panel Analysis: rekap dihitung dari seluruh data, bukan hanya yang dimuat layar.
import { Hono } from 'hono';
import { allow, authn, bad, loadSettings, now, oneOf, readJson, reqStr, type AppEnv } from '../core.ts';
import { buckets, ranges, report, type Data, type Period } from '../lib/analytics.ts';
import { PACKAGE_SKUS } from '../lib/materials.ts';
import { planConfig } from './capacity.ts';

export const analyticsRoutes = new Hono<AppEnv>();
analyticsRoutes.use('*', authn);

analyticsRoutes.post('/', async (c) => {
  await allow(c, ['manager', 'spv', 'fat'], 'analysis');
  const b = await readJson(c);
  const period = oneOf(b, 'period', ['day', 'week', 'month', 'year'] as const) as Period;
  const date = reqStr(b, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) throw bad('Tanggal tidak valid');
  const db = c.env.DB;
  const cfg = planConfig(await loadSettings(db));
  const since = Math.min(ranges(period, date, cfg.cal).previous.from, buckets(period, date, cfg.cal)[0].from);
  const all = async <T>(sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).all<T>()).results;
  const ready = (await all<{ entity_id: string; at: number }>("SELECT entity_id, at FROM audit_log WHERE action IN ('packed','pack') AND at >= ?", since)).map((r) => ({ id: Number(r.entity_id), at: r.at }));
  const data: Data = {
    orders: await all(
      `SELECT id, service, type, source, status, stage, customer_name, meter, total, deadline, created_at, approved_at, finished_at FROM orders
       WHERE created_at >= ? OR finished_at >= ? OR id IN (SELECT entity_id::bigint FROM audit_log WHERE action IN ('packed','pack') AND at >= ?) ORDER BY id`, since, since, since),
    payments: await all('SELECT amount, at FROM payments WHERE at >= ?', since),
    logs: await all('SELECT type, reason, value, counted, at FROM logs WHERE at >= ? ORDER BY id', since),
    ledger: await all('SELECT sku_code, type, qty, at, note FROM stock_ledger WHERE at >= ? ORDER BY id', since),
    filmSkus: (await all<{ code: string }>("SELECT code FROM skus WHERE machine = 'dtf' AND unit = 'meter' ORDER BY code")).map((k) => k.code),
    meterSkus: (await all<{ code: string }>("SELECT code FROM skus WHERE unit = 'meter' ORDER BY code")).map((k) => k.code).filter((k) => !PACKAGE_SKUS.includes(k)),
    ready,
    firstOrderAt: (await all<{ t: number | null }>('SELECT MIN(created_at) AS t FROM orders'))[0].t,
  };
  c.header('Cache-Control', 'private, no-store');
  return c.json(report(data, period, date, now(), cfg));
});
