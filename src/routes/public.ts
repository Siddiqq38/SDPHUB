import { Hono } from 'hono';
import { addWorkSeconds } from '../lib/calendar.ts';
import { calendarOf, loadSettings, notFound, now, numericSettings, type AppEnv } from '../core.ts';
import { MACHINES, type Machine } from '../domain.ts';

export const publicRoutes = new Hono<AppEnv>();

// Harga layanan (diisi master). Tidak ada data customer atau internal.
publicRoutes.get('/info', async (c) => {
  const s = numericSettings(await loadSettings(c.env.DB));
  return c.json({ settings: { priceDtf: s.priceDtf, priceSub120: s.priceSub120, priceSub160: s.priceSub160, priceSub180: s.priceSub180 } });
});

// Lacak order dengan resi acak. Tanpa nama, nomor telepon, harga, atau catatan internal.
publicRoutes.get('/track/:code', async (c) => {
  const raw = c.req.param('code');
  const code = /^rs-/i.test(raw) ? raw.toUpperCase() : raw; // resi lama (acak panjang) tetap berlaku
  if (!/^([A-Za-z0-9_-]{20,64}|RS-[0-9A-Z]{5}-[0-9A-Z]{5})$/.test(code)) throw notFound('Resi tidak ditemukan');
  const o = await c.env.DB.prepare('SELECT id, service, items, status, stage, started_at, rework_m, meter FROM orders WHERE track_code = ?').bind(code).first<any>();
  if (!o) throw notFound('Resi tidak ditemukan');
  let estimate: number | null = null;
  if (['antrian', 'produksi', 'curing'].includes(o.status)) {
    const settings = await loadSettings(c.env.DB);
    const norm = numericSettings(settings)[MACHINES[o.stage as Machine].norm];
    if (norm) {
      const cfg = calendarOf(settings);
      const queue = await c.env.DB.prepare(
        `SELECT id, status, started_at, COALESCE(rework_m, meter) AS m FROM orders WHERE stage = ? AND status IN ('antrian','produksi','curing')
         ORDER BY (status <> 'antrian') DESC, priority DESC, approved_at, id`,
      ).bind(o.stage).all<any>();
      let cursor = now();
      for (const q of queue.results) {
        const end = addWorkSeconds(q.status === 'antrian' ? cursor : q.started_at, q.m * norm, cfg);
        cursor = Math.max(cursor, end);
        if (q.id === o.id) { estimate = end; break; }
      }
    }
  }
  c.header('Cache-Control', 'no-store');
  return c.json({
    service: o.service,
    items: (JSON.parse(o.items) as any[]).map((i) => ({ name: i.name, qty: i.qty, unit: i.unit })),
    status: o.status,
    estimate,
  });
});
