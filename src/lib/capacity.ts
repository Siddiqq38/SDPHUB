// Perencanaan kapasitas per mesin. Fungsi murni; versi Apps Script-nya di apps-script/Code.gs harus sama.
import { addWorkSeconds, effectiveSeconds, localDay, type CalendarConfig } from './calendar.ts';

export type Machine = 'dtf' | 'subp' | 'cal';
export const MACHINE_LIST: Machine[] = ['dtf', 'subp', 'cal'];

export interface Job {
  id: number; order_no: string; service: 'dtf' | 'sub'; status: string; stage: Machine; meter: number; rework_m: number | null;
  priority: number; approved_at: number | null; started_at: number | null; created_at: number; finished_at: number | null; paid: boolean;
}
export interface PlanConfig {
  cal: CalendarConfig;
  norms: Record<Machine, number | null>; // detik per meter
  pct: number;      // persen kapasitas yang boleh dijual
  holdMin: number;  // lama slot ditahan untuk order belum lunas
  finDtf: number;   // menit finishing (curing, QC, kemas)
  finSub: number;
}
export interface Slot { id: number; order_no: string; machine: Machine; start: number; end: number; meter: number; hold: boolean }

const DAY = 864e5;
const CONFIRMED = ['antrian', 'produksi', 'curing'];
const PENDING = ['cek', 'revisi', 'bayar'];
const chainOf = (service: 'dtf' | 'sub', stage: Machine): Machine[] => (service === 'dtf' ? ['dtf'] : stage === 'cal' ? ['cal'] : ['subp', 'cal']);

/** Susun jadwal: order pasti (urutan antrian) lebih dulu, lalu order yang slotnya masih ditahan. */
export function plan(jobs: Job[], now: number, cfg: PlanConfig) {
  const confirmed = jobs.filter((j) => CONFIRMED.includes(j.status)).sort((a, b) =>
    Number(b.status !== 'antrian') - Number(a.status !== 'antrian') || b.priority - a.priority || (a.approved_at ?? 0) - (b.approved_at ?? 0) || a.id - b.id);
  const pending = jobs.filter((j) => PENDING.includes(j.status) && (j.paid || now - j.created_at < cfg.holdMin * 60000)).sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  const cursor: Record<Machine, number> = { dtf: now, subp: now, cal: now };
  const slots: Slot[] = [];
  const last = new Map<number, number>();
  for (const j of [...confirmed, ...pending]) {
    const meter = j.rework_m ?? j.meter;
    let previous = now;
    for (const m of chainOf(j.service, j.stage)) {
      const norm = cfg.norms[m];
      if (!norm) continue;
      const running = (j.status === 'produksi' || j.status === 'curing') && m === j.stage;
      const start = running ? j.started_at! : addWorkSeconds(Math.max(cursor[m], previous), 0, cfg.cal);
      const end = running ? Math.max(now, addWorkSeconds(start, meter * norm, cfg.cal)) : addWorkSeconds(start, (meter * norm * 100) / cfg.pct, cfg.cal);
      cursor[m] = Math.max(cursor[m], end);
      previous = end;
      slots.push({ id: j.id, order_no: j.order_no, machine: m, start, end, meter, hold: !j.paid && PENDING.includes(j.status) });
    }
    last.set(j.id, previous);
  }
  return { slots, cursor, last };
}

/** Kapan order baru sepanjang `meter` selesai (termasuk finishing). null bila norma belum diatur. */
export function readyFor(jobs: Job[], now: number, cfg: PlanConfig, service: 'dtf' | 'sub', meter: number): number | null {
  const stages = chainOf(service, service === 'dtf' ? 'dtf' : 'subp').filter((m) => cfg.norms[m]);
  if (!stages.length) return null;
  const probe: Job = { id: -1, order_no: '', service, status: 'cek', stage: service === 'dtf' ? 'dtf' : 'subp', meter, rework_m: null, priority: 0, approved_at: null, started_at: null, created_at: now, finished_at: null, paid: true };
  const printed = plan([...jobs, probe], now, cfg).last.get(-1)!;
  return addWorkSeconds(printed, (service === 'dtf' ? cfg.finDtf : cfg.finSub) * 60, cfg.cal);
}

const dayStart = (day: string, cal: CalendarConfig) => Date.parse(day + 'T00:00:00Z') - cal.offsetMin * 60000;

/** Batas SLA standar: lunas sebelum 12.00 selesai hari itu, selebihnya hari kerja berikutnya. */
export function slaDue(now: number, cal: CalendarConfig): number {
  const today = dayStart(localDay(now, cal), cal);
  let from = now - today < 12 * 3600000 ? today : today + DAY;
  for (let i = 0; i < 60; i++, from += DAY) if (effectiveSeconds(from, from + DAY, cal)) return closing(from, cal);
  return from;
}
/** Jam tutup (akhir blok terakhir) pada hari yang dimulai di `start`. */
function closing(start: number, cal: CalendarConfig): number {
  const index = Math.floor((start + cal.offsetMin * 60000) / DAY);
  const blocks = cal.days?.[index] ?? cal.blocks;
  return start + Math.max(...blocks.map((b) => b[1])) * 60000;
}

/** Ringkasan 7 hari kerja: kapasitas jual, terbooking (meter), dan sisa per mesin. */
export function days(jobs: Job[], now: number, cfg: PlanConfig, count = 7) {
  const { slots } = plan(jobs, now, cfg);
  const out: { day: string; machine: Machine; capacity: number; booked: number; done: number; free: number }[] = [];
  const round = (n: number) => Math.round(n * 10) / 10;
  for (const m of MACHINE_LIST) {
    const norm = cfg.norms[m];
    if (!norm) continue;
    const perMeter = (norm * 100) / cfg.pct;
    let start = dayStart(localDay(now, cfg.cal), cfg.cal);
    for (let n = 0, guard = 0; n < count && guard < 60; guard++, start += DAY) {
      const seconds = effectiveSeconds(start, start + DAY, cfg.cal);
      if (!seconds) continue;
      n++;
      const capacity = seconds / perMeter;
      const booked = slots.filter((s) => s.machine === m).reduce((a, s) => a + effectiveSeconds(Math.max(s.start, start), Math.min(s.end, start + DAY), cfg.cal), 0) / perMeter;
      const isToday = start <= now;
      const done = isToday ? jobs.filter((j) => m !== 'subp' && (j.finished_at ?? 0) >= start && (j.service === 'dtf' ? m === 'dtf' : m === 'cal')).reduce((a, j) => a + j.meter, 0) : 0;
      let free = capacity - booked - done;
      if (isToday) free = Math.min(free, effectiveSeconds(now, start + DAY, cfg.cal) / perMeter - booked);
      out.push({ day: localDay(start + 1, cfg.cal), machine: m, capacity: round(capacity), booked: round(booked), done: round(done), free: round(Math.max(0, free)) });
    }
  }
  return out;
}

/** "YYYY-MM-DD HH:MM" WITA, dibulatkan ke atas per 30 menit setelah jeda 15 menit untuk mengisi form. */
export function suggestDeadline(ready: number, cal: CalendarConfig): string {
  const step = 30 * 60000;
  const t = Math.ceil((ready + 15 * 60000) / step) * step + cal.offsetMin * 60000;
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}
export const deadlineTime = (d: string, cal: CalendarConfig) => Date.parse(`${d.slice(0, 10)}T${d.slice(11) || '23:59'}:00Z`) - cal.offsetMin * 60000;
export const showTime = (ms: number, cal: CalendarConfig) => {
  const s = new Date(ms + cal.offsetMin * 60000).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16).replace(':', '.')}`;
};
