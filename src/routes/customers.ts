// Database customer: pencarian per halaman, impor massal, dan pengubahan kategori.
// Aktif = ada kunjungan atau order dalam 1 tahun terakhir.
import { Hono } from 'hono';
import { audit, authn, bad, calendarOf, forbidden, loadSettings, notFound, now, oneOf, optStr, pagesOf, readJson, reqStr, type AppEnv, type Ctx } from '../core.ts';
import type { Page, Role } from '../domain.ts';
import { localDay } from '../lib/calendar.ts';

export const PAGE_SIZE = 50;
/** Tanggal batas: kunjungan sebelum ini berarti tidak aktif. */
export const activeSince = (today: string) => `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
const today = async (c: Ctx) => localDay(now(), calendarOf(await loadSettings(c.env.DB)));

async function need(c: Ctx, roles: Role[], pages: Page[]) {
  const u = c.get('user');
  if (u.role === 'master') return;
  const own = await pagesOf(c.env.DB, u.role);
  if (!roles.includes(u.role) || !pages.some((p) => own.includes(p))) throw forbidden();
}
const dateOf = (v: unknown) => (typeof v === 'string' && /^(19|20)\d\d-\d\d-\d\d$/.test(v) ? v : null);
const intOf = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e13 ? v : null);

export const customerRoutes = new Hono<AppEnv>();
customerRoutes.use('*', authn);

customerRoutes.post('/search', async (c) => {
  await need(c, ['crm', 'cs', 'store', 'spv', 'manager', 'fat'], ['pelanggan', 'input']);
  const b = await readJson(c);
  const q = (optStr(b, 'q', 100) ?? '').toLowerCase();
  const status = oneOf({ status: b.status ?? 'all' }, 'status', ['all', 'active', 'inactive'] as const);
  const kind = oneOf({ kind: b.kind ?? 'all' }, 'kind', ['all', 'B2B', 'B2C', 'none'] as const);
  const category = optStr(b, 'category', 60);
  const page = Number.isInteger(b.page) && (b.page as number) >= 0 ? (b.page as number) : 0;
  const limit = activeSince(await today(c));
  const where: string[] = [];
  const args: unknown[] = [];
  if (q) { where.push("(lower(name) LIKE ? OR lower(code) LIKE ? OR wa LIKE ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status !== 'all') { where.push(status === 'active' ? 'COALESCE(last_visit, since) >= ?' : '(COALESCE(last_visit, since) IS NULL OR COALESCE(last_visit, since) < ?)'); args.push(limit); }
  if (kind !== 'all') where.push(kind === 'none' ? "(kind IS NULL OR kind = '')" : `kind = '${kind}'`);
  if (category) { where.push('category = ?'); args.push(category); }
  const filter = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const db = c.env.DB;
  const total = (await db.prepare(`SELECT COUNT(*) n FROM customers ${filter}`).bind(...args).first<{ n: number }>())!.n;
  const rows = (await db.prepare(
    `SELECT id, code, name, wa, source, status, kind, category, email, city, address, since, last_visit, visits, spending,
       CASE WHEN COALESCE(last_visit, since) >= ? THEN 1 ELSE 0 END AS active
     FROM customers ${filter} ORDER BY lower(name), id LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`,
  ).bind(limit, ...args).all()).results;
  const summary = await db.prepare(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE COALESCE(last_visit, since) >= ?) AS active, COUNT(*) FILTER (WHERE kind = 'B2B') AS b2b,
       COUNT(*) FILTER (WHERE kind = 'B2C') AS b2c, COUNT(*) FILTER (WHERE wa = '') AS nophone FROM customers`,
  ).bind(limit).first();
  const categories = (await db.prepare("SELECT DISTINCT category FROM customers WHERE category IS NOT NULL AND category <> '' ORDER BY category").all<{ category: string }>()).results.map((x) => x.category);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ total, page, size: PAGE_SIZE, rows, summary, categories });
});

// Impor massal. Nama yang sama (tanpa membedakan huruf besar) diperbarui; kolom kosong tidak menimpa data lama.
customerRoutes.post('/bulk', async (c) => {
  await need(c, ['crm', 'spv'], ['pelanggan']);
  const b = await readJson(c);
  if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 500) throw bad('Kirim 1 sampai 500 baris');
  const u = c.get('user');
  let added = 0, updated = 0;
  await c.env.DB.tx(async (db) => {
    const max = await db.prepare("SELECT COALESCE(MAX(substring(code from 5)::bigint), 0) AS n FROM customers WHERE code ~ '^CUS-[0-9]+$'").first<{ n: number }>();
    let next = Number(max!.n);
    for (const raw of b.rows as Record<string, unknown>[]) {
      const name = reqStr(raw as Record<string, any>, 'name', 150).replace(/\s+/g, ' ');
      const text = (k: string, size: number) => (typeof raw[k] === 'string' ? (raw[k] as string).trim().slice(0, size) : '') || null;
      const v = [text('wa', 40), text('email', 150), text('city', 80), text('address', 250), dateOf(raw.since), dateOf(raw.last_visit), intOf(raw.visits), intOf(raw.spending), text('kind', 3), text('category', 60)];
      const found = await db.prepare('SELECT id FROM customers WHERE lower(name) = lower(?) ORDER BY id LIMIT 1').bind(name).first<{ id: number }>();
      if (found) {
        await db.prepare(`UPDATE customers SET wa = COALESCE(?, wa), email = COALESCE(?, email), city = COALESCE(?, city), address = COALESCE(?, address), since = COALESCE(?, since),
          last_visit = GREATEST(?, last_visit), visits = COALESCE(?, visits), spending = COALESCE(?, spending), kind = COALESCE(?, kind), category = COALESCE(?, category) WHERE id = ?`).bind(...v, found.id).run();
        updated++;
      } else {
        await db.prepare(`INSERT INTO customers (code, name, wa, source, status, created_at, email, city, address, since, last_visit, visits, spending, kind, category)
          VALUES (?,?,?, 'Database DTF', 'aktif', ?,?,?,?,?,?,?,?,?,?)`).bind(`CUS-${String(++next).padStart(5, '0')}`, name, v[0] ?? '', now(), ...v.slice(1)).run();
        added++;
      }
    }
    await audit(db, u.id, 'customers_bulk', 'customer', undefined, { added, updated });
  });
  return c.json({ ok: true, added, updated }, 201);
});

customerRoutes.post('/update', async (c) => {
  await need(c, ['crm', 'cs', 'spv'], ['pelanggan']);
  const b = await readJson(c);
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > PAGE_SIZE || !b.ids.every((x: unknown) => Number.isInteger(x))) throw bad('Pilih 1 sampai 50 customer');
  const sets: string[] = [], vals: unknown[] = [];
  if (b.kind !== undefined) { sets.push('kind = ?'); vals.push(b.kind ? oneOf(b, 'kind', ['B2B', 'B2C'] as const) : null); }
  if (b.category !== undefined) { sets.push('category = ?'); vals.push(optStr(b, 'category', 60)); }
  if (b.ids.length === 1) {
    if (b.name !== undefined) { sets.push('name = ?'); vals.push(reqStr(b, 'name', 150)); }
    if (b.wa !== undefined) { sets.push('wa = ?'); vals.push(optStr(b, 'wa', 40) ?? ''); }
    if (b.city !== undefined) { sets.push('city = ?'); vals.push(optStr(b, 'city', 80)); }
  }
  if (!sets.length) throw bad('Tidak ada perubahan');
  await c.env.DB.tx(async (db) => {
    for (const id of b.ids as number[]) if (!(await db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run()).meta.changes) throw notFound('Customer tidak ditemukan');
    await audit(db, c.get('user').id, 'customers_updated', 'customer', undefined, { ids: b.ids });
  });
  return c.json({ ok: true });
});
