import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addWorkSeconds, effectiveSeconds, localDay } from '../src/lib/calendar.ts';
import { hashPassword, passwordProblem, verifyPassword } from '../src/lib/auth.ts';
import { MORNING, RETAIL, buildItems, filmCm, tier, totalOf, FILE_CHECKS, QC_CHECKS } from '../src/domain.ts';

const wita = (iso: string) => Date.parse(iso + '+08:00');
const fmt = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
const settings = { priceDtf: 23000, priceSub120: null, priceSub160: 26000, priceSub180: null, normDtf: 240, normSubPrint: null, normPress: null };

test('10 meter x 4 menit mulai 11.40 selesai 13.20 (melewati istirahat)', () => {
  assert.equal(fmt(addWorkSeconds(wita('2026-11-10T11:40:00'), 10 * 240)), '2026-11-10 13:20');
});
test('melewati jam tutup dan Minggu', () => {
  assert.equal(fmt(addWorkSeconds(wita('2026-11-14T15:30:00'), 3600)), '2026-11-16 09:30'); // Sabtu -> Senin
  assert.equal(effectiveSeconds(wita('2026-11-10T11:00:00'), wita('2026-11-10T14:00:00')), 7200);
});
test('hari kerja memakai WITA', () => {
  assert.equal(localDay(Date.parse('2026-11-10T17:00:00Z')), '2026-11-11');
});
test('harga DTF maklon 23.000 per meter', () => {
  const items = buildItems({ service: 'dtfm', meter: 10 }, settings);
  assert.equal(totalOf(items), 230000);
});
test('harga retail bertingkat per ukuran: 1-11, 12-36, 37 ke atas', () => {
  assert.deepEqual([tier(11), tier(12), tier(36), tier(37)], [0, 1, 1, 2]);
  assert.equal(totalOf(buildItems({ service: 'dtfr', qty: { 'DTF C': 12 } }, settings)), 276000);
  assert.equal(totalOf(buildItems({ service: 'dtfr', qty: { 'DTF C': 11, 'DTF A': 37 } }, settings)), 11 * 25000 + 37 * 7000);
});
test('panjang film memilih orientasi paling hemat pada lebar 58 cm', () => {
  assert.equal(filmCm(RETAIL['DTF C'], 1), 30); // 42 x 30: lebar 42, panjang 30
  assert.equal(filmCm(RETAIL['DTF D'], 1), 59); // lebar 59 > 58, harus diputar
});
test('input tidak sah ditolak; harga sublim yang belum diatur tidak boleh dipakai', () => {
  assert.throws(() => buildItems({ service: 'dtfm', meter: 0 }, settings), /Panjang/);
  assert.throws(() => buildItems({ service: 'dtfm', meter: 1.005 }, settings), /desimal/);
  assert.throws(() => buildItems({ service: 'dtfr', qty: { 'DTF A': 1.5 } }, settings), /bulat/);
  assert.throws(() => buildItems({ service: 'dtfr', qty: {} }, settings), /minimal/);
  assert.throws(() => buildItems({ service: 'sub', meter: 5, width: 'priceSub120' }, settings), /belum diatur/);
  assert.equal(totalOf(buildItems({ service: 'sub', meter: 5, width: 'priceSub160' }, settings)), 130000);
});
test('konstanta di frontend sama dengan aturan server', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const [k, d] of Object.entries(RETAIL)) assert.ok(app.includes(`'${k}':{s:'${d.s}',w:${d.w},l:${d.l},p:[${d.p.join(',')}]}`), k);
  for (const t of [...FILE_CHECKS, ...QC_CHECKS.dtf, ...QC_CHECKS.sub]) assert.ok(app.includes(`'${t}'`), t);
  for (const s of Object.values(MORNING).flat()) for (const t of s.checks) assert.ok(app.includes(`'${t}'`), t);
});
test('hash password: salt acak dan verifikasi', async () => {
  const a = await hashPassword('Rahasia12345');
  const b = await hashPassword('Rahasia12345');
  assert.notEqual(a.hash, b.hash);
  assert.equal(await verifyPassword('Rahasia12345', a.hash, a.salt, a.iter), true);
  assert.equal(await verifyPassword('rahasia12345', a.hash, a.salt, a.iter), false);
  assert.ok(passwordProblem('pendek1'));
});
