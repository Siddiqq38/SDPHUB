import { Hono } from 'hono';
import type { Db } from '../db.ts';
import {
  audit, authn, bad, conflict, forbidden, intParam, isStaff, need, notFound, now, oneOf, optStr, readJson, reqNum, reqStr, type AppEnv,
} from '../core.ts';

export const stockRoutes = new Hono<AppEnv>();
stockRoutes.use('*', authn);

// Penerimaan: jumlah dinyatakan dan hasil ukur disimpan terpisah; selisih wajib dikonfirmasi.
stockRoutes.post('/lots', need('stock.write'), async (c) => {
  const u = c.get('user');
  const b = await readJson(c);
  const owner = oneOf(b, 'owner', ['sdp', 'customer'] as const);
  let customerId: number | null = null;
  if (owner === 'customer') {
    customerId = reqNum(b, 'customer_id', 0);
    if (!(await c.env.DB.prepare('SELECT 1 FROM customers WHERE id = ?').bind(customerId).first())) throw notFound('Customer tidak ditemukan');
  }
  const declared = reqNum(b, 'declared_qty', 0, true);
  const measured = reqNum(b, 'measured_qty', 0, true);
  const diff = Math.abs(declared - measured) > 1e-9;
  if (diff && b.diff_confirmed !== true) throw conflict('Ada selisih jumlah dinyatakan vs hasil ukur; konfirmasi selisih wajib');
  const roll = reqStr(b, 'roll_id', 60);
  if (await c.env.DB.prepare('SELECT 1 FROM material_lots WHERE roll_id = ?').bind(roll).first()) throw conflict('Roll ID sudah ada');
  if (b.photo_key != null && !(await c.env.DB.prepare("SELECT 1 FROM files WHERE key = ? AND confirmed = 1 AND kind = 'receiving_photo'").bind(String(b.photo_key)).first())) throw bad('Foto receiving tidak ditemukan');
  const r = await c.env.DB.prepare(
    `INSERT INTO material_lots (roll_id, sku, owner, customer_id, unit, declared_qty, measured_qty, diff_confirmed, condition, location, received_by, received_at, photo_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(roll, reqStr(b, 'sku', 60), owner, customerId, reqStr(b, 'unit', 20), declared, measured, diff ? 1 : 0, optStr(b, 'condition', 300), optStr(b, 'location', 60), u.id, now(), b.photo_key ?? null).run();
  const lotId = r.meta.last_row_id as number;
  await c.env.DB.prepare("INSERT INTO stock_ledger (lot_id, kind, qty, source_type, source_id, at, by_user) VALUES (?,'receive',?,'receiving',?,?,?)")
    .bind(lotId, measured, String(lotId), now(), u.id).run();
  await audit(c.env.DB, u.id, 'lot_received', 'lot', lotId);
  return c.json({ ok: true, id: lotId }, 201);
});

stockRoutes.put('/lots/:id/location', need('stock.write'), async (c) => {
  const b = await readJson(c);
  const r = await c.env.DB.prepare('UPDATE material_lots SET location = ? WHERE id = ?').bind(reqStr(b, 'location', 60), intParam(c, 'id')).run();
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

const LEDGER_KINDS = ['reserve', 'release_reserve', 'use', 'waste', 'return_stock', 'return_owner', 'sample', 'cleaning', 'maintenance'] as const;

// Ledger idempotent per sumber: kombinasi (source_type, source_id, kind) hanya dihitung sekali.
stockRoutes.post('/lots/:id/ledger', need('stock.use'), async (c) => {
  const u = c.get('user');
  const lotId = intParam(c, 'id');
  const b = await readJson(c);
  const kind = oneOf(b, 'kind', LEDGER_KINDS);
  const qty = reqNum(b, 'qty', 0);
  const sourceType = reqStr(b, 'source_type', 30);
  const sourceId = reqStr(b, 'source_id', 60);
  const lot = await c.env.DB.prepare('SELECT * FROM material_lots WHERE id = ?').bind(lotId).first<any>();
  if (!lot) throw notFound();
  if (['reserve', 'use'].includes(kind) && sourceType === 'wo') {
    const wo = await c.env.DB.prepare('SELECT w.status, o.customer_id FROM work_orders w JOIN orders o ON o.id = w.order_id WHERE w.id = ?').bind(Number(sourceId)).first<any>();
    if (!wo) throw notFound('WO sumber tidak ditemukan');
    // Bahan titipan customer tidak boleh dipakai customer lain.
    if (lot.owner === 'customer' && lot.customer_id !== wo.customer_id) throw forbidden('Bahan titipan milik customer lain');
  } else if (lot.owner === 'customer' && ['reserve', 'use'].includes(kind)) {
    throw forbidden('Bahan titipan customer hanya dapat dipakai lewat WO milik customer tersebut');
  }
  const dup = await c.env.DB.prepare('SELECT id FROM stock_ledger WHERE source_type = ? AND source_id = ? AND kind = ?').bind(sourceType, sourceId, kind).first();
  if (dup) return c.json({ ok: true, idempotent: true, id: dup.id });
  const bal = await balance(c.env.DB, lotId);
  if (kind === 'reserve' && qty > bal.available + 1e-9) throw conflict(`Stok tersedia hanya ${bal.available}`);
  if (['use', 'waste', 'sample', 'cleaning', 'maintenance', 'return_owner'].includes(kind) && qty > bal.on_hand + 1e-9) throw conflict(`Stok fisik hanya ${bal.on_hand}`);
  const stmts = [
    c.env.DB.prepare('INSERT INTO stock_ledger (lot_id, kind, qty, source_type, source_id, note, at, by_user) VALUES (?,?,?,?,?,?,?,?)')
      .bind(lotId, kind, qty, sourceType, sourceId, optStr(b, 'note', 300), now(), u.id),
  ];
  // Pemakaian aktual melepas reservasi sumber yang sama, sehingga tidak terhitung dua kali.
  if (kind === 'use') {
    const res = await c.env.DB.prepare("SELECT qty FROM stock_ledger WHERE lot_id = ? AND source_type = ? AND source_id = ? AND kind = 'reserve'").bind(lotId, sourceType, sourceId).first<{ qty: number }>();
    const rel = await c.env.DB.prepare("SELECT 1 FROM stock_ledger WHERE source_type = ? AND source_id = ? AND kind = 'release_reserve' AND lot_id = ?").bind(sourceType, sourceId, lotId).first();
    if (res && !rel) {
      stmts.push(c.env.DB.prepare("INSERT INTO stock_ledger (lot_id, kind, qty, source_type, source_id, note, at, by_user) VALUES (?,'release_reserve',?,?,?,'otomatis saat dipakai',?,?)")
        .bind(lotId, res.qty, sourceType, sourceId, now(), u.id));
    }
  }
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, u.id, 'ledger', 'lot', lotId, { kind, qty });
  return c.json({ ok: true, balance: await balance(c.env.DB, lotId) }, 201);
});

async function balance(db: Db, lotId: number) {
  const rows = await db.prepare('SELECT kind, SUM(qty) q FROM stock_ledger WHERE lot_id = ? GROUP BY kind').bind(lotId).all<{ kind: string; q: number }>();
  const q = Object.fromEntries(rows.results.map((r) => [r.kind, r.q]));
  const g = (k: string) => q[k] ?? 0;
  const on_hand = g('receive') + g('return_stock') - g('use') - g('waste') - g('sample') - g('cleaning') - g('maintenance') - g('return_owner');
  const reserved = g('reserve') - g('release_reserve');
  return { on_hand, reserved, available: on_hand - reserved };
}

stockRoutes.get('/lots', async (c) => {
  const u = c.get('user');
  if (!isStaff(u)) throw forbidden();
  const owner = c.req.query('owner');
  const rows = await c.env.DB.prepare(`SELECT l.*, cu.business_name AS customer_name FROM material_lots l LEFT JOIN customers cu ON cu.id = l.customer_id ${owner === 'sdp' || owner === 'customer' ? 'WHERE l.owner = ?' : ''} ORDER BY l.id DESC LIMIT 300`)
    .bind(...(owner === 'sdp' || owner === 'customer' ? [owner] : [])).all<any>();
  const out = [];
  for (const l of rows.results) out.push({ ...l, ...(await balance(c.env.DB, l.id)) });
  return c.json(out);
});
