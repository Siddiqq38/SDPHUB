// Kalender kerja WITA. Fungsi murni: tidak membaca jam sistem, mudah diuji.
// Waktu dalam epoch ms UTC. Offset WITA = +480 menit (tanpa DST).

export interface CalendarConfig {
  offsetMin: number;          // 480 untuk WITA
  blocks: [number, number][]; // blok produksi efektif, menit sejak 00:00 lokal
  closedWeekdays: number[];   // 0 = Minggu
}

export const DEFAULT_CALENDAR: CalendarConfig = {
  offsetMin: 480,
  blocks: [[9 * 60, 12 * 60], [13 * 60, 16 * 60]],
  closedWeekdays: [0],
};

export function parseBlocks(s: string): [number, number][] {
  return s.split(',').map((b) => {
    const [a, c] = b.trim().split('-');
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    return [toMin(a), toMin(c)] as [number, number];
  });
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Menit sejak tengah malam lokal + indeks hari lokal dari epoch. */
function local(ms: number, cfg: CalendarConfig) {
  const shifted = ms + cfg.offsetMin * MIN;
  const dayIndex = Math.floor(shifted / DAY);
  const minOfDay = (shifted - dayIndex * DAY) / MIN;
  const weekday = (((dayIndex + 4) % 7) + 7) % 7; // 1970-01-01 = Kamis (4)
  return { dayIndex, minOfDay, weekday };
}

function fromLocal(dayIndex: number, minOfDay: number, cfg: CalendarConfig) {
  return dayIndex * DAY + minOfDay * MIN - cfg.offsetMin * MIN;
}

/** Hari lokal 'YYYY-MM-DD' untuk epoch ms. */
export function localDay(ms: number, cfg: CalendarConfig = DEFAULT_CALENDAR): string {
  const { dayIndex } = local(ms, cfg);
  return new Date(dayIndex * DAY).toISOString().slice(0, 10);
}

/**
 * Mulai bekerja pada `startMs`, butuh `workSeconds` detik produksi efektif.
 * Waktu berhenti pada istirahat, di luar jam produksi, dan hari libur.
 * Mengembalikan epoch ms saat pekerjaan selesai.
 */
export function addWorkSeconds(startMs: number, workSeconds: number, cfg: CalendarConfig = DEFAULT_CALENDAR): number {
  if (workSeconds < 0) throw new Error('durasi negatif');
  let remaining = workSeconds * 1000;
  let { dayIndex, minOfDay, weekday } = local(startMs, cfg);
  let cursorMs = startMs;
  let guard = 0;
  while (guard++ < 3650) {
    if (!cfg.closedWeekdays.includes(weekday)) {
      for (const [a, b] of cfg.blocks) {
        const from = Math.max(minOfDay, a);
        if (from >= b) continue;
        const blockStart = fromLocal(dayIndex, from, cfg);
        const blockEnd = fromLocal(dayIndex, b, cfg);
        const avail = blockEnd - blockStart;
        if (remaining <= avail) {
          return Math.round(blockStart + remaining);
        }
        remaining -= avail;
        cursorMs = blockEnd;
      }
    }
    dayIndex += 1;
    weekday = (weekday + 1) % 7;
    minOfDay = 0;
  }
  void cursorMs;
  throw new Error('kalender kerja tidak menghasilkan slot');
}

/** Detik produksi efektif antara dua waktu (mengabaikan istirahat/libur). */
export function effectiveSeconds(startMs: number, endMs: number, cfg: CalendarConfig = DEFAULT_CALENDAR): number {
  if (endMs <= startMs) return 0;
  let total = 0;
  let { dayIndex, weekday } = local(startMs, cfg);
  const last = local(endMs, cfg).dayIndex;
  for (let d = dayIndex; d <= last; d++, weekday = (weekday + 1) % 7) {
    if (cfg.closedWeekdays.includes(weekday)) continue;
    for (const [a, b] of cfg.blocks) {
      const s = Math.max(fromLocal(d, a, cfg), startMs);
      const e = Math.min(fromLocal(d, b, cfg), endMs);
      if (e > s) total += e - s;
    }
  }
  return Math.round(total / 1000);
}
