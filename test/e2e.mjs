// Uji alur penuh terhadap server lokal: npm run dev (terminal lain), lalu npm run test:e2e.
// Membutuhkan database lokal KOSONG (hapus folder .wrangler/state lalu migrasi ulang) dan BOOTSTRAP_TOKEN pada .dev.vars.
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const BOOT = process.env.BOOTSTRAP_TOKEN ?? 'token-uji-lokal-0123456789';
let pass = 0, fail = 0;

function client(name) {
  return { name, cookie: '', csrf: '' };
}
async function call(cl, method, path, body, opts = {}) {
  const headers = {};
  if (cl?.cookie) headers.Cookie = cl.cookie;
  if (cl?.csrf && method !== 'GET') headers['X-CSRF-Token'] = cl.csrf;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const sc = res.headers.get('set-cookie');
  if (sc && cl) cl.cookie = sc.split(';')[0];
  if (opts.raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  return { status: res.status, data };
}
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  GAGAL ' + label + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}
async function login(cl, username, password) {
  const r = await call(cl, 'POST', '/api/auth/login', { username, password });
  if (r.status === 200) cl.csrf = r.data.csrf;
  return r;
}
async function loginReady(cl, username, initial, final) {
  let r = await login(cl, username, initial);
  if (r.data?.must_change_password) {
    await call(cl, 'POST', '/api/auth/change-password', { current_password: initial, new_password: final });
    r = await login(cl, username, final);
  } else if (r.status !== 200) r = await login(cl, username, final);
  return r;
}
const PW = 'Awal12345abc', PW2 = 'Final12345xyz';
const WITA_NOW = () => Date.now();

async function main() {
  const anon = client('anon');
  console.log('# Bootstrap master');
  let r = await call(anon, 'POST', '/api/bootstrap', { token: 'salah-salah-salah-salah', username: 'master1', password: PW2, full_name: 'Master Uji' });
  check('token salah ditolak', r.status === 403, r);
  r = await call(anon, 'POST', '/api/bootstrap', { token: BOOT, username: 'master1', password: PW2, full_name: 'Master Uji' });
  check('token benar membuat master', r.status === 200, r);
  r = await call(anon, 'POST', '/api/bootstrap', { token: BOOT, username: 'master2', password: PW2, full_name: 'Master Dua' });
  check('bootstrap kedua ditolak (sekali pakai)', r.status === 403, r);

  const master = client('master');
  r = await login(master, 'master1', PW2);
  check('master login', r.status === 200, r);

  console.log('# Keamanan dasar');
  r = await call(anon, 'GET', '/api/orders');
  check('API tanpa login = 401', r.status === 401);
  r = await call(master, 'POST', '/api/master/users', { username: 'x' });
  check('POST tanpa CSRF/valid = ditolak', r.status >= 400);
  const noCsrf = { ...master, csrf: '' };
  r = await call(noCsrf, 'POST', '/api/master/customers', { code: 'C0' });
  check('POST tanpa token CSRF = 403', r.status === 403, r);
  for (let i = 0; i < 5; i++) await login(client('x'), 'master1', 'salah-salah-1');
  r = await login(client('x'), 'master1', PW2);
  check('pembatasan login setelah 5 gagal = 429', r.status === 429, r);

  console.log('# Akun karyawan');
  const staff = [
    ['cs1', 'cs', '0002'], ['sup1', 'supervisor', '0003'], ['crm1', 'crm', '0004'], ['op1', 'operator', '0005'], ['op2', 'operator', '0006'],
    ['qc1', 'qc', '0007'], ['gud1', 'gudang', '0008'], ['fat1', 'fat', '0009'],
  ];
  for (const [u, role, reg] of staff) {
    r = await call(master, 'POST', '/api/master/users', { username: u, role, password: PW, reg_code: reg, full_name: 'Uji ' + u, employee_no: 'TLI' + reg, department: 'SDP', job_title: role });
    check(`buat akun ${u}`, r.status === 201, r);
  }
  const C = {};
  for (const [u] of staff) C[u] = client(u);
  r = await login(C.cs1, 'cs1', PW);
  check('login awal wajib ganti password', r.data?.must_change_password === true, r);
  r = await call(C.cs1, 'GET', '/api/orders');
  check('API lain diblokir sebelum ganti password', r.status === 403, r);
  for (const [u] of staff) await loginReady(C[u], u, PW, PW2);
  r = await call(C.cs1, 'GET', '/api/orders');
  check('setelah ganti password API terbuka', r.status === 200, r);
  r = await call(C.cs1, 'POST', '/api/master/users', {});
  check('CS tidak bisa membuat akun', r.status === 403, r);

  console.log('# Konfigurasi mesin dan norma');
  const mk = async (code, kind) => (await call(master, 'POST', '/api/master/config/machines', { code, name: code, kind })).data.id;
  const mDtf = await mk('DTF-1', 'dtf_printer');
  const mSub = await mk('SUB-1', 'sublim_printer');
  const mCal = await mk('CAL-1', 'calender');
  r = await call(master, 'PUT', '/api/master/config/norms/sublim_printer', { seconds_per_unit: 120, source_note: 'uji' });
  check('master mengatur norma sublim', r.status === 200, r);
  r = await call(C.cs1, 'PUT', '/api/master/config/norms/calender', { seconds_per_unit: 5 });
  check('CS tidak bisa mengubah norma', r.status === 403, r);

  console.log('# Pendaftaran member');
  const reg = (u, name) => call(anon, 'POST', '/api/public/register', {
    business_name: name, pic_name: 'PIC ' + name, contact: '0812000' + u.length, address: 'Jl. Uji 1 Makassar', business_type: 'konveksi',
    city_scope: 'in_city', username: u, password: PW2, consent_contact: true,
  });
  r = await call(anon, 'POST', '/api/public/register', { business_name: 'X' });
  check('pendaftaran tidak lengkap ditolak', r.status === 400, r);
  r = await reg('memberA', 'Konveksi A');
  check('pendaftaran publik diterima (pending)', r.status === 201 && r.data.status === 'menunggu_cs', r);
  const appA = r.data.id;
  r = await login(client('t'), 'memberA', PW2);
  check('akun pending tidak bisa login', r.status === 401, r);
  r = await call(master, 'POST', `/api/applications/${appA}/decide`, { approve: true, customer_code: '0001' });
  check('ACC tanpa verifikasi CS ditolak', r.status === 409, r);
  r = await call(C.cs1, 'POST', `/api/applications/${appA}/cs`, { note: 'Sudah dihubungi via telepon' });
  check('CS mencatat verifikasi', r.status === 200, r);
  r = await call(master, 'POST', `/api/applications/${appA}/decide`, { approve: true, customer_code: '0001' });
  check('ACC tanpa survei CRM ditolak', r.status === 409, r);
  r = await call(C.cs1, 'POST', `/api/applications/${appA}/survey`, { note: 'x', feasible: true });
  check('CS tidak boleh mengisi survei CRM', r.status === 403, r);
  r = await call(C.crm1, 'POST', `/api/applications/${appA}/survey`, { note: 'Lokasi sesuai', feasible: true });
  check('CRM mencatat survei', r.status === 200, r);
  r = await call(C.cs1, 'POST', `/api/applications/${appA}/decide`, { approve: true, customer_code: '0001' });
  check('CS tidak bisa ACC', r.status === 403, r);
  r = await call(master, 'POST', `/api/applications/${appA}/decide`, { approve: true, customer_code: '0001' });
  check('master ACC -> akun aktif', r.status === 200 && r.data.status === 'aktif', r);
  const custA = client('A');
  r = await login(custA, 'memberA', PW2);
  check('member A login, role customer', r.status === 200 && r.data.role === 'customer', r);

  r = await reg('memberB', 'Konveksi B');
  const appB = r.data.id;
  await call(C.cs1, 'POST', `/api/applications/${appB}/cs`, { note: 'ok' });
  await call(C.crm1, 'POST', `/api/applications/${appB}/survey`, { note: 'ok', feasible: true });
  await call(master, 'POST', `/api/applications/${appB}/decide`, { approve: true, customer_code: '0002' });
  const custB = client('B');
  await login(custB, 'memberB', PW2);

  r = await reg('memberC', 'Konveksi C');
  const appC = r.data.id;
  await call(C.cs1, 'POST', `/api/applications/${appC}/cs`, { note: 'ok' });
  await call(C.crm1, 'POST', `/api/applications/${appC}/survey`, { note: 'tidak layak', feasible: false });
  r = await call(master, 'POST', `/api/applications/${appC}/decide`, { approve: true, customer_code: '0003' });
  check('survei tidak layak: ACC ditolak', r.status === 409, r);

  console.log('# Pesanan terpadu (DTF + Sublim, satu CS)');
  const dl = WITA_NOW() + 7 * 86400_000;
  r = await call(custA, 'POST', '/api/orders', {
    customer_deadline: dl, po_ref: 'PO-UJI-1',
    items: [
      { service_code: 'DTF', order_qty: 10, order_unit: 'meter', prod_unit: 'meter', bill_unit: 'meter', material_owner: 'customer' },
      { service_code: 'SUBLIM_KAIN', order_qty: 2, order_unit: 'roll', prod_unit: 'meter', bill_unit: 'meter', prod_per_order: 50, bill_per_order: 50 },
    ],
  });
  check('customer A membuat order 2 layanan', r.status === 201, r);
  const orderA = r.data.id, trackA = r.data.tracking_code;
  r = await call(custA, 'POST', '/api/orders', { items: [{ service_code: 'DTF', order_qty: 1, order_unit: 'roll', prod_unit: 'meter', bill_unit: 'meter' }] });
  check('konversi satuan tanpa faktor ditolak', r.status === 400, r);
  r = await call(custB, 'POST', '/api/orders', { items: [{ service_code: 'DTF', order_qty: 5, order_unit: 'meter', prod_unit: 'meter', bill_unit: 'meter' }] });
  const orderB = r.data.id;
  r = await call(custB, 'GET', `/api/orders/${orderA}`);
  check('customer B tidak bisa melihat order A', r.status === 404, r);
  r = await call(custB, 'GET', '/api/orders');
  check('daftar order B hanya milik B', r.data.length === 1 && r.data[0].id === orderB, r);
  r = await call(C.cs1, 'GET', '/api/orders');
  check('satu CS melihat order DTF dan Sublim', r.data.length === 2, r);

  r = await call(C.cs1, 'GET', `/api/orders/${orderA}`);
  const itemDtf = r.data.items.find((i) => i.service_code === 'DTF').id;
  const itemSub = r.data.items.find((i) => i.service_code === 'SUBLIM_KAIN').id;
  check('tracking code acak >=128 bit', trackA.length >= 22, trackA);

  console.log('# Artwork, validasi CS, rilis');
  // Alur unggah dua langkah: init (izin + URL bertanda tangan) -> PUT langsung ke storage -> confirm.
  async function upload(cl, kind, text = 'isi file uji') {
    const blob = new Blob([text], { type: 'application/pdf' });
    const init = await call(cl, 'POST', '/api/files/init', { kind, file_name: 'desain.pdf', content_type: 'application/pdf', size_bytes: blob.size });
    if (init.status !== 201) return init;
    const { url, method, fields, file_field } = init.data.upload;
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set(file_field, blob, 'desain.pdf');
    const put = await fetch(url.startsWith('/') ? BASE + url : url, { method, body: fd });
    if (!put.ok) return { status: put.status, data: { error: 'PUT storage gagal' } };
    return call(cl, 'POST', '/api/files/confirm', { key: init.data.key });
  }
  r = await upload(custA, 'artwork');
  check('customer unggah artwork', r.status === 201, r);
  const key1 = r.data.key;
  r = await call(custA, 'POST', `/api/prod/items/${itemDtf}/artworks`, { file_key: key1 });
  check('versi 1 artwork dibuat', r.status === 201 && r.data.version === 1, r);
  const art1 = r.data.id;
  r = await call(custB, 'POST', `/api/prod/items/${itemDtf}/artworks`, { file_key: key1 });
  check('customer B tidak bisa mengunggah ke item A', r.status === 404, r);
  r = await call(custB, 'GET', `/api/files/${key1}`, undefined, { raw: true });
  check('customer B tidak bisa mengunduh file A', r.status === 404, r.status);
  r = await call(custA, 'GET', `/api/files/${key1}`, undefined, { raw: true });
  check('customer A bisa mengunduh file sendiri', r.status === 200);
  r = await call(C.cs1, 'POST', `/api/prod/artworks/${art1}/approve`, { approved_by_pic: 'PIC A', approval_ref: 'WA 18/11 10:00' });
  check('approve sebelum review ditolak', r.status === 409, r);
  r = await call(C.cs1, 'POST', `/api/prod/artworks/${art1}/review`, { status: 'menunggu_persetujuan', preflight_note: 'Resolusi 300dpi OK' });
  check('CS review artwork', r.status === 200, r);
  r = await call(C.cs1, 'POST', `/api/prod/artworks/${art1}/approve`, { approved_by_pic: 'PIC A' });
  check('persetujuan tanpa referensi bukti ditolak', r.status === 400, r);
  r = await call(C.cs1, 'POST', `/api/prod/artworks/${art1}/approve`, { approved_by_pic: 'PIC A', approval_ref: 'WA 18/11 10:00' });
  check('CS mencatat persetujuan PIC', r.status === 200, r);
  r = await upload(custA, 'artwork', 'versi 2');
  r = await call(custA, 'POST', `/api/prod/items/${itemDtf}/artworks`, { file_key: r.data.key });
  check('revisi tanpa evaluasi dampak ditolak', r.status === 400, r);
  r = await upload(custA, 'artwork', 'versi 2 b');
  const key2 = r.data.key;
  r = await call(custA, 'POST', `/api/prod/items/${itemDtf}/artworks`, { file_key: key2, revision_impact_note: 'Tidak ada tambahan biaya' });
  check('revisi menjadi versi 2, versi 1 tetap disetujui', r.status === 201 && r.data.version === 2, r);
  r = await call(C.cs1, 'GET', `/api/orders/${orderA}`);
  const itD = r.data.items.find((i) => i.id === itemDtf);
  check('versi produksi tetap versi 1 sampai versi 2 disetujui', itD.approved_artwork_id === art1, itD);

  r = await call(C.sup1, 'POST', `/api/orders/${orderA}/release`, {});
  check('rilis sebelum validasi CS ditolak', r.status === 409, r);
  r = await call(C.cs1, 'POST', `/api/orders/${orderA}/cs-validate`, { detail_confirmed: true, confirm_ref: 'Telp PIC', payment_policy_checked: true, deadline_feasible: false, validation_note: 'x' });
  check('validasi CS menolak deadline belum layak', r.status === 400, r);
  r = await call(C.cs1, 'POST', `/api/orders/${orderA}/cs-validate`, { detail_confirmed: true, confirm_ref: 'Telp PIC 18/11', payment_policy_checked: true, deadline_feasible: true, validation_note: 'DP sesuai kebijakan' });
  check('CS memvalidasi order', r.status === 200, r);
  r = await call(C.cs1, 'POST', `/api/orders/${orderA}/release`, {});
  check('CS tidak bisa merilis sendiri', r.status === 403, r);
  r = await call(C.sup1, 'POST', `/api/orders/${orderA}/release`, {});
  check('rilis ditolak: item Sublim belum punya artwork disetujui', r.status === 409, r);
  r = await upload(custA, 'artwork', 'sublim');
  r = await call(custA, 'POST', `/api/prod/items/${itemSub}/artworks`, { file_key: r.data.key });
  const art3 = r.data.id;
  await call(C.cs1, 'POST', `/api/prod/artworks/${art3}/review`, { status: 'menunggu_persetujuan', preflight_note: 'ok' });
  await call(C.cs1, 'POST', `/api/prod/artworks/${art3}/approve`, { approved_by_pic: 'PIC A', approval_ref: 'WA' });
  r = await call(C.sup1, 'POST', `/api/orders/${orderA}/release`, {});
  check('penanggung jawab merilis produksi', r.status === 200, r);

  console.log('# Assignment, check-in, standby');
  const ops = (await call(master, 'GET', '/api/master/users')).data.filter((u) => u.role === 'operator');
  const op1 = ops.find((u) => u.username === 'op1').id, op2 = ops.find((u) => u.username === 'op2').id;
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderA}/work-orders`, { item_id: itemDtf, stage: 'print_film', machine_id: mDtf, planned_qty: 10, assigned_to: op1 });
  check('assign ke operator belum check-in ditolak', r.status === 409, r);
  await call(C.op1, 'POST', '/api/master/attendance/checkin', {});
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderA}/work-orders`, { item_id: itemDtf, stage: 'print_film', machine_id: mDtf, planned_qty: 10, assigned_to: op1 });
  check('assign ke operator belum Standby ditolak', r.status === 409, r);
  await call(C.op1, 'POST', '/api/master/attendance/standby', { standby: true });
  await call(C.op2, 'POST', '/api/master/attendance/checkin', {});
  await call(C.op2, 'POST', '/api/master/attendance/standby', { standby: true });
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderA}/work-orders`, { item_id: itemDtf, stage: 'print_film', machine_id: mSub, planned_qty: 10, assigned_to: op1 });
  check('tahap DTF pada mesin sublim ditolak', r.status === 400, r);
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderA}/work-orders`, { item_id: itemDtf, stage: 'print_film', machine_id: mDtf, planned_qty: 10, assigned_to: op1 });
  check('CS assign WO DTF ke operator standby', r.status === 201, r);
  const wo1 = r.data.id;
  r = await call(C.cs1, 'GET', `/api/orders/${orderA}`);
  const w1 = r.data.work_orders.find((w) => w.id === wo1);
  check('estimasi DTF 10 m x 4 menit terisi', w1.est_end_at > Date.now() && w1.est_initial_end_at === w1.est_end_at, w1);
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderA}/work-orders`, { item_id: itemSub, stage: 'transfer_calender', machine_id: mCal, planned_qty: 100, assigned_to: op2 });
  check('transfer calender menunggu print kertas lolos QC', r.status === 409, r);
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderA}/work-orders`, { item_id: itemSub, stage: 'print_kertas', machine_id: mSub, planned_qty: 100, assigned_to: op2 });
  check('WO Sublim kertas pada mesin sublim', r.status === 201, r);
  const wo2 = r.data.id;
  const lines = (await call(C.cs1, 'GET', `/api/orders/${orderA}`)).data.work_orders;
  check('estimasi Sublim memakai norma sublim terpisah (bukan norma DTF)', lines.find((w) => w.id === wo2).est_end_at !== null);

  console.log('# QC kesiapan mesin');
  r = await call(C.op1, 'POST', `/api/prod/wo/${wo1}/start`, {});
  check('mulai tanpa QC kesiapan ditolak', r.status === 409, r);
  const ck = (okAll, photos) => ['area', 'machine', 'material', 'nozzle_check', 'test_print', 'curing', 'press_test'].map((k) => ({
    key: k, ok: okAll === true || k !== okAll, ...(photos[k] ? { photo_key: photos[k] } : {}),
  }));
  r = await call(C.op1, 'POST', `/api/prod/machines/${mDtf}/qc`, { checklist: ck(true, {}) });
  check('foto wajib untuk nozzle/test print/uji press', r.status === 400, r);
  const photos = {};
  for (const k of ['nozzle_check', 'test_print', 'press_test']) photos[k] = (await upload(C.op1, 'qc_photo', 'foto ' + k)).data.key;
  r = await call(C.op1, 'POST', `/api/prod/machines/${mDtf}/qc`, { checklist: ck('curing', photos) });
  check('NG tanpa temuan/tindakan ditolak', r.status === 400, r);
  r = await call(C.op1, 'POST', `/api/prod/machines/${mDtf}/qc`, { checklist: ck('curing', photos), finding: 'Suhu curing rendah', action_note: 'Naikkan suhu, tunggu stabil' });
  check('NG -> tahan produksi', r.status === 201 && r.data.conclusion === 'tahan_produksi', r);
  r = await call(C.op1, 'POST', `/api/prod/wo/${wo1}/start`, {});
  check('mulai saat mesin ditahan ditolak', r.status === 409, r);
  r = await call(C.op1, 'POST', `/api/prod/machines/${mDtf}/qc`, { checklist: ck(true, photos) });
  check('operator tidak bisa menyatakan siap setelah NG', r.status === 403, r);
  r = await call(C.qc1, 'POST', `/api/prod/machines/${mDtf}/qc`, { checklist: ck(true, photos) });
  check('QC memverifikasi ulang -> siap', r.status === 201 && r.data.conclusion === 'siap', r);
  r = await call(C.op2, 'POST', `/api/prod/wo/${wo1}/start`, {});
  check('operator lain tidak bisa memulai WO orang lain', r.status === 403, r);
  r = await call(C.op1, 'POST', `/api/prod/wo/${wo1}/start`, {});
  check('operator pemilik memulai WO', r.status === 200, r);

  console.log('# Mesin sama tidak boleh dua WO sekaligus');
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderB}/work-orders`, { item_id: 1, stage: 'print_film', machine_id: mDtf, planned_qty: 5, assigned_to: op2 });
  check('order B belum dirilis -> WO ditolak', r.status === 409 || r.status === 404, r);
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderA}/work-orders`, { item_id: itemDtf, stage: 'print_film', machine_id: mDtf, planned_qty: 5, assigned_to: op2 });
  check('WO kedua dibuat pada mesin DTF yang sama (antre)', r.status === 201, r);
  const wo3 = r.data.id;
  r = await call(C.cs1, 'GET', `/api/orders/${orderA}`);
  const q1 = r.data.work_orders.find((w) => w.id === wo1), q3 = r.data.work_orders.find((w) => w.id === wo3);
  check('antrean per mesin: WO kedua diestimasi setelah WO pertama', q3.est_end_at > q1.est_end_at, { q1: q1.est_end_at, q3: q3.est_end_at });
  r = await call(C.op2, 'POST', `/api/prod/wo/${wo3}/start`, {});
  check('mesin yang sama tidak menjalankan dua WO sekaligus', r.status === 409 && /Mesin sedang menjalankan/.test(r.data.error), r);

  console.log('# Selesai, QC hasil, serah terima parsial');
  r = await call(C.op1, 'POST', `/api/prod/wo/${wo1}/finish`, { qty_out: 10 });
  check('operator menyelesaikan WO (waktu server)', r.status === 200 && typeof r.data.effective_s === 'number', r);
  r = await call(C.qc1, 'POST', `/api/prod/wo/${wo1}/qc`, { verdict: 'pass', qty_initial: 10, qty_reject: 1, qty_rework: 0, qty_good_final: 8 });
  check('QC tidak menerima hitungan ganda (8+1 != 10)', r.status === 400, r);
  r = await call(C.qc1, 'POST', `/api/prod/wo/${wo1}/qc`, { verdict: 'rework', qty_initial: 10, qty_reject: 1, qty_rework: 2, qty_good_final: 7 });
  check('QC: 7 baik, 1 reject, 2 rework', r.status === 201, r);
  const qc1 = r.data.id;
  r = await call(C.gud1, 'POST', `/api/prod/orders/${orderA}/handover`, { item_id: itemDtf, package_label: 'Paket 1', qty_this: 8, received_by_name: 'Budi' });
  check('serah terima melebihi hasil baik ditolak', r.status === 409, r);
  r = await call(C.gud1, 'POST', `/api/prod/orders/${orderA}/handover`, { item_id: itemDtf, package_label: 'Paket 1', qty_this: 5, received_by_name: 'Budi', courier_receipt: 'JNE123' });
  check('serah terima parsial 5 dari 7', r.status === 201 && r.data.remaining_result === 2 && r.data.remaining_work === 5, r);
  r = await call(C.qc1, 'POST', `/api/prod/wo/${wo1}/qc`, { verdict: 'pass', qty_initial: 3, qty_reject: 0, qty_rework: 0, qty_good_final: 3, recheck_of: qc1 });
  check('recheck rework melebihi sisa ditolak', r.status === 400, r);
  r = await call(C.qc1, 'POST', `/api/prod/wo/${wo1}/qc`, { verdict: 'pass', qty_initial: 2, qty_reject: 0, qty_rework: 0, qty_good_final: 2, recheck_of: qc1 });
  check('recheck rework 2 lolos', r.status === 201, r);
  r = await call(C.cs1, 'POST', `/api/orders/${orderA}/close`, {});
  check('order tidak bisa ditutup saat ada sisa', r.status === 409, r);
  r = await call(C.cs1, 'GET', `/api/orders/${orderA}`);
  check('status order = serah_terima_sebagian', r.data.status === 'serah_terima_sebagian', r.data.status);

  console.log('# Mesin berbeda paralel, antrean berlanjut');
  const okAll = (keys) => keys.map((k) => ({ key: k, ok: true }));
  r = await call(C.op2, 'POST', `/api/prod/wo/${wo3}/start`, {});
  check('setelah WO pertama selesai, WO antrean dapat dimulai', r.status === 200, r);
  r = await call(C.op2, 'POST', `/api/prod/wo/${wo3}/finish`, { qty_out: 5 });
  r = await call(C.qc1, 'POST', `/api/prod/wo/${wo3}/qc`, { verdict: 'pass', qty_initial: 5, qty_reject: 0, qty_rework: 0, qty_good_final: 5 });
  check('QC WO antrean lolos', r.status === 201, r);

  console.log('# Sublim kain: print kertas -> transfer calender');
  r = await call(C.op2, 'POST', `/api/prod/machines/${mSub}/qc`, { checklist: okAll(['area', 'material', 'nozzle_check', 'test_print']) });
  check('QC kesiapan printer sublim siap', r.status === 201 && r.data.conclusion === 'siap', r);
  r = await call(C.op2, 'POST', `/api/prod/wo/${wo2}/start`, {});
  check('operator memulai print kertas', r.status === 200, r);
  r = await call(C.op2, 'POST', `/api/prod/wo/${wo2}/finish`, { qty_out: 100 });
  check('print kertas selesai', r.status === 200, r);
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderA}/work-orders`, { item_id: itemSub, stage: 'transfer_calender', machine_id: mCal, planned_qty: 100, assigned_to: op2 });
  check('calender masih ditolak sebelum QC print kertas lolos', r.status === 409, r);
  r = await call(C.qc1, 'POST', `/api/prod/wo/${wo2}/qc`, { verdict: 'pass', qty_initial: 100, qty_reject: 0, qty_rework: 0, qty_good_final: 100 });
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderA}/work-orders`, { item_id: itemSub, stage: 'transfer_calender', machine_id: mCal, planned_qty: 100, assigned_to: op2 });
  check('calender diizinkan setelah print kertas lolos QC', r.status === 201, r);
  const wo4 = r.data.id;
  r = await call(C.cs1, 'GET', `/api/orders/${orderA}`);
  check('norma calender belum diatur -> estimasi kosong (Belum diatur)', r.data.work_orders.find((w) => w.id === wo4).est_end_at === null, r.data.work_orders);
  r = await call(C.op2, 'POST', `/api/prod/machines/${mCal}/qc`, { checklist: okAll(['area', 'material', 'parameter', 'transfer_test']) });
  r = await call(C.op2, 'POST', `/api/prod/wo/${wo4}/start`, {});
  check('operator memulai transfer calender', r.status === 200, r);
  r = await call(C.op2, 'POST', `/api/prod/wo/${wo4}/finish`, { qty_out: 98 });
  r = await call(C.qc1, 'POST', `/api/prod/wo/${wo4}/qc`, { verdict: 'pass', qty_initial: 98, qty_reject: 0, qty_rework: 0, qty_good_final: 98 });
  check('QC kain hasil transfer (input 100, output 98: selisih proses tersimpan)', r.status === 201, r);

  console.log('# Selesai produksi, serah terima penuh, penutupan');
  r = await call(C.cs1, 'POST', `/api/prod/orders/${orderA}/finish-production`, {});
  check('CS menandai produksi selesai', r.status === 200, r);
  r = await call(C.gud1, 'POST', `/api/prod/orders/${orderA}/handover`, { item_id: itemDtf, package_label: 'Paket 2', qty_this: 9, received_by_name: 'Budi' });
  check('serah terima sisa DTF 9 (total 14 baik, 5 sudah)', r.status === 201 && r.data.remaining_result === 0, r);
  r = await call(C.cs1, 'POST', `/api/orders/${orderA}/close`, {});
  check('belum bisa ditutup: Sublim belum diserahkan', r.status === 409, r);
  r = await call(C.gud1, 'POST', `/api/prod/orders/${orderA}/handover`, { item_id: itemSub, package_label: 'Rol 1', qty_this: 98, received_by_name: 'Budi' });
  check('serah terima kain 98 (sisa pekerjaan dihitung dari target 100)', r.status === 201 && r.data.remaining_work === 2, r);
  r = await call(C.cs1, 'POST', `/api/orders/${orderA}/close`, {});
  check('order ditutup setelah semua hasil baik diserahkan', r.status === 200, r);
  r = await call(anon, 'GET', `/api/public/track/${trackA}`);
  check('tracking menampilkan "Selesai" dan istilah output yang benar', r.data.status === 'Selesai' && r.data.items.some((i) => i.output === 'Kain sublim siap') && r.data.items.some((i) => i.output === 'Hasil transfer DTF siap'), r.data);

  console.log('# Tracking publik');
  r = await call(anon, 'GET', `/api/public/track/${trackA}`);
  const raw = JSON.stringify(r.data);
  check('tracking publik tampil ringkasan', r.status === 200 && r.data.items.length === 2, r);
  check('tracking tidak membocorkan nama/kontak/harga/operator/file', !/Konveksi|PIC|0812|Jl\. Uji|operator|op1|amount|desain|file/i.test(raw), raw);
  r = await call(anon, 'GET', '/api/public/track/tidak-ada-resi-ini-xxxxxxxxxxxx');
  check('resi acak yang salah = 404', r.status === 404);
  r = await call(anon, 'GET', `/api/orders/${orderA}`);
  check('order tidak terbuka publik', r.status === 401);

  console.log('# Keuangan');
  r = await call(C.fat1, 'POST', `/api/finance/orders/${orderA}/invoices`, { kind: 'invoice', amount: 1500000 });
  check('FAT membuat invoice (nominal dari manusia)', r.status === 201, r);
  r = await upload(custA, 'payment_proof');
  r = await call(custA, 'POST', `/api/finance/orders/${orderA}/payments`, { amount: 1500000, proof_key: r.data.key });
  check('unggah bukti tidak otomatis terverifikasi', r.status === 201 && r.data.verified === false, r);
  const pay = r.data.id;
  r = await call(custA, 'POST', `/api/finance/payments/${pay}/verify`, {});
  check('customer tidak bisa memverifikasi pembayaran', r.status === 403, r);
  r = await call(C.cs1, 'POST', `/api/finance/payments/${pay}/verify`, {});
  check('CS tidak bisa memverifikasi pembayaran', r.status === 403, r);
  r = await call(C.fat1, 'POST', `/api/finance/payments/${pay}/verify`, {});
  check('FAT memverifikasi pembayaran', r.status === 200, r);
  r = await call(C.fat1, 'GET', `/api/finance/orders/${orderA}/summary`);
  check('angka keuangan terpisah', r.data.invoice === 1500000 && r.data.pembayaran_terverifikasi === 1500000, r);

  console.log('# Mini WMS');
  r = await call(C.gud1, 'POST', '/api/stock/lots', { roll_id: 'R-001', sku: 'FILM-DTF', owner: 'sdp', unit: 'meter', declared_qty: 100, measured_qty: 98 });
  check('selisih receiving wajib dikonfirmasi', r.status === 409, r);
  r = await call(C.gud1, 'POST', '/api/stock/lots', { roll_id: 'R-001', sku: 'FILM-DTF', owner: 'sdp', unit: 'meter', declared_qty: 100, measured_qty: 98, diff_confirmed: true });
  check('receiving SDP dengan konfirmasi selisih', r.status === 201, r);
  const lotSdp = r.data.id;
  r = await call(C.gud1, 'POST', '/api/stock/lots', { roll_id: 'KAIN-A1', sku: 'KAIN', owner: 'customer', customer_id: 1, unit: 'meter', declared_qty: 50, measured_qty: 50 });
  const lotCust = r.data.id;
  r = await call(C.gud1, 'POST', `/api/stock/lots/${lotSdp}/ledger`, { kind: 'use', qty: 10, source_type: 'wo', source_id: String(wo1) });
  check('pemakaian tercatat', r.status === 201 && r.data.balance.on_hand === 88, r);
  r = await call(C.gud1, 'POST', `/api/stock/lots/${lotSdp}/ledger`, { kind: 'use', qty: 10, source_type: 'wo', source_id: String(wo1) });
  check('ledger idempotent: kirim ulang tidak dihitung dua kali', r.data.idempotent === true, r);
  r = await call(C.gud1, 'GET', '/api/stock/lots?owner=sdp');
  check('bahan titipan tidak masuk inventory SDP', r.data.every((l) => l.owner === 'sdp') && r.data[0].on_hand === 88, r);
  const wo2b = wo2;
  r = await call(C.gud1, 'POST', `/api/stock/lots/${lotCust}/ledger`, { kind: 'use', qty: 5, source_type: 'wo', source_id: String(wo2b) });
  check('bahan titipan customer A dipakai WO customer A', r.status === 201, r);

  console.log('# Reset akun mencabut sesi');
  r = await call(C.qc1, 'GET', '/api/orders');
  check('qc1 punya sesi aktif', r.status === 200);
  const qcId = (await call(master, 'GET', '/api/master/users')).data.find((u) => u.username === 'qc1').id;
  r = await call(master, 'PATCH', `/api/master/users/${qcId}`, { new_password: 'Reset12345abc' });
  check('master reset password', r.status === 200 && r.data.sessions_revoked === true, r);
  r = await call(C.qc1, 'GET', '/api/orders');
  check('sesi lama tidak berlaku setelah reset', r.status === 401, r);
  const fatId = (await call(master, 'GET', '/api/master/users')).data.find((u) => u.username === 'fat1').id;
  await call(master, 'PATCH', `/api/master/users/${fatId}`, { active: false });
  r = await call(C.fat1, 'GET', '/api/orders');
  check('sesi tidak berlaku setelah akun dinonaktifkan', r.status === 401, r);
  r = await login(client('z'), 'fat1', PW2);
  check('akun nonaktif tidak bisa login', r.status === 401);

  console.log(`\nHasil: ${pass} lolos, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
