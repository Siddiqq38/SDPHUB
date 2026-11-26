import { Hono } from 'hono';
import { localDay } from '../lib/calendar.ts';
import { days, plan, slaDue } from '../lib/capacity.ts';
import { activeJobs, planConfig } from './capacity.ts';
import { WORK_BLOCKS_DEFAULT, authn, calendarOf, loadSettings, now, numericSettings, overtimeOf, pagesOf, type AppEnv } from '../core.ts';
import { ACCESS_DEFAULT, GRANTABLE, ORDER_PAGES, type Page } from '../domain.ts';

export const stateRoutes = new Hono<AppEnv>();
stateRoutes.use('*', authn);

// Satu potret data untuk layar, disaring menurut menu yang boleh dibuka peran.
stateRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const u = c.get('user');
  const master = u.role === 'master';
  const pages: Page[] = master ? [...GRANTABLE, 'atur', 'pengguna', 'akses', 'data', 'akun'] : [...(await pagesOf(db, u.role)), 'akun'];
  const has = (...p: Page[]) => p.some((x) => pages.includes(x));
  const raw = await loadSettings(db);
  const out: Record<string, unknown> = {
    api: 4, // versi kontrak; layar memberi peringatan bila server belum diperbarui
    me: { code: u.code, name: u.name, role: u.role, store: u.store },
    pages,
    today: localDay(now(), calendarOf(raw)),
    calendar: calendarOf(raw),
    settings: numericSettings(raw),
    orders: [], customers: [], skus: [], ledger: [], loss: [], qcReports: [], users: [], access: {},
  };

  if (has(...ORDER_PAGES)) {
    // Semua order yang masih berjalan, ditambah 300 order selesai/ditolak terbaru. Store Head hanya miliknya.
    const mine = u.role === 'store';
    const rows = await db.prepare(
      `SELECT o.*, cu.code AS cust_code FROM orders o LEFT JOIN customers cu ON cu.id = o.customer_id
       WHERE (o.status NOT IN ('selesai','ditolak') OR o.id IN (SELECT id FROM orders WHERE status IN ('selesai','ditolak') ORDER BY id DESC LIMIT 300))
       ${mine ? 'AND o.created_by = ?' : ''} ORDER BY o.id`,
    ).bind(...(mine ? [u.code] : [])).all<any>();
    const ids = new Set(rows.results.map((r) => r.id));
    const pays = ids.size
      ? (await db.prepare('SELECT p.* FROM payments p WHERE p.order_id >= ? ORDER BY p.id').bind(Math.min(...ids)).all<any>()).results.filter((p) => ids.has(p.order_id))
      : [];
    const byOrder = new Map<number, any[]>();
    for (const p of pays) (byOrder.get(p.order_id) ?? byOrder.set(p.order_id, []).get(p.order_id)!).push({ id: p.id, amount: p.amount, method: p.method, by: p.by_user, at: p.at });
    // Nomor WhatsApp hanya untuk peran yang berurusan dengan customer.
    const seeContact = master || ['cs', 'crm', 'store', 'spv', 'manager', 'fat'].includes(u.role);
    out.orders = rows.results.map((o) => ({
      dbId: o.id, id: o.order_no, track: o.track_code, type: o.type, service: o.service, custCode: o.cust_code, customer: o.customer_name,
      wa: seeContact ? o.wa : '', source: o.source, store: o.store ?? '-', items: JSON.parse(o.items), total: o.total, meter: o.meter, file: o.file_ref, fileKey: o.file_key,
      deadline: o.deadline, note: o.note, status: o.status, stage: o.stage, priority: !!o.priority, issue: o.issue, reworkM: o.rework_m, process: o.process,
      receiver: o.receiver, createdBy: o.created_by, created: o.created_at, approved: o.approved_at, started: o.started_at, pay: byOrder.get(o.id) ?? [],
    }));
  }
  // Jadwal kapasitas memakai semua order (tanpa nama customer), agar Store Head melihat sisa slot yang benar.
  if (has('input', 'dashboard', 'produksi')) {
    const cfg = planConfig(raw), jobs = await activeJobs(db), t = now();
    out.capacity = {
      days: days(jobs, t, cfg), slots: plan(jobs, t, cfg).slots, slaDue: slaDue(t, cfg.cal),
      overtime: overtimeOf(raw).filter((o) => o.day >= (out.today as string)),
    };
  }
  out.workBlocks = raw.work_blocks || WORK_BLOCKS_DEFAULT;
  if (has('input', 'pelanggan', 'cs', 'cekfile')) {
    out.customers = (await db.prepare('SELECT id, code, name, wa, source, status FROM customers ORDER BY name LIMIT 5000').all()).results;
  }
  if (has('stok', 'dashboard')) {
    out.skus = (await db.prepare('SELECT code, name, svc, unit, stock, min_stock AS min, use_per_m AS use, machine FROM skus ORDER BY code').all()).results;
  }
  if (has('stok')) {
    out.ledger = (await db.prepare('SELECT at, sku_code AS code, type, qty, ref FROM stock_ledger ORDER BY id DESC LIMIT 50').all()).results;
  }
  if (has('loss', 'dashboard', 'laporan')) {
    out.loss = (await db.prepare('SELECT id AS "logId", order_no AS id, type, reason, value, counted AS count, at FROM logs ORDER BY id DESC LIMIT 300').all()).results;
  }
  if (has('qc', 'produksi')) {
    const rows = await db.prepare('SELECT * FROM qc_reports ORDER BY id DESC LIMIT 60').all<any>();
    out.qcReports = rows.results.reverse().map((r) => ({
      id: r.id, machine: r.machine, day: r.day, ng: JSON.parse(r.ng), note: r.note ?? '', action: r.action ?? '', photos: JSON.parse(r.photos),
      status: r.status, by: r.by_user, at: r.at, approvedBy: r.approved_by, leaderNote: r.leader_note ?? '',
    }));
  }
  if (master) {
    out.users = (await db.prepare('SELECT id, code, name, role, store, active, must_change_password FROM users ORDER BY id').all()).results;
    const rows = await db.prepare('SELECT role, pages FROM role_access').all<{ role: string; pages: string }>();
    out.access = { ...ACCESS_DEFAULT, ...Object.fromEntries(rows.results.map((r) => [r.role, JSON.parse(r.pages)])) };
  }
  c.header('Cache-Control', 'private, no-store');
  return c.json(out);
});
