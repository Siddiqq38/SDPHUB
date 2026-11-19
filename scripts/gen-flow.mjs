// Membuat docs/alur-pesanan.svg dari daftar node. Jalankan: node scripts/gen-flow.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 900, BW = 250, BH = 52;
const N = {
  a: [450, 40, 'Member aktif membuat pesanan'],
  b: [450, 125, 'Satu meja CS terpadu: DTF dan Sublim'],
  c: [450, 210, 'CS konfirmasi detail ke PIC, pembayaran sesuai kebijakan, dan deadline'],
  d: [250, 305, 'Persetujuan rilis oleh penanggung jawab (artwork sudah disetujui PIC)'],
  e: [650, 305, 'Assign operator check-in dan Standby'],
  f: [250, 400, 'WO dan antrean per mesin'],
  g: [650, 400, 'QC kesiapan mesin diverifikasi'],
  h: [450, 495, 'Operator Mulai (waktu server dicatat)'],
  i: [160, 595, 'DTF: film, powder, curing'],
  j: [450, 595, 'Sublim: print kertas'],
  k: [740, 595, 'Sublim kain: print dan transfer calender'],
  l: [450, 695, 'QC hasil: Pass / Hold / Rework / Reject'],
  m: [450, 780, 'Packing dan serah terima sebagian atau penuh'],
  n: [450, 865, 'Tracking customer dan penutupan'],
};
const E = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['c', 'e'], ['d', 'f'], ['e', 'g'], ['f', 'h'], ['g', 'h'], ['h', 'i'], ['h', 'j'], ['h', 'k'], ['i', 'l'], ['j', 'l'], ['k', 'l'], ['l', 'm'], ['m', 'n']];

function wrap(text, max = 30) {
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 930" width="${W}" height="930" font-family="Segoe UI, Arial, sans-serif">
<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#7a8599"/></marker></defs>
<rect width="${W}" height="930" fill="#ffffff"/>
<text x="20" y="24" font-size="14" font-weight="700" fill="#1c2330">Alur pesanan terpadu SDP</text>\n`;
for (const [a, b] of E) {
  const [x1, y1] = N[a], [x2, y2] = N[b];
  const sy = y1 + BH / 2, ey = y2 - BH / 2;
  const my = (sy + ey) / 2;
  svg += `<path d="M${x1} ${sy} L${x1} ${my} L${x2} ${my} L${x2} ${ey - 2}" fill="none" stroke="#7a8599" stroke-width="1.4" marker-end="url(#ar)"/>\n`;
}
for (const [k, [x, y, t]] of Object.entries(N)) {
  const lines = wrap(t);
  svg += `<rect x="${x - BW / 2}" y="${y - BH / 2}" width="${BW}" height="${BH}" rx="10" fill="#e6f1fc" stroke="#9cc3ea"/>\n`;
  lines.forEach((ln, i) => { svg += `<text x="${x}" y="${y + 4 + (i - (lines.length - 1) / 2) * 14}" text-anchor="middle" font-size="12" fill="#14518f">${esc(ln)}</text>\n`; });
  void k;
}
svg += `<text x="20" y="915" font-size="11" fill="#5b6577">Aturan: CS tidak merilis sendiri. Satu mesin satu WO pada satu waktu. Hasil kain dan kertas Sublim tidak dihitung ganda. Serah terima boleh sebagian.</text>\n</svg>\n`;
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'alur-pesanan.svg'), svg);
console.log('docs/alur-pesanan.svg dibuat');
