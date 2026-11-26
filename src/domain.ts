// Aturan bisnis SDP (alur WIC-OPR-005). Fungsi murni dan konstanta; dipakai server dan diuji unit.

export const ROLES = ['master', 'manager', 'spv', 'cs', 'crm', 'store', 'op', 'qc', 'gudang', 'fat'] as const;
export type Role = (typeof ROLES)[number];

export const GRANTABLE = ['dashboard', 'laporan', 'input', 'cs', 'toko', 'pelanggan', 'cekfile', 'produksi', 'qc', 'serah', 'bayar', 'stok', 'loss', 'layanan', 'lacak'] as const;
export type Page = (typeof GRANTABLE)[number] | 'atur' | 'pengguna' | 'akses' | 'data' | 'akun';

export const ACCESS_DEFAULT: Record<Exclude<Role, 'master'>, Page[]> = {
  manager: ['dashboard', 'laporan', 'pelanggan', 'produksi', 'bayar', 'stok', 'loss', 'layanan', 'lacak'],
  spv: ['dashboard', 'laporan', 'cs', 'cekfile', 'produksi', 'qc', 'serah', 'stok', 'loss', 'layanan', 'lacak'],
  cs: ['dashboard', 'input', 'cs', 'pelanggan', 'bayar', 'produksi', 'serah', 'stok', 'loss', 'layanan', 'lacak'],
  crm: ['pelanggan', 'layanan', 'lacak'],
  store: ['input', 'toko', 'layanan', 'lacak'],
  op: ['cekfile', 'produksi', 'qc', 'stok'],
  qc: ['qc', 'produksi'],
  gudang: ['stok', 'serah'],
  fat: ['bayar', 'laporan', 'layanan', 'lacak'],
};

// Menu yang menampilkan data order. Tanpa salah satunya, data order tidak dikirim ke browser.
export const ORDER_PAGES: Page[] = ['dashboard', 'laporan', 'input', 'cs', 'toko', 'pelanggan', 'cekfile', 'produksi', 'qc', 'serah', 'bayar'];

// Price list retail DTF dari aplikasi DTF Manage Pro (price list 04 Nov 2026).
export const RETAIL: Record<string, { s: string; w: number; l: number; p: [number, number, number] }> = {
  'DTF Logo': { s: '10 x 15 cm', w: 15, l: 10, p: [6000, 5500, 4500] },
  'DTF A': { s: 'A5, 15 x 21 cm', w: 21, l: 15, p: [10000, 9000, 7000] },
  'DTF B': { s: 'A4, 21 x 30 cm', w: 30, l: 21, p: [17000, 16000, 12000] },
  'DTF C': { s: 'A3, 30 x 42 cm', w: 42, l: 30, p: [25000, 23000, 18000] },
  'DTF D': { s: 'A2, 42 x 59 cm', w: 59, l: 42, p: [45000, 41000, 32000] },
};
export const CANVAS_CM = 58;
export const WIDTHS = [
  ['priceSub120', 'Lebar kain sampai 120 cm'],
  ['priceSub160', 'Lebar kain 121 sampai 160 cm'],
  ['priceSub180', 'Lebar kain 161 sampai 180 cm'],
] as const;

export const MACHINES = {
  dtf: { name: 'Printer DTF Rhinotec', svc: 'dtf', norm: 'normDtf' },
  subp: { name: 'Printer Sublim', svc: 'sub', norm: 'normSubPrint' },
  cal: { name: 'Mesin Press / Calender', svc: 'sub', norm: 'normPress' },
} as const;
export type Machine = keyof typeof MACHINES;

export const FILE_CHECKS = ['Format CDR, PDF, atau PNG transparan', 'Ukuran sesuai order', 'Font sudah di-outline', 'Resolusi minimal 300 DPI'];
export const QC_CHECKS = {
  dtf: ['Warna sesuai', 'Bebas garis', 'Tinta tidak meleber', 'Powder matang merata', 'Qty sesuai'],
  sub: ['Warna sesuai', 'Bebas garis', 'Tidak ghosting atau berbayang', 'Hasil press merata', 'Qty dan ukuran sesuai'], // usulan, menunggu SOP
};
export const CURING = { minC: 130, maxC: 150, minS: 60, maxS: 90 };

// QC pagi STD-OPR-006 (DTF). Checklist sublim masih usulan.
type Step = { time: string; title: string; checks: string[]; photo?: string };
const step = (time: string, title: string, checks: string[], photo?: string): Step => ({ time, title, checks, photo });
export const MORNING: Record<Machine, Step[]> = {
  dtf: [
    step('08.30-08.35', 'Persiapan mesin', ['Mesin dan area kerja bersih, aman, serta mesin menyala sesuai prosedur', 'Tinta putih/CMYK, PET film, dan powder adhesive tersedia dan siap digunakan']),
    step('08.35-08.45', 'Cleaning dan nozzle check', ['Cleaning sesuai kebutuhan; hasil nozzle check lengkap tanpa garis putus atau hilang'], 'Nozzle check'),
    step('08.45-08.50', 'Test print dan curing', ['Test print file standar: detail, warna, dan gambar sesuai file', 'Curing sesuai parameter; powder meleleh dan menempel merata'], 'Test print'),
    step('08.50-08.55', 'Uji press dan daya lekat', ['Press pada kain uji sesuai parameter; hasil transfer rata dan tidak mudah terkelupas'], 'Hasil press'),
    step('08.55-08.57', 'Laporan hasil', ['Hasil uji press dilaporkan kepada leader; kendala dan tindakan awal dicatat jika ada']),
    step('08.57-09.00', 'Kesiapan produksi', ['Seluruh hasil QC sudah diperiksa, bahan cukup, serta mesin dan area aman untuk produksi']),
  ],
  subp: [
    step('Usulan', 'Persiapan printer sublim', ['Mesin dan area bersih dan aman', 'Tinta dan kertas sublim tersedia']),
    step('Usulan', 'Nozzle check dan test print', ['Nozzle check lengkap', 'Test print sesuai file'], 'Nozzle check / test print'),
  ],
  cal: [
    step('Usulan', 'Persiapan press', ['Mesin dan area bersih dan aman', 'Suhu dan kecepatan sesuai instruksi']),
    step('Usulan', 'Uji transfer', ['Hasil transfer pada kain uji rata dan warna sesuai'], 'Hasil press'),
  ],
};

export interface Item { name: string; qty: number; unit: 'pcs' | 'meter'; price: number; meter: number }

export const tier = (q: number) => (q <= 11 ? 0 : q <= 36 ? 1 : 2);

/** Panjang film (cm) untuk q lembar: pilih orientasi paling hemat pada lebar cetak 58 cm. */
export function filmCm(d: { w: number; l: number }, q: number): number {
  let best = Infinity;
  for (const [a, b] of [[d.w, d.l], [d.l, d.w]]) {
    const per = Math.floor(CANVAS_CM / a);
    if (per > 0) best = Math.min(best, Math.ceil(q / per) * b);
  }
  return best;
}

/** Deadline: tanggal, boleh diikuti jam (WITA). */
export const DEADLINE_RE = /^\d{4}-\d{2}-\d{2}( ([01]\d|2[0-3]):[0-5]\d)?$/;
// Resi untuk customer: 10 karakter acak tanpa I, L, O, U agar mudah dibaca dan diketik.
const RESI_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newResi(): string {
  const s = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => RESI_CHARS[b & 31]).join('');
  return `RS-${s.slice(0, 5)}-${s.slice(5)}`;
}

export class RuleError extends Error {}

export type OrderInput = { service: 'dtfr' | 'dtfm' | 'sub'; qty?: Record<string, unknown>; meter?: unknown; width?: unknown };

/** Rincian dan harga dihitung server dari pengaturan; harga kiriman browser diabaikan. */
export function buildItems(input: OrderInput, settings: Record<string, number | null>): Item[] {
  if (input.service === 'dtfr') {
    const items: Item[] = [];
    for (const [k, d] of Object.entries(RETAIL)) {
      const n = Number(input.qty?.[k] ?? 0);
      if (n === 0) continue;
      if (!Number.isInteger(n) || n < 0 || n > 100000) throw new RuleError('Jumlah pcs harus bilangan bulat positif');
      items.push({ name: k, qty: n, unit: 'pcs', price: d.p[tier(n)], meter: filmCm(d, n) / 100 });
    }
    if (!items.length) throw new RuleError('Isi jumlah minimal satu ukuran');
    return items;
  }
  const m = Number(input.meter);
  if (!(m > 0) || m > 100000 || Math.abs(Math.round(m * 100) - m * 100) > 1e-6) throw new RuleError('Panjang harus lebih dari 0 meter, maksimal 2 angka desimal');
  if (input.service === 'dtfm') {
    const price = settings.priceDtf;
    if (!price) throw new RuleError('Harga DTF maklon belum diatur');
    return [{ name: 'DTF maklon per meter', qty: m, unit: 'meter', price, meter: m }];
  }
  const w = WIDTHS.find((x) => x[0] === input.width);
  if (!w) throw new RuleError('Pilih lebar kain');
  const price = settings[w[0]];
  if (!price) throw new RuleError('Harga sublim untuk lebar ini belum diatur di Pengaturan');
  return [{ name: 'Sublim print + press, ' + w[1].toLowerCase(), qty: m, unit: 'meter', price, meter: m }];
}

export const totalOf = (items: Item[]) => Math.round(items.reduce((a, i) => a + i.price * i.qty, 0));
export const meterOf = (items: Item[]) => Math.round(items.reduce((a, i) => a + i.meter, 0) * 100) / 100;
