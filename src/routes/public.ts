import { Hono } from 'hono';
import { FINAL_STAGE } from '../lib/sql.ts';
import { notFound, type AppEnv } from '../core.ts';

export const publicRoutes = new Hono<AppEnv>();

// Hanya informasi yang diisi master. Tidak ada alamat, kontak, harga, atau kapasitas karangan.
publicRoutes.get('/info', async (c) => {
  const settings = await c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('brand_name','company_name','contact_info','workshop_info')").all<{ key: string; value: string }>();
  const services = await c.env.DB.prepare('SELECT code, name, output_label FROM services WHERE active = 1').all();
  return c.json({ settings: Object.fromEntries(settings.results.map((s) => [s.key, s.value])), services: services.results });
});

const STAGE_LABEL: Record<string, string> = {
  menunggu_cs: 'Pesanan diterima, sedang diperiksa',
  menunggu_rilis: 'Menunggu persetujuan produksi',
  dirilis: 'Menunggu antrean produksi',
  berjalan: 'Dalam proses produksi',
  selesai_produksi: 'Produksi selesai, menyiapkan serah terima',
  serah_terima_sebagian: 'Sebagian hasil sudah diserahkan',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};

// Tracking publik: ringkasan aman saja. Tanpa nama/kontak/alamat, harga, pembayaran, file, operator, atau catatan internal.
publicRoutes.get('/track/:code', async (c) => {
  const code = c.req.param('code');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) throw notFound('Resi tidak ditemukan');
  const t = await c.env.DB.prepare(
    'SELECT o.id, o.status, o.sdp_promise_at, o.customer_deadline FROM tracking t JOIN orders o ON o.id = t.order_id WHERE t.code = ?',
  ).bind(code).first<any>();
  if (!t) throw notFound('Resi tidak ditemukan');
  const items = await c.env.DB.prepare(
    `SELECT s.output_label, i.prod_unit AS unit,
       COALESCE((SELECT SUM(q.qty_good_final) FROM qc_results q JOIN work_orders w ON w.id = q.wo_id WHERE w.item_id = i.id AND ${FINAL_STAGE}),0) AS good,
       COALESCE((SELECT SUM(h.qty_this) FROM handovers h WHERE h.item_id = i.id),0) AS handed
     FROM order_items i JOIN services s ON s.code = i.service_code WHERE i.order_id = ?`,
  ).bind(t.id).all<any>();
  const est = await c.env.DB.prepare("SELECT MAX(est_end_at) e FROM work_orders WHERE order_id = ? AND status != 'dibatalkan'").bind(t.id).first<{ e: number | null }>();
  c.header('Cache-Control', 'no-store');
  return c.json({
    status: STAGE_LABEL[t.status] ?? 'Dalam proses',
    items: items.results.map((i) => ({
      output: i.good > 0 && ['selesai_produksi', 'serah_terima_sebagian', 'selesai'].includes(t.status) ? `${i.output_label} siap` : i.output_label,
      unit: i.unit, qty_baik: i.good, qty_diserahkan: i.handed,
    })),
    janji_selesai: t.sdp_promise_at ?? null,
    estimasi_selesai: est?.e ?? null,
  });
});
