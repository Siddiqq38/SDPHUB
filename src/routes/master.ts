import { Hono } from 'hono';
import { hashPassword, passwordProblem, validUsername } from '../lib/auth.ts';
import {
  audit, authn, bad, conflict, intParam, isStaff, need, notFound, now, oneOf, optNum, optStr, readJson, reqNum, reqStr, forbidden, type AppEnv,
} from '../core.ts';
import { STAFF, type Role } from '../lib/rbac.ts';

export const masterRoutes = new Hono<AppEnv>();
masterRoutes.use('*', authn);

// ---- Pengguna / karyawan (master) ----
masterRoutes.get('/users', need('user.manage'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.active, u.must_change_password, u.customer_id, e.reg_code, e.full_name, e.employee_no, e.department, e.job_title
     FROM users u LEFT JOIN employees e ON e.user_id = u.id ORDER BY u.id`,
  ).all();
  return c.json(rows.results);
});

masterRoutes.post('/users', need('user.manage'), async (c) => {
  const b = await readJson(c);
  const username = reqStr(b, 'username', 32);
  if (!validUsername(username)) throw bad('Username 3-32 karakter: huruf, angka, titik, garis');
  const role = oneOf(b, 'role', STAFF);
  const password = reqStr(b, 'password', 200);
  const problem = passwordProblem(password);
  if (problem) throw bad(problem);
  const reg = reqStr(b, 'reg_code', 20);
  if (await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) throw conflict('Username sudah dipakai');
  if (await c.env.DB.prepare('SELECT 1 FROM employees WHERE reg_code = ?').bind(reg).first()) throw conflict('Kode pendaftaran sudah ada');
  const h = await hashPassword(password);
  const active = b.active === false ? 0 : 1;
  const r = await c.env.DB.prepare(
    'INSERT INTO users (username, pass_hash, pass_salt, pass_iter, role, active, must_change_password, created_at) VALUES (?,?,?,?,?,?,1,?)',
  ).bind(username, h.hash, h.salt, h.iter, role, active, now()).run();
  const id = r.meta.last_row_id as number;
  await c.env.DB.prepare('INSERT INTO employees (user_id, reg_code, full_name, employee_no, department, job_title) VALUES (?,?,?,?,?,?)')
    .bind(id, reg, reqStr(b, 'full_name', 120), reqStr(b, 'employee_no', 40), reqStr(b, 'department', 60), reqStr(b, 'job_title', 80)).run();
  await audit(c.env.DB, c.get('user').id, 'user_created', 'user', id, { role });
  return c.json({ ok: true, id }, 201);
});

// Reset password / ubah role / nonaktifkan: semua mencabut sesi (session_epoch naik).
masterRoutes.patch('/users/:id', need('user.manage'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!row) throw notFound();
  const me = c.get('user');
  if (id === me.id && (b.active === false || (b.role && b.role !== 'master'))) throw forbidden('Tidak boleh menonaktifkan atau menurunkan akun sendiri');
  const sets: string[] = [];
  const vals: any[] = [];
  let revoke = false;
  if (b.active !== undefined) { sets.push('active = ?'); vals.push(b.active ? 1 : 0); revoke = true; }
  if (b.role !== undefined) {
    if (row.role === 'customer') throw bad('Role customer tidak dapat diubah');
    sets.push('role = ?'); vals.push(oneOf(b, 'role', STAFF) as Role); revoke = true;
  }
  if (b.new_password !== undefined) {
    const p = reqStr(b, 'new_password', 200);
    const problem = passwordProblem(p);
    if (problem) throw bad(problem);
    const h = await hashPassword(p);
    sets.push('pass_hash = ?', 'pass_salt = ?', 'pass_iter = ?', 'must_change_password = 1');
    vals.push(h.hash, h.salt, h.iter);
    revoke = true;
  }
  if (revoke) { sets.push('session_epoch = session_epoch + 1'); }
  if (!sets.length) throw bad('Tidak ada perubahan');
  const stmts = [c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id)];
  if (revoke) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, me.id, 'user_updated', 'user', id, { revoke });
  return c.json({ ok: true, sessions_revoked: revoke });
});

// ---- Customer ----
masterRoutes.get('/customers', need('customer.read'), async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM customers ORDER BY business_name').all();
  return c.json(rows.results);
});

masterRoutes.post('/customers', need('customer.write'), async (c) => {
  const b = await readJson(c);
  const code = reqStr(b, 'code', 40);
  if (await c.env.DB.prepare('SELECT 1 FROM customers WHERE code = ?').bind(code).first()) throw conflict('Kode customer sudah ada');
  const r = await c.env.DB.prepare(
    `INSERT INTO customers (code, business_name, pic_name, contact, email, address, business_type, city_scope, payment_policy, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    code, reqStr(b, 'business_name', 150), reqStr(b, 'pic_name', 120), reqStr(b, 'contact', 40), optStr(b, 'email', 150),
    reqStr(b, 'address', 400), optStr(b, 'business_type', 100), oneOf(b, 'city_scope', ['in_city', 'out_city'] as const),
    optStr(b, 'payment_policy', 100) ?? 'belum_diatur', optStr(b, 'notes'), now(),
  ).run();
  await audit(c.env.DB, c.get('user').id, 'customer_created', 'customer', r.meta.last_row_id as number);
  return c.json({ ok: true, id: r.meta.last_row_id }, 201);
});

// Melengkapi customer lama: ID dan kode tidak berubah, pesanan terkait tetap terhubung.
masterRoutes.patch('/customers/:id', need('customer.write'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const cur = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first<any>();
  if (!cur) throw notFound();
  const pick = (k: string, max: number) => (b[k] === undefined ? cur[k] : reqStr(b, k, max));
  await c.env.DB.prepare(
    `UPDATE customers SET business_name=?, pic_name=?, contact=?, email=?, address=?, business_type=?, city_scope=?, payment_policy=?, notes=? WHERE id=?`,
  ).bind(
    pick('business_name', 150), pick('pic_name', 120), pick('contact', 40),
    b.email === undefined ? cur.email : optStr(b, 'email', 150),
    pick('address', 400),
    b.business_type === undefined ? cur.business_type : optStr(b, 'business_type', 100),
    b.city_scope === undefined ? cur.city_scope : oneOf(b, 'city_scope', ['in_city', 'out_city'] as const),
    pick('payment_policy', 100),
    b.notes === undefined ? cur.notes : optStr(b, 'notes'),
    id,
  ).run();
  await audit(c.env.DB, c.get('user').id, 'customer_updated', 'customer', id);
  return c.json({ ok: true });
});

// ---- Konfigurasi: layanan, mesin, norma, settings ----
masterRoutes.get('/config', async (c) => {
  if (!isStaff(c.get('user'))) throw forbidden();
  const [services, machines, norms, settings] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM services').all(),
    c.env.DB.prepare('SELECT * FROM machines ORDER BY code').all(),
    c.env.DB.prepare('SELECT * FROM norms').all(),
    c.env.DB.prepare('SELECT * FROM settings').all(),
  ]);
  return c.json({ services: services.results, machines: machines.results, norms: norms.results, settings: settings.results });
});

masterRoutes.put('/config/services/:code', need('config.write'), async (c) => {
  const b = await readJson(c);
  const r = await c.env.DB.prepare('UPDATE services SET active = ? WHERE code = ?').bind(b.active ? 1 : 0, c.req.param('code')).run();
  if (!r.meta.changes) throw notFound();
  await audit(c.env.DB, c.get('user').id, 'service_toggled', 'service', c.req.param('code'), { active: !!b.active });
  return c.json({ ok: true });
});

masterRoutes.post('/config/machines', need('config.write'), async (c) => {
  const b = await readJson(c);
  const code = reqStr(b, 'code', 30);
  if (await c.env.DB.prepare('SELECT 1 FROM machines WHERE code = ?').bind(code).first()) throw conflict('Kode mesin sudah ada');
  const r = await c.env.DB.prepare('INSERT INTO machines (code, name, kind) VALUES (?,?,?)')
    .bind(code, reqStr(b, 'name', 100), oneOf(b, 'kind', ['dtf_printer', 'sublim_printer', 'calender'] as const)).run();
  await audit(c.env.DB, c.get('user').id, 'machine_created', 'machine', r.meta.last_row_id as number);
  return c.json({ ok: true, id: r.meta.last_row_id }, 201);
});

masterRoutes.put('/config/machines/:id', need('config.write'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const r = await c.env.DB.prepare('UPDATE machines SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id).run();
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

// seconds_per_unit = null berarti "Belum diatur". Norma DTF tidak otomatis berlaku untuk Sublim.
masterRoutes.put('/config/norms/:kind', need('config.write'), async (c) => {
  const b = await readJson(c);
  const kind = oneOf({ k: c.req.param('kind') }, 'k', ['dtf_printer', 'sublim_printer', 'calender'] as const);
  const spu = b.seconds_per_unit === null ? null : reqNum(b, 'seconds_per_unit', 0);
  await c.env.DB.prepare('UPDATE norms SET seconds_per_unit = ?, source_note = ? WHERE machine_kind = ?').bind(spu, optStr(b, 'source_note', 300), kind).run();
  await audit(c.env.DB, c.get('user').id, 'norm_updated', 'norm', kind, { spu });
  return c.json({ ok: true });
});

const SETTING_KEYS = ['work_open', 'work_close', 'prep_start', 'prod_blocks', 'closed_weekdays', 'brand_name', 'company_name', 'contact_info', 'workshop_info', 'tz_offset_min'];
masterRoutes.put('/config/settings', need('config.write'), async (c) => {
  const b = await readJson(c);
  const stmts = [];
  for (const [k, v] of Object.entries(b)) {
    if (!SETTING_KEYS.includes(k)) throw bad(`Setting "${k}" tidak dikenal`);
    if (typeof v !== 'string' || v.length > 1000) throw bad(`Setting "${k}" harus teks`);
    stmts.push(c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v));
  }
  if (!stmts.length) throw bad('Tidak ada perubahan');
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, c.get('user').id, 'settings_updated', 'settings', undefined, Object.keys(b));
  return c.json({ ok: true });
});

// ---- Attendance / standby operator ----
masterRoutes.post('/attendance/checkin', need('wo.run'), async (c) => {
  const day = new Date(now() + 480 * 60_000).toISOString().slice(0, 10);
  const u = c.get('user');
  const ex = await c.env.DB.prepare('SELECT * FROM attendance WHERE user_id = ? AND day = ?').bind(u.id, day).first<any>();
  if (ex) {
    await c.env.DB.prepare('UPDATE attendance SET check_out_at = NULL WHERE id = ?').bind(ex.id).run();
    return c.json({ ok: true, day, already: true });
  }
  await c.env.DB.prepare('INSERT INTO attendance (user_id, day, check_in_at, standby) VALUES (?,?,?,0)').bind(u.id, day, now()).run();
  return c.json({ ok: true, day }, 201);
});
masterRoutes.post('/attendance/standby', need('wo.run'), async (c) => {
  const b = await readJson(c);
  const day = new Date(now() + 480 * 60_000).toISOString().slice(0, 10);
  const r = await c.env.DB.prepare('UPDATE attendance SET standby = ? WHERE user_id = ? AND day = ? AND check_out_at IS NULL').bind(b.standby ? 1 : 0, c.get('user').id, day).run();
  if (!r.meta.changes) throw conflict('Belum check-in hari ini');
  return c.json({ ok: true });
});
masterRoutes.post('/attendance/checkout', need('wo.run'), async (c) => {
  const day = new Date(now() + 480 * 60_000).toISOString().slice(0, 10);
  const r = await c.env.DB.prepare('UPDATE attendance SET check_out_at = ?, standby = 0 WHERE user_id = ? AND day = ? AND check_out_at IS NULL').bind(now(), c.get('user').id, day).run();
  if (!r.meta.changes) throw conflict('Belum check-in hari ini');
  return c.json({ ok: true });
});
masterRoutes.get('/attendance/today', async (c) => {
  if (!isStaff(c.get('user'))) throw forbidden();
  const day = new Date(now() + 480 * 60_000).toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    `SELECT a.user_id, e.full_name, a.check_in_at, a.check_out_at, a.standby,
       (SELECT COUNT(*) FROM work_orders w WHERE w.assigned_to = a.user_id AND w.status = 'berjalan') AS active_wo
     FROM attendance a JOIN employees e ON e.user_id = a.user_id WHERE a.day = ?`,
  ).bind(day).all();
  return c.json(rows.results);
});
void optNum;
