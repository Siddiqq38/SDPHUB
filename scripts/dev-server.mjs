// Server pengembangan dan uji: Postgres asli (PGlite, WASM) + penyimpanan file lokal + situs statis dari public/.
// Menjalankan aplikasi yang sama dengan produksi (createApp); hanya lingkungan (DB/storage) yang berbeda.
// Jalankan: node --no-warnings scripts/dev-server.mjs   (PORT=8787, FRESH=0 untuk mempertahankan data)
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { makeDb, pgliteDriver } from '../src/db.ts';
import { createApp } from '../src/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8787);
const dataDir = join(root, '.dev-data');
if (process.env.FRESH !== '0' && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
mkdirSync(join(dataDir, 'files'), { recursive: true });

const pglite = new PGlite(join(dataDir, 'pg'), {
  extensions: { citext },
  parsers: { 20: (v) => Number(v), 1700: (v) => Number(v) },
});
await pglite.waitReady;
const { rows } = await pglite.query("SELECT to_regclass('public.users') AS t");
if (!rows[0].t) {
  for (const f of readdirSync(join(root, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pglite.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
}

const fp = (key) => join(dataDir, 'files', key.replace(/\//g, '__'));
const storage = {
  async createUpload(key) { return { url: `/__dev_storage/up/${key}`, method: 'PUT', fields: {}, file_field: 'file' }; },
  async stat(key) { return existsSync(fp(key)) ? { size: statSync(fp(key)).size } : null; },
  async downloadUrl(key, filename) { return `/__dev_storage/dl/${key}?name=${encodeURIComponent(filename)}`; },
};
const env = { DB: makeDb(pgliteDriver(pglite)), FILES: storage, BOOTSTRAP_TOKEN: process.env.BOOTSTRAP_TOKEN ?? 'token-uji-lokal-0123456789' };
const app = createApp(async () => env);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/__dev_storage/up/') && req.method === 'PUT') {
      const key = url.pathname.slice('/__dev_storage/up/'.length);
      const fd = await new Request(url, { method: 'POST', headers: req.headers, body }).formData();
      const file = fd.get('file');
      writeFileSync(fp(key), Buffer.from(await file.arrayBuffer()));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return;
    }
    if (url.pathname.startsWith('/__dev_storage/dl/')) {
      const key = url.pathname.slice('/__dev_storage/dl/'.length);
      if (!existsSync(fp(key))) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${url.searchParams.get('name') ?? 'file'}"` });
      res.end(readFileSync(fp(key))); return;
    }
    if (!url.pathname.startsWith('/api/')) {
      const p = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = join(root, 'public', p);
      if (file.startsWith(join(root, 'public')) && existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file)); return;
      }
      res.writeHead(404); res.end('Tidak ditemukan'); return;
    }
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, duplex: 'half', redirect: 'manual' });
    const response = await app.fetch(request);
    const headers = {};
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('dev server error');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Dev server (Postgres PGlite) siap di http://127.0.0.1:${PORT}`));
