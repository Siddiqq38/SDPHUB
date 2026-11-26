// Kelola Data: khusus Admin Sistem (master) untuk membetulkan atau membersihkan data, terutama saat simulasi.
// Setiap perubahan tetap dicatat di audit_log, dan audit_log tidak pernah dihapus.
import { Hono } from 'hono';
import type { Db } from '../db.ts';
import { allow, audit, authn, bad, conflict, forbidden, intParam, notFound, now, oneOf, optStr, readJson, reqNum, reqStr, type AppEnv } from '../core.ts';
import { DEADLINE_RE } from '../domain.ts';

const deadlineOf = (b: Record<string, unknown>) => {
  const d = optStr(b, 'deadline', 16);
  if (d && !DEADLINE_RE.test(d)) throw bad('Format deadline tidak valid');
  return d;
};

export const manageRoutes = new Hono<AppEnv>();
manageRoutes.use('*', authn, async (c, next) => {
  await allow(c, []);
  await next();
});

const STATUSES = ['cek', 'revisi', 'bayar', 'antrian', 'produksi', 'curing', 'qc', 'packing', 'siap', 'selesai', 'ditolak'] as const;

async function removeOrder(db: Db, o: any) {
  // Pemakaian bahan order ini dikembalikan ke stok, lalu seluruh catatannya dihapus.
  const used = await db.prepare("SELECT sku_code, SUM(qty) q FROM stock_ledger WHERE ref = ? AND type = 'Pakai' GROUP BY sku_code").bind(o.order_no).all<any>();
  for (const k of used.results) await db.prepare('UPDATE skus SET stock = ROUND((stock - ?)::numeric, 2) WHERE code = ?').bind(k.q, k.sku_code).run();
  await db.prepare('DELETE FROM stock_ledger WHERE ref = ?').bind(o.order_no).run();
  await db.prepare('DELETE FROM payments WHERE order_id = ?').bind(o.id).run();
  await db.prepare('DELETE FROM logs WHERE order_no = ?').bind(o.order_no).run();
  await db.prepare('DELETE FROM orders WHERE id = ?').bind(o.id).run();
}

manageRoutes.patch('/orders/:id', async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  await c.env.DB.tx(async (db) => {
    const o = await db.prepare('SELECT * FROM orders WHERE id = ? FOR UPDATE').bind(id).first<any>();
    if (!o) throw notFound('Order tidak ditemukan');
    const status = b.status === undefined ? o.status : oneOf(b, 'status', STATUSES);
    let stage: string = o.stage;
    if (b.stage !== undefined) stage = oneOf(b, 'stage', ['dtf', 'subp', 'cal'] as const);
    if ((stage === 'dtf') !== (o.service === 'dtf')) throw bad('Tahap mesin tidak sesuai layanan order');
    if (status === 'curing' && stage !== 'dtf') throw bad('Curing hanya untuk DTF');
    if (['produksi', 'curing'].includes(status) && (await db.prepare("SELECT 1 FROM orders WHERE stage = ? AND status IN ('produksi','curing') AND id <> ?").bind(stage, id).first())) {
      throw conflict('Mesin masih mengerjakan order lain');
    }
    const t = now();
    await db.prepare('UPDATE orders SET customer_name=?, wa=?, file_ref=?, note=?, deadline=?, status=?, stage=?, approved_at=COALESCE(approved_at, ?), started_at=COALESCE(started_at, ?) WHERE id=?')
      .bind(
        b.customer_name === undefined ? o.customer_name : reqStr(b, 'customer_name', 150),
        b.wa === undefined ? o.wa : reqStr(b, 'wa', 40),
        b.file_ref === undefined ? o.file_ref : reqStr(b, 'file_ref', 300),
        b.note === undefined ? o.note : optStr(b, 'note', 500),
        b.deadline === undefined ? o.deadline : deadlineOf(b),
        status, stage,
        ['antrian', 'produksi', 'curing'].includes(status) ? t : null,
        ['produksi', 'curing'].includes(status) ? t : null,
        id,
      ).run();
    await audit(db, c.get('user').id, 'manage_order_edit', 'order', id, b);
  });
  return c.json({ ok: true });
});

manageRoutes.delete('/orders/:id', async (c) => {
  const id = intParam(c, 'id');
  await c.env.DB.tx(async (db) => {
    const o = await db.prepare('SELECT * FROM orders WHERE id = ? FOR UPDATE').bind(id).first<any>();
    if (!o) throw notFound('Order tidak ditemukan');
    await removeOrder(db, o);
    await audit(db, c.get('user').id, 'manage_order_delete', 'order', id, { order_no: o.order_no, total: o.total });
  });
  return c.json({ ok: true });
});

// Hapus satu baris: pembayaran, log loss/QC, atau laporan QC pagi.
for (const [path, table, label] of [['payments', 'payments', 'Pembayaran'], ['logs', 'logs', 'Catatan'], ['qc', 'qc_reports', 'Laporan QC']] as const) {
  manageRoutes.delete(`/${path}/:id`, async (c) => {
    const id = intParam(c, 'id');
    const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
    if (!row) throw notFound(label + ' tidak ditemukan');
    await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    await audit(c.env.DB, c.get('user').id, `manage_${path}_delete`, table, id, row);
    return c.json({ ok: true });
  });
}

manageRoutes.patch('/customers/:id', async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const cur = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first<any>();
  if (!cur) throw notFound('Pelanggan tidak ditemukan');
  await c.env.DB.prepare('UPDATE customers SET name = ?, wa = ?, status = ? WHERE id = ?').bind(
    b.name === undefined ? cur.name : reqStr(b, 'name', 150),
    b.wa === undefined ? cur.wa : reqStr(b, 'wa', 40),
    b.status === undefined ? cur.status : oneOf(b, 'status', ['aktif', 'menunggu', 'ditolak'] as const),
    id,
  ).run();
  await audit(c.env.DB, c.get('user').id, 'manage_customer_edit', 'customer', id, b);
  return c.json({ ok: true });
});

manageRoutes.delete('/customers/:id', async (c) => {
  const id = intParam(c, 'id');
  await c.env.DB.tx(async (db) => {
    if (await db.prepare('SELECT 1 FROM orders WHERE customer_id = ?').bind(id).first()) throw conflict('Pelanggan masih punya order. Hapus ordernya dahulu.');
    const r = await db.prepare('DELETE FROM customers WHERE id = ?').bind(id).run();
    if (!r.meta.changes) throw notFound('Pelanggan tidak ditemukan');
    await audit(db, c.get('user').id, 'manage_customer_delete', 'customer', id);
  });
  return c.json({ ok: true });
});

manageRoutes.put('/stock/:code', async (c) => {
  const b = await readJson(c);
  const stock = reqNum(b, 'stock', 0, true);
  const r = await c.env.DB.prepare('UPDATE skus SET stock = ? WHERE code = ?').bind(stock, c.req.param('code')).run();
  if (!r.meta.changes) throw notFound('SKU tidak ditemukan');
  await audit(c.env.DB, c.get('user').id, 'manage_stock_set', 'sku', c.req.param('code'), { stock });
  return c.json({ ok: true });
});

manageRoutes.delete('/users/:id', async (c) => {
  const id = intParam(c, 'id');
  if (id === c.get('user').id) throw forbidden('Akun yang sedang dipakai tidak dapat dihapus');
  await c.env.DB.tx(async (db) => {
    const u = await db.prepare('SELECT code FROM users WHERE id = ?').bind(id).first<any>();
    if (!u) throw notFound('Pengguna tidak ditemukan');
    if (await db.prepare('SELECT 1 FROM files WHERE uploaded_by = ?').bind(id).first()) throw conflict('Pengguna ini punya berkas unggahan. Nonaktifkan saja, atau bersihkan data simulasi dahulu.');
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    await audit(db, c.get('user').id, 'manage_user_delete', 'user', id, { code: u.code });
  });
  return c.json({ ok: true });
});

// Bersihkan seluruh data transaksi sebelum dipakai sungguhan. Akun, harga, hak akses, daftar SKU, dan audit tetap.
manageRoutes.post('/reset', async (c) => {
  const b = await readJson(c);
  if (b.confirm !== 'HAPUS SEMUA') throw bad('Ketik HAPUS SEMUA untuk melanjutkan');
  await c.env.DB.tx(async (db) => {
    for (const t of ['payments', 'logs', 'stock_ledger', 'qc_reports', 'orders', 'files']) await db.prepare(`DELETE FROM ${t}`).run();
    if (b.customers === true) await db.prepare('DELETE FROM customers').run();
    await db.prepare('UPDATE skus SET stock = 0').run();
    await audit(db, c.get('user').id, 'manage_reset', 'all', undefined, { customers: b.customers === true });
  });
  return c.json({ ok: true });
});
