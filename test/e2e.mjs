// Uji alur penuh ke server yang berjalan: `npm run dev` (database kosong) lalu `npm run test:e2e`.
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const BOOT = process.env.BOOTSTRAP_TOKEN ?? 'token-uji-lokal-0123456789';
const SHEETS = process.env.SHEETS === '1'; // backend Apps Script (lewat test/gas-harness.mjs)
let pass = 0, fail = 0;
const check = (label, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + label); } else { fail++; console.log('  GAGAL ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : '')); } };
const client = () => ({ cookie: '', csrf: '' });
async function call(cl, method, path, body, opts = {}) {
  const headers = {};
  if (cl?.cookie) headers.Cookie = cl.cookie;
  if (cl?.csrf && method !== 'GET') headers['X-CSRF-Token'] = cl.csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie');
  if (sc && cl) cl.cookie = sc.split(';')[0];
  if (opts.raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  return { status: res.status, data };
}
async function login(cl, username, password) {
  const r = await call(cl, 'POST', '/api/auth/login', { username, password });
  if (r.status === 200) cl.csrf = r.data.csrf;
  return r;
}
const PW = 'Awal12345abc', PW2 = 'Final12345xyz';
let n = 0;
const key = () => 'req-' + Date.now() + '-' + ++n;
async function upload(cl, kind, name = 'file.pdf') {
  const blob = new Blob(['isi uji ' + name], { type: 'application/pdf' });
  if (SHEETS) return call(cl, 'POST', '/api/files/upload', { kind, file_name: name, content_type: blob.type, data: Buffer.from(await blob.arrayBuffer()).toString('base64') });
  const init = await call(cl, 'POST', '/api/files/init', { kind, file_name: name, content_type: blob.type, size_bytes: blob.size });
  if (init.status !== 201) return init;
  const { url, method, fields, file_field } = init.data.upload;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set(file_field, blob, name);
  await fetch(url.startsWith('/') ? BASE + url : url, { method, body: fd });
  return call(cl, 'POST', '/api/files/confirm', { key: init.data.key });
}

async function main() {
  const anon = client(), master = client();
  console.log('# Master pertama dan keamanan dasar');
  let r = await call(anon, 'POST', '/api/bootstrap', { token: 'salah-salah-salah-salah', username: 'MASTER1', password: PW2, full_name: 'Admin Uji' });
  check('token bootstrap salah ditolak', r.status === 403, r);
  r = await call(anon, 'POST', '/api/bootstrap', { token: BOOT, username: 'MASTER1', password: PW2, full_name: 'Admin Uji' });
  check('master pertama dibuat', r.status === 200, r);
  r = await call(anon, 'POST', '/api/bootstrap', { token: BOOT, username: 'MASTER2', password: PW2, full_name: 'Dua' });
  check('bootstrap hanya sekali', r.status === 403, r);
  r = await login(master, 'master1', PW2);
  check('login (kode tidak membedakan huruf besar)', r.status === 200, r);
  for (const p of ['/api/state', '/api/files/qc_photo/x']) check('tanpa login 401: ' + p, (await call(anon, 'GET', p)).status === 401);
  if (!SHEETS) { // mode spreadsheet memakai token di body (tanpa cookie), sehingga tidak ada CSRF
    r = await call({ ...master, csrf: '' }, 'PUT', '/api/admin/settings', { priceDtf: 1 });
    check('tanpa token CSRF ditolak', r.status === 403, r);
  }

  console.log('# Akun per peran');
  const roles = [['MGR', 'manager'], ['SPV', 'spv'], ['CS', 'cs'], ['CRM', 'crm'], ['STH', 'store'], ['STH2', 'store'], ['OPR', 'op'], ['QC1', 'qc'], ['GDG', 'gudang'], ['FAT', 'fat']];
  const C = {};
  const U = (k) => (k.length < 3 ? k + '01' : k); // kode pengguna minimal 3 karakter
  for (const [code, role] of roles) {
    r = await call(master, 'POST', '/api/admin/users', { code: U(code), name: 'Uji ' + code, role, store: role === 'store' ? 'Toko ' + code : undefined, password: PW });
    check('buat akun ' + code, r.status === 201, r);
    C[code] = client();
  }
  r = await login(C.CS, U('CS'), PW);
  check('password awal wajib diganti', r.data?.must_change_password === true, r);
  check('akses diblokir sebelum ganti password', (await call(C.CS, 'GET', '/api/state')).status === 403);
  for (const [code] of roles) {
    await login(C[code], U(code), PW);
    await call(C[code], 'POST', '/api/auth/change-password', { current_password: PW, new_password: PW2 });
    await login(C[code], U(code), PW2);
  }
  check('setelah ganti password data terbuka', (await call(C.CS, 'GET', '/api/state')).status === 200);
  check('CS tidak bisa membuat akun', (await call(C.CS, 'POST', '/api/admin/users', {})).status === 403);
  const state = async (cl) => (await call(cl, 'GET', '/api/state')).data;

  console.log('# Pengaturan dan pelanggan');
  const order = (extra) => ({ request_key: key(), type: 'maklon', service: 'dtfm', source: 'WhatsApp', file_ref: 'a.cdr', meter: 10, ...extra });
  r = await call(C.CRM, 'POST', '/api/customers/import', { rows: [{ code: 'tk-0001', name: 'Konveksi Uji', wa: '0811' }, { code: 'TK-0002', name: 'Jersey Uji', wa: '0812' }] });
  check('CRM mengimpor pelanggan terdaftar', r.status === 201 && r.data.added === 2, r);
  r = await call(C.CRM, 'POST', '/api/customers/import', { rows: [{ code: 'TK-0001', name: 'Dobel', wa: '1' }] });
  check('impor ulang tidak menggandakan', r.data.added === 0 && r.data.skipped === 1, r);
  r = await call(C.CS, 'POST', '/api/orders', order({ service: 'sub', width: 'priceSub160', customer_code: 'TK-0002' }));
  check('order sublim ditolak selama harga belum diatur', r.status === 400 && /belum diatur/.test(r.data.error), r);
  check('CS tidak bisa mengubah harga', (await call(C.CS, 'PUT', '/api/admin/settings', { priceDtf: 1 })).status === 403);
  r = await call(master, 'PUT', '/api/admin/settings', { priceSub160: 26000, normSubPrint: 60, normPress: null });
  check('master mengatur harga dan norma sublim', r.status === 200, r);

  console.log('# DTF: input CS -> cek file -> lunas -> antrian');
  const body = order({ customer_code: 'TK-0001', total: 1, price: 1 });
  r = await call(C.CS, 'POST', '/api/orders', body);
  check('CS input order, harga dihitung server (10 m = 230.000)', r.status === 201 && r.data.total === 230000, r);
  const A = r.data.id, trackA = r.data.track_code;
  r = await call(C.CS, 'POST', '/api/orders', body);
  check('kirim ulang tidak membuat order ganda', r.data.duplicate === true && r.data.id === A, r);
  check('FAT tidak bisa input order', (await call(C.FAT, 'POST', '/api/orders', order({ customer_code: 'TK-0001' }))).status === 403);
  const get = async (id, cl = master) => (await state(cl)).orders.find((o) => o.dbId === id);
  const pay = (cl, id, amount, extra = {}) => call(cl, 'POST', `/api/orders/${id}/payments`, { amount, method: 'Transfer', request_key: key(), ...extra });
  const post = (cl, id, path, b = {}) => call(cl, 'POST', `/api/orders/${id}/${path}`, b);
  check('status awal menunggu cek file', (await get(A)).status === 'cek');
  check('mulai sebelum cek file ditolak', (await post(C.OPR, A, 'start')).status === 409);
  check('CS tidak bisa meloloskan file', (await post(C.CS, A, 'file-check', { ok: true, checks: [true, true, true, true] })).status === 403);
  check('file layak butuh semua butir', (await post(C.OPR, A, 'file-check', { ok: true, checks: [true, true, false, true] })).status === 400);
  r = await post(C.OPR, A, 'file-check', { ok: true, checks: [true, true, true, true] });
  check('operator meloloskan file; belum lunas tidak masuk antrian', r.status === 200 && r.data.released === false && (await get(A)).status === 'bayar', r);
  check('FAT tidak mencatat/verifikasi pembayaran', (await pay(C.FAT, A, 1000)).status === 403);
  r = await pay(C.CS, A, 100000);
  check('bayar sebagian: tetap tertahan', r.status === 201 && r.data.released === false, r);
  check('bayar melebihi sisa ditolak', (await pay(C.CS, A, 999999)).status === 409);
  const k = key();
  await pay(C.CS, A, 130000, { request_key: k });
  r = await pay(C.CS, A, 130000, { request_key: k });
  check('pembayaran tidak tercatat ganda', r.data.duplicate === true, r);
  let o = await get(A);
  check('lunas -> antrian cetak', o.status === 'antrian' && o.pay.reduce((a, p) => a + p.amount, 0) === 230000, o);

  console.log('# QC pagi: foto wajib, NG, persetujuan leader');
  check('mulai tanpa QC pagi ditolak', (await post(C.OPR, A, 'start')).status === 409);
  const morning = async (cl, machine, count, labels, ng = false, extra = {}) => {
    const photos = [];
    for (const label of labels) photos.push({ label, key: (await upload(cl, 'qc_photo', 'foto.jpg')).data.key });
    const answers = Array.from({ length: count }, (_, i) => (ng && i === 0 ? 'NG' : 'OK'));
    return call(cl, 'POST', '/api/qc/morning', { machine, answers, photos, ...extra });
  };
  const dtfLabels = ['Nozzle check', 'Test print', 'Hasil press'];
  check('foto wajib', (await morning(C.OPR, 'dtf', 8, ['Nozzle check'])).status === 400);
  check('NG tanpa temuan ditolak', (await morning(C.OPR, 'dtf', 8, dtfLabels, true)).status === 400);
  r = await morning(C.OPR, 'dtf', 8, dtfLabels, true, { note: 'kotor', action: 'dibersihkan' });
  check('laporan NG terkirim', r.status === 201, r);
  let q = (await state(C.SPV)).qcReports.at(-1);
  check('operator tidak bisa menyetujui', (await call(C.OPR, 'POST', `/api/qc/morning/${q.id}/decide`, { decision: 'siap' })).status === 403);
  check('laporan NG tidak dapat disetujui', (await call(C.SPV, 'POST', `/api/qc/morning/${q.id}/decide`, { decision: 'siap' })).status === 409);
  check('SPV menahan produksi', (await call(C.SPV, 'POST', `/api/qc/morning/${q.id}/decide`, { decision: 'tahan', note: 'perbaiki' })).status === 200);
  check('mulai saat ditahan ditolak', (await post(C.OPR, A, 'start')).status === 409);
  check('laporan baru setelah perbaikan', (await morning(C.OPR, 'dtf', 8, dtfLabels)).status === 201);
  check('mulai sebelum disetujui ditolak', (await post(C.OPR, A, 'start')).status === 409);
  q = (await state(C.SPV)).qcReports.at(-1);
  await call(C.SPV, 'POST', `/api/qc/morning/${q.id}/decide`, { decision: 'siap' });

  console.log('# Produksi DTF, QC, kemas, serah terima');
  r = await call(C.CS, 'POST', '/api/orders', order({ customer_code: 'TK-0001', meter: 2, paid_method: 'Tunai' }));
  const B = r.data.id;
  await post(C.OPR, B, 'file-check', { ok: true, checks: [true, true, true, true] });
  check('lunas saat input -> langsung antrian setelah file layak', (await get(B)).status === 'antrian');
  check('GDG mengisi stok film', (await call(C.GDG, 'POST', '/api/stock/move', { sku: 'SDP-DTF-FLM-60', type: 'Stok masuk', qty: 100 })).status === 201);
  check('stok tidak boleh minus lewat mutasi manual', (await call(C.GDG, 'POST', '/api/stock/move', { sku: 'SDP-DTF-FLM-60', type: 'Waste', qty: 500 })).status === 409);
  check('gudang mengatur pakai per meter', (await call(C.GDG, 'PUT', '/api/stock/sku/SDP-DTF-FLM-60', { min: 20, use: 1.05 })).status === 200);
  check('operator memulai cetak', (await post(C.OPR, B === 0 ? B : A, 'start')).status === 200);
  r = await post(C.OPR, B, 'start');
  check('satu mesin satu order', r.status === 409 && /Mesin/.test(r.data.error), r);
  check('selesai tanpa curing ditolak', (await post(C.OPR, A, 'finish', { temp: 140, seconds: 70 })).status === 409);
  check('lanjut curing', (await post(C.OPR, A, 'curing')).status === 200);
  check('suhu curing di luar standar ditolak', (await post(C.OPR, A, 'finish', { temp: 120, seconds: 70 })).status === 400);
  r = await post(C.OPR, A, 'finish', { temp: 140, seconds: 70 });
  check('curing selesai, stok terpotong', r.status === 200 && r.data.deducted === 1, r);
  check('stok film 100 - 10,5 = 89,5', (await state(C.GDG)).skus.find((s) => s.code === 'SDP-DTF-FLM-60').stock === 89.5);
  check('kemas sebelum QC ditolak', (await post(C.OPR, A, 'pack')).status === 409);
  check('QC lolos butuh semua butir', (await post(C.QC1, A, 'qc', { pass: true, checks: [true] })).status === 400);
  check('petugas QC meloloskan', (await post(C.QC1, A, 'qc', { pass: true, checks: [true, true, true, true, true] })).status === 200);
  check('operator mengemas', (await post(C.OPR, A, 'pack')).status === 200);
  check('serah terima butuh nama penerima', (await post(C.GDG, A, 'handover', {})).status === 400);
  check('gudang menyerahkan', (await post(C.GDG, A, 'handover', { receiver: 'Budi' })).status === 200);
  check('status selesai', (await get(A)).status === 'selesai');

  console.log('# Sublim: revisi, print, press, reject, cetak ulang');
  const art = (await upload(C.CS, 'artwork', 'desain.pdf')).data.key;
  r = await call(C.CS, 'POST', '/api/orders', order({ service: 'sub', width: 'priceSub160', meter: 20, customer_code: 'TK-0002', paid_method: 'QRIS', file_key: art }));
  check('order sublim dengan berkas unggahan', r.status === 201 && r.data.total === 520000, r);
  const S1 = r.data.id;
  check('operator mengunduh berkas', (await call(C.OPR, 'GET', '/api/files/' + art, undefined, { raw: true })).status === 200);
  check('FAT tidak bisa mengunduh artwork', (await call(C.FAT, 'GET', '/api/files/' + art)).status === 404);
  check('tidak layak butuh alasan', (await post(C.OPR, S1, 'file-check', { ok: false })).status === 400);
  await post(C.OPR, S1, 'file-check', { ok: false, issue: 'resolusi rendah' });
  check('status menunggu revisi', (await get(S1)).status === 'revisi');
  check('CS kirim revisi', (await post(C.CS, S1, 'revise', { file_ref: 'rev.pdf' })).status === 200);
  r = await post(C.OPR, S1, 'file-check', { ok: true, checks: [true, true, true, true] });
  check('sudah lunas -> antrian', r.data.released === true, r);
  for (const [machine, count, labels] of [['subp', 4, ['Nozzle check / test print']], ['cal', 3, ['Hasil press']]]) {
    await morning(C.OPR, machine, count, labels);
    q = (await state(C.SPV)).qcReports.at(-1);
    check('QC pagi ' + machine + ' disetujui', (await call(C.SPV, 'POST', `/api/qc/morning/${q.id}/decide`, { decision: 'siap' })).status === 200);
  }
  await post(C.OPR, S1, 'start');
  r = await post(C.OPR, S1, 'finish');
  check('print selesai lanjut press', r.data.next === 'press' && (await get(S1)).stage === 'cal', r);
  await post(C.OPR, S1, 'start');
  check('press butuh suhu dan waktu', (await post(C.OPR, S1, 'finish', {})).status === 400);
  await post(C.OPR, S1, 'finish', { temp: 200, seconds: 40 });
  check('reject melebihi hasil ditolak', (await post(C.OPR, S1, 'qc', { pass: false, reject_m: 99 })).status === 400);
  await post(C.OPR, S1, 'qc', { pass: false, reject_m: 3 });
  o = await get(S1);
  check('reject: antri cetak ulang 3 m dari tahap print', o.status === 'antrian' && o.stage === 'subp' && o.reworkM === 3, o);
  for (const [p, b] of [['start'], ['finish'], ['start'], ['finish', { temp: 200, seconds: 40 }]]) await post(C.OPR, S1, p, b);
  await post(C.OPR, S1, 'qc', { pass: true, checks: [true, true, true, true, true] });
  await post(C.OPR, S1, 'pack');
  await post(C.CS, S1, 'handover', { receiver: 'Andi' });
  check('sublim selesai setelah cetak ulang', (await get(S1)).status === 'selesai');
  check('Log QC tercatat', (await state(C.SPV)).loss.some((l) => l.type === 'Reject' && /3 m/.test(l.reason)));

  console.log('# Customer baru dan CRM');
  r = await call(C.CS, 'POST', '/api/orders', order({ name: 'Brand Baru', wa: '0899', paid_method: 'Transfer' }));
  const N = r.data.id;
  check('order customer baru dibuat', r.status === 201, r);
  r = await post(C.OPR, N, 'file-check', { ok: true, checks: [true, true, true, true] });
  check('ditahan sampai CRM memverifikasi', r.status === 409 && /CRM/.test(r.data.error), r);
  const cu = (await state(C.CRM)).customers.find((x) => x.name === 'Brand Baru');
  check('CS tidak bisa memverifikasi', (await call(C.CS, 'POST', `/api/customers/${cu.id}/decide`, { status: 'aktif' })).status === 403);
  check('CRM menyetujui', (await call(C.CRM, 'POST', `/api/customers/${cu.id}/decide`, { status: 'aktif' })).status === 200);
  check('setelah disetujui lanjut', (await post(C.OPR, N, 'file-check', { ok: true, checks: [true, true, true, true] })).status === 200);

  console.log('# Penolakan dan loss sales');
  r = await call(C.CS, 'POST', '/api/orders', order({ customer_code: 'TK-0001' }));
  await post(C.CS, r.data.id, 'reject', { reason: 'Double input' });
  r = await call(C.CS, 'POST', '/api/orders', order({ customer_code: 'TK-0001' }));
  await post(C.CS, r.data.id, 'reject', { reason: 'Customer batal' });
  const loss = (await state(C.SPV)).loss.filter((l) => l.type === 'Loss Sales');
  check('double input tidak dihitung loss sales', loss.filter((l) => l.count).length === 1 && loss.length === 2, loss);
  check('order antrian tidak bisa ditolak', (await post(C.CS, B, 'reject', { reason: 'Customer batal' })).status === 409);

  console.log('# Pembatasan data per peran');
  r = await call(C.STH, 'POST', '/api/orders', order({ type: 'retail', service: 'dtfr', qty: { 'DTF C': 12 }, name: 'Pembeli', wa: '0855', source: 'WhatsApp' }));
  check('Store Head input order retail 12 pcs = 276.000', r.status === 201 && r.data.total === 276000, r);
  const T = r.data.id;
  let st = await state(C.STH);
  check('Store Head hanya melihat order miliknya, sumber Toko', st.orders.length === 1 && st.orders[0].source === 'Toko' && st.orders[0].store === 'Toko STH', st.orders);
  check('Store Head lain tidak melihat', (await state(C.STH2)).orders.length === 0);
  check('Store Head lain tidak bisa membayar order itu', (await pay(C.STH2, T, 1000)).status === 404);
  check('Store Head mencatat pembayaran order sendiri', (await pay(C.STH, T, 276000)).status === 201);
  st = await state(C.GDG);
  check('gudang tidak menerima nomor telepon', st.orders.every((x) => x.wa === '') && st.users.length === 0);
  st = await state(C.FAT);
  check('FAT melihat pembayaran, tanpa stok dan pengguna', st.orders.some((x) => x.pay.length) && st.skus.length === 0 && st.users.length === 0);
  check('manager tidak bisa menjalankan produksi', (await post(C.MGR, B, 'start')).status === 403);
  check('manager tidak bisa mencatat mutasi', (await call(C.MGR, 'POST', '/api/stock/move', { sku: 'SDP-DTF-FLM-60', type: 'Stok masuk', qty: 1 })).status === 403);

  console.log('# Hak akses dan sesi');
  check('master mencabut menu produksi operator', (await call(master, 'PUT', '/api/admin/access', { role: 'op', pages: ['cekfile', 'qc'] })).status === 200);
  check('tindakan ikut dicabut', (await post(C.OPR, B, 'start')).status === 403);
  await call(master, 'DELETE', '/api/admin/access');
  check('dikembalikan: operator bisa lagi', (await post(C.OPR, B, 'start')).status === 200);
  check('menu master tidak bisa diberikan', (await call(master, 'PUT', '/api/admin/access', { role: 'cs', pages: ['pengguna'] })).status === 400);
  const uid = (await state(master)).users.find((u) => u.code === 'OPR').id;
  await call(master, 'PATCH', `/api/admin/users/${uid}`, { active: false });
  check('akun nonaktif: sesi dicabut', (await call(C.OPR, 'GET', '/api/state')).status === 401);

  console.log('# Lacak publik');
  r = await call(anon, 'GET', '/api/public/track/' + trackA);
  check('lacak tampil', r.status === 200 && r.data.status === 'selesai', r);
  check('tanpa data pribadi, harga, atau internal', !/Konveksi|0811|230000|price|CS|file|a\.cdr/.test(JSON.stringify(r.data)), r.data);
  check('resi salah 404', (await call(anon, 'GET', '/api/public/track/xxxxxxxxxxxxxxxxxxxxxx')).status === 404);
  r = await call(anon, 'GET', '/api/public/info');
  check('harga publik tersedia', r.data.settings.priceDtf === 23000, r.data);
  console.log('# Kelola Data (khusus master)');
  check('SPV tidak bisa mengelola data', (await call(C.SPV, 'DELETE', '/api/manage/orders/' + A)).status === 403);
  check('CS tidak bisa membersihkan data', (await call(C.CS, 'POST', '/api/manage/reset', { confirm: 'HAPUS SEMUA' })).status === 403);
  r = await call(C.CS, 'POST', '/api/orders', order({ customer_code: 'TK-0001', paid_method: 'Tunai' }));
  const E = r.data.id;
  check('master mengubah order', (await call(master, 'PATCH', '/api/manage/orders/' + E, { customer_name: 'Nama Baru', status: 'antrian', note: 'diubah' })).status === 200);
  o = await get(E);
  check('perubahan tersimpan', o.customer === 'Nama Baru' && o.status === 'antrian' && o.note === 'diubah', o);
  check('status tidak sah ditolak', (await call(master, 'PATCH', '/api/manage/orders/' + E, { status: 'xxx' })).status === 400);
  check('master menghapus pembayaran', (await call(master, 'DELETE', '/api/manage/payments/' + o.pay[0].id)).status === 200 && (await get(E)).pay.length === 0);
  check('pelanggan yang punya order tidak bisa dihapus', (await call(master, 'DELETE', '/api/manage/customers/1')).status === 409);
  const stockOf = async () => (await state(master)).skus.find((s) => s.code === 'SDP-DTF-FLM-60').stock;
  const before = await stockOf();
  check('master menghapus order selesai', (await call(master, 'DELETE', '/api/manage/orders/' + A)).status === 200 && !(await get(A)));
  check('pemakaian bahan order terhapus dikembalikan ke stok', Math.abs((await stockOf()) - before - 10.5) < 1e-6, [before, await stockOf()]);
  check('master mengubah stok', (await call(master, 'PUT', '/api/manage/stock/SDP-DTF-FLM-60', { stock: 42 })).status === 200 && (await stockOf()) === 42);
  let st2 = await state(master);
  check('master menghapus log', (await call(master, 'DELETE', '/api/manage/logs/' + st2.loss[0].logId)).status === 200);
  check('master menghapus laporan QC', (await call(master, 'DELETE', '/api/manage/qc/' + st2.qcReports[0].id)).status === 200);
  const spare = st2.users.find((u) => u.code === 'STH2');
  check('master mengubah nama akun', (await call(master, 'PATCH', '/api/admin/users/' + spare.id, { name: 'Toko Dua' })).status === 200);
  check('master menghapus akun tanpa berkas', (await call(master, 'DELETE', '/api/manage/users/' + spare.id)).status === 200);
  check('master tidak bisa menghapus dirinya', (await call(master, 'DELETE', '/api/manage/users/' + st2.users.find((u) => u.code === 'MASTER1').id)).status === 403);

  check('reset butuh kata konfirmasi', (await call(master, 'POST', '/api/manage/reset', { confirm: 'ya' })).status === 400);
  check('master membersihkan data simulasi', (await call(master, 'POST', '/api/manage/reset', { confirm: 'HAPUS SEMUA', customers: true })).status === 200);
  st2 = await state(master);
  check('data kosong, akun dan harga tetap', st2.orders.length === 0 && st2.customers.length === 0 && st2.qcReports.length === 0 && st2.skus.length === 14 && st2.skus.every((s) => s.stock === 0) && st2.users.length > 5 && st2.settings.priceDtf === 23000, st2);
  r = await call(C.CS, 'POST', '/api/orders', order({ name: 'Setelah Reset', wa: '0800' }));
  check('input order setelah reset berjalan', r.status === 201, r);
  for (let i = 0; i < 5; i++) await login(client(), 'MGR', 'salah-salah-1');
  check('login dibatasi setelah 5 gagal', (await login(client(), 'MGR', PW2)).status === 429);

  console.log(`\nHasil: ${pass} lolos, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
