// Rekap kinerja Daily, Weekly, Monthly, Yearly dari seluruh data. Fungsi murni.
// Versi Apps Script-nya di apps-script/Code.gs harus sama.
import { effectiveSeconds, localDay, type CalendarConfig } from './calendar.ts';
import { deadlineTime, slaDue } from './capacity.ts';

export type Period = 'day' | 'week' | 'month' | 'year';
export const TARGETS = { ontimeMin: 95, rejectMax: 2, wasteMax: 3, utilMin: 70, utilMax: 90 };

export interface AOrder {
  id: number; service: string; type: string; source: string; status: string; stage: string; customer_name: string;
  meter: number; total: number; deadline: string | null; created_at: number; approved_at: number | null; finished_at: number | null;
}
export interface Data {
  orders: AOrder[];
  payments: { amount: number; at: number }[];
  logs: { type: string; reason: string; value: number | null; counted: number; at: number }[];
  ledger: { sku_code: string; type: string; qty: number; at: number }[];
  meterSkus: string[];
  firstOrderAt: number | null; // awal operasional: kapasitas sebelum itu tidak dihitung
  ready: { id: number; at: number }[]; // waktu dikemas (siap kirim)
}
export interface Cfg { cal: CalendarConfig; norms: { dtf: number | null; subp: number | null; cal: number | null } }

const DAY = 864e5;
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? round1((a / b) * 100) : null);
const dayStart = (day: string, cal: CalendarConfig) => Date.parse(day + 'T00:00:00Z') - cal.offsetMin * 60000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Rentang periode yang memuat `date`, dan periode pembanding sebelumnya. Minggu laporan: Senin sampai Sabtu (lembur Minggu ikut). */
export function ranges(period: Period, date: string, cal: CalendarConfig) {
  const base = Date.parse(date + 'T00:00:00Z');
  const d = new Date(base);
  let first = date, next: string, previous: string;
  if (period === 'day') {
    next = iso(base + DAY);
    let p = base - DAY;
    for (let i = 0; i < 14 && !effectiveSeconds(dayStart(iso(p), cal), dayStart(iso(p), cal) + DAY, cal); i++) p -= DAY; // hari kerja sebelumnya
    previous = iso(p);
  } else if (period === 'week') {
    const monday = base - ((d.getUTCDay() + 6) % 7) * DAY;
    first = iso(monday); next = iso(monday + 7 * DAY); previous = iso(monday - 7 * DAY);
  } else if (period === 'month') {
    first = iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); next = iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); previous = iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  } else {
    first = `${d.getUTCFullYear()}-01-01`; next = `${d.getUTCFullYear() + 1}-01-01`; previous = `${d.getUTCFullYear() - 1}-01-01`;
  }
  const current = { from: dayStart(first, cal), to: dayStart(next, cal) };
  const prev = period === 'day' ? { from: dayStart(previous, cal), to: dayStart(previous, cal) + DAY } : { from: dayStart(previous, cal), to: current.from };
  return { current, previous: prev };
}

export function summarize(data: Data, range: { from: number; to: number }, now: number, cfg: Cfg) {
  const inside = (t: number | null | undefined) => t != null && t >= range.from && t < range.to;
  const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);
  const created = data.orders.filter((o) => inside(o.created_at) && o.status !== 'ditolak');
  const value = sum(created, (o) => o.total);
  const summary = {
    orders: created.length, meter: round1(sum(created, (o) => o.meter)), value,
    paid: sum(data.payments.filter((p) => inside(p.at)), (p) => p.amount),
    aov: created.length ? Math.round(value / created.length) : 0,
  };

  // Produksi: meter dihitung saat tahap akhir selesai; print sublim mengikuti press.
  const finished = data.orders.filter((o) => inside(o.finished_at));
  const meterOf = (service: string) => sum(finished.filter((o) => o.service === service), (o) => o.meter);
  const end = Math.min(range.to, now);
  const begin = data.firstOrderAt === null ? end : Math.max(range.from, dayStart(localDay(data.firstOrderAt, cfg.cal), cfg.cal));
  const machines = (['dtf', 'subp', 'cal'] as const).map((m) => {
    const meter = round1(meterOf(m === 'dtf' ? 'dtf' : 'sub'));
    const norm = cfg.norms[m];
    const capacity = norm && end > begin ? round1(effectiveSeconds(begin, end, cfg.cal) / norm) : null;
    return { machine: m, meter, capacity, util: capacity ? pct(meter, capacity) : null };
  });

  const byId = new Map(data.orders.map((o) => [o.id, o]));
  const done = data.ready.filter((r) => inside(r.at) && byId.has(r.id) && r.at >= byId.get(r.id)!.created_at).map((r) => ({ o: byId.get(r.id)!, at: r.at }));
  const onTime = done.filter(({ o, at }) => at <= (o.deadline ? deadlineTime(o.deadline, cfg.cal) : slaDue(o.approved_at ?? o.created_at, cfg.cal))).length;
  const leads = done.filter(({ o }) => o.approved_at).map(({ o, at }) => (at - o.approved_at!) / 3600000);
  const ready = { count: done.length, ontime: onTime, pct: pct(onTime, done.length), leadHours: leads.length ? round1(sum(leads, (x) => x) / leads.length) : null };

  const produced = round1(sum(finished, (o) => o.meter));
  const rejectM = round1(sum(data.logs.filter((l) => l.type === 'Reject' && inside(l.at)), (l) => Number(/([0-9]+(?:\.[0-9]+)?) m /.exec(l.reason)?.[1] ?? 0)));
  const used = data.ledger.filter((l) => inside(l.at) && l.qty < 0 && data.meterSkus.includes(l.sku_code) && ['Produksi', 'Test print', 'Reject', 'Waste'].includes(l.type));
  const usedOf = (type?: string) => round1(sum(used.filter((l) => !type || l.type === type), (l) => -l.qty));
  const quality = { produced, rejectM, rejectPct: pct(rejectM, produced), usedM: usedOf(), testM: usedOf('Test print'), wasteM: usedOf('Waste'), wastePct: pct(usedOf('Waste'), usedOf()) };

  const group = (keys: string[], of: (o: AOrder) => string) => keys.map((key) => {
    const list = created.filter((o) => of(o) === key);
    return { key, orders: list.length, meter: round1(sum(list, (o) => o.meter)), value: sum(list, (o) => o.total) };
  });
  const names = [...new Set(created.map((o) => o.customer_name))];
  const sales = {
    service: group(['dtf', 'sub'], (o) => o.service),
    type: group(['retail', 'maklon'], (o) => o.type),
    source: group(['WhatsApp', 'Datang langsung', 'Toko'], (o) => o.source),
    top: group(names, (o) => o.customer_name).sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1)).slice(0, 10),
  };

  const lost = data.logs.filter((l) => l.type === 'Loss Sales' && l.counted && inside(l.at));
  const reasonOf = (r: string) => (r.startsWith('Kapasitas penuh') ? 'Kapasitas penuh' : r);
  const reasons = [...new Set(lost.map((l) => reasonOf(l.reason)))].map((reason) => {
    const list = lost.filter((l) => reasonOf(l.reason) === reason);
    return { reason, count: list.length, value: sum(list, (l) => l.value ?? 0) };
  }).sort((a, b) => b.value - a.value || (a.reason < b.reason ? -1 : 1));
  const loss = { count: lost.length, value: sum(lost, (l) => l.value ?? 0), reasons };

  return { summary, machines, ready, quality, sales, loss };
}

/** Kelompok waktu untuk grafik tren: harian = 14 hari sampai tanggal itu; mingguan dan bulanan = per hari; tahunan = per bulan. */
export function buckets(period: Period, date: string, cal: CalendarConfig) {
  const { from, to } = ranges(period, date, cal).current;
  const out: { key: string; from: number; to: number }[] = [];
  if (period === 'year') {
    const year = Number(date.slice(0, 4));
    for (let m = 0; m < 12; m++) {
      const first = iso(Date.UTC(year, m, 1));
      out.push({ key: first.slice(0, 7), from: dayStart(first, cal), to: dayStart(iso(Date.UTC(year, m + 1, 1)), cal) });
    }
  } else {
    for (let t = period === 'day' ? from - 13 * DAY : from; t < to; t += DAY) out.push({ key: localDay(t, cal), from: t, to: t + DAY });
  }
  return out;
}

export function trend(data: Data, list: ReturnType<typeof buckets>) {
  const sum = <T>(items: T[], f: (x: T) => number) => items.reduce((a, x) => a + f(x), 0);
  return list.map((b) => {
    const inside = (t: number | null) => t != null && t >= b.from && t < b.to;
    const created = data.orders.filter((o) => inside(o.created_at) && o.status !== 'ditolak');
    const finished = data.orders.filter((o) => inside(o.finished_at));
    const meter = (service: string) => round1(sum(finished.filter((o) => o.service === service), (o) => o.meter));
    return {
      key: b.key, orders: created.length, value: sum(created, (o) => o.total), paid: sum(data.payments.filter((p) => inside(p.at)), (p) => p.amount),
      dtf: meter('dtf'), sub: meter('sub'),
    };
  });
}

export function report(data: Data, period: Period, date: string, now: number, cfg: Cfg) {
  const r = ranges(period, date, cfg.cal);
  return {
    period, date, targets: TARGETS,
    from: localDay(r.current.from, cfg.cal), to: localDay(r.current.to - 1, cfg.cal),
    previousFrom: localDay(r.previous.from, cfg.cal), previousTo: localDay(r.previous.to - 1, cfg.cal),
    current: summarize(data, r.current, now, cfg), previous: summarize(data, r.previous, now, cfg),
    trend: trend(data, buckets(period, date, cfg.cal)),
  };
}
