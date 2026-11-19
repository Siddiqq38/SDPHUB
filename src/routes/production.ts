import { Hono } from 'hono';
import { FINAL_STAGE } from '../lib/sql.ts';
import type { Db } from '../db.ts';
import { addWorkSeconds, effectiveSeconds, localDay, type CalendarConfig } from '../lib/calendar.ts';
import { convert, workSeconds } from '../lib/units.ts';
import {
  HttpError, assertCustomerScope, audit, authn, bad, conflict, forbidden, intParam, isStaff, loadCalendar, need, notFound, now, oneOf, optNum, optStr,
  readJson, reqNum, reqStr, type AppEnv, type Ctx,
} from '../core.ts';

export const prodRoutes = new Hono<AppEnv>();
prodRoutes.use('*', authn);

// Status order yang masih boleh membuat/memulai WO. Serah terima sebagian tidak menghentikan sisa produksi.
const PRODUCIBLE = ['dirilis', 'berjalan', 'serah_terima_sebagian'];

// Tahap yang menjadi WO per mesin, per layanan.
const STAGE_MACHINE: Record<string, Record<string, string>> = {
  DTF: { print_film: 'dtf_printer' },
  SUBLIM_KERTAS: { print_kertas: 'sublim_printer' },
  SUBLIM_KAIN: { print_kertas: 'sublim_printer', transfer_calender: 'calender' },
};

// Checklist QC kesiapan mesin. Dapat ditimpa master lewat setting qc_checklist_<kind> (JSON) sesuai SOP final.
type CheckItem = { key: string; label: string; photo?: boolean };
const DEFAULT_CHECKLISTS: Record<string, CheckItem[]> = {
  dtf_printer: [
    { key: 'area', label: 'Persiapan area' }, { key: 'machine', label: 'Persiapan mesin' }, { key: 'material', label: 'Persiapan bahan' },
    { key: 'nozzle_check', label: 'Nozzle check', photo: true }, { key: 'test_print', label: 'Test print', photo: true },
    { key: 'curing', label: 'Curing' }, { key: 'press_test', label: 'Uji press / daya lekat pada kain uji', photo: true },
  ],
  sublim_printer: [
    { key: 'area', label: 'Area' }, { key: 'material', label: 'Bahan' }, { key: 'nozzle_check', label: 'Nozzle' }, { key: 'test_print', label: 'Test print' },
  ],
  calender: [
    { key: 'area', label: 'Area' }, { key: 'material', label: 'Bahan' }, { key: 'parameter', label: 'Parameter sesuai instruksi' }, { key: 'transfer_test', label: 'Uji transfer' },
  ],
};

async function checklistFor(db: Db, kind: string): Promise<CheckItem[]> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(`qc_checklist_${kind}`).first<{ value: string }>();
  if (row) {
    try {
      const v = JSON.parse(row.value);
      if (Array.isArray(v) && v.every((i) => i && typeof i.key === 'string' && typeof i.label === 'string')) return v;
    } catch { /* pakai bawaan */ }
  }
  const d = DEFAULT_CHECKLISTS[kind];
  if (!d) throw bad('Jenis mesin tidak dikenal');
  return d;
}

// ---------- Estimasi antrean per mesin ----------
async function recomputeQueue(db: Db, machineId: number, reason: string, userId: number | null, cfg: CalendarConfig) {
  const m = await db.prepare('SELECT kind FROM machines WHERE id = ?').bind(machineId).first<{ kind: string }>();
  if (!m) return;
  const norm = await db.prepare('SELECT seconds_per_unit, unit FROM norms WHERE machine_kind = ?').bind(m.kind).first<{ seconds_per_unit: number | null; unit: string }>();
  const wos = await db.prepare(
    `SELECT * FROM work_orders WHERE machine_id = ? AND status IN ('berjalan','menunggu') ORDER BY (status = 'berjalan') DESC, queue_pos, id`,
  ).bind(machineId).all<any>();
  let cursor = now();
  for (const w of wos.results) {
    const secs = norm && norm.unit === w.planned_unit ? workSeconds(w.planned_qty, norm.seconds_per_unit) : null;
    let start: number | null;
    let end: number | null;
    if (w.est_manual && w.est_end_at) {
      start = w.est_start_at;
      end = w.est_end_at;
    } else if (w.status === 'berjalan') {
      start = w.started_at;
      end = secs == null ? null : addWorkSeconds(w.started_at, secs, cfg);
    } else {
      start = cursor;
      end = secs == null ? null : addWorkSeconds(cursor, secs, cfg);
    }
    if (end != null) cursor = Math.max(cursor, end);
    if (end !== w.est_end_at || start !== w.est_start_at) {
      const initial = w.est_initial_end_at ?? end; // baseline SLA: tidak ikut bergeser
      await db.batch([
        db.prepare('UPDATE work_orders SET est_start_at=?, est_end_at=?, est_initial_end_at=? WHERE id=?').bind(start, end, initial, w.id),
        db.prepare('INSERT INTO estimate_history (wo_id, est_end_at, reason, at, by_user) VALUES (?,?,?,?,?)').bind(w.id, end, reason, now(), userId),
      ]);
    }
  }
}

// ---------- Artwork ----------
prodRoutes.post('/items/:id/artworks', async (c) => {
  const u = c.get('user');
  const itemId = intParam(c, 'id');
  const item = await c.env.DB.prepare('SELECT i.*, o.customer_id, o.status AS order_status FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ?').bind(itemId).first<any>();
  if (!item) throw notFound();
  assertCustomerScope(u, item.customer_id);
  if (!(u.role === 'customer' || u.role === 'cs' || u.role === 'master')) throw forbidden();
  if (['selesai', 'dibatalkan'].includes(item.order_status)) throw conflict('Order sudah ditutup');
  const b = await readJson(c);
  const fileKey = reqStr(b, 'file_key', 200);
  const f = await c.env.DB.prepare("SELECT * FROM files WHERE key = ? AND confirmed = 1 AND kind = 'artwork'").bind(fileKey).first<any>();
  if (!f || f.customer_id !== item.customer_id) throw bad('File artwork tidak ditemukan untuk customer ini');
  const taken = await c.env.DB.prepare('SELECT 1 FROM artworks WHERE file_key = ?').bind(fileKey).first();
  if (taken) throw conflict('File ini sudah dipakai sebagai versi artwork');
  const last = await c.env.DB.prepare('SELECT MAX(version) v FROM artworks WHERE item_id = ?').bind(itemId).first<{ v: number | null }>();
  const version = (last?.v ?? 0) + 1;
  let impact: string | null = null;
  if (item.approved_artwork_id) impact = reqStr(b, 'revision_impact_note', 1000); // revisi wajib evaluasi biaya/bahan/deadline
  const r = await c.env.DB.prepare(
    `INSERT INTO artworks (item_id, version, file_key, file_name, size_bytes, size_note, preflight_status, uploaded_by, uploaded_at, revision_impact_note)
     VALUES (?,?,?,?,?,?, 'diperiksa', ?,?,?)`,
  ).bind(itemId, version, fileKey, f.file_name, f.size_bytes, optStr(b, 'size_note', 200), u.id, now(), impact).run();
  await audit(c.env.DB, u.id, 'artwork_uploaded', 'artwork', r.meta.last_row_id as number, { version });
  return c.json({ ok: true, id: r.meta.last_row_id, version }, 201);
});

prodRoutes.post('/artworks/:id/review', need('artwork.review'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const status = oneOf(b, 'status', ['perlu_revisi', 'menunggu_persetujuan'] as const);
  const note = reqStr(b, 'preflight_note', 1000);
  const r = await c.env.DB.prepare("UPDATE artworks SET preflight_status=?, preflight_note=?, preview_ref=? WHERE id=? AND preflight_status IN ('diperiksa','menunggu_persetujuan','perlu_revisi')")
    .bind(status, note, optStr(b, 'preview_ref', 300), id).run();
  if (!r.meta.changes) throw conflict('Artwork tidak dalam tahap pemeriksaan');
  await audit(c.env.DB, c.get('user').id, 'artwork_reviewed', 'artwork', id, { status });
  return c.json({ ok: true });
});

// Persetujuan PIC customer harus dicatat dengan nama dan referensi bukti, bukan sekadar pesan terkirim.
prodRoutes.post('/artworks/:id/approve', need('artwork.review'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const pic = reqStr(b, 'approved_by_pic', 120);
  reqStr(b, 'approval_ref', 300);
  const art = await c.env.DB.prepare('SELECT * FROM artworks WHERE id = ?').bind(id).first<any>();
  if (!art) throw notFound();
  if (art.preflight_status !== 'menunggu_persetujuan') throw conflict('Artwork belum lolos pemeriksaan');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE artworks SET preflight_status='disetujui', approved_by_pic=?, approved_at=?, preview_ref=COALESCE(?, preview_ref) WHERE id=?")
      .bind(pic, now(), optStr(b, 'approval_ref', 300), id),
    c.env.DB.prepare('UPDATE order_items SET approved_artwork_id = ? WHERE id = ?').bind(id, art.item_id),
  ]);
  await audit(c.env.DB, c.get('user').id, 'artwork_approved', 'artwork', id);
  return c.json({ ok: true });
});

prodRoutes.get('/artworks/:id/file', async (c) => {
  const u = c.get('user');
  const id = intParam(c, 'id');
  const a = await c.env.DB.prepare('SELECT a.file_key, a.file_name, o.customer_id FROM artworks a JOIN order_items i ON i.id = a.item_id JOIN orders o ON o.id = i.order_id WHERE a.id = ?').bind(id).first<any>();
  if (!a) throw notFound();
  assertCustomerScope(u, a.customer_id);
  if (!['customer', 'master', 'supervisor', 'cs', 'crm', 'operator', 'qc'].includes(u.role)) throw notFound();
  c.header('Cache-Control', 'private, no-store');
  return c.redirect(await c.env.FILES.downloadUrl(a.file_key, a.file_name), 302); // URL bertanda tangan 60 detik
});

// ---------- QC kesiapan mesin ----------
prodRoutes.get('/machines/:id/checklist', async (c) => {
  if (!isStaff(c.get('user'))) throw forbidden();
  const m = await c.env.DB.prepare('SELECT kind FROM machines WHERE id = ?').bind(intParam(c, 'id')).first<{ kind: string }>();
  if (!m) throw notFound();
  return c.json(await checklistFor(c.env.DB, m.kind));
});

prodRoutes.get('/machines/status', async (c) => {
  if (!isStaff(c.get('user'))) throw forbidden();
  const cfg = await loadCalendar(c.env.DB);
  const day = localDay(now(), cfg);
  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.code, m.name, m.kind, m.active,
       (SELECT conclusion FROM machine_qc_reports r WHERE r.machine_id = m.id AND r.day = ? ORDER BY r.at DESC, r.id DESC LIMIT 1) AS qc_today,
       (SELECT wo_no FROM work_orders w WHERE w.machine_id = m.id AND w.status = 'berjalan') AS running_wo
     FROM machines m ORDER BY m.code`,
  ).bind(day).all();
  return c.json(rows.results);
});

prodRoutes.post('/machines/:id/qc', need('machine.qc'), async (c) => {
  const u = c.get('user');
  const id = intParam(c, 'id');
  const m = await c.env.DB.prepare('SELECT * FROM machines WHERE id = ? AND active = 1').bind(id).first<any>();
  if (!m) throw notFound('Mesin tidak ditemukan atau nonaktif');
  const b = await readJson(c);
  const def = await checklistFor(c.env.DB, m.kind);
  if (!Array.isArray(b.checklist)) throw bad('Checklist wajib diisi');
  const byKey = new Map<string, any>(b.checklist.map((x: any) => [x?.key, x]));
  const out: any[] = [];
  let hasNg = false;
  for (const d of def) {
    const x = byKey.get(d.key);
    if (!x || typeof x.ok !== 'boolean') throw bad(`Butir "${d.label}" wajib diisi OK atau NG`);
    if (!x.ok) hasNg = true;
    if (x.ok && d.photo) {
      if (typeof x.photo_key !== 'string') throw bad(`Foto wajib untuk "${d.label}"`);
      const ph = await c.env.DB.prepare("SELECT 1 FROM files WHERE key = ? AND confirmed = 1 AND kind = 'qc_photo'").bind(x.photo_key).first();
      if (!ph) throw bad(`Foto untuk "${d.label}" tidak ditemukan`);
    }
    out.push({ key: d.key, label: d.label, ok: x.ok, photo_key: x.photo_key ?? null });
  }
  let finding: string | null = null;
  let action: string | null = null;
  if (hasNg) {
    finding = reqStr(b, 'finding', 1000); // temuan dan tindakan awal wajib saat ada NG
    action = reqStr(b, 'action_note', 1000);
  } else {
    finding = optStr(b, 'finding', 1000);
    action = optStr(b, 'action_note', 1000);
  }
  const cfg = await loadCalendar(c.env.DB);
  const day = localDay(now(), cfg);
  const prev = await c.env.DB.prepare('SELECT conclusion FROM machine_qc_reports WHERE machine_id = ? AND day = ? ORDER BY at DESC, id DESC LIMIT 1').bind(id, day).first<{ conclusion: string }>();
  // Setelah NG, kesimpulan "siap" hanya dapat ditetapkan petugas QC (verifikasi ulang).
  if (!hasNg && prev?.conclusion === 'tahan_produksi' && u.role !== 'qc') throw forbidden('Setelah temuan NG, verifikasi ulang kesiapan dilakukan petugas QC');
  const conclusion = hasNg ? 'tahan_produksi' : 'siap';
  const r = await c.env.DB.prepare(
    'INSERT INTO machine_qc_reports (machine_id, day, checklist_json, has_ng, finding, action_note, conclusion, reported_by, at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).bind(id, day, JSON.stringify(out), hasNg ? 1 : 0, finding, action, conclusion, u.id, now()).run();
  await audit(c.env.DB, u.id, 'machine_qc', 'machine', id, { conclusion });
  return c.json({ ok: true, id: r.meta.last_row_id, conclusion }, 201);
});

// ---------- Work order ----------
async function checkAssignable(c: Ctx, userId: number, excludeWo?: number) {
  const cfg = await loadCalendar(c.env.DB);
  const day = localDay(now(), cfg);
  const op = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'operator' AND active = 1").bind(userId).first();
  if (!op) throw bad('Operator tidak ditemukan atau nonaktif');
  const att = await c.env.DB.prepare('SELECT * FROM attendance WHERE user_id = ? AND day = ?').bind(userId, day).first<any>();
  if (!att || att.check_out_at) throw conflict('Operator belum check-in hari ini');
  if (!att.standby) throw conflict('Operator tidak dalam status Standby');
  const busy = await c.env.DB.prepare("SELECT wo_no FROM work_orders WHERE assigned_to = ? AND status = 'berjalan' AND id != ?").bind(userId, excludeWo ?? 0).first<{ wo_no: string }>();
  if (busy) throw conflict(`Operator masih menjalankan ${busy.wo_no}`);
}

prodRoutes.post('/orders/:id/work-orders', need('wo.assign'), async (c) => {
  const u = c.get('user');
  const orderId = intParam(c, 'id');
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<any>();
  if (!o) throw notFound();
  if (!PRODUCIBLE.includes(o.status)) throw conflict('Order belum dirilis produksi');
  const b = await readJson(c);
  const item = await c.env.DB.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').bind(reqNum(b, 'item_id', 0), orderId).first<any>();
  if (!item) throw notFound('Item tidak ditemukan pada order ini');
  if (!item.approved_artwork_id) throw conflict('Item belum punya artwork yang disetujui');
  const stage = reqStr(b, 'stage', 40);
  const kind = STAGE_MACHINE[item.service_code]?.[stage];
  if (!kind) throw bad(`Tahap "${stage}" bukan WO mesin untuk layanan ${item.service_code}`);
  const machine = await c.env.DB.prepare('SELECT * FROM machines WHERE id = ? AND active = 1').bind(reqNum(b, 'machine_id', 0)).first<any>();
  if (!machine || machine.kind !== kind) throw bad(`Tahap ini membutuhkan mesin jenis ${kind}`);
  const qty = reqNum(b, 'planned_qty', 0);
  if (stage === 'transfer_calender') {
    const ok = await c.env.DB.prepare(
      `SELECT 1 FROM work_orders w JOIN qc_results q ON q.wo_id = w.id
       WHERE w.item_id = ? AND w.stage = 'print_kertas' AND w.status = 'selesai' AND q.verdict = 'pass' LIMIT 1`,
    ).bind(item.id).first();
    if (!ok) throw conflict('Transfer calender menunggu hasil print kertas yang lolos pemeriksaan');
  }
  let assignedTo: number | null = null;
  if (b.assigned_to != null) {
    assignedTo = reqNum(b, 'assigned_to', 0);
    await checkAssignable(c, assignedTo);
  }
  const cnt = await c.env.DB.prepare('SELECT COUNT(*) n FROM work_orders WHERE order_id = ?').bind(orderId).first<{ n: number }>();
  const woNo = `WO-${o.order_no.replace('SDP-', '')}-${cnt!.n + 1}`;
  const pos = await c.env.DB.prepare("SELECT COALESCE(MAX(queue_pos),0)+1 p FROM work_orders WHERE machine_id = ? AND status IN ('menunggu','berjalan')").bind(machine.id).first<{ p: number }>();
  const manual = b.est_manual_end != null ? Math.round(reqNum(b, 'est_manual_end', 0)) : null;
  const r = await c.env.DB.prepare(
    `INSERT INTO work_orders (wo_no, item_id, order_id, stage, machine_id, artwork_id, planned_qty, planned_unit, assigned_to, assigned_by, queue_pos, est_end_at, est_initial_end_at, est_manual, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(woNo, item.id, orderId, stage, machine.id, item.approved_artwork_id, qty, item.prod_unit, assignedTo, assignedTo ? u.id : null, pos!.p, manual, manual, manual ? 1 : 0, now()).run();
  await recomputeQueue(c.env.DB, machine.id, 'WO dibuat', u.id, await loadCalendar(c.env.DB));
  await audit(c.env.DB, u.id, 'wo_created', 'wo', r.meta.last_row_id as number);
  return c.json({ ok: true, id: r.meta.last_row_id, wo_no: woNo }, 201);
});

prodRoutes.post('/wo/:id/assign', need('wo.assign'), async (c) => {
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const w = await c.env.DB.prepare("SELECT * FROM work_orders WHERE id = ? AND status = 'menunggu'").bind(id).first<any>();
  if (!w) throw conflict('WO tidak ada atau sudah berjalan');
  const op = reqNum(b, 'assigned_to', 0);
  await checkAssignable(c, op, id);
  await c.env.DB.prepare('UPDATE work_orders SET assigned_to = ?, assigned_by = ? WHERE id = ?').bind(op, c.get('user').id, id).run();
  await audit(c.env.DB, c.get('user').id, 'wo_assigned', 'wo', id, { op });
  return c.json({ ok: true });
});

prodRoutes.get('/wo', async (c) => {
  const u = c.get('user');
  if (!isStaff(u)) throw forbidden();
  const own = u.role === 'operator';
  const rows = await c.env.DB.prepare(
    `SELECT w.*, m.code AS machine_code, o.order_no, i.service_code, e.full_name AS operator_name, (SELECT COUNT(*) FROM qc_results q WHERE q.wo_id = w.id) AS qc_count
     FROM work_orders w JOIN machines m ON m.id = w.machine_id JOIN orders o ON o.id = w.order_id JOIN order_items i ON i.id = w.item_id
     LEFT JOIN employees e ON e.user_id = w.assigned_to
     ${own ? 'WHERE w.assigned_to = ?' : ''} ORDER BY w.id DESC LIMIT 300`,
  ).bind(...(own ? [u.id] : [])).all();
  return c.json(rows.results);
});

// Mulai: hanya operator pemilik WO, rilis sudah ada, mesin siap pada hari ini, mesin tidak sedang menjalankan WO lain.
prodRoutes.post('/wo/:id/start', need('wo.run'), async (c) => {
  const u = c.get('user');
  const id = intParam(c, 'id');
  const w = await c.env.DB.prepare('SELECT w.*, o.status AS order_status FROM work_orders w JOIN orders o ON o.id = w.order_id WHERE w.id = ?').bind(id).first<any>();
  if (!w) throw notFound();
  if (w.assigned_to !== u.id) throw forbidden('WO ini bukan tugas Anda');
  if (w.status !== 'menunggu') throw conflict('WO tidak dalam status menunggu');
  if (!PRODUCIBLE.includes(w.order_status)) throw conflict('Order belum dirilis produksi');
  const cfg = await loadCalendar(c.env.DB);
  const day = localDay(now(), cfg);
  const att = await c.env.DB.prepare('SELECT * FROM attendance WHERE user_id = ? AND day = ?').bind(u.id, day).first<any>();
  if (!att || att.check_out_at) throw conflict('Belum check-in hari ini');
  const qc = await c.env.DB.prepare('SELECT conclusion FROM machine_qc_reports WHERE machine_id = ? AND day = ? ORDER BY at DESC, id DESC LIMIT 1').bind(w.machine_id, day).first<{ conclusion: string }>();
  if (!qc) throw conflict('QC kesiapan mesin hari ini belum dibuat');
  if (qc.conclusion !== 'siap') throw conflict('Mesin ditahan produksi (QC kesiapan NG). Perbaiki dan verifikasi ulang.');
  const mine = await c.env.DB.prepare("SELECT wo_no FROM work_orders WHERE assigned_to = ? AND status = 'berjalan'").bind(u.id).first<{ wo_no: string }>();
  if (mine) throw conflict(`Anda masih menjalankan ${mine.wo_no}`);
  if (w.stage === 'transfer_calender') {
    const ok = await c.env.DB.prepare(
      "SELECT 1 FROM work_orders x JOIN qc_results q ON q.wo_id = x.id WHERE x.item_id = ? AND x.stage = 'print_kertas' AND x.status = 'selesai' AND q.verdict = 'pass' LIMIT 1",
    ).bind(w.item_id).first();
    if (!ok) throw conflict('Hasil print kertas belum lolos pemeriksaan');
  }
  try {
    const r = await c.env.DB.prepare("UPDATE work_orders SET status='berjalan', started_at=?, started_by=?, started_session=? WHERE id=? AND status='menunggu'")
      .bind(now(), u.id, c.get('sid').slice(0, 12), id).run();
    if (!r.meta.changes) throw conflict('WO sudah dimulai');
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    if (e?.code === '23505' || String(e?.message ?? e).toUpperCase().includes('UNIQUE')) throw conflict('Mesin sedang menjalankan WO lain');
    throw e;
  }
  await c.env.DB.prepare("UPDATE orders SET status='berjalan' WHERE id = ? AND status='dirilis'").bind(w.order_id).run();
  await recomputeQueue(c.env.DB, w.machine_id, 'WO dimulai', u.id, cfg);
  await audit(c.env.DB, u.id, 'wo_started', 'wo', id);
  return c.json({ ok: true });
});

prodRoutes.post('/wo/:id/finish', need('wo.run'), async (c) => {
  const u = c.get('user');
  const id = intParam(c, 'id');
  const b = await readJson(c);
  const out = reqNum(b, 'qty_out', 0);
  const w = await c.env.DB.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first<any>();
  if (!w) throw notFound();
  if (w.assigned_to !== u.id) throw forbidden('WO ini bukan tugas Anda');
  if (w.status !== 'berjalan') throw conflict('WO tidak sedang berjalan');
  const cfg = await loadCalendar(c.env.DB);
  const t = now();
  const raw = Math.round((t - w.started_at) / 1000);
  const eff = effectiveSeconds(w.started_at, t, cfg);
  await c.env.DB.prepare("UPDATE work_orders SET status='selesai', finished_at=?, raw_duration_s=?, effective_s=?, out_total=? WHERE id=?").bind(t, raw, eff, out, id).run();
  await recomputeQueue(c.env.DB, w.machine_id, 'WO selesai', u.id, cfg);
  await audit(c.env.DB, u.id, 'wo_finished', 'wo', id, { raw, eff });
  return c.json({ ok: true, raw_duration_s: raw, effective_s: eff });
});

// ---------- QC hasil ----------
prodRoutes.post('/wo/:id/qc', need('result.qc'), async (c) => {
  const id = intParam(c, 'id');
  const w = await c.env.DB.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first<any>();
  if (!w) throw notFound();
  if (w.status !== 'selesai') throw conflict('WO belum selesai');
  const b = await readJson(c);
  const verdict = oneOf(b, 'verdict', ['pass', 'hold', 'rework', 'reject'] as const);
  const initial = reqNum(b, 'qty_initial', 0);
  const reject = reqNum(b, 'qty_reject', 0, true);
  const rework = reqNum(b, 'qty_rework', 0, true);
  const good = reqNum(b, 'qty_good_final', 0, true);
  if (Math.abs(good + reject + rework - initial) > 1e-9) throw bad('Output baik + reject + rework harus sama dengan output awal (tidak boleh dihitung ganda)');
  if (verdict === 'pass' && rework !== 0) throw bad('Verdict pass tidak boleh memiliki qty rework');
  if (verdict === 'rework' && rework <= 0) throw bad('Verdict rework membutuhkan qty rework');
  if (verdict === 'reject' && (good !== 0 || rework !== 0)) throw bad('Verdict reject: seluruh output reject');
  if (verdict === 'hold' && (good !== 0 || reject !== 0 || rework !== 0)) throw bad('Verdict hold: belum ada keputusan baik/reject/rework');
  const recheck = b.recheck_of != null ? reqNum(b, 'recheck_of', 0) : null;
  if (recheck == null) {
    const dup = await c.env.DB.prepare('SELECT 1 FROM qc_results WHERE wo_id = ? AND recheck_of IS NULL').bind(id).first();
    if (dup) throw conflict('QC awal WO ini sudah ada; gunakan recheck_of untuk hasil hold/rework');
    if (Math.abs(initial - w.out_total) > 1e-9) throw bad(`Output awal harus sama dengan output WO (${w.out_total})`);
  } else {
    const prev = await c.env.DB.prepare('SELECT * FROM qc_results WHERE id = ? AND wo_id = ?').bind(recheck, id).first<any>();
    if (!prev || !['hold', 'rework'].includes(prev.verdict)) throw bad('recheck_of harus mengacu ke QC hold/rework pada WO yang sama');
    const outstanding = (prev.verdict === 'hold' ? prev.qty_initial : prev.qty_rework);
    const used = await c.env.DB.prepare('SELECT COALESCE(SUM(qty_initial),0) s FROM qc_results WHERE recheck_of = ?').bind(recheck).first<{ s: number }>();
    if (initial > outstanding - used!.s + 1e-9) throw bad('Qty pemeriksaan ulang melebihi sisa hold/rework');
  }
  const r = await c.env.DB.prepare(
    'INSERT INTO qc_results (wo_id, verdict, qty_initial, qty_reject, qty_rework, qty_good_final, note, by_user, at, recheck_of) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).bind(id, verdict, initial, reject, rework, good, optStr(b, 'note', 1000), c.get('user').id, now(), recheck).run();
  await audit(c.env.DB, c.get('user').id, 'qc_result', 'wo', id, { verdict });
  return c.json({ ok: true, id: r.meta.last_row_id }, 201);
});

// Penanda selesai produksi dilakukan eksplisit; tidak ada WO terbuka dan tidak ada hold/rework tersisa.
prodRoutes.post('/orders/:id/finish-production', async (c) => {
  const u = c.get('user');
  if (!['cs', 'supervisor', 'master'].includes(u.role)) throw forbidden();
  const id = intParam(c, 'id');
  const o = await c.env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<any>();
  if (!o) throw notFound();
  if (!PRODUCIBLE.includes(o.status)) throw conflict('Order tidak sedang berproduksi');
  const open = await c.env.DB.prepare("SELECT COUNT(*) n FROM work_orders WHERE order_id = ? AND status IN ('menunggu','berjalan')").bind(id).first<{ n: number }>();
  if (open!.n) throw conflict('Masih ada WO yang belum selesai');
  const pend = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM qc_results q JOIN work_orders w ON w.id = q.wo_id
     WHERE w.order_id = ? AND q.verdict IN ('hold','rework')
       AND (CASE q.verdict WHEN 'hold' THEN q.qty_initial ELSE q.qty_rework END) - COALESCE((SELECT SUM(r.qty_initial) FROM qc_results r WHERE r.recheck_of = q.id),0) > 1e-9`,
  ).bind(id).first<{ n: number }>();
  if (pend!.n) throw conflict('Masih ada hasil hold/rework yang belum diperiksa ulang');
  const noQc = await c.env.DB.prepare("SELECT COUNT(*) n FROM work_orders w WHERE w.order_id = ? AND w.status='selesai' AND NOT EXISTS (SELECT 1 FROM qc_results q WHERE q.wo_id = w.id)").bind(id).first<{ n: number }>();
  if (noQc!.n) throw conflict('Ada WO selesai yang belum melalui QC hasil');
  await c.env.DB.prepare("UPDATE orders SET status='selesai_produksi' WHERE id = ?").bind(id).run();
  await audit(c.env.DB, u.id, 'production_finished', 'order', id);
  return c.json({ ok: true });
});

// ---------- Serah terima (boleh sebagian) ----------
prodRoutes.post('/orders/:id/handover', need('handover.write'), async (c) => {
  const u = c.get('user');
  const orderId = intParam(c, 'id');
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<any>();
  if (!o) throw notFound();
  if (!['berjalan', 'selesai_produksi', 'serah_terima_sebagian'].includes(o.status)) throw conflict('Order belum punya hasil untuk diserahkan');
  const b = await readJson(c);
  const item = await c.env.DB.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').bind(reqNum(b, 'item_id', 0), orderId).first<any>();
  if (!item) throw notFound('Item tidak ditemukan');
  const qty = reqNum(b, 'qty_this', 0);
  const agg = await c.env.DB.prepare(
    `SELECT COALESCE((SELECT SUM(q.qty_good_final) FROM qc_results q JOIN work_orders w ON w.id = q.wo_id WHERE w.item_id = ? AND ${FINAL_STAGE}),0) AS good,
            COALESCE((SELECT SUM(qty_this) FROM handovers WHERE item_id = ?),0) AS handed,
            (SELECT MAX(q.id) FROM qc_results q JOIN work_orders w ON w.id = q.wo_id WHERE w.item_id = ? AND ${FINAL_STAGE}) AS last_qc`,
  ).bind(item.id, item.id, item.id).first<any>();
  const available = agg.good - agg.handed;
  if (qty > available + 1e-9) throw conflict(`Hasil baik yang tersedia untuk diserahkan hanya ${available} ${item.prod_unit}`);
  const cumulative = agg.handed + qty;
  const target = convert({ qty: item.order_qty, unit: item.order_unit }, item.prod_unit, item.prod_per_order).qty;
  const r = await c.env.DB.prepare(
    `INSERT INTO handovers (order_id, item_id, package_label, wo_id, qc_result_id, qty_good, qty_this, qty_cumulative, remaining_result, remaining_work,
       material_returned, handed_by, received_by_name, evidence_ref, courier_receipt, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(orderId, item.id, reqStr(b, 'package_label', 100), optNum(b, 'wo_id'), agg.last_qc, agg.good, qty, cumulative, available - qty, Math.max(target - cumulative, 0),
    optStr(b, 'material_returned', 300), u.id, reqStr(b, 'received_by_name', 120), optStr(b, 'evidence_ref', 300), optStr(b, 'courier_receipt', 100), now()).run();
  // Setelah "selesai produksi" status tidak mundur ke tahap yang membuka produksi lagi.
  const stmts = [c.env.DB.prepare("UPDATE orders SET status='serah_terima_sebagian' WHERE id = ? AND status IN ('berjalan','serah_terima_sebagian')").bind(orderId)];
  if (b.courier_receipt) stmts.push(c.env.DB.prepare('UPDATE tracking SET courier_receipt = ? WHERE order_id = ?').bind(String(b.courier_receipt).slice(0, 100), orderId));
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, u.id, 'handover', 'order', orderId, { qty });
  return c.json({ ok: true, id: r.meta.last_row_id, qty_cumulative: cumulative, remaining_result: available - qty, remaining_work: Math.max(target - cumulative, 0) }, 201);
});

// ---------- Dashboard ----------
prodRoutes.get('/dashboard', async (c) => {
  if (!isStaff(c.get('user'))) throw forbidden();
  const db = c.env.DB;
  const one = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  const [menungguCs, menungguRilis, siapJadwal, woBerjalan, woMenunggu, hasilSiap, belumArtwork, lewatDeadline] = await Promise.all([
    one("SELECT COUNT(*) n FROM orders WHERE status='menunggu_cs'"),
    one("SELECT COUNT(*) n FROM orders WHERE status='menunggu_rilis'"),
    one("SELECT COUNT(*) n FROM orders o WHERE o.status IN ('dirilis','berjalan') AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.approved_artwork_id IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.order_id=o.id)"),
    one("SELECT COUNT(*) n FROM work_orders WHERE status='berjalan'"),
    one("SELECT COUNT(*) n FROM work_orders WHERE status='menunggu'"),
    one("SELECT COUNT(*) n FROM orders WHERE status IN ('selesai_produksi','serah_terima_sebagian')"),
    one("SELECT COUNT(*) n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.approved_artwork_id IS NULL AND o.status NOT IN ('selesai','dibatalkan')"),
    one("SELECT COUNT(*) n FROM orders WHERE status NOT IN ('selesai','dibatalkan') AND customer_deadline IS NOT NULL AND customer_deadline < (EXTRACT(EPOCH FROM now()) * 1000)"),
  ]);
  const output = await db.prepare(
    `SELECT i.service_code, i.prod_unit, SUM(q.qty_good_final) good, SUM(q.qty_reject) reject, SUM(q.qty_rework) rework
     FROM qc_results q JOIN work_orders w ON w.id=q.wo_id JOIN order_items i ON i.id=w.item_id WHERE (w.stage = 'transfer_calender' OR i.service_code <> 'SUBLIM_KAIN') GROUP BY i.service_code, i.prod_unit`,
  ).all();
  return c.json({
    hambatan: { menunggu_cs: menungguCs, menunggu_rilis: menungguRilis, item_belum_artwork_disetujui: belumArtwork },
    siap_dijadwalkan: siapJadwal, wo_berjalan: woBerjalan, wo_menunggu: woMenunggu, hasil_siap_atau_sebagian_diserahkan: hasilSiap,
    lewat_deadline: lewatDeadline, output_per_layanan_dan_satuan: output.results,
  });
});
