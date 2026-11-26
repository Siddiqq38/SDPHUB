import { Hono } from 'hono';
import { randomToken } from '../lib/auth.ts';
import { localDay } from '../lib/calendar.ts';
import type { Db } from '../db.ts';
import {
  allow, audit, authn, bad, calendarOf, conflict, forbidden, intParam, loadSettings, notFound, now, numericSettings, oneOf, optStr, readJson, reqNum, reqStr,
  rule, type AppEnv, type Ctx,
} from '../core.ts';
import { CURING, FILE_CHECKS, QC_CHECKS, buildItems, meterOf, totalOf, type Item } from '../domain.ts';

export const orderRoutes = new Hono<AppEnv>();
orderRoutes.use('*', authn);

const METHODS = ['Transfer', 'QRIS', 'Tunai'] as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Jalankan perubahan order dalam satu transaksi dengan baris order terkunci. */
async function withOrder<T>(c: Ctx, id: number, fn: (db: Db, o: any) => Promise<T>): Promise<T> {
  return c.env.DB.tx(async (db) => {
    const o = await db.prepare('SELECT * FROM orders WHERE id = ? FOR UPDATE').bind(id).first<any>();
    if (!o) throw notFound('Order tidak ditemukan');
    const u = c.get('user');
    if (u.role === 'store' && o.created_by !== u.code) throw notFound('Order tidak ditemukan'); // Store Head hanya order miliknya
    return fn(db, o);
  });
}
const paidOf = async (db: Db, orderId: number) =>
  (await db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id = ?').bind(orderId).first<{ s: number }>())!.s;

async function customerActive(db: Db, o: any) {
  if (!o.customer_id) return true;
  const c = await db.prepare('SELECT status FROM customers WHERE id = ?').bind(o.customer_id).first<{ status: string }>();
  return c?.status === 'aktif';
}

/** Order masuk antrian cetak hanya bila file sudah layak (status bayar) dan lunas. */
async function release(db: Db, orderId: number): Promise<boolean> {
  const o = await db.prepare('SELECT status, total FROM orders WHERE id = ?').bind(orderId).first<any>();
  if (o.status !== 'bayar' || (await paidOf(db, orderId)) < o.total) return false;
  await db.prepare("UPDATE orders SET status = 'antrian', approved_at = ? WHERE id = ?").bind(now(), orderId).run();
  return true;
}

async function checkArtwork(db: Db, key: string | null, userId: number) {
  if (!key) return;
  const f = await db.prepare("SELECT 1 FROM files WHERE key = ? AND kind = 'artwork' AND confirmed = 1 AND uploaded_by = ?").bind(key, userId).first();
  if (!f) throw bad('Berkas unggahan tidak ditemukan');
}

// ---- Input order (CS atau Store Head) ----
orderRoutes.post('/', async (c) => {
  await allow(c, ['cs', 'store'], 'input');
  const u = c.get('user');
  const b = await readJson(c);
  const requestKey = reqStr(b, 'request_key', 64);
  const type = oneOf(b, 'type', ['retail', 'maklon'] as const);
  const service = oneOf(b, 'service', ['dtfr', 'dtfm', 'sub'] as const);
  const source = u.role === 'store' ? 'Toko' : oneOf(b, 'source', ['WhatsApp', 'Datang langsung', 'Toko'] as const);
  const fileRef = reqStr(b, 'file_ref', 300);
  const fileKey = optStr(b, 'file_key', 200);
  const deadline = optStr(b, 'deadline', 10);
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw bad('Format deadline tidak valid');
  const method = b.paid_method == null ? null : oneOf(b, 'paid_method', METHODS);

  const result = await c.env.DB.tx(async (db) => {
    const dup = await db.prepare('SELECT id, order_no, track_code FROM orders WHERE request_key = ?').bind(requestKey).first<any>();
    if (dup) return { ...dup, duplicate: true }; // kirim ulang tidak membuat order ganda
    await checkArtwork(db, fileKey, u.id);
    const settings = numericSettings(await loadSettings(db));
    const items: Item[] = rule(() => buildItems({ service, qty: b.qty, meter: b.meter, width: b.width }, settings));
    const total = totalOf(items);

    let customerId: number | null = null;
    let name: string;
    let wa: string;
    if (type === 'maklon') {
      if (b.customer_code) {
        const cu = await db.prepare('SELECT * FROM customers WHERE code = ?').bind(reqStr(b, 'customer_code', 40)).first<any>();
        if (!cu || cu.status === 'ditolak') throw bad('Pelanggan tidak ditemukan atau ditolak CRM');
        customerId = cu.id; name = cu.name; wa = cu.wa;
      } else {
        name = reqStr(b, 'name', 150); wa = reqStr(b, 'wa', 40);
        const n = await db.prepare("SELECT COUNT(*) n FROM customers WHERE code LIKE 'BR-%'").first<{ n: number }>();
        const code = `BR-${String(n!.n + 1).padStart(4, '0')}`;
        const r = await db.prepare("INSERT INTO customers (code, name, wa, source, status, created_at) VALUES (?,?,?, 'Customer baru', 'menunggu', ?)").bind(code, name, wa, now()).run();
        customerId = r.meta.last_row_id;
      }
    } else {
      name = reqStr(b, 'name', 150); wa = reqStr(b, 'wa', 40);
    }
    const t = now();
    const svc = service === 'sub' ? 'sub' : 'dtf';
    const track = randomToken(16);
    const r = await db.prepare(
      `INSERT INTO orders (order_no, track_code, type, service, customer_id, customer_name, wa, source, store, items, meter, total, file_ref, file_key,
         deadline, note, status, stage, created_by, created_at, request_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'cek', ?,?,?,?)`,
    ).bind('TMP-' + track, track, type, svc, customerId, name, wa, source, source === 'Toko' ? (u.store || optStr(b, 'store', 100) || 'Toko') : null,
      JSON.stringify(items), meterOf(items), total, fileRef, fileKey, deadline, optStr(b, 'note', 500), svc === 'dtf' ? 'dtf' : 'subp', u.code, t, requestKey).run();
    const id = r.meta.last_row_id;
    const ymd = localDay(t).slice(2).replace(/-/g, '');
    const orderNo = `SDP-${ymd}-${String(id).padStart(3, '0')}`;
    await db.prepare('UPDATE orders SET order_no = ? WHERE id = ?').bind(orderNo, id).run();
    if (method) await db.prepare('INSERT INTO payments (order_id, amount, method, by_user, at) VALUES (?,?,?,?,?)').bind(id, total, method, u.code, t).run();
    await audit(db, u.id, 'order_created', 'order', id);
    return { id, order_no: orderNo, track_code: track, total };
  });
  return c.json(result, 201);
});

// ---- Cek file oleh Operator (pre-press) ----
orderRoutes.post('/:id/file-check', async (c) => {
  await allow(c, ['op', 'spv'], 'cekfile');
  const b = await readJson(c);
  const ok = b.ok === true;
  if (ok && !(Array.isArray(b.checks) && b.checks.length === FILE_CHECKS.length && b.checks.every((x: unknown) => x === true))) throw bad('Centang semua butir, atau tandai tidak layak');
  const issue = ok ? null : reqStr(b, 'issue', 500);
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    if (o.status !== 'cek') throw conflict('Order tidak sedang menunggu cek file');
    if (!(await customerActive(db, o))) throw conflict('Customer belum diverifikasi CRM');
    await db.prepare('UPDATE orders SET status = ?, issue = ? WHERE id = ?').bind(ok ? 'bayar' : 'revisi', issue, o.id).run();
    const released = ok ? await release(db, o.id) : false;
    await audit(db, c.get('user').id, ok ? 'file_ok' : 'file_rejected', 'order', o.id);
    return { ok: true, released };
  }));
});

orderRoutes.post('/:id/revise', async (c) => {
  await allow(c, ['cs', 'spv'], 'cs');
  const b = await readJson(c);
  const ref = reqStr(b, 'file_ref', 300);
  const key = optStr(b, 'file_key', 200);
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    if (o.status !== 'revisi') throw conflict('Order tidak sedang menunggu revisi');
    await checkArtwork(db, key, c.get('user').id);
    await db.prepare("UPDATE orders SET status = 'cek', file_ref = ?, file_key = ?, issue = NULL WHERE id = ?").bind(ref, key, o.id).run();
    await audit(db, c.get('user').id, 'file_revised', 'order', o.id);
    return { ok: true };
  }));
});

orderRoutes.post('/:id/reject', async (c) => {
  await allow(c, ['cs', 'spv'], 'cs');
  const b = await readJson(c);
  const reason = oneOf(b, 'reason', ['Harga tidak cocok', 'Customer batal', 'Deadline tidak terkejar', 'Bahan habis', 'Double input'] as const);
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    if (!['cek', 'revisi', 'bayar'].includes(o.status)) throw conflict('Order sudah masuk produksi dan tidak dapat ditolak');
    await db.prepare("UPDATE orders SET status = 'ditolak' WHERE id = ?").bind(o.id).run();
    await db.prepare("INSERT INTO logs (order_no, type, reason, value, counted, by_user, at) VALUES (?, 'Loss Sales', ?,?,?,?,?)")
      .bind(o.order_no, reason, o.total, reason === 'Double input' ? 0 : 1, c.get('user').code, now()).run();
    await audit(db, c.get('user').id, 'order_rejected', 'order', o.id, { reason });
    return { ok: true, paid: await paidOf(db, o.id) };
  }));
});

// ---- Pembayaran diterima: dicatat CS atau Store Head, tanpa verifikasi FAT ----
orderRoutes.post('/:id/payments', async (c) => {
  await allow(c, ['cs', 'store']);
  const b = await readJson(c);
  const amount = reqNum(b, 'amount', 0);
  if (!Number.isInteger(amount)) throw bad('Nominal rupiah harus bilangan bulat');
  const method = oneOf(b, 'method', METHODS);
  const requestKey = reqStr(b, 'request_key', 64);
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    if (await db.prepare('SELECT 1 FROM payments WHERE request_key = ?').bind(requestKey).first()) return { ok: true, duplicate: true, released: false };
    if (o.status === 'ditolak') throw conflict('Order sudah ditolak');
    const left = o.total - (await paidOf(db, o.id));
    if (amount > left) throw conflict(`Nominal melebihi sisa tagihan (${left})`);
    await db.prepare('INSERT INTO payments (order_id, amount, method, by_user, at, request_key) VALUES (?,?,?,?,?,?)').bind(o.id, amount, method, c.get('user').code, now(), requestKey).run();
    const released = await release(db, o.id);
    await audit(db, c.get('user').id, 'payment_recorded', 'order', o.id, { amount });
    return { ok: true, released };
  }), 201);
});

orderRoutes.post('/:id/priority', async (c) => {
  await allow(c, ['spv'], 'produksi');
  const b = await readJson(c);
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    if (o.status !== 'antrian') throw conflict('Hanya order di antrian yang dapat diprioritaskan');
    await db.prepare('UPDATE orders SET priority = ? WHERE id = ?').bind(b.on ? 1 : 0, o.id).run();
    return { ok: true };
  }));
});

// ---- Produksi ----
orderRoutes.post('/:id/start', async (c) => {
  await allow(c, ['op', 'spv'], 'produksi');
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    if (o.status !== 'antrian') throw conflict('Order tidak berada di antrian');
    if ((await paidOf(db, o.id)) < o.total) throw conflict('Order belum lunas');
    const day = localDay(now(), calendarOf(await loadSettings(db)));
    const qc = await db.prepare('SELECT status FROM qc_reports WHERE machine = ? AND day = ? ORDER BY id DESC LIMIT 1').bind(o.stage, day).first<{ status: string }>();
    if (qc?.status !== 'siap') throw conflict('QC pagi mesin ini belum disetujui leader');
    if (await db.prepare("SELECT 1 FROM orders WHERE stage = ? AND status IN ('produksi','curing')").bind(o.stage).first()) throw conflict('Mesin masih mengerjakan order lain');
    await db.prepare("UPDATE orders SET status = 'produksi', started_at = ? WHERE id = ?").bind(now(), o.id).run();
    await audit(db, c.get('user').id, 'production_start', 'order', o.id, { stage: o.stage });
    return { ok: true, stage: o.stage };
  }));
});

orderRoutes.post('/:id/curing', async (c) => {
  await allow(c, ['op', 'spv'], 'produksi');
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    if (o.stage !== 'dtf' || o.status !== 'produksi') throw conflict('Order tidak sedang dicetak di mesin DTF');
    await db.prepare("UPDATE orders SET status = 'curing' WHERE id = ?").bind(o.id).run();
    return { ok: true };
  }));
});

orderRoutes.post('/:id/finish', async (c) => {
  await allow(c, ['op', 'spv'], 'produksi');
  const b = await readJson(c);
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    let process: string | null = null;
    if (o.stage === 'subp') {
      if (o.status !== 'produksi') throw conflict('Order tidak sedang dicetak');
    } else {
      const expected = o.stage === 'dtf' ? 'curing' : 'produksi';
      if (o.status !== expected) throw conflict(o.stage === 'dtf' ? 'Order belum masuk tahap curing' : 'Order tidak sedang dipress');
      const temp = reqNum(b, 'temp', 0);
      const sec = reqNum(b, 'seconds', 0);
      if (o.stage === 'dtf' && (temp < CURING.minC || temp > CURING.maxC || sec < CURING.minS || sec > CURING.maxS)) {
        throw bad(`Standar curing ${CURING.minC} sampai ${CURING.maxC} °C selama ${CURING.minS} sampai ${CURING.maxS} detik`);
      }
      process = `${temp} °C, ${sec} detik`;
    }
    const meter = o.rework_m ?? o.meter;
    const skus = await db.prepare('SELECT code, use_per_m FROM skus WHERE machine = ? AND use_per_m IS NOT NULL AND use_per_m > 0').bind(o.stage).all<any>();
    for (const k of skus.results) {
      const q = round2(k.use_per_m * meter);
      await db.prepare('UPDATE skus SET stock = ROUND((stock - ?)::numeric, 2) WHERE code = ?').bind(q, k.code).run();
      await db.prepare("INSERT INTO stock_ledger (sku_code, type, qty, ref, by_user, at) VALUES (?, 'Pakai', ?,?,?,?)").bind(k.code, -q, o.order_no, c.get('user').code, now()).run();
    }
    if (o.stage === 'subp') {
      await db.prepare("UPDATE orders SET status = 'antrian', stage = 'cal' WHERE id = ?").bind(o.id).run();
    } else {
      await db.prepare("UPDATE orders SET status = 'qc', process = ?, finished_at = ? WHERE id = ?").bind(process, now(), o.id).run();
    }
    await audit(db, c.get('user').id, 'production_finish', 'order', o.id, { stage: o.stage, meter });
    return { ok: true, next: o.stage === 'subp' ? 'press' : 'qc', deducted: skus.results.length };
  }));
});

// ---- QC hasil, kemas, serah terima ----
orderRoutes.post('/:id/qc', async (c) => {
  await allow(c, ['op', 'qc', 'spv'], 'qc');
  const b = await readJson(c);
  const pass = b.pass === true;
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    if (o.status !== 'qc') throw conflict('Order tidak sedang menunggu QC');
    const u = c.get('user');
    if (pass) {
      const need = QC_CHECKS[o.service as 'dtf' | 'sub'].length;
      if (!(Array.isArray(b.checks) && b.checks.length === need && b.checks.every((x: unknown) => x === true))) throw bad('Centang semua butir, atau catat reject');
      await db.prepare("UPDATE orders SET status = 'packing', rework_m = NULL, qc_by = ? WHERE id = ?").bind(u.code, o.id).run();
    } else {
      const reject = reqNum(b, 'reject_m', 0);
      const max = o.rework_m ?? o.meter;
      if (reject > max) throw bad(`Meter reject tidak boleh melebihi ${max}`);
      await db.prepare("INSERT INTO logs (order_no, type, reason, value, counted, by_user, at) VALUES (?, 'Reject', ?, NULL, 0, ?, ?)")
        .bind(o.order_no, `Tidak lolos QC, ${reject} m dicetak ulang`, u.code, now()).run();
      await db.prepare("UPDATE orders SET status = 'antrian', approved_at = ?, stage = ?, rework_m = ?, qc_by = ? WHERE id = ?")
        .bind(now(), o.service === 'dtf' ? 'dtf' : 'subp', reject, u.code, o.id).run();
    }
    await audit(db, u.id, pass ? 'qc_pass' : 'qc_reject', 'order', o.id);
    return { ok: true };
  }));
});

orderRoutes.post('/:id/pack', async (c) => {
  await allow(c, ['op', 'qc', 'spv'], 'qc');
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    if (o.status !== 'packing') throw conflict('Order belum lolos QC');
    await db.prepare("UPDATE orders SET status = 'siap' WHERE id = ?").bind(o.id).run();
    await audit(db, c.get('user').id, 'packed', 'order', o.id);
    return { ok: true };
  }));
});

orderRoutes.post('/:id/handover', async (c) => {
  await allow(c, ['cs', 'spv', 'gudang'], 'serah');
  const b = await readJson(c);
  const receiver = reqStr(b, 'receiver', 120);
  return c.json(await withOrder(c, intParam(c, 'id'), async (db, o) => {
    if (o.status !== 'siap') throw conflict('Order belum siap kirim');
    await db.prepare("UPDATE orders SET status = 'selesai', receiver = ?, handed_at = ? WHERE id = ?").bind(receiver, now(), o.id).run();
    await audit(db, c.get('user').id, 'handover', 'order', o.id);
    return { ok: true };
  }));
});

void forbidden;
