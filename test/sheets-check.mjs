// Memeriksa kesiapan pindah: SQL ekspor dari harness dimuat ke Postgres (skema asli), lalu hash password diverifikasi
// oleh kode server Supabase. Jalankan setelah uji alur mode spreadsheet, selama harness masih hidup.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { verifyPassword } from '../src/lib/auth.ts';
import { loadGas } from './gas-harness.mjs';
import { MORNING, RETAIL, ACCESS_DEFAULT, GRANTABLE, ROLES, FILE_CHECKS, QC_CHECKS } from '../src/domain.ts';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8788';
const sql = await (await fetch(BASE + '/__export')).text();
const db = new PGlite({ extensions: { citext }, parsers: { 20: Number, 1700: Number } });
for (const f of ['0001_schema.sql', '0002_seed_config.sql']) await db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
await db.exec(sql);
for (const t of ['users', 'customers', 'orders', 'payments', 'skus', 'stock_ledger', 'qc_reports', 'logs', 'files', 'audit_log']) {
  const n = (await db.query(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n;
  const expected = sql.split('\n').filter((l) => l.startsWith(`INSERT INTO ${t} (`)).length;
  assert.equal(n, t === 'skus' ? 14 : expected, t);
  console.log(`  ok   ${t}: ${n} baris`);
}
const admin = (await db.query("SELECT * FROM users WHERE code = 'master1'")).rows[0];
assert.equal(await verifyPassword('Final12345xyz', admin.pass_hash, admin.pass_salt, Number(admin.pass_iter)), true);
console.log('  ok   password dari spreadsheet berlaku di server Supabase');
await db.query("INSERT INTO customers (code,name,wa,source,status,created_at) VALUES ('X-1','x','1','Tigalapan Kaos','aktif',1)");
console.log('  ok   penomoran id berlanjut setelah impor');
assert.equal((await db.query('SELECT used_at FROM bootstrap')).rows[0].used_at > 0, true);
console.log('  ok   bootstrap terkunci setelah impor');

// Aturan di Code.gs harus sama dengan src/domain.ts
const { context: g } = loadGas();
const plain = (v) => JSON.parse(JSON.stringify(v));
assert.deepEqual(plain(g.ROLES), [...ROLES]);
assert.deepEqual(plain(g.GRANTABLE), [...GRANTABLE]);
assert.deepEqual(plain(g.ACCESS_DEFAULT), ACCESS_DEFAULT);
for (const [k, d] of Object.entries(RETAIL)) assert.deepEqual(plain(g.RETAIL[k]), { w: d.w, l: d.l, p: d.p });
assert.equal(g.FILE_CHECK_COUNT, FILE_CHECKS.length);
assert.deepEqual(plain(g.QC_CHECK_COUNT), { dtf: QC_CHECKS.dtf.length, sub: QC_CHECKS.sub.length });
for (const [m, steps] of Object.entries(MORNING)) {
  assert.deepEqual(plain(g.MORNING_TEXT[m]), steps.flatMap((s) => s.checks));
  assert.deepEqual(plain(g.MORNING[m]), [steps.flatMap((s) => s.checks).length, steps.filter((s) => s.photo).map((s) => s.photo)]);
}
console.log('  ok   aturan Code.gs sama dengan server');
console.log('Kesiapan pindah: lolos');
