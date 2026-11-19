import { Hono } from 'hono';
import { hashPassword, passwordProblem, validUsername } from '../lib/auth.ts';
import {
  HttpError, audit, authn, bad, clientIp, conflict, intParam, need, notFound, now, oneOf, optStr, readJson, reqStr, type AppEnv, type Ctx,
} from '../core.ts';

export const publicMemberRoutes = new Hono<AppEnv>();
export const memberRoutes = new Hono<AppEnv>();

async function createApplication(c: Ctx, b: Record<string, any>, source: 'online' | 'workshop') {
  const username = reqStr(b, 'username', 32);
  if (!validUsername(username)) throw bad('Username 3-32 karakter: huruf, angka, titik, garis');
  const password = reqStr(b, 'password', 200);
  const problem = passwordProblem(password);
  if (problem) throw bad(problem);
  if (b.consent_contact !== true) throw bad('Persetujuan dihubungi untuk verifikasi wajib dicentang');
  const dupU = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ? UNION SELECT 1 FROM member_applications WHERE username = ? AND status != ?')
    .bind(username, username, 'ditolak').first();
  if (dupU) throw conflict('Username sudah dipakai');
  const h = await hashPassword(password);
  const r = await c.env.DB.prepare(
    `INSERT INTO member_applications (business_name, pic_name, contact, email, address, business_type, city_scope, username,
       pass_hash, pass_salt, pass_iter, consent_contact, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
  )
    .bind(
      reqStr(b, 'business_name', 150), reqStr(b, 'pic_name', 120), reqStr(b, 'contact', 40), optStr(b, 'email', 150),
      reqStr(b, 'address', 400), reqStr(b, 'business_type', 100), oneOf(b, 'city_scope', ['in_city', 'out_city'] as const),
      username, h.hash, h.salt, h.iter, source, now(),
    )
    .run();
  return r.meta.last_row_id as number;
}

// Pendaftaran publik: tidak ada akun, role, atau status aktif yang ditentukan pendaftar.
publicMemberRoutes.post('/register', async (c) => {
  const ip = clientIp(c);
  const key = `reg|${ip}`;
  const n = await c.env.DB.prepare('SELECT COUNT(*) n FROM login_attempts WHERE key = ? AND at > ?').bind(key, now() - 3600_000).first<{ n: number }>();
  if ((n?.n ?? 0) >= 10) throw new HttpError(429, 'Terlalu banyak pendaftaran dari alamat ini');
  await c.env.DB.prepare('INSERT INTO login_attempts (key, at) VALUES (?,?)').bind(key, now()).run();
  const b = await readJson(c);
  const id = await createApplication(c, b, 'online');
  return c.json({ ok: true, id, status: 'menunggu_cs', message: 'Pendaftaran diterima. CS akan menghubungi untuk verifikasi.' }, 201);
});

memberRoutes.use('*', authn);

memberRoutes.post('/workshop', need('app.workshop'), async (c) => {
  const b = await readJson(c);
  const id = await createApplication(c, b, 'workshop');
  await audit(c.env.DB, c.get('user').id, 'application_workshop', 'application', id);
  return c.json({ ok: true, id }, 201);
});

memberRoutes.get('/', need('app.list'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, business_name, pic_name, contact, email, address, business_type, city_scope, username, status, source,
            cs_note, cs_at, crm_note, crm_feasible, crm_at, master_note, master_at, link_customer_id, created_at
     FROM member_applications ORDER BY id DESC LIMIT 300`,
  ).all();
  return c.json(rows.results);
});

// 1) CS menghubungi dan memverifikasi (pekerjaan manusia; aplikasi hanya mencatat).
memberRoutes.post('/:id/cs', need('app.cs'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const note = reqStr(b, 'note', 1000);
  const r = await c.env.DB.prepare(
    "UPDATE member_applications SET cs_note=?, cs_by=?, cs_at=?, status='menunggu_survei' WHERE id=? AND status IN ('menunggu_cs','menunggu_survei')",
  ).bind(note, c.get('user').id, now(), id).run();
  if (!r.meta.changes) throw conflict('Pendaftaran tidak berada pada tahap verifikasi CS');
  await audit(c.env.DB, c.get('user').id, 'application_cs_verified', 'application', id);
  return c.json({ ok: true });
});

// 2) CRM mencatat hasil survei.
memberRoutes.post('/:id/survey', need('app.survey'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const note = reqStr(b, 'note', 1000);
  if (typeof b.feasible !== 'boolean') throw bad('Field "feasible" wajib true/false');
  const r = await c.env.DB.prepare(
    "UPDATE member_applications SET crm_note=?, crm_feasible=?, crm_by=?, crm_at=?, status='menunggu_acc' WHERE id=? AND cs_at IS NOT NULL AND status IN ('menunggu_survei','menunggu_acc')",
  ).bind(note, b.feasible ? 1 : 0, c.get('user').id, now(), id).run();
  if (!r.meta.changes) throw conflict('Verifikasi CS belum dicatat');
  await audit(c.env.DB, c.get('user').id, 'application_survey', 'application', id, { feasible: b.feasible });
  return c.json({ ok: true });
});

// 3) Master ACC atau menolak. ACC hanya bila verifikasi CS dan survei CRM layak sudah ada.
memberRoutes.post('/:id/decide', need('app.decide'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const note = optStr(b, 'note', 1000);
  const app = await c.env.DB.prepare('SELECT * FROM member_applications WHERE id = ?').bind(id).first<any>();
  if (!app) throw notFound();
  if (app.status === 'aktif' || app.status === 'ditolak') throw conflict('Pendaftaran sudah diputuskan');
  const me = c.get('user').id;
  if (b.approve !== true) {
    await c.env.DB.prepare("UPDATE member_applications SET status='ditolak', master_note=?, master_by=?, master_at=? WHERE id=?").bind(note, me, now(), id).run();
    await audit(c.env.DB, me, 'application_rejected', 'application', id);
    return c.json({ ok: true, status: 'ditolak' });
  }
  if (!app.cs_at) throw conflict('Belum ada verifikasi CS');
  if (!app.crm_at || app.crm_feasible !== 1) throw conflict('Survei CRM belum ada atau menyatakan tidak layak');

  let customerId: number;
  if (b.link_customer_id != null) {
    customerId = Number(b.link_customer_id);
    const ex = await c.env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(customerId).first();
    if (!ex) throw notFound('Customer yang dihubungkan tidak ada');
    const taken = await c.env.DB.prepare('SELECT 1 FROM users WHERE customer_id = ?').bind(customerId).first();
    if (taken) throw conflict('Customer tersebut sudah punya akun member');
  } else {
    const code = reqStr(b, 'customer_code', 40);
    const dup = await c.env.DB.prepare('SELECT 1 FROM customers WHERE code = ?').bind(code).first();
    if (dup) throw conflict('Kode customer sudah ada');
    const r = await c.env.DB.prepare(
      `INSERT INTO customers (code, business_name, pic_name, contact, email, address, business_type, city_scope, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(code, app.business_name, app.pic_name, app.contact, app.email, app.address, app.business_type, app.city_scope, now()).run();
    customerId = r.meta.last_row_id as number;
  }
  const u = await c.env.DB.prepare(
    `INSERT INTO users (username, pass_hash, pass_salt, pass_iter, role, active, must_change_password, customer_id, created_at)
     VALUES (?,?,?,?, 'customer', 1, 0, ?, ?)`,
  ).bind(app.username, app.pass_hash, app.pass_salt, app.pass_iter, customerId, now()).run();
  await c.env.DB.prepare("UPDATE member_applications SET status='aktif', master_note=?, master_by=?, master_at=?, link_customer_id=?, user_id=? WHERE id=?")
    .bind(note, me, now(), customerId, u.meta.last_row_id, id).run();
  await audit(c.env.DB, me, 'application_approved', 'application', id, { customerId });
  return c.json({ ok: true, status: 'aktif', customer_id: customerId });
});
