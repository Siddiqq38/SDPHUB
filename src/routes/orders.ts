import { Hono } from 'hono';
import { FINAL_STAGE } from '../lib/sql.ts';
import { randomToken } from '../lib/auth.ts';
import { convert } from '../lib/units.ts';
import {
  assertCustomerScope, audit, authn, bad, conflict, forbidden, intParam, isStaff, need, notFound, now, oneOf, optNum, optStr, optTime, readJson, reqNum, reqStr,
  type AppEnv,
} from '../core.ts';

export const orderRoutes = new Hono<AppEnv>();
orderRoutes.use('*', authn);

const PRIORITIES = ['rendah', 'normal', 'tinggi', 'urgent'] as const;

async function orderOr404(c: any, id: number) {
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) throw notFound();
  assertCustomerScope(c.get('user'), o.customer_id);
  return o as any;
}

orderRoutes.post('/', async (c) => {
  const u = c.get('user');
  const b = await readJson(c);
  let customerId: number;
  if (u.role === 'customer') {
    if (!u.customer_id) throw forbidden();
    customerId = u.customer_id;
  } else if (u.role === 'cs') {
    customerId = reqNum(b, 'customer_id', 0);
  } else throw forbidden();
  const cust = await c.env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(customerId).first();
  if (!cust) throw notFound('Customer tidak ditemukan');
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 50) throw bad('Pesanan harus berisi 1-50 item layanan');

  const services = await c.env.DB.prepare('SELECT code, active FROM services').all<{ code: string; active: number }>();
  const active = new Set(services.results.filter((s) => s.active).map((s) => s.code));
  const items = b.items.map((it: any) => {
    if (!it || typeof it !== 'object') throw bad('Item tidak valid');
    const service = oneOf(it, 'service_code', ['DTF', 'SUBLIM_KERTAS', 'SUBLIM_KAIN'] as const);
    if (!active.has(service)) throw bad(`Layanan ${service} sedang tidak aktif`);
    const order_qty = reqNum(it, 'order_qty', 0);
    const order_unit = reqStr(it, 'order_unit', 20);
    const prod_unit = reqStr(it, 'prod_unit', 20);
    const bill_unit = reqStr(it, 'bill_unit', 20);
    const prod_per_order = optNum(it, 'prod_per_order');
    const bill_per_order = optNum(it, 'bill_per_order');
    convert({ qty: order_qty, unit: order_unit }, prod_unit, prod_per_order);
    convert({ qty: order_qty, unit: order_unit }, bill_unit, bill_per_order);
    return {
      service, order_qty, order_unit, prod_unit, bill_unit, prod_per_order, bill_per_order,
      description: optStr(it, 'description'), media_width_mm: optNum(it, 'media_width_mm'), print_width_mm: optNum(it, 'print_width_mm'),
      design_size: optStr(it, 'design_size', 100), material_type: optStr(it, 'material_type', 100),
      material_owner: it.material_owner === 'customer' ? 'customer' : 'sdp', output_form: optStr(it, 'output_form', 100),
    };
  });

  const t = now();
  const ins = await c.env.DB.prepare(
    `INSERT INTO orders (order_no, customer_id, po_ref, end_customer_ref, received_at, customer_deadline, priority, description,
       packing_note, handover_method, qc_requirements, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    'TMP-' + randomToken(6), customerId, optStr(b, 'po_ref', 100), optStr(b, 'end_customer_ref', 150), t, optTime(b, 'customer_deadline'),
    b.priority ? oneOf(b, 'priority', PRIORITIES) : 'normal', optStr(b, 'description'), optStr(b, 'packing_note'),
    optStr(b, 'handover_method', 100), optStr(b, 'qc_requirements'), optStr(b, 'notes'), u.id, t,
  ).run();
  const id = ins.meta.last_row_id as number;
  const yymm = new Date(t + 480 * 60_000).toISOString().slice(2, 7).replace('-', '');
  const orderNo = `SDP-${yymm}-${String(id).padStart(4, '0')}`;
  const track = randomToken(16); // 128 bit
  const stmts = [
    c.env.DB.prepare('UPDATE orders SET order_no = ? WHERE id = ?').bind(orderNo, id),
    c.env.DB.prepare('INSERT INTO tracking (code, order_id, created_at) VALUES (?,?,?)').bind(track, id, t),
    ...items.map((i: any) =>
      c.env.DB.prepare(
        `INSERT INTO order_items (order_id, service_code, description, order_qty, order_unit, prod_unit, bill_unit, prod_per_order, bill_per_order,
           media_width_mm, print_width_mm, design_size, material_type, material_owner, output_form) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(id, i.service, i.description, i.order_qty, i.order_unit, i.prod_unit, i.bill_unit, i.prod_per_order, i.bill_per_order,
        i.media_width_mm, i.print_width_mm, i.design_size, i.material_type, i.material_owner, i.output_form),
    ),
  ];
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, u.id, 'order_created', 'order', id);
  return c.json({ ok: true, id, order_no: orderNo, tracking_code: track }, 201);
});

orderRoutes.get('/', async (c) => {
  const u = c.get('user');
  const where = u.role === 'customer' ? 'WHERE o.customer_id = ?' : '';
  const stmt = c.env.DB.prepare(
    `SELECT o.id, o.order_no, o.status, o.priority, o.received_at, o.customer_deadline, o.sdp_promise_at, c.business_name,
       (SELECT string_agg(DISTINCT service_code, ',') FROM order_items WHERE order_id = o.id) AS services
     FROM orders o JOIN customers c ON c.id = o.customer_id ${where} ORDER BY o.id DESC LIMIT 300`,
  );
  const rows = await (u.role === 'customer' ? stmt.bind(u.customer_id) : stmt).all();
  return c.json(rows.results);
});

orderRoutes.get('/:id', async (c) => {
  const id = intParam(c, 'id');
  const o = await orderOr404(c, id);
  const u = c.get('user');
  const [items, wos, tracking, cust] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(id).all(),
    c.env.DB.prepare('SELECT w.*, m.code AS machine_code FROM work_orders w JOIN machines m ON m.id = w.machine_id WHERE w.order_id = ? ORDER BY w.id').bind(id).all(),
    c.env.DB.prepare('SELECT code FROM tracking WHERE order_id = ?').bind(id).first<{ code: string }>(),
    c.env.DB.prepare('SELECT code, business_name, pic_name, contact, payment_policy FROM customers WHERE id = ?').bind(o.customer_id).first(),
  ]);
  const arts = await c.env.DB.prepare(
    'SELECT a.* FROM artworks a JOIN order_items i ON i.id = a.item_id WHERE i.order_id = ? ORDER BY a.item_id, a.version',
  ).bind(id).all();
  // Customer tidak melihat catatan internal.
  const out: any = { ...o, items: items.results, work_orders: wos.results, artworks: arts.results, tracking_code: tracking?.code, customer: cust };
  if (u.role === 'customer') {
    for (const k of ['cs_validation_note', 'cs_confirm_ref', 'notes']) delete out[k];
    out.work_orders = [];
  }
  // Proyeksi melewati deadline -> CS wajib konfirmasi ulang; deadline tidak digeser diam-diam.
  const latest = Math.max(0, ...wos.results.map((w: any) => w.est_end_at ?? 0));
  out.needs_reconfirm = !!(o.customer_deadline && latest > o.customer_deadline);
  return c.json(out);
});

// Validasi CS: konfirmasi detail ke PIC, bukti, kebijakan pembayaran, kelayakan deadline.
orderRoutes.post('/:id/cs-validate', need('order.cs_validate'), async (c) => {
  const id = intParam(c, 'id');
  const o = await orderOr404(c, id);
  if (!['menunggu_cs', 'menunggu_rilis'].includes(o.status)) throw conflict('Order sudah melewati tahap CS');
  const b = await readJson(c);
  if (b.detail_confirmed !== true) throw bad('Detail wajib dikonfirmasi ke PIC');
  const ref = reqStr(b, 'confirm_ref', 300);
  if (b.payment_policy_checked !== true) throw bad('Kebijakan pembayaran wajib diperiksa');
  if (b.deadline_feasible !== true) throw bad('Kelayakan deadline wajib dinyatakan layak, atau konfirmasi ulang ke customer');
  const note = reqStr(b, 'validation_note', 1000);
  const promise = optTime(b, 'sdp_promise_at');
  const prev = o.sdp_promise_at && promise && promise !== o.sdp_promise_at ? [...JSON.parse(o.sdp_promise_prev_json), o.sdp_promise_at] : JSON.parse(o.sdp_promise_prev_json);
  await c.env.DB.prepare(
    `UPDATE orders SET cs_confirmed_detail=1, cs_confirm_ref=?, cs_payment_checked=1, cs_deadline_feasible=1, cs_validation_note=?,
       cs_by=?, cs_at=?, status='menunggu_rilis', sdp_promise_at=COALESCE(?, sdp_promise_at), sdp_promise_prev_json=? WHERE id=?`,
  ).bind(ref, note, c.get('user').id, now(), promise, JSON.stringify(prev), id).run();
  await audit(c.env.DB, c.get('user').id, 'order_cs_validated', 'order', id);
  return c.json({ ok: true });
});

// Rilis produksi oleh penanggung jawab. CS tidak dapat merilis pesanannya sendiri.
orderRoutes.post('/:id/release', need('order.release'), async (c) => {
  const id = intParam(c, 'id');
  const o = await orderOr404(c, id);
  if (o.status !== 'menunggu_rilis' || !o.cs_confirmed_detail) throw conflict('Order belum divalidasi CS');
  const items = await c.env.DB.prepare('SELECT id, approved_artwork_id FROM order_items WHERE order_id = ?').bind(id).all<any>();
  for (const it of items.results) {
    if (!it.approved_artwork_id) throw conflict(`Item #${it.id} belum punya versi artwork yang disetujui`);
  }
  await c.env.DB.prepare("UPDATE orders SET status='dirilis', release_by=?, release_at=? WHERE id=?").bind(c.get('user').id, now(), id).run();
  await audit(c.env.DB, c.get('user').id, 'order_released', 'order', id);
  return c.json({ ok: true });
});

orderRoutes.post('/:id/cancel', async (c) => {
  const id = intParam(c, 'id');
  const o = await orderOr404(c, id);
  const u = c.get('user');
  if (!(u.role === 'customer' || ['cs', 'master', 'supervisor'].includes(u.role))) throw forbidden();
  if (['selesai', 'dibatalkan', 'serah_terima_sebagian'].includes(o.status)) throw conflict('Order tidak dapat dibatalkan pada status ini');
  const running = await c.env.DB.prepare("SELECT 1 FROM work_orders WHERE order_id = ? AND status IN ('berjalan','selesai')").bind(id).first();
  if (running) throw conflict('Produksi sudah dimulai; gunakan alur komplain/rework, bukan pembatalan');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE work_orders SET status='dibatalkan' WHERE order_id = ? AND status='menunggu'").bind(id),
    c.env.DB.prepare("UPDATE orders SET status='dibatalkan' WHERE id = ?").bind(id),
  ]);
  await audit(c.env.DB, u.id, 'order_cancelled', 'order', id);
  return c.json({ ok: true });
});

// Penutupan: seluruh hasil baik sudah diserahkan dan tidak ada WO terbuka.
orderRoutes.post('/:id/close', need('order.close'), async (c) => {
  const id = intParam(c, 'id');
  const o = await orderOr404(c, id);
  if (!['serah_terima_sebagian', 'selesai_produksi'].includes(o.status)) throw conflict('Order belum siap ditutup');
  const open = await c.env.DB.prepare("SELECT COUNT(*) n FROM work_orders WHERE order_id = ? AND status IN ('menunggu','berjalan')").bind(id).first<{ n: number }>();
  if (open!.n) throw conflict('Masih ada WO yang belum selesai');
  const left = await c.env.DB.prepare(
    `SELECT i.id,
       COALESCE((SELECT SUM(q.qty_good_final) FROM qc_results q JOIN work_orders w ON w.id = q.wo_id WHERE w.item_id = i.id AND ${FINAL_STAGE}), 0) AS good,
       COALESCE((SELECT SUM(h.qty_this) FROM handovers h WHERE h.item_id = i.id), 0) AS handed
     FROM order_items i WHERE i.order_id = ?`,
  ).bind(id).all<any>();
  for (const r of left.results) if (r.good - r.handed > 1e-9) throw conflict(`Item #${r.id} masih punya hasil baik yang belum diserahkan`);
  if (left.results.every((r) => r.handed === 0)) throw conflict('Belum ada serah terima');
  await c.env.DB.prepare("UPDATE orders SET status='selesai', closed_at=? WHERE id=?").bind(now(), id).run();
  await audit(c.env.DB, c.get('user').id, 'order_closed', 'order', id);
  return c.json({ ok: true });
});

void isStaff;
