// Menjalankan apps-script/Code.gs di Node dengan tiruan layanan Google, dan melayaninya sebagai API REST
// agar uji alur yang sama dapat dipakai:  node test/gas-harness.mjs   lalu   SHEETS=1 node test/e2e.mjs
// GET /__export mengembalikan SQL pindahan Supabase.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

export function loadGas() {
  const sheets = new Map(), props = new Map([['BOOTSTRAP_TOKEN', 'token-uji-lokal-0123456789']]), cache = new Map(), drive = new Map();
  // Seperti Sheets: apostrof di depan menandai teks dan tidak ikut tersimpan; rumus tidak boleh masuk.
  const store = (v) => {
    if (typeof v === 'string' && v.startsWith("'")) return v.slice(1);
    if (typeof v === 'string' && v.startsWith('=')) throw new Error('rumus tersisip ke sheet: ' + v);
    return v;
  };
  const makeSheet = () => {
    const data = [];
    let max = 5; // sengaja kecil agar penambahan baris grid ikut teruji
    let cols = 26;
    const sh = {
      data,
      getDataRange: () => ({ getValues: () => { const w = Math.max(1, ...data.map((r) => r.length)); return data.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? '')); } }),
      getRange: (r, c, nr = 1, nc = 1) => {
        if (r + nr - 1 > max) throw new Error('di luar batas grid sheet: baris ' + (r + nr - 1) + ' > ' + max);
        const range = {
          setValues: (vals) => { vals.forEach((row, i) => { const t = (data[r - 1 + i] ??= []); row.forEach((v, j) => { t[c - 1 + j] = store(v); }); }); return range; },
          setNumberFormat: () => range,
          setFontWeight: () => range,
        };
        return range;
      },
      getLastRow: () => data.length,
      getMaxRows: () => max,
      getMaxColumns: () => cols,
      insertColumnsAfter: (after, count) => { cols += count; },
      setFrozenRows: () => {},
      deleteRows: (n, count) => { if (max - count < 2) throw new Error('tidak boleh menghapus semua baris tidak beku'); data.splice(n - 1, count); max -= count; },
      insertRowsAfter: (after, count) => { max += count; },
    };
    return sh;
  };
  const ss = { getSheetByName: (n) => sheets.get(n) ?? null, insertSheet: (n) => { const s = makeSheet(); sheets.set(n, s); return s; } };
  const fileObj = (id) => ({ getId: () => id, getName: () => drive.get(id).name, getBlob: () => ({ getBytes: () => drive.get(id).bytes }), setSharing: (access, perm) => { drive.get(id).shared = access + '/' + perm; } });
  const makeFolder = (path) => {
    const children = new Map();
    return {
      getId: () => 'folder-1',
      createFile: (blob) => { const id = randomUUID(); drive.set(id, { ...blob, path }); return fileObj(id); },
      getFoldersByName: (n) => { const f = children.get(n); let done = false; return { hasNext: () => !!f && !done, next: () => { done = true; return f; } }; },
      createFolder: (n) => { const f = makeFolder(path + '/' + n); children.set(n, f); return f; },
    };
  };
  const folder = makeFolder('SDP');
  const context = {
    console, Date, JSON, Math,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => randomUUID(),
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      newBlob: (bytes, type, name) => ({ bytes: typeof bytes === 'string' ? [...Buffer.from(bytes)] : bytes, type, name }),
    },
    DriveApp: { createFolder: () => folder, getFolderById: () => folder, getFileById: (id) => fileObj(id), Access: { ANYONE_WITH_LINK: 'LINK' }, Permission: { VIEW: 'VIEW' } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), context, { filename: 'Code.gs' });
  vm.runInContext('setup()', context);
  return { context, sheets, props, drive };
}

if (process.argv[1]?.endsWith('gas-harness.mjs')) {
  const { context, drive } = loadGas();
  const PORT = Number(process.env.PORT ?? 8788);
  createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.url === '/__drive') { res.writeHead(200); res.end(JSON.stringify([...drive.values()].map((f) => ({ path: f.path, name: f.name, shared: f.shared ?? null, size: f.bytes.length })))); return; }
    if (req.url === '/__export') { res.writeHead(200); res.end(context.buatSqlSupabase_()); return; }
    // Pratinjau layar dalam mode spreadsheet: berkas statis, config.js diarahkan ke /exec (tiruan URL Web App).
    const path = req.url.split('?')[0];
    if (path === '/exec') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(context.doPost({ postData: { contents: Buffer.concat(chunks).toString() } }).text);
      return;
    }
    if (!path.startsWith('/api/')) {
      const name = path === '/' ? 'index.html' : path.slice(1);
      if (name === 'config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end("window.SDP_CONFIG={sheetsUrl:'/exec'};"); return; }
      if (!['index.html', 'app.js', 'styles.css', 'logo-light.png', 'logo-dark.png', 'icon.png'].includes(name)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': name.endsWith('js') ? 'text/javascript' : name.endsWith('css') ? 'text/css' : name.endsWith('png') ? 'image/png' : 'text/html; charset=utf-8' });
      res.end(readFileSync(new URL('../public/' + name, import.meta.url)));
      return;
    }
    const token = /sdp_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const out = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ method: req.method, path: req.url, body, token }) } }).text);
    const headers = { 'content-type': 'application/json' };
    if (req.url === '/api/auth/login' && out.status === 200) {
      headers['set-cookie'] = `sdp_session=${out.data.token}; Path=/`;
      out.data.csrf = 'sheets';
    }
    res.writeHead(out.status, headers);
    res.end(JSON.stringify(out.data));
  }).listen(PORT, '127.0.0.1', () => console.log(`Harness Apps Script siap di http://127.0.0.1:${PORT}`));
}
