// Memeriksa kesiapan pindah: SQL ekspor dari harness dimuat ke Postgres (skema asli), lalu hash password diverifikasi
// oleh kode server Supabase. Jalankan setelah uji alur mode spreadsheet, selama harness masih hidup.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { verifyPassword } from '../src/lib/auth.ts';
import { loadGas } from './gas-harness.mjs';
import { calendarOf } from '../src/core.ts';
import { days, plan, readyFor, slaDue } from '../src/lib/capacity.ts';
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

// Jadwal kapasitas harus identik di kedua backend.
{
  const cal = calendarOf({ overtime: JSON.stringify([{ day: '2026-11-29', start: '09:00', end: '12:00' }, { day: '2026-11-27', start: '21:00', end: '23:00' }]) });
  const gcal = g.calendar_({ overtime: JSON.stringify([{ day: '2026-11-29', start: '09:00', end: '12:00' }, { day: '2026-11-27', start: '21:00', end: '23:00' }]) });
  const cfg = { cal, norms: { dtf: 240, subp: 60, cal: 90 }, pct: 90, holdMin: 120, finDtf: 30, finSub: 60 };
  const now = Date.parse('2026-11-27T02:15:00Z');
  const job = (id, extra) => ({ id, order_no: 'O' + id, service: 'dtf', status: 'antrian', stage: 'dtf', meter: 40, rework_m: null, priority: 0, approved_at: now - 1000 + id, started_at: null, created_at: now - 3600000, finished_at: null, paid: true, ...extra });
  const jobs = [job(1, { status: 'produksi', started_at: now - 600000 }), job(2, { meter: 150 }), job(3, { service: 'sub', stage: 'subp', meter: 200 }), job(4, { status: 'bayar', paid: false }), job(5, { status: 'cek', paid: false, created_at: now - 8 * 3600000 }), job(6, { status: 'qc', finished_at: now - 100, meter: 12 })];
  const gcfg = { ...cfg, cal: gcal };
  assert.deepEqual(plain(g.plan_(jobs, now, gcfg).slots), plain(plan(jobs, now, cfg).slots));
  assert.deepEqual(plain(g.days_(jobs, now, gcfg)), plain(days(jobs, now, cfg)));
  for (const [svc, m] of [['dtf', 1], ['dtf', 500], ['sub', 80]]) assert.equal(g.readyFor_(jobs, now, gcfg, svc, m), readyFor(jobs, now, cfg, svc, m));
  for (const t of [now, now + 4 * 3600000, now + 30 * 3600000]) assert.equal(g.slaDue_(t, gcal), slaDue(t, cal));
  console.log('  ok   jadwal kapasitas Code.gs sama dengan server');
}
console.log('Kesiapan pindah: lolos');
