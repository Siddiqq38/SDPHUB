// Inventory per roll / kemasan: master SKU dan bin, GR, put away, pemakaian, dan opname.
// Stok SKU = jumlah sisa semua lot yang sudah di-put away.
import { Hono } from 'hono';
import { allow, audit, authn, bad, conflict, notFound, now, oneOf, optStr, readJson, reqNum, reqStr, type AppEnv } from '../core.ts';
import type { Db } from '../db.ts';
import type { Role } from '../domain.ts';
import { allocate, candidates, type Lot, type Sku, type Stage } from '../lib/materials.ts';
import { activeJobs, planConfig } from './capacity.ts';
import { loadSettings } from '../core.ts';

export const RECEIVERS: Role[] = ['gudang', 'op', 'cs', 'spv', 'manager']; // GR dan put away: seluruh tim SDP
export const USERS_OF_STOCK: Role[] = ['gudang', 'op', 'spv'];
const KEEPERS: Role[] = ['gudang', 'spv'];
export const USAGE = { produksi: 'Produksi', test: 'Test print', reject: 'Reject', refund: 'Refund', waste: 'Waste' } as const;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const CODE = /^[A-Z0-9][A-Z0-9._-]{1,29}$/;
const codeOf = (b: Record<string, any>, k: string, label: string) => {
  const v = reqStr(b, k, 30).toUpperCase();
  if (!CODE.test(v)) throw bad(`${label} 2 sampai 30 huruf, angka, titik, garis, tanpa spasi`);
  return v;
};
const amount = (v: unknown, label: string) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e6 || Math.abs(round3(v) - v) > 1e-9) throw bad(`${label} harus angka 0 atau lebih, maksimal 3 angka desimal`);
  return v;
};

export async function recount(db: Db, sku: string) {
  await db.prepare("UPDATE skus SET stock = ROUND((SELECT COALESCE(SUM(qty_left), 0) FROM lots WHERE sku_code = ? AND status = 'tersedia')::numeric, 3) WHERE code = ?").bind(sku, sku).run();
}
async function lotOf(db: Db, code: string) {
  const lot = await db.prepare('SELECT * FROM lots WHERE lot_code = ? FOR UPDATE').bind(code).first<any>();
  if (!lot) throw notFound('Roll / lot tidak ditemukan');
  return lot;
}
const entry = (db: Db, sku: string, lot: string, type: string, qty: number, ref: string, note: string | null, by: string, key: string | null = null) =>
  db.prepare('INSERT INTO stock_ledger (sku_code, lot_code, type, qty, ref, note, by_user, at, request_key) VALUES (?,?,?,?,?,?,?,?,?)').bind(sku, lot, type, qty, ref, note, by, now(), key).run();

export async function materialData(db: Db) {
  const skus = (await db.prepare('SELECT code, name, machine, unit FROM skus ORDER BY code').all<Sku & { name: string }>()).results;
  const lots = (await db.prepare("SELECT lot_code, sku_code, bin, status, qty_left, qty_initial, received_at FROM lots WHERE status = 'tersedia' ORDER BY id").all<Lot>()).results;
  return { skus, lots };
}
/** Rekomendasi dan booking untuk semua order aktif. */
export async function materialPlan(db: Db) {
  const { skus, lots } = await materialData(db);
  const cfg = planConfig(await loadSettings(db));
  return { skus, lots, ...allocate(await activeJobs(db), lots, skus, now(), cfg.holdMin) };
}

/** Potong satu roll; tiap jenis pemakaian menjadi satu baris kartu stok. */
async function consume(db: Db, lot: any, parts: { label: string; qty: number }[], ref: string, note: string | null, by: string, key: string | null) {
  const total = round3(parts.reduce((a, p) => a + p.qty, 0));
  if (total > lot.qty_left + 1e-9) throw conflict(`Pemakaian ${total} melebihi sisa ${lot.lot_code} (${lot.qty_left})`);
  const left = round3(lot.qty_left - total);
  for (const p of parts) await entry(db, lot.sku_code, lot.lot_code, p.label, -p.qty, ref, note, by, key);
  await db.prepare('UPDATE lots SET qty_left = ?, status = ? WHERE id = ?').bind(left, left > 0 ? 'tersedia' : 'habis', lot.id).run();
  await recount(db, lot.sku_code);
  return left;
}
function partsOf(b: Record<string, any>) {
  const parts = Object.entries(USAGE).map(([k, label]) => ({ label, qty: amount(b[k] ?? 0, label) })).filter((p) => p.qty > 0);
  if (!parts.length) throw bad('Isi minimal satu jumlah pemakaian');
  const note = optStr(b, 'note', 300);
  if (!note && parts.some((p) => ['Reject', 'Refund', 'Waste'].includes(p.label))) throw bad('Isi keterangan untuk reject, refund, atau waste');
  return { parts, note };
}

/**
 * Pemakaian bahan saat satu tahap produksi selesai. Wajib diisi bila bahannya ada di rak;
 * roll di luar rekomendasi boleh dipakai dengan keterangan.
 */
export async function consumeForOrder(db: Db, o: any, input: unknown, by: string) {
  const plan = await materialPlan(db);
  const stage = o.stage as Stage;
  const codes = candidates(plan.skus, stage, o.fabric_sku);
  const list = input === undefined || input === null ? [] : input;
  if (!Array.isArray(list) || list.length > 5) throw bad('Daftar bahan tidak valid');
  if (!list.length) {
    if (plan.lots.some((l) => codes.includes(l.sku_code))) throw bad('Catat roll yang dipakai untuk order ini');
    return 0;
  }
  const recommended = plan.needs.find((n) => n.id === o.id && n.stage === stage)?.picks.map((p) => p.lot) ?? [];
  const seen = new Set<string>();
  for (const m of list as Record<string, any>[]) {
    const code = reqStr(m, 'lot', 40);
    if (seen.has(code)) throw bad('Satu roll cukup diisi satu baris');
    seen.add(code);
    const { parts, note } = partsOf(m);
    const lot = await lotOf(db, code);
    if (lot.status !== 'tersedia') throw conflict(`Roll ${code} tidak tersedia`);
    if (!codes.includes(lot.sku_code)) throw bad(`Roll ${code} bukan bahan untuk tahap ini`);
    if (!note && recommended.length && !recommended.includes(code)) throw bad(`${code} di luar rekomendasi. Isi alasan penggantian`);
    await consume(db, lot, parts, o.order_no, note, by, null);
  }
  return list.length;
}

/**
 * Hasil cetak yang ternyata reject atau di-refund: pindahkan dari Produksi (print bagus) ke kategori itu.
 * Stok roll tidak berubah karena filmnya sudah terpotong. Mengembalikan meter yang dipindahkan.
 */
export async function reclassify(db: Db, orderNo: string, type: 'Reject' | 'Refund', meter: number, reason: string, by: string) {
  const used = (await db.prepare("SELECT lot_code, sku_code, SUM(-qty) AS q, MAX(id) AS last FROM stock_ledger WHERE ref = ? AND type = 'Produksi' GROUP BY lot_code, sku_code ORDER BY MAX(id) DESC").bind(orderNo).all<any>()).results;
  let rest = meter;
  for (const u of used) {
    const take = round3(Math.min(rest, Number(u.q)));
    if (take <= 0) continue;
    await entry(db, u.sku_code, u.lot_code, 'Produksi', take, orderNo, 'Dipindahkan ke ' + type, by);
    await entry(db, u.sku_code, u.lot_code, type, -take, orderNo, reason, by);
    rest = round3(rest - take);
    if (rest <= 0) break;
  }
  return round3(meter - rest);
}

export const inventoryRoutes = new Hono<AppEnv>();
inventoryRoutes.use('*', authn);

// ---- Master ----
inventoryRoutes.post('/sku', async (c) => {
  await allow(c, KEEPERS, 'stok');
  const b = await readJson(c);
  const code = codeOf(b, 'code', 'Kode SKU');
  const machine = oneOf(b, 'machine', ['dtf', 'subp', 'cal'] as const);
  const unit = oneOf(b, 'unit', ['meter', 'ml', 'gram', 'pcs'] as const);
  const min = reqNum(b, 'min', 0, true);
  const name = reqStr(b, 'name', 150);
  if (await c.env.DB.prepare('SELECT 1 FROM skus WHERE code = ?').bind(code).first()) throw conflict('Kode SKU sudah dipakai');
  await c.env.DB.prepare('INSERT INTO skus (code, name, svc, unit, stock, min_stock, machine) VALUES (?,?,?,?,0,?,?)')
    .bind(code, name, machine === 'dtf' ? 'dtf' : 'sub', unit, min, machine).run();
  await audit(c.env.DB, c.get('user').id, 'sku_created', 'sku', code);
  return c.json({ ok: true }, 201);
});
inventoryRoutes.put('/sku/:code', async (c) => {
  await allow(c, KEEPERS, 'stok');
  const b = await readJson(c);
  const min = reqNum(b, 'min', 0, true);
  const r = await c.env.DB.prepare('UPDATE skus SET min_stock = ? WHERE code = ?').bind(min, c.req.param('code')).run();
  if (!r.meta.changes) throw notFound('SKU tidak ditemukan');
  await audit(c.env.DB, c.get('user').id, 'sku_updated', 'sku', c.req.param('code'), { min });
  return c.json({ ok: true });
});
inventoryRoutes.post('/bin', async (c) => {
  await allow(c, KEEPERS, 'stok');
  const b = await readJson(c);
  const code = codeOf(b, 'code', 'Kode bin');
  await c.env.DB.tx(async (db) => {
    if (b.remove === true) {
      if (await db.prepare("SELECT 1 FROM lots WHERE bin = ? AND status <> 'habis'").bind(code).first()) throw conflict('Bin masih berisi barang');
      if (!(await db.prepare('DELETE FROM bins WHERE code = ?').bind(code).run()).meta.changes) throw notFound('Bin tidak ditemukan');
    } else {
      if (await db.prepare('SELECT 1 FROM bins WHERE code = ?').bind(code).first()) throw conflict('Kode bin sudah ada');
      await db.prepare('INSERT INTO bins (code, note, created_at) VALUES (?,?,?)').bind(code, optStr(b, 'note', 100), now()).run();
    }
    await audit(db, c.get('user').id, b.remove === true ? 'bin_removed' : 'bin_created', 'bin', code);
  });
  return c.json({ ok: true }, 201);
});

// ---- GR: setiap roll / kemasan mendapat ID sendiri ----
inventoryRoutes.post('/gr', async (c) => {
  await allow(c, RECEIVERS, 'stok');
  const b = await readJson(c);
  const requestKey = reqStr(b, 'request_key', 64);
  const sku = reqStr(b, 'sku', 60);
  const batch = codeOf(b, 'batch', 'Nomor batch');
  const rolls = reqNum(b, 'rolls', 0);
  if (!Number.isInteger(rolls) || rolls > 100) throw bad('Jumlah roll / kemasan 1 sampai 100');
  const qty = amount(b.qty, 'Isi per roll');
  if (!qty) throw bad('Isi per roll harus lebih dari 0');
  const supplier = reqStr(b, 'supplier', 150);
  const docNo = optStr(b, 'doc_no', 60);
  const u = c.get('user');
  const result = await c.env.DB.tx(async (db) => {
    const dup = await db.prepare('SELECT lot_code FROM lots WHERE request_key = ? ORDER BY id').bind(requestKey).all<any>();
    if (dup.results.length) return { ok: true, duplicate: true, lots: dup.results.map((x) => x.lot_code) };
    if (!(await db.prepare('SELECT 1 FROM skus WHERE code = ? FOR UPDATE').bind(sku).first())) throw notFound('SKU tidak ditemukan');
    const used = await db.prepare('SELECT lot_code FROM lots WHERE batch = ?').bind(batch).all<any>();
    let n = used.results.reduce((a, x) => Math.max(a, Number(x.lot_code.slice(batch.length + 1)) || 0), 0);
    const codes: string[] = [];
    for (let i = 0; i < rolls; i++) {
      const code = `${batch}-${String(++n).padStart(2, '0')}`;
      await db.prepare("INSERT INTO lots (lot_code, sku_code, batch, qty_initial, qty_left, status, supplier, doc_no, received_by, received_at, request_key) VALUES (?,?,?,?,?, 'menunggu', ?,?,?,?,?)")
        .bind(code, sku, batch, qty, qty, supplier, docNo, u.code, now(), requestKey).run();
      await entry(db, sku, code, 'GR', qty, docNo ?? 'GR', supplier, u.code);
      codes.push(code);
    }
    await audit(db, u.id, 'goods_received', 'sku', sku, { batch, rolls, qty });
    return { ok: true, lots: codes };
  });
  return c.json(result, 201);
});

// Put away (atau pindah bin). Stok baru dihitung tersedia setelah punya bin.
inventoryRoutes.post('/putaway', async (c) => {
  await allow(c, RECEIVERS, 'stok');
  const b = await readJson(c);
  const code = reqStr(b, 'lot', 40);
  const bin = reqStr(b, 'bin', 30).toUpperCase();
  const u = c.get('user');
  await c.env.DB.tx(async (db) => {
    const lot = await lotOf(db, code);
    if (lot.status === 'habis') throw conflict('Roll ini sudah habis');
    if (!(await db.prepare('SELECT 1 FROM bins WHERE code = ?').bind(bin).first())) throw bad('Bin belum terdaftar di Master Bin');
    if (lot.bin === bin) throw conflict('Roll sudah berada di bin tersebut');
    await db.prepare("UPDATE lots SET bin = ?, status = 'tersedia', putaway_by = ?, putaway_at = ? WHERE id = ?").bind(bin, u.code, now(), lot.id).run();
    await entry(db, lot.sku_code, code, lot.bin ? 'Pindah bin' : 'Put away', 0, bin, lot.bin ? `${lot.bin} ke ${bin}` : null, u.code);
    await recount(db, lot.sku_code);
  });
  return c.json({ ok: true });
});

// ---- Pemakaian per roll: produksi, test print, reject, waste dicatat terpisah ----
inventoryRoutes.post('/use', async (c) => {
  await allow(c, USERS_OF_STOCK, 'stok');
  const b = await readJson(c);
  const requestKey = reqStr(b, 'request_key', 64);
  const code = reqStr(b, 'lot', 40);
  const { parts, note } = partsOf(b);
  const orderNo = optStr(b, 'order_no', 40);
  const u = c.get('user');
  const result = await c.env.DB.tx(async (db) => {
    if (await db.prepare('SELECT 1 FROM stock_ledger WHERE request_key = ?').bind(requestKey).first()) return { ok: true, duplicate: true };
    const lot = await lotOf(db, code);
    if (lot.status !== 'tersedia') throw conflict(lot.status === 'menunggu' ? 'Roll belum di-put away' : 'Roll ini sudah habis');
    if (orderNo && !(await db.prepare('SELECT 1 FROM orders WHERE order_no = ?').bind(orderNo).first())) throw bad('Nomor order tidak ditemukan');
    const left = await consume(db, lot, parts, orderNo ?? 'manual', note, u.code, requestKey);
    return { ok: true, left };
  });
  return c.json(result, 201);
});

// Reject atau refund yang diketahui belakangan, dari hasil produksi sebuah order.
inventoryRoutes.post('/reclass', async (c) => {
  await allow(c, USERS_OF_STOCK, 'stok');
  const b = await readJson(c);
  const orderNo = reqStr(b, 'order_no', 40);
  const type = oneOf(b, 'type', ['Reject', 'Refund'] as const);
  const meter = amount(b.meter, 'Meter');
  const reason = reqStr(b, 'reason', 300);
  if (!meter) throw bad('Isi meter lebih dari 0');
  const moved = await c.env.DB.tx(async (db) => {
    const n = await reclassify(db, orderNo, type, meter, reason, c.get('user').code);
    if (n < meter - 1e-9) throw conflict(`Pemakaian produksi order ini hanya ${n} m`);
    await audit(db, c.get('user').id, 'stock_reclass', 'order', orderNo, { type, meter });
    return n;
  });
  return c.json({ ok: true, moved }, 201);
});

// Kemasan (tinta, powder, kertas pelindung) atau sisa ujung roll dinyatakan habis.
inventoryRoutes.post('/empty', async (c) => {
  await allow(c, USERS_OF_STOCK, 'stok');
  const b = await readJson(c);
  const code = reqStr(b, 'lot', 40);
  const u = c.get('user');
  await c.env.DB.tx(async (db) => {
    const lot = await lotOf(db, code);
    if (lot.status !== 'tersedia') throw conflict('Hanya roll yang tersedia yang dapat ditandai habis');
    await entry(db, lot.sku_code, code, 'Habis', -lot.qty_left, 'manual', optStr(b, 'note', 300), u.code);
    await db.prepare("UPDATE lots SET qty_left = 0, status = 'habis' WHERE id = ?").bind(lot.id).run();
    await recount(db, lot.sku_code);
  });
  return c.json({ ok: true });
});

// Stock opname per roll: hanya SPV, dengan alasan.
inventoryRoutes.post('/adjust', async (c) => {
  await allow(c, ['spv'], 'stok');
  const b = await readJson(c);
  const code = reqStr(b, 'lot', 40);
  const actual = amount(b.qty, 'Sisa aktual');
  const note = reqStr(b, 'note', 300);
  const u = c.get('user');
  await c.env.DB.tx(async (db) => {
    const lot = await lotOf(db, code);
    if (lot.status === 'menunggu') throw conflict('Roll belum di-put away');
    const delta = round3(actual - lot.qty_left);
    if (!delta) throw conflict('Sisa aktual sama dengan catatan');
    await entry(db, lot.sku_code, code, 'Opname', delta, 'opname', note, u.code);
    await db.prepare('UPDATE lots SET qty_left = ?, status = ? WHERE id = ?').bind(actual, actual > 0 ? 'tersedia' : 'habis', lot.id).run();
    await recount(db, lot.sku_code);
    await audit(db, u.id, 'stock_adjusted', 'lot', code, { delta });
  });
  return c.json({ ok: true });
});
