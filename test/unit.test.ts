import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addWorkSeconds, effectiveSeconds, localDay } from '../src/lib/calendar.ts';
import { convert, sumSameUnit, workSeconds } from '../src/lib/units.ts';
import { hashPassword, passwordProblem, verifyPassword } from '../src/lib/auth.ts';

// WITA = UTC+8. Helper: waktu lokal WITA -> epoch ms.
const wita = (iso: string) => Date.parse(iso + '+08:00');
const fmt = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

test('10 meter x 4 menit = 40 menit efektif; mulai 11.40 selesai 13.20 (melewati istirahat)', () => {
  const secs = workSeconds(10, 240)!;
  assert.equal(secs, 2400);
  const end = addWorkSeconds(wita('2026-11-10T11:40:00'), secs); // Selasa
  assert.equal(fmt(end), '2026-11-10 13:20');
});

test('10 meter x 10 detik = 100 detik; 10 menit/meter = 100 menit', () => {
  assert.equal(workSeconds(10, 10), 100);
  assert.equal(workSeconds(10, 600), 6000);
  assert.equal(workSeconds(10, 600)! / 60, 100);
});

test('norma belum diatur menghasilkan null, bukan nol', () => {
  assert.equal(workSeconds(10, null), null);
  assert.equal(workSeconds(10, undefined), null);
});

test('melewati jam tutup 16.00 lanjut besok jam 09.00', () => {
  const end = addWorkSeconds(wita('2026-11-10T15:30:00'), 3600); // 30 menit hari ini + 30 menit besok
  assert.equal(fmt(end), '2026-11-11 09:30');
});

test('Sabtu sore melompati Minggu libur ke Senin', () => {
  const end = addWorkSeconds(wita('2026-11-14T15:30:00'), 3600); // Sabtu 14 Nov 2026
  assert.equal(fmt(end), '2026-11-16 09:30'); // Senin
});

test('mulai sebelum jam produksi atau saat Minggu dimulai pada blok berikutnya', () => {
  assert.equal(fmt(addWorkSeconds(wita('2026-11-10T08:40:00'), 60)), '2026-11-10 09:01');
  assert.equal(fmt(addWorkSeconds(wita('2026-11-15T10:00:00'), 60)), '2026-11-16 09:01'); // Minggu
});

test('detik efektif mengabaikan istirahat dan libur', () => {
  assert.equal(effectiveSeconds(wita('2026-11-10T11:00:00'), wita('2026-11-10T14:00:00')), 2 * 3600);
  assert.equal(effectiveSeconds(wita('2026-11-14T15:00:00'), wita('2026-11-16T10:00:00')), 3600 + 3600);
});

test('hari lokal memakai WITA, bukan UTC', () => {
  assert.equal(localDay(Date.parse('2026-11-10T17:00:00Z')), '2026-11-11'); // 01.00 WITA
});

test('konversi satuan harus eksplisit dan satuan berbeda tidak dijumlahkan', () => {
  assert.deepEqual(convert({ qty: 5, unit: 'roll' }, 'meter', 50), { qty: 250, unit: 'meter' });
  assert.throws(() => convert({ qty: 5, unit: 'roll' }, 'meter', null), /belum diatur/);
  assert.throws(() => sumSameUnit([{ qty: 1, unit: 'meter' }, { qty: 1, unit: 'lembar' }]), /Tidak boleh/);
  assert.equal(sumSameUnit([{ qty: 1, unit: 'meter' }, { qty: 2, unit: 'meter' }]).qty, 3);
});

test('hash password: benar, salah, dan salt acak', async () => {
  const a = await hashPassword('Rahasia12345');
  const b = await hashPassword('Rahasia12345');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(await verifyPassword('Rahasia12345', a.hash, a.salt, a.iter), true);
  assert.equal(await verifyPassword('rahasia12345', a.hash, a.salt, a.iter), false);
  assert.ok(passwordProblem('pendek1'));
  assert.ok(passwordProblem('hanyahurufsemua'));
  assert.equal(passwordProblem('Rahasia12345'), null);
});
