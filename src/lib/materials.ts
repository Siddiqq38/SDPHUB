// Rekomendasi dan booking roll. Dihitung ulang dari data terkini (tidak disimpan), sehingga selalu konsisten.
// Versi Apps Script-nya di apps-script/Code.gs harus sama.

/** Dilacak per kemasan, bukan bahan utama per meter. */
export const PACKAGE_SKUS = ['SDP-SUB-TSU-01'];
export type Stage = 'dtf' | 'subp' | 'cal';
export interface Sku { code: string; machine: string; unit: string }
export interface Lot { lot_code: string; sku_code: string; bin: string | null; status: string; qty_left: number; qty_initial: number; received_at: number }
export interface MaterialJob {
  id: number; service: 'dtf' | 'sub'; status: string; stage: Stage; meter: number; rework_m: number | null; fabric_sku?: string | null;
  priority: number; approved_at: number | null; created_at: number; paid: boolean;
}
export interface Pick { lot: string; sku: string; bin: string | null; take: number }
export interface Need { id: number; stage: Stage; need: number; short: number; picks: Pick[] }

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const CONFIRMED = ['antrian', 'produksi', 'curing'];
const PENDING = ['cek', 'revisi', 'bayar'];

/** SKU bahan utama satu tahap: film (DTF), kertas (print sublim), kain (press; sesuai pilihan order bila ada). */
export function candidates(skus: Sku[], stage: Stage, fabric: string | null): string[] {
  const list = skus.filter((k) => k.machine === stage && k.unit === 'meter' && !PACKAGE_SKUS.includes(k.code)).map((k) => k.code);
  return stage === 'cal' && fabric && list.includes(fabric) ? [fabric] : list;
}
export const stagesOf = (service: 'dtf' | 'sub', stage: Stage): Stage[] => (service === 'dtf' ? ['dtf'] : stage === 'cal' ? ['cal'] : ['subp', 'cal']);

/**
 * Urutan pemilihan: satu roll yang cukup (roll terbuka dulu, lalu GR terlama);
 * bila tidak ada, gabungkan beberapa roll dengan urutan yang sama.
 */
export function allocate(jobs: MaterialJob[], lots: Lot[], skus: Sku[], now: number, holdMin: number) {
  const left = new Map(lots.filter((l) => l.status === 'tersedia' && l.qty_left > 0).map((l) => [l.lot_code, l.qty_left]));
  const usable = lots.filter((l) => left.has(l.lot_code)).sort((a, b) => a.received_at - b.received_at || (a.lot_code < b.lot_code ? -1 : 1));
  const confirmed = jobs.filter((j) => CONFIRMED.includes(j.status)).sort((a, b) =>
    Number(b.status !== 'antrian') - Number(a.status !== 'antrian') || b.priority - a.priority || (a.approved_at ?? 0) - (b.approved_at ?? 0) || a.id - b.id);
  const pending = jobs.filter((j) => PENDING.includes(j.status) && (j.paid || now - j.created_at < holdMin * 60000)).sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  const needs: Need[] = [];
  const booked: Record<string, number> = {};
  for (const j of [...confirmed, ...pending]) {
    for (const stage of stagesOf(j.service, j.stage)) {
      const codes = candidates(skus, stage, j.fabric_sku ?? null);
      const need = j.rework_m ?? j.meter;
      const open = usable.filter((l) => codes.includes(l.sku_code) && left.get(l.lot_code)! > 0)
        .sort((a, b) => Number(left.get(b.lot_code)! < b.qty_initial) - Number(left.get(a.lot_code)! < a.qty_initial));
      const single = open.find((l) => left.get(l.lot_code)! >= need);
      let rest = need;
      const picks: Pick[] = [];
      for (const l of single ? [single] : open) {
        if (rest <= 0) break;
        const take = round3(Math.min(rest, left.get(l.lot_code)!));
        left.set(l.lot_code, round3(left.get(l.lot_code)! - take));
        rest = round3(rest - take);
        picks.push({ lot: l.lot_code, sku: l.sku_code, bin: l.bin, take });
        booked[l.sku_code] = round3((booked[l.sku_code] ?? 0) + take);
      }
      needs.push({ id: j.id, stage, need, short: Math.max(0, rest), picks });
    }
  }
  return { needs, booked };
}

/** Sisa bahan di rak yang belum terbooking untuk sekumpulan SKU. */
export function freeOf(codes: string[], lots: Lot[], booked: Record<string, number>): number {
  const onRack = lots.filter((l) => l.status === 'tersedia' && codes.includes(l.sku_code)).reduce((a, l) => a + l.qty_left, 0);
  return Math.max(0, round3(onRack - codes.reduce((a, c) => a + (booked[c] ?? 0), 0)));
}
