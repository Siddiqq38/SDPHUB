// Membuat docs/API.md dan docs/MATRIKS-HAK-AKSES.md langsung dari kode, agar dokumen tidak melenceng.
// Jalankan: node --no-warnings scripts/gen-docs.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'docs'), { recursive: true });
const { PERM, STAFF } = await import('../src/lib/rbac.ts');

const ROLES = ['master', 'supervisor', 'cs', 'crm', 'operator', 'gudang', 'qc', 'fat', 'customer'];
let md = '# Matriks hak akses\n\nDihasilkan dari `src/lib/rbac.ts`. Server memeriksa hak ini pada setiap API; menu frontend hanya cerminan.\n\n';
md += '| Izin | ' + ROLES.join(' | ') + ' |\n|---|' + ROLES.map(() => ':-:').join('|') + '|\n';
for (const [perm, roles] of Object.entries(PERM)) md += `| \`${perm}\` | ` + ROLES.map((r) => (roles.includes(r) ? 'ya' : '')).join(' | ') + ' |\n';
md += '\nCatatan pembatasan di luar tabel:\n\n';
md += '- **Customer** hanya melihat order, artwork, file, dan pembayaran bisnisnya sendiri (data customer lain dijawab 404). Customer tidak melihat catatan internal CS.\n';
md += '- **Operator** hanya dapat memulai/menyelesaikan WO yang ditugaskan kepadanya.\n';
md += '- **CS** tidak dapat merilis produksi, tidak dapat ACC member, tidak dapat memverifikasi pembayaran.\n';
md += '- Setelah QC kesiapan mesin NG, kesimpulan "siap" hanya dapat ditetapkan petugas **QC**.\n';
md += '- Tidak ada role yang dapat dipilih pendaftar publik. Role customer hanya dibuat saat master ACC.\n';
md += `- Role karyawan yang dapat dibuat master: ${STAFF.join(', ')}.\n`;
writeFileSync(join(root, 'docs', 'MATRIKS-HAK-AKSES.md'), md);

// ---- API ----
const index = readFileSync(join(root, 'src', 'index.ts'), 'utf8');
const mounts = [...index.matchAll(/app\.route\('([^']+)', (\w+)\)/g)].map((m) => ({ prefix: m[1], name: m[2] }));
const exportsByFile = {};
for (const f of readdirSync(join(root, 'src', 'routes'))) {
  const src = readFileSync(join(root, 'src', 'routes', f), 'utf8');
  for (const m of src.matchAll(/export const (\w+) = new Hono/g)) exportsByFile[m[1]] = { file: f, src };
}
const authRouters = new Set(['memberRoutes', 'masterRoutes', 'orderRoutes', 'prodRoutes', 'fileRoutes', 'stockRoutes', 'financeRoutes']);
let api = '# Dokumentasi API\n\nDihasilkan dari kode (`scripts/gen-docs.mjs`). Semua respons JSON kecuali unduhan file. Galat berbentuk `{"error": "pesan"}`.\n\n';
api += 'Autentikasi: cookie sesi `sdp_session` (HttpOnly, SameSite=Strict, Secure di HTTPS). Metode selain GET wajib header `X-CSRF-Token` (nilai dari `/api/auth/login` atau `/api/auth/me`).\n\n';
api += '| Metode | Path | Akses | Berkas |\n|---|---|---|---|\n';
for (const mnt of mounts) {
  const ex = exportsByFile[mnt.name];
  if (!ex) continue;
  const re = new RegExp(`${mnt.name}\\.(get|post|put|patch|delete)\\('([^']*)'(?:, (authn|need\\('([\\w.]+)'\\)))?`, 'g');
  for (const m of ex.src.matchAll(re)) {
    const method = m[1].toUpperCase();
    const path = (mnt.prefix + (m[2] === '/' ? '' : m[2])).replace(/\/+$/, '') || '/';
    let who;
    if (m[4]) who = 'izin `' + m[4] + '`: ' + PERM[m[4]].join(', ');
    else if (mnt.name === 'authRoutes') who = ['/login'].includes(m[2]) ? 'publik (dibatasi percobaan)' : 'login';
    else if (['publicRoutes', 'publicMemberRoutes', 'bootstrapRoutes'].includes(mnt.name)) who = mnt.name === 'bootstrapRoutes' ? 'publik + BOOTSTRAP_TOKEN, sekali pakai' : 'publik';
    else who = authRouters.has(mnt.name) ? 'login; pemeriksaan peran/kepemilikan di dalam handler' : 'publik';
    api += `| ${method} | \`${path}\` | ${who} | ${ex.file} |\n`;
  }
}
api += '\nUnggah file: `POST /api/files` multipart (`file`, `kind`, opsional `customer_id` untuk staf). Unduh: `GET /api/files/:kind/:id` atau `GET /api/prod/artworks/:id/file`, keduanya memeriksa peran dan kepemilikan.\n';
writeFileSync(join(root, 'docs', 'API.md'), api);
console.log('docs/MATRIKS-HAK-AKSES.md dan docs/API.md dibuat');
