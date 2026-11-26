import { Hono } from 'hono';
import { hashPassword, passwordProblem, validUsername } from '../lib/auth.ts';
import { localDay } from '../lib/calendar.ts';
import {
  allow, audit, authn, bad, calendarOf, conflict, forbidden, intParam, loadSettings, notFound, now, oneOf, optStr, readJson, reqNum, reqStr, type AppEnv,
} from '../core.ts';
import { GRANTABLE, MORNING, ROLES, type Machine } from '../domain.ts';

export const opsRoutes = new Hono<AppEnv>();
opsRoutes.use('*', authn);

// ---- QC pagi mesin (STD-OPR-006) ----
opsRoutes.post('/qc/morning', async (c) => {
  await allow(c, ['op', 'qc', 'spv'], 'qc');
  const u = c.get('user');
  const b = await readJson(c);
  const machine = oneOf(b, 'machine', ['dtf', 'subp', 'cal'] as const) as Machine;
  const steps = MORNING[machine];
  const items = steps.flatMap((s) => s.checks);
  if (!(Array.isArray(b.answers) && b.answers.length === items.length && b.answers.every((x: unknown) => x === 'OK' || x === 'NG'))) {
    throw bad('Setiap butir wajib dipilih OK atau Tidak sesuai');
  }
  const ng = items.filter((_, i) => b.answers[i] === 'NG');
  const photos: { label: string; key: string }[] = [];
  for (const s of steps) {
    if (!s.photo) continue;
    const p = Array.isArray(b.photos) ? b.photos.find((x: any) => x?.label === s.photo) : null;
    if (!p || typeof p.key !== 'string') throw bad(`Lampirkan foto ${s.photo}`);
    const f = await c.env.DB.prepare("SELECT 1 FROM files WHERE key = ? AND kind = 'qc_photo' AND confirmed = 1 AND uploaded_by = ?").bind(p.key, u.id).first();
    if (!f) throw bad(`Foto ${s.photo} tidak ditemukan`);
    photos.push({ label: s.photo, key: p.key });
  }
  const note = optStr(b, 'note', 1500);
  const action = optStr(b, 'action', 1500);
  if (ng.length && (!note || !action)) throw bad('Temuan dan tindakan awal wajib diisi');
  await c.env.DB.tx(async (db) => {
    const day = localDay(now(), calendarOf(await loadSettings(db)));
    const cur = await db.prepare('SELECT status FROM qc_reports WHERE machine = ? AND day = ? ORDER BY id DESC LIMIT 1').bind(machine, day).first<{ status: string }>();
    if (cur && cur.status !== 'tahan') throw conflict('Laporan hari ini sudah dikirim');
    const r = await db.prepare("INSERT INTO qc_reports (machine, day, answers, ng, note, action, photos, status, by_user, at) VALUES (?,?,?,?,?,?,?, 'menunggu', ?, ?)")
      .bind(machine, day, JSON.stringify(b.answers), JSON.stringify(ng), note, action, JSON.stringify(photos), u.code, now()).run();
    await audit(db, u.id, 'qc_morning', 'qc', r.meta.last_row_id);
  });
  return c.json({ ok: true }, 201);
});

opsRoutes.post('/qc/morning/:id/decide', async (c) => {
  await allow(c, ['spv'], 'qc');
  const b = await readJson(c);
  const decision = oneOf(b, 'decision', ['siap', 'tahan'] as const);
  const note = optStr(b, 'note', 1500);
  if (decision === 'tahan' && !note) throw bad('Alasan tahan produksi wajib diisi');
  const id = intParam(c, 'id');
  await c.env.DB.tx(async (db) => {
    const r = await db.prepare('SELECT * FROM qc_reports WHERE id = ? FOR UPDATE').bind(id).first<any>();
    if (!r) throw notFound('Laporan QC tidak ditemukan');
    if (r.status !== 'menunggu') throw conflict('Laporan ini sudah diputuskan');
    if (decision === 'siap' && JSON.parse(r.ng).length) throw conflict('Ada butir tidak sesuai. Operator perbaiki lalu kirim QC baru');
    await db.prepare('UPDATE qc_reports SET status = ?, approved_by = ?, approved_at = ?, leader_note = ? WHERE id = ?').bind(decision, c.get('user').code, now(), note, id).run();
    await audit(db, c.get('user').id, 'qc_morning_' + decision, 'qc', id);
  });
  return c.json({ ok: true });
});

// ---- Pelanggan B2B: CRM hanya memverifikasi customer baru ----
opsRoutes.post('/customers/import', async (c) => {
  await allow(c, ['crm'], 'pelanggan');
  const b = await readJson(c);
  if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 2000) throw bad('Isi 1 sampai 2000 baris');
  const rows = b.rows.map((r: any, i: number) => {
    try {
      return { code: reqStr(r, 'code', 40).toUpperCase(), name: reqStr(r, 'name', 150), wa: reqStr(r, 'wa', 40) };
    } catch {
      throw bad(`Baris ${i + 1}: kode, nama, dan WhatsApp wajib diisi`);
    }
  });
  let added = 0;
  await c.env.DB.tx(async (db) => {
    for (const r of rows) {
      const res = await db.prepare(
        "INSERT INTO customers (code, name, wa, source, status, verified_by, verified_at, created_at) VALUES (?,?,?, 'Tigalapan Kaos', 'aktif', ?,?,?) ON CONFLICT (code) DO NOTHING",
      ).bind(r.code, r.name, r.wa, c.get('user').code, now(), now()).run();
      added += res.meta.changes;
    }
    await audit(db, c.get('user').id, 'customers_imported', 'customer', undefined, { added });
  });
  return c.json({ ok: true, added, skipped: rows.length - added }, 201);
});

opsRoutes.post('/customers/:id/decide', async (c) => {
  await allow(c, ['crm'], 'pelanggan');
  const b = await readJson(c);
  const status = oneOf(b, 'status', ['aktif', 'ditolak'] as const);
  const r = await c.env.DB.prepare("UPDATE customers SET status = ?, verified_by = ?, verified_at = ? WHERE id = ? AND status = 'menunggu'")
    .bind(status, c.get('user').code, now(), intParam(c, 'id')).run();
  if (!r.meta.changes) throw conflict('Customer tidak sedang menunggu verifikasi');
  await audit(c.env.DB, c.get('user').id, 'customer_' + status, 'customer', c.req.param('id'));
  return c.json({ ok: true });
});

// ---- Inventory ----
opsRoutes.post('/stock/move', async (c) => {
  await allow(c, ['gudang', 'op', 'spv'], 'stok');
  const b = await readJson(c);
  const code = reqStr(b, 'sku', 60);
  const type = oneOf(b, 'type', ['Stok masuk', 'Waste', 'Cleaning', 'Koreksi kurang'] as const);
  const qty = reqNum(b, 'qty', 0);
  const delta = type === 'Stok masuk' ? qty : -qty;
  await c.env.DB.tx(async (db) => {
    const k = await db.prepare('SELECT stock FROM skus WHERE code = ? FOR UPDATE').bind(code).first<{ stock: number }>();
    if (!k) throw notFound('SKU tidak ditemukan');
    if (k.stock + delta < 0) throw conflict('Stok tidak cukup');
    await db.prepare('UPDATE skus SET stock = ROUND((stock + ?)::numeric, 2) WHERE code = ?').bind(delta, code).run();
    await db.prepare('INSERT INTO stock_ledger (sku_code, type, qty, ref, by_user, at) VALUES (?,?,?,?,?,?)').bind(code, type, delta, optStr(b, 'ref', 100) ?? 'manual', c.get('user').code, now()).run();
  });
  return c.json({ ok: true }, 201);
});

opsRoutes.put('/stock/sku/:code', async (c) => {
  await allow(c, ['gudang', 'spv'], 'stok');
  const b = await readJson(c);
  const min = reqNum(b, 'min', 0, true);
  const use = b.use === null || b.use === '' ? null : reqNum(b, 'use', 0, true);
  const r = await c.env.DB.prepare('UPDATE skus SET min_stock = ?, use_per_m = ? WHERE code = ?').bind(min, use, c.req.param('code')).run();
  if (!r.meta.changes) throw notFound('SKU tidak ditemukan');
  await audit(c.env.DB, c.get('user').id, 'sku_updated', 'sku', c.req.param('code'), { min, use });
  return c.json({ ok: true });
});

// ---- Master: pengguna, hak akses, pengaturan ----
opsRoutes.post('/admin/users', async (c) => {
  await allow(c, []);
  const b = await readJson(c);
  const code = reqStr(b, 'code', 32).toUpperCase();
  if (!validUsername(code)) throw bad('Kode 3 sampai 32 huruf, angka, titik, atau garis');
  const role = oneOf(b, 'role', ROLES);
  const password = reqStr(b, 'password', 200);
  const problem = passwordProblem(password);
  if (problem) throw bad(problem);
  if (await c.env.DB.prepare('SELECT 1 FROM users WHERE code = ?').bind(code).first()) throw conflict('Kode sudah dipakai');
  const h = await hashPassword(password);
  const r = await c.env.DB.prepare('INSERT INTO users (code, name, role, store, active, pass_hash, pass_salt, pass_iter, must_change_password, created_at) VALUES (?,?,?,?,1,?,?,?,1,?)')
    .bind(code, reqStr(b, 'name', 120), role, optStr(b, 'store', 100), h.hash, h.salt, h.iter, now()).run();
  await audit(c.env.DB, c.get('user').id, 'user_created', 'user', r.meta.last_row_id, { role });
  return c.json({ ok: true }, 201);
});

// Reset password, ganti peran, atau nonaktifkan: semua sesi pengguna itu dicabut.
opsRoutes.patch('/admin/users/:id', async (c) => {
  await allow(c, []);
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const me = c.get('user');
  if (!(await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(id).first())) throw notFound();
  if (id === me.id) throw forbidden('Gunakan menu Akun Saya untuk akun sendiri');
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.active !== undefined) { sets.push('active = ?'); vals.push(b.active ? 1 : 0); }
  if (b.role !== undefined) { sets.push('role = ?'); vals.push(oneOf(b, 'role', ROLES)); }
  if (b.name !== undefined) { sets.push('name = ?'); vals.push(reqStr(b, 'name', 120)); }
  if (b.store !== undefined) { sets.push('store = ?'); vals.push(optStr(b, 'store', 100)); }
  if (b.new_password !== undefined) {
    const p = reqStr(b, 'new_password', 200);
    const problem = passwordProblem(p);
    if (problem) throw bad(problem);
    const h = await hashPassword(p);
    sets.push('pass_hash = ?', 'pass_salt = ?', 'pass_iter = ?', 'must_change_password = 1');
    vals.push(h.hash, h.salt, h.iter);
  }
  if (!sets.length) throw bad('Tidak ada perubahan');
  sets.push('session_epoch = session_epoch + 1');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
  ]);
  await audit(c.env.DB, me.id, 'user_updated', 'user', id);
  return c.json({ ok: true });
});

opsRoutes.put('/admin/access', async (c) => {
  await allow(c, []);
  const b = await readJson(c);
  const role = oneOf(b, 'role', ROLES.filter((r) => r !== 'master'));
  if (!Array.isArray(b.pages) || !b.pages.length || !b.pages.every((p: any) => (GRANTABLE as readonly string[]).includes(p))) throw bad('Daftar menu tidak valid (minimal satu)');
  await c.env.DB.prepare('INSERT INTO role_access (role, pages) VALUES (?,?) ON CONFLICT (role) DO UPDATE SET pages = excluded.pages').bind(role, JSON.stringify([...new Set(b.pages)])).run();
  await audit(c.env.DB, c.get('user').id, 'access_updated', 'role', role, b.pages);
  return c.json({ ok: true });
});
opsRoutes.delete('/admin/access', async (c) => {
  await allow(c, []);
  await c.env.DB.prepare('DELETE FROM role_access').run();
  return c.json({ ok: true });
});

const SETTING_KEYS = ['priceDtf', 'priceSub120', 'priceSub160', 'priceSub180', 'normDtf', 'normSubPrint', 'normPress'];
opsRoutes.put('/admin/settings', async (c) => {
  await allow(c, []);
  const b = await readJson(c);
  const stmts = [];
  for (const [k, v] of Object.entries(b)) {
    if (!SETTING_KEYS.includes(k)) throw bad(`Pengaturan "${k}" tidak dikenal`);
    if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e9)) throw bad(`Nilai "${k}" harus angka lebih dari 0, atau kosong`);
    if (k === 'priceDtf' && v === null) throw bad('Harga DTF tidak boleh kosong');
    if (k.startsWith('price') && v !== null && !Number.isInteger(v)) throw bad('Harga rupiah harus bilangan bulat');
    stmts.push(c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(k, v === null ? '' : String(v)));
  }
  if (!stmts.length) throw bad('Tidak ada perubahan');
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, c.get('user').id, 'settings_updated', 'settings', undefined, b);
  return c.json({ ok: true });
});
