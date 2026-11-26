import { Hono } from 'hono';
import { randomToken } from '../lib/auth.ts';
import { audit, authn, bad, conflict, forbidden, notFound, now, readJson, reqNum, reqStr, type AppEnv } from '../core.ts';
import { MAX_FILE_BYTES } from '../storage.ts';
import type { Role } from '../domain.ts';

export const fileRoutes = new Hono<AppEnv>();
fileRoutes.use('*', authn);

const KINDS = ['artwork', 'qc_photo'] as const;
type Kind = (typeof KINDS)[number];
const UPLOAD: Record<Kind, Role[]> = { artwork: ['master', 'cs', 'store'], qc_photo: ['master', 'op', 'qc', 'spv'] };
const READ: Record<Kind, Role[]> = { artwork: ['master', 'manager', 'spv', 'cs', 'store', 'op'], qc_photo: ['master', 'manager', 'spv', 'op', 'qc'] };

// Langkah 1: minta izin unggah. Server memeriksa peran, lalu memberi URL bertanda tangan ke storage.
fileRoutes.post('/init', async (c) => {
  const u = c.get('user');
  const b = await readJson(c);
  const kind = reqStr(b, 'kind', 30) as Kind;
  if (!KINDS.includes(kind)) throw bad('Jenis file tidak dikenal');
  if (!UPLOAD[kind].includes(u.role)) throw forbidden();
  const size = reqNum(b, 'size_bytes', 0);
  if (!Number.isInteger(size) || size > MAX_FILE_BYTES) throw bad(`Ukuran file maksimal ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const name = reqStr(b, 'file_name', 200).replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'file';
  const contentType = typeof b.content_type === 'string' && b.content_type.length < 100 ? b.content_type : 'application/octet-stream';
  if (kind === 'qc_photo' && !/^image\/(jpeg|png|webp|heic|heif)$/.test(contentType)) throw bad('Foto QC harus berupa gambar JPG, PNG, WEBP, atau HEIC');
  const key = `${kind}/${randomToken(16)}`;
  const upload = await c.env.FILES.createUpload(key, contentType);
  await c.env.DB.prepare('INSERT INTO files (key, kind, file_name, content_type, size_bytes, uploaded_by, uploaded_at, confirmed) VALUES (?,?,?,?,?,?,?,0)')
    .bind(key, kind, name, contentType, size, u.id, now()).run();
  return c.json({ key, file_name: name, upload }, 201);
});

// Langkah 2: setelah browser selesai mengunggah, server memastikan objeknya benar-benar ada di storage.
fileRoutes.post('/confirm', async (c) => {
  const u = c.get('user');
  const b = await readJson(c);
  const key = reqStr(b, 'key', 200);
  const f = await c.env.DB.prepare('SELECT * FROM files WHERE key = ? AND uploaded_by = ?').bind(key, u.id).first<any>();
  if (!f) throw notFound();
  if (f.confirmed) return c.json({ ok: true, key, size_bytes: f.size_bytes });
  const st = await c.env.FILES.stat(key);
  if (!st) throw conflict('File belum terunggah ke penyimpanan');
  if (st.size <= 0 || st.size > MAX_FILE_BYTES) throw bad('Ukuran file tidak valid');
  await c.env.DB.prepare('UPDATE files SET confirmed = 1, size_bytes = ? WHERE key = ?').bind(st.size, key).run();
  await audit(c.env.DB, u.id, 'file_uploaded', 'file', key);
  return c.json({ ok: true, key, file_name: f.file_name, size_bytes: st.size }, 201);
});

// Unduh selalu lewat pemeriksaan hak akses, lalu dialihkan ke URL bertanda tangan 60 detik. Bucket tidak pernah publik.
fileRoutes.get('/:kind/:id', async (c) => {
  const u = c.get('user');
  const key = `${c.req.param('kind')}/${c.req.param('id')}`;
  const meta = await c.env.DB.prepare('SELECT * FROM files WHERE key = ? AND confirmed = 1').bind(key).first<any>();
  if (!meta || !READ[meta.kind as Kind].includes(u.role)) throw notFound();
  if (u.role === 'store' && meta.uploaded_by !== u.id) throw notFound();
  c.header('Cache-Control', 'private, no-store');
  return c.redirect(await c.env.FILES.downloadUrl(key, meta.file_name), 302);
});
