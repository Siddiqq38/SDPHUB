import { Hono } from 'hono';
import {
  assertCustomerScope, audit, authn, bad, conflict, forbidden, intParam, isStaff, need, notFound, now, oneOf, optNum, optStr, optTime, readJson, reqNum, reqStr, type AppEnv,
} from '../core.ts';

export const financeRoutes = new Hono<AppEnv>();
financeRoutes.use('*', authn);

// Tarif tidak pernah dikarang: nominal selalu diisi manusia.
financeRoutes.post('/orders/:id/invoices', need('invoice.write'), async (c) => {
  const id = intParam(c, 'id');
  if (!(await c.env.DB.prepare('SELECT 1 FROM orders WHERE id = ?').bind(id).first())) throw notFound();
  const b = await readJson(c);
  const amount = reqNum(b, 'amount', 0);
  if (!Number.isInteger(amount)) throw bad('Nominal rupiah harus bilangan bulat');
  const r = await c.env.DB.prepare('INSERT INTO invoices (order_id, kind, amount, due_at, note, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, oneOf(b, 'kind', ['penawaran', 'dp', 'invoice'] as const), amount, optTime(b, 'due_at'), optStr(b, 'note', 500), c.get('user').id, now()).run();
  await audit(c.env.DB, c.get('user').id, 'invoice_created', 'order', id);
  return c.json({ ok: true, id: r.meta.last_row_id }, 201);
});

// Unggah bukti hanya mencatat bukti; belum memverifikasi pembayaran.
financeRoutes.post('/orders/:id/payments', async (c) => {
  const u = c.get('user');
  const id = intParam(c, 'id');
  const o = await c.env.DB.prepare('SELECT customer_id FROM orders WHERE id = ?').bind(id).first<any>();
  if (!o) throw notFound();
  assertCustomerScope(u, o.customer_id);
  if (!['customer', 'cs', 'fat'].includes(u.role)) throw forbidden();
  const b = await readJson(c);
  const amount = reqNum(b, 'amount', 0);
  let proof: string | null = null;
  if (b.proof_key != null) {
    const f = await c.env.DB.prepare("SELECT customer_id FROM files WHERE key = ? AND confirmed = 1 AND kind = 'payment_proof'").bind(String(b.proof_key)).first<any>();
    if (!f || f.customer_id !== o.customer_id) throw bad('File bukti tidak ditemukan');
    proof = String(b.proof_key);
  }
  const r = await c.env.DB.prepare('INSERT INTO payments (order_id, invoice_id, amount, proof_key, proof_uploaded_by, proof_uploaded_at, note) VALUES (?,?,?,?,?,?,?)')
    .bind(id, optNum(b, 'invoice_id'), amount, proof, proof ? u.id : null, proof ? now() : null, optStr(b, 'note', 300)).run();
  await audit(c.env.DB, u.id, 'payment_recorded', 'order', id);
  return c.json({ ok: true, id: r.meta.last_row_id, verified: false }, 201);
});

financeRoutes.post('/payments/:id/verify', need('payment.verify'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const p = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first<any>();
  if (!p) throw notFound();
  if (p.verified) throw conflict('Pembayaran sudah diverifikasi');
  await c.env.DB.prepare('UPDATE payments SET verified=1, verified_by=?, verified_at=?, note=COALESCE(?, note) WHERE id=?').bind(c.get('user').id, now(), optStr(b, 'note', 300), id).run();
  await audit(c.env.DB, c.get('user').id, 'payment_verified', 'payment', id);
  return c.json({ ok: true });
});

// Penawaran, invoice, pembayaran terverifikasi, dan Loss Sales adalah angka terpisah.
financeRoutes.get('/orders/:id/summary', async (c) => {
  const u = c.get('user');
  const id = intParam(c, 'id');
  const o = await c.env.DB.prepare('SELECT customer_id FROM orders WHERE id = ?').bind(id).first<any>();
  if (!o) throw notFound();
  assertCustomerScope(u, o.customer_id);
  const sum = async (sql: string) => (await c.env.DB.prepare(sql).bind(id).first<{ s: number }>())?.s ?? 0;
  return c.json({
    penawaran: await sum("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE order_id=? AND kind='penawaran'"),
    invoice: await sum("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE order_id=? AND kind='invoice'"),
    dp: await sum("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE order_id=? AND kind='dp'"),
    pembayaran_terverifikasi: await sum('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id=? AND verified=1'),
    pembayaran_belum_diverifikasi: await sum('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id=? AND verified=0'),
  });
});

// Loss Sales: penolakan biasa tercatat; double input tidak dihitung.
financeRoutes.post('/loss-sales', need('loss.write'), async (c) => {
  const b = await readJson(c);
  const r = await c.env.DB.prepare('INSERT INTO loss_sales (customer_id, reason, potential_amount, is_duplicate, by_user, at) VALUES (?,?,?,?,?,?)')
    .bind(optNum(b, 'customer_id'), reqStr(b, 'reason', 500), optTime(b, 'potential_amount'), b.is_duplicate ? 1 : 0, c.get('user').id, now()).run();
  return c.json({ ok: true, id: r.meta.last_row_id }, 201);
});
financeRoutes.get('/loss-sales/total', need('report.read'), async (c) => {
  const r = await c.env.DB.prepare('SELECT COALESCE(SUM(potential_amount),0) s, COUNT(*) n FROM loss_sales WHERE is_duplicate = 0').first();
  return c.json(r);
});

// Komplain/rework terhubung ke order/WO awal; tidak otomatis menyalahkan siapa pun atau membuat tagihan.
financeRoutes.post('/complaints', need('complaint.write'), async (c) => {
  const b = await readJson(c);
  const orderId = reqNum(b, 'order_id', 0);
  if (!(await c.env.DB.prepare('SELECT 1 FROM orders WHERE id = ?').bind(orderId).first())) throw notFound('Order tidak ditemukan');
  const r = await c.env.DB.prepare('INSERT INTO complaints (order_id, wo_id, description, evidence_key, opened_by, opened_at) VALUES (?,?,?,?,?,?)')
    .bind(orderId, optNum(b, 'wo_id'), reqStr(b, 'description', 2000), optStr(b, 'evidence_key', 200), c.get('user').id, now()).run();
  return c.json({ ok: true, id: r.meta.last_row_id }, 201);
});
financeRoutes.patch('/complaints/:id', need('complaint.write'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const status = oneOf(b, 'status', ['investigasi', 'solusi', 'selesai'] as const);
  if (status === 'selesai' && !optStr(b, 'solution')) throw bad('Solusi wajib diisi sebelum komplain diselesaikan');
  await c.env.DB.prepare('UPDATE complaints SET status=?, investigation=COALESCE(?, investigation), solution=COALESCE(?, solution), approved_by=CASE WHEN ?=\'selesai\' THEN ? ELSE approved_by END WHERE id=?')
    .bind(status, optStr(b, 'investigation'), optStr(b, 'solution'), status, c.get('user').id, id).run();
  return c.json({ ok: true });
});
financeRoutes.get('/complaints', async (c) => {
  if (!isStaff(c.get('user'))) throw forbidden();
  return c.json((await c.env.DB.prepare('SELECT * FROM complaints ORDER BY id DESC LIMIT 200').all()).results);
});
