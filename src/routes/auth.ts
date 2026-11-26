import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import {
  LOGIN_MAX_FAILS, LOGIN_WINDOW_MS, SESSION_TTL_MS, hashPassword, passwordProblem, randomToken, sha256, validUsername, verifyPassword, timingSafeEqual,
} from '../lib/auth.ts';
import { COOKIE, audit, authn, bad, clientIp, forbidden, now, readJson, reqStr, type AppEnv, HttpError } from '../core.ts';

export const authRoutes = new Hono<AppEnv>();
export const bootstrapRoutes = new Hono<AppEnv>();

// Hash tiruan agar waktu respons tidak membocorkan keberadaan username.
const DUMMY = { hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', salt: 'AAAAAAAAAAAAAAAAAAAAAA', iter: 100000 };

authRoutes.post('/login', async (c) => {
  const b = await readJson(c);
  const username = reqStr(b, 'username', 32);
  const password = reqStr(b, 'password', 200);
  const key = `${username.toLowerCase()}|${clientIp(c)}`;
  const since = now() - LOGIN_WINDOW_MS;
  const fails = await c.env.DB.prepare('SELECT COUNT(*) n FROM login_attempts WHERE key = ? AND at > ?').bind(key, since).first<{ n: number }>();
  if ((fails?.n ?? 0) >= LOGIN_MAX_FAILS) throw new HttpError(429, 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.');

  const u = await c.env.DB.prepare('SELECT * FROM users WHERE code = ?').bind(username).first<any>();
  const ok = u
    ? await verifyPassword(password, u.pass_hash, u.pass_salt, u.pass_iter)
    : (await verifyPassword(password, DUMMY.hash, DUMMY.salt, DUMMY.iter), false);
  if (!u || !ok || !u.active) {
    await c.env.DB.prepare('INSERT INTO login_attempts (key, at) VALUES (?,?)').bind(key, now()).run();
    throw new HttpError(401, 'Username atau password salah');
  }
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();

  const token = randomToken(32);
  const csrf = randomToken(24);
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, csrf, epoch, created_at, expires_at) VALUES (?,?,?,?,?,?)')
    .bind(await sha256(token), u.id, csrf, u.session_epoch, now(), now() + SESSION_TTL_MS)
    .run();
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: 'Strict', path: '/', maxAge: SESSION_TTL_MS / 1000 });
  await audit(c.env.DB, u.id, 'login');
  return c.json({ csrf, role: u.role, code: u.code, must_change_password: !!u.must_change_password });
});

authRoutes.post('/logout', authn, async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(c.get('sid')).run();
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', authn, async (c) => c.json({ ...c.get('user'), csrf: c.get('csrf') }));

authRoutes.post('/change-password', authn, async (c) => {
  const b = await readJson(c);
  const cur = reqStr(b, 'current_password', 200);
  const next = reqStr(b, 'new_password', 200);
  const problem = passwordProblem(next);
  if (problem) throw bad(problem);
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first<any>();
  if (!(await verifyPassword(cur, row.pass_hash, row.pass_salt, row.pass_iter))) throw forbidden('Password saat ini salah');
  if (cur === next) throw bad('Password baru harus berbeda');
  const h = await hashPassword(next);
  const epoch = row.session_epoch + 1;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET pass_hash=?, pass_salt=?, pass_iter=?, must_change_password=0, session_epoch=? WHERE id=?').bind(h.hash, h.salt, h.iter, epoch, u.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
  ]);
  deleteCookie(c, COOKIE, { path: '/' });
  await audit(c.env.DB, u.id, 'password_changed');
  return c.json({ ok: true, relogin: true });
});

// Bootstrap master: sekali pakai, wajib BOOTSTRAP_TOKEN (secret server), hanya bila belum ada master.
bootstrapRoutes.post('/', async (c) => {
  const secret = c.env.BOOTSTRAP_TOKEN;
  if (!secret || secret.length < 16) throw new HttpError(503, 'Bootstrap belum diaktifkan di server');
  const b = await readJson(c);
  const token = reqStr(b, 'token', 200);
  const enc = new TextEncoder();
  const [a, s] = await Promise.all([sha256(token), sha256(secret)]);
  if (!timingSafeEqual(enc.encode(a), enc.encode(s))) throw forbidden('Token bootstrap salah');
  const username = reqStr(b, 'username', 32);
  if (!validUsername(username)) throw bad('Username 3-32 karakter: huruf, angka, titik, garis');
  const password = reqStr(b, 'password', 200);
  const problem = passwordProblem(password);
  if (problem) throw bad(problem);
  const full_name = reqStr(b, 'full_name', 120);
  const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE role = 'master' LIMIT 1").first();
  if (exists) throw forbidden('Master sudah ada');
  const claim = await c.env.DB.prepare('UPDATE bootstrap SET used_at = ? WHERE id = 1 AND used_at IS NULL').bind(now()).run();
  if (!claim.meta.changes) throw forbidden('Bootstrap sudah pernah dipakai');
  const h = await hashPassword(password);
  const r = await c.env.DB.prepare(
    "INSERT INTO users (code, name, role, active, pass_hash, pass_salt, pass_iter, must_change_password, created_at) VALUES (?,?, 'master', 1, ?,?,?, 0, ?)",
  ).bind(username, full_name, h.hash, h.salt, h.iter, now()).run();
  await audit(c.env.DB, r.meta.last_row_id, 'bootstrap_master');
  return c.json({ ok: true });
});
