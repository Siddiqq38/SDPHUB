'use strict';
// Simulasi alur tanpa akun. Tidak memakai fetch sama sekali: tidak ada jalur ke database produksi.
const el = document.getElementById('sim');
const ROLES = { customer: 'Customer', cs: 'CS', supervisor: 'Penanggung jawab', operator: 'Operator', qc: 'QC' };

const COMMON_HEAD = [
  { who: 'customer', t: 'Member aktif membuat pesanan', d: 'Pesanan otomatis berkategori DTF/Sublim dan masuk inbox CS.' },
  { who: 'cs', t: 'Konfirmasi detail, pembayaran sesuai kebijakan, dan deadline', d: 'CS mencatat bukti konfirmasi ke PIC dan kelayakan deadline. CS tidak menyetujui rilis sendiri.' },
  { who: 'supervisor', t: 'Persetujuan rilis produksi', d: 'Penanggung jawab merilis setelah artwork disetujui PIC.' },
  { who: 'cs', t: 'Assign operator check-in & Standby, buat WO per mesin', d: 'Assignment tidak melewati persetujuan file, bahan, pembayaran, atau rilis.' },
  { who: 'qc', t: 'QC kesiapan mesin', d: 'Ada NG berarti produksi ditahan sampai diperbaiki dan diverifikasi ulang.' },
  { who: 'operator', t: 'Operator menekan Mulai', d: 'Waktu server, operator, dan sesi tercatat. Satu mesin satu WO pada satu waktu.' },
];
const PATHS = {
  DTF: { name: 'DTF - print transfer', norm: 240, normNote: 'acuan aplikasi DTF lama (4 menit/meter)', out: 'Hasil transfer DTF siap',
    mid: [{ who: 'operator', t: 'Print film → powdering → curing', d: 'Output: transfer DTF roll, lembar, atau potongan.' }] },
  SUBLIM_KERTAS: { name: 'Sublim - print kertas', norm: 120, normNote: 'CONTOH, bukan norma operasional', out: 'Kertas sublim siap',
    mid: [{ who: 'operator', t: 'Print kertas sublim', d: 'Tidak wajib melalui press.' }] },
  SUBLIM_KAIN: { name: 'Sublim - print dan transfer kain', norm: 120, normNote: 'CONTOH, bukan norma operasional', out: 'Kain sublim siap',
    mid: [{ who: 'operator', t: 'Print kertas', d: 'Hasil diperiksa sebelum transfer.' }, { who: 'qc', t: 'Pemeriksaan hasil print kertas', d: 'Lolos dulu, baru boleh transfer.' }, { who: 'operator', t: 'Transfer calender / roller heat press', d: 'Output: kain yang menerima hasil transfer.' }] },
};
const COMMON_TAIL = [
  { who: 'qc', t: 'QC hasil: Pass / Hold / Rework / Reject', d: 'Output awal, reject, rework, dan output baik final dipisah agar tidak dihitung ganda.' },
  { who: 'cs', t: 'Packing dan serah terima sebagian atau penuh', d: 'Satu paket diserahkan tidak berarti seluruh order selesai.' },
  { who: 'cs', t: 'Tracking customer dan penutupan', d: 'Tracking publik hanya menampilkan ringkasan aman.' },
];

let role = 'customer', path = 'DTF', step = 0, qty = 10;
const logs = [];

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (v != null) e.setAttribute(k, v); }
  for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}
const steps = () => [...COMMON_HEAD, ...PATHS[path].mid, ...COMMON_TAIL];

// Kalender: blok 09:00-12:00 dan 13:00-16:00 WITA, Minggu libur. Contoh mulai Selasa 11:40.
function sampleEstimate(totalSeconds) {
  const blocks = [[540, 720], [780, 960]];
  let day = 2, min = 11 * 60 + 40, remaining = totalSeconds / 60;
  for (let guard = 0; guard < 400; guard++) {
    if (day % 7 !== 0) for (const [a, b] of blocks) {
      const from = Math.max(min, a);
      if (from >= b) continue;
      if (remaining <= b - from) { const t = from + remaining; return `${['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][day % 7]} ${String(Math.floor(t / 60)).padStart(2, '0')}.${String(Math.round(t % 60)).padStart(2, '0')}`; }
      remaining -= b - from;
    }
    day++; min = 0;
  }
  return '-';
}

function draw() {
  const s = steps();
  const cur = s[step];
  const secs = qty * PATHS[path].norm;
  el.replaceChildren(
    h('h1', { style: 'margin-top:20px' }, 'Simulasi alur pesanan'),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', {}, 'Peran Anda:'), Object.entries(ROLES).map(([k, v]) => h('button', { class: k === role ? 'primary' : '', onclick: () => { role = k; draw(); } }, v))),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('strong', {}, 'Jalur layanan:'), Object.entries(PATHS).map(([k, v]) => h('button', { class: k === path ? 'primary' : '', onclick: () => { path = k; step = 0; logs.length = 0; draw(); } }, v.name)))),
    h('div', { class: 'card' }, h('h3', {}, 'Langkah ', Math.min(step + 1, s.length), ' dari ', s.length),
      h('ol', { class: 'steps' }, s.map((x, i) => h('li', { style: i === step ? 'font-weight:700' : i < step ? 'opacity:.55' : '' }, x.t, ' ', h('span', { class: 'tag' }, ROLES[x.who])))),
      cur ? h('div', {}, h('p', { class: 'muted' }, cur.d),
        role === cur.who ? h('button', { class: 'primary', onclick: () => { logs.push(`${ROLES[role]}: ${cur.t}`); step++; draw(); } }, 'Jalankan langkah ini')
          : h('div', { class: 'msg' }, `Langkah ini dilakukan oleh ${ROLES[cur.who]}. Ganti peran untuk melanjutkan. ${ROLES[role]} tidak boleh melakukannya.`))
        : h('div', { class: 'msg okk' }, 'Selesai. Hasil di tracking publik: ', h('strong', {}, PATHS[path].out), '.')),
    h('div', { class: 'card' }, h('h3', {}, 'Contoh hitungan estimasi (CONTOH)'),
      h('label', {}, 'Qty (meter)'), h('input', { type: 'number', value: qty, min: 1, onchange: (e) => { qty = Math.max(1, Number(e.target.value) || 1); draw(); } }),
      h('p', {}, `${qty} meter × ${PATHS[path].norm} detik/meter = ${Math.round(secs / 60 * 10) / 10} menit efektif. Mulai Selasa 11.40 → selesai ${sampleEstimate(secs)} (melewati istirahat, jam tutup, dan Minggu).`),
      h('p', { class: 'muted small' }, 'Norma: ' + PATHS[path].normNote + '. Norma DTF tidak otomatis berlaku untuk Sublim; di aplikasi asli norma yang belum diatur ditampilkan "Belum diatur".')),
    h('div', { class: 'card' }, h('h3', {}, 'Riwayat latihan'), logs.length ? h('ul', {}, logs.map((l) => h('li', {}, l))) : h('p', { class: 'muted' }, 'Belum ada langkah.'),
      h('button', { onclick: () => { step = 0; logs.length = 0; draw(); } }, 'Reset latihan')));
}
draw();
