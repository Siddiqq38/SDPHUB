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
  const blob = new Blob(['isi uji ' + name], { type: kind === 'qc_photo' ? 'image/jpeg' : 'application/pdf' });
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
  const FILM = 'SDP-DTF-FLM-60';
  const skuStock = async (code = FILM) => (await state(master)).skus.find((s) => s.code === code).stock;
  check('GDG membuat bin', (await call(C.GDG, 'POST', '/api/stock/bin', { code: 'a1.2', note: 'Rak A' })).status === 201);
  check('bin ganda ditolak', (await call(C.GDG, 'POST', '/api/stock/bin', { code: 'A1.2' })).status === 409);
  check('CS tidak mengubah master bin', (await call(C.CS, 'POST', '/api/stock/bin', { code: 'B1' })).status === 403);
  const gr = { request_key: key(), sku: FILM, batch: 'FLM001', rolls: 2, qty: 100, supplier: 'PT Pemasok' };
  r = await call(C.CS, 'POST', '/api/stock/gr', gr);
  check('CS melakukan GR, tiap roll punya ID', r.status === 201 && r.data.lots.join() === 'FLM001-01,FLM001-02', r);
  r = await call(C.CS, 'POST', '/api/stock/gr', gr);
  check('kirim ulang GR tidak menggandakan', r.data.duplicate === true && r.data.lots.length === 2, r);
  check('stok belum tersedia sebelum put away', (await skuStock()) === 0);
  check('pemakaian sebelum put away ditolak', (await call(C.OPR, 'POST', '/api/stock/use', { request_key: key(), lot: 'FLM001-01', produksi: 1 })).status === 409);
  check('bin tak terdaftar ditolak', (await call(C.OPR, 'POST', '/api/stock/putaway', { lot: 'FLM001-01', bin: 'Z9' })).status === 400);
  check('Operator put away', (await call(C.OPR, 'POST', '/api/stock/putaway', { lot: 'FLM001-01', bin: 'A1.2' })).status === 200);
  check('Manager put away', (await call(C.MGR, 'POST', '/api/stock/putaway', { lot: 'FLM001-02', bin: 'A1.2' })).status === 200);
  check('stok tersedia 200 setelah put away', (await skuStock()) === 200);
  check('bin berisi tidak bisa dihapus', (await call(C.GDG, 'POST', '/api/stock/bin', { code: 'A1.2', remove: true })).status === 409);
  check('pemakaian melebihi sisa ditolak', (await call(C.GDG, 'POST', '/api/stock/use', { request_key: key(), lot: 'FLM001-02', waste: 500, note: 'x' })).status === 409);
  check('reject tanpa keterangan ditolak', (await call(C.OPR, 'POST', '/api/stock/use', { request_key: key(), lot: 'FLM001-02', reject: 1 })).status === 400);

  r = await call(C.CS, 'POST', '/api/stock/sku', { code: 'KIM001', name: 'Kain Milano', machine: 'cal', unit: 'meter', min: 20 });
  check('CS tidak menambah SKU', r.status === 403, r);
  check('SPV menambah SKU kain', (await call(C.SPV, 'POST', '/api/stock/sku', { code: 'KIM001', name: 'Kain Milano', machine: 'cal', unit: 'meter', min: 20 })).status === 201);
  await call(C.CS, 'POST', '/api/stock/gr', { request_key: key(), sku: 'KIM001', batch: 'rcvkn001', rolls: 1, qty: 200, supplier: 'PT Kain' });
  await call(C.CS, 'POST', '/api/stock/putaway', { lot: 'RCVKN001-01', bin: 'A1.2' });
  const use = { request_key: key(), lot: 'RCVKN001-01', produksi: 99.9, test: 0.1, note: '10 cm untuk test print' };
  r = await call(C.OPR, 'POST', '/api/stock/use', use);
  check('contoh kain: 99,9 produksi + 0,1 test = sisa 100', r.status === 201 && r.data.left === 100 && (await skuStock('KIM001')) === 100, r);
  r = await call(C.OPR, 'POST', '/api/stock/use', use);
  check('kirim ulang pemakaian tidak memotong dua kali', r.data.duplicate === true && (await skuStock('KIM001')) === 100, r);
  check('CS tidak mencatat pemakaian', (await call(C.CS, 'POST', '/api/stock/use', { ...use, request_key: key() })).status === 403);
  check('opname hanya SPV', (await call(C.OPR, 'POST', '/api/stock/adjust', { lot: 'RCVKN001-01', qty: 98, note: 'x' })).status === 403);
  check('SPV opname', (await call(C.SPV, 'POST', '/api/stock/adjust', { lot: 'RCVKN001-01', qty: 98.5, note: 'hitung ulang' })).status === 200 && (await skuStock('KIM001')) === 98.5);
  check('tandai habis', (await call(C.OPR, 'POST', '/api/stock/empty', { lot: 'FLM001-02' })).status === 200 && (await skuStock()) === 100);
  const kain = (await state(C.OPR)).ledger.filter((l) => l.lot === 'RCVKN001-01').map((l) => l.type).reverse().join();
  check('kartu stok lengkap per roll', kain === 'GR,Put away,Produksi,Test print,Opname', kain);
  check('operator memulai cetak', (await post(C.OPR, B === 0 ? B : A, 'start')).status === 200);
  r = await post(C.OPR, B, 'start');
  check('satu mesin satu order', r.status === 409 && /Mesin/.test(r.data.error), r);
  check('selesai tanpa curing ditolak', (await post(C.OPR, A, 'finish', { temp: 140, seconds: 70 })).status === 409);
  check('lanjut curing', (await post(C.OPR, A, 'curing')).status === 200);
  check('suhu curing di luar standar ditolak', (await post(C.OPR, A, 'finish', { temp: 120, seconds: 70 })).status === 400);
  const plan = (await state(C.OPR)).materials;
  const needA = plan.needs.find((n) => n.id === A && n.stage === 'dtf');
  check('roll direkomendasikan untuk order berjalan', needA.picks.length === 1 && needA.picks[0].lot === 'FLM001-01' && needA.picks[0].take === 10 && needA.picks[0].bin === 'A1.2' && needA.short === 0, needA);
  check('bahan terbooking dihitung', plan.booked['SDP-DTF-FLM-60'] >= 12, plan.booked);
  check('selesai tanpa catatan roll ditolak', (await post(C.OPR, A, 'finish', { temp: 140, seconds: 70 })).status === 400);
  check('roll bahan lain ditolak', (await post(C.OPR, A, 'finish', { temp: 140, seconds: 70, materials: [{ lot: 'RCVKN001-01', produksi: 10 }] })).status === 400);
  check('pemakaian melebihi sisa ditolak saat selesai', (await post(C.OPR, A, 'finish', { temp: 140, seconds: 70, materials: [{ lot: 'FLM001-01', produksi: 900 }] })).status === 409);
  check('order tetap curing setelah ditolak', (await get(A)).status === 'curing' && (await skuStock()) === 100);
  r = await post(C.OPR, A, 'finish', { temp: 140, seconds: 70, materials: [{ lot: 'FLM001-01', produksi: 10, test: 0.5 }] });
  check('curing selesai, roll terpotong', r.status === 200 && r.data.next === 'qc' && r.data.rolls === 1 && (await skuStock()) === 89.5, r);
  const orderA = (await get(A)).id;
  check('kartu stok mencatat nomor order', (await state(C.OPR)).ledger.filter((l) => l.ref === orderA).length === 2);
  check('order tidak dikenal ditolak', (await call(C.OPR, 'POST', '/api/stock/use', { request_key: key(), lot: 'FLM001-01', produksi: 1, order_no: 'SDP-X' })).status === 400);
  check('kemas sebelum QC ditolak', (await post(C.OPR, A, 'pack')).status === 409);
  check('QC lolos butuh semua butir', (await post(C.QC1, A, 'qc', { pass: true, checks: [true] })).status === 400);
  check('petugas QC meloloskan', (await post(C.QC1, A, 'qc', { pass: true, checks: [true, true, true, true, true] })).status === 200);
  check('operator mengemas', (await post(C.OPR, A, 'pack')).status === 200);
  check('serah terima butuh nama penerima', (await post(C.GDG, A, 'handover', {})).status === 400);
  check('gudang menyerahkan', (await post(C.GDG, A, 'handover', { receiver: 'Budi' })).status === 200);
  check('status selesai', (await get(A)).status === 'selesai');

  console.log('# Sublim: revisi, print, press, reject, cetak ulang');
  const art = (await upload(C.CS, 'artwork', 'desain.pdf')).data.key;
  check('order sublim wajib memilih kain', (await call(C.CS, 'POST', '/api/orders', order({ service: 'sub', width: 'priceSub160', meter: 20, customer_code: 'TK-0002' }))).status === 400);
  r = await call(C.CS, 'POST', '/api/capacity/check', { service: 'sub', width: 'priceSub160', meter: 500, fabric_sku: 'KIM001', deadline: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) });
  check('cek kapasitas memperingatkan bahan kurang', r.data.materials.some((m) => m.stage === 'cal' && m.free < m.need), r);
  r = await call(C.CS, 'POST', '/api/orders', order({ service: 'sub', width: 'priceSub160', meter: 20, customer_code: 'TK-0002', paid_method: 'QRIS', file_key: art, fabric_sku: 'KIM001' }));
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
  check('press wajib mencatat kain', (await post(C.OPR, S1, 'finish', { temp: 200, seconds: 40 })).status === 400);
  await post(C.OPR, S1, 'finish', { temp: 200, seconds: 40, materials: [{ lot: 'RCVKN001-01', produksi: 20 }] });
  check('reject melebihi hasil ditolak', (await post(C.OPR, S1, 'qc', { pass: false, reject_m: 99 })).status === 400);
  await post(C.OPR, S1, 'qc', { pass: false, reject_m: 3 });
  o = await get(S1);
  check('reject: antri cetak ulang 3 m dari tahap print', o.status === 'antrian' && o.stage === 'subp' && o.reworkM === 3, o);
  for (const [p, b] of [['start'], ['finish'], ['start'], ['finish', { temp: 200, seconds: 40, materials: [{ lot: 'RCVKN001-01', produksi: 3 }] }]]) await post(C.OPR, S1, p, b);
  check('kain terpotong 20 + 3 meter', (await skuStock('KIM001')) === 75.5);
  await post(C.OPR, S1, 'qc', { pass: true, checks: [true, true, true, true, true] });
  await post(C.OPR, S1, 'pack');
  await post(C.CS, S1, 'handover', { receiver: 'Andi' });
  check('sublim selesai setelah cetak ulang', (await get(S1)).status === 'selesai');
  check('Log QC tercatat', (await state(C.SPV)).loss.some((l) => l.type === 'Reject' && /3 m/.test(l.reason)));

  console.log('# Customer baru tanpa verifikasi, resi, dan jam deadline');
  const wita = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  const soon = wita(Date.now() + 5 * 864e5);
  r = await call(C.CS, 'POST', '/api/orders', order({ name: 'Brand Baru', wa: '0899', paid_method: 'Transfer', deadline: soon }));
  const N = r.data.id, resi = r.data.track_code;
  check('order customer baru dibuat', r.status === 201, r);
  check('resi otomatis berformat RS-XXXXX-XXXXX', /^RS-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(resi), resi);
  check('jam deadline tersimpan', (await get(N)).deadline === soon);
  for (const bad of ['2026-11-27 25:00', '27/11/2026', '2026-11-27 12']) {
    check('deadline tidak valid ditolak: ' + bad, (await call(C.CS, 'POST', '/api/orders', order({ customer_code: 'TK-0001', deadline: bad }))).status === 400);
  }
  check('langsung bisa dicek Operator tanpa CRM', (await post(C.OPR, N, 'file-check', { ok: true, checks: [true, true, true, true] })).status === 200);
  check('customer baru berstatus aktif', (await call(C.CRM, 'POST', '/api/customers/search', { q: 'brand baru' })).data.rows[0].active === 1);
  r = await call(anon, 'GET', '/api/public/track/' + resi.toLowerCase());
  check('lacak dengan resi, huruf kecil diterima', r.status === 200 && r.data.status === 'antrian', r);
  check('resi acak lain 404', (await call(anon, 'GET', '/api/public/track/RS-00000-00000')).status === 404);
  check('versi server dikirim', (await state(C.CS)).api === 11);

  console.log('# Kapasitas produksi');
  let cap = (await state(C.CS)).capacity;
  const first = cap.days.find((d) => d.machine === 'dtf');
  check('jadwal 7 hari kerja, 155,3 m per hari penuh', cap.days.filter((d) => d.machine === 'dtf').length === 7 && cap.days.some((d) => d.machine === 'dtf' && d.capacity === 155.3), first);
  const ask = { service: 'dtfm', meter: 5 };
  r = await call(C.CS, 'POST', '/api/capacity/check', { ...ask, deadline: soon });
  check('cek kapasitas: muat sebelum deadline', r.status === 200 && r.data.fits === true && r.data.ready > Date.now(), r);
  r = await call(C.CS, 'POST', '/api/capacity/check', { service: 'dtfm', meter: 900, deadline: wita(Date.now() + 864e5) });
  check('cek kapasitas: 900 m besok tidak muat, ada saran jadwal', r.data.fits === false && /^\d{4}-\d\d-\d\d \d\d:(00|30)$/.test(r.data.suggest), r);
  const suggest = r.data.suggest;
  r = await call(C.CS, 'POST', '/api/orders', order({ customer_code: 'TK-0001', meter: 900, deadline: wita(Date.now() + 864e5) }));
  check('server menolak order melebihi kapasitas', r.status === 409 && /Kapasitas tidak cukup/.test(r.data.error), r);
  r = await call(C.CS, 'POST', '/api/capacity/check', { service: 'dtfm', meter: 900, deadline: suggest });
  check('jadwal saran diterima', r.data.fits === true, r);
  check('FAT tidak bisa cek kapasitas', (await call(C.FAT, 'POST', '/api/capacity/check', ask)).status === 403);
  check('loss sales ditolak bila kapasitas masih ada', (await call(C.CS, 'POST', '/api/capacity/loss', { ...ask, deadline: soon, name: 'X' })).status === 400);
  r = await call(C.CS, 'POST', '/api/capacity/loss', { service: 'dtfm', meter: 900, deadline: wita(Date.now() + 864e5), name: 'Konveksi Penuh' });
  check('loss sales kapasitas tercatat tanpa order', r.status === 201 && (await state(C.SPV)).loss.some((l) => l.id === '-' && l.value === 900 * 23000 && /Kapasitas penuh: Konveksi Penuh/.test(l.reason)), r);
  const lemburDay = soon.slice(0, 10);
  const capOf = async () => (await state(C.SPV)).capacity.days.find((d) => d.machine === 'dtf' && d.day === lemburDay)?.capacity ?? 0;
  const capBefore = await capOf();
  check('CS tidak bisa menambah lembur', (await call(C.CS, 'POST', '/api/capacity/overtime', { day: lemburDay, start: '21:30', end: '23:00', reason: 'x' })).status === 403);
  check('jam lembur terbalik ditolak', (await call(C.SPV, 'POST', '/api/capacity/overtime', { day: lemburDay, start: '23:00', end: '21:30', reason: 'x' })).status === 400);
  check('SPV menambah lembur', (await call(C.SPV, 'POST', '/api/capacity/overtime', { day: lemburDay, start: '21:00', end: '23:00', reason: 'order besar' })).status === 200);
  const after = await capOf();
  check('lembur menambah kapasitas tanpa hitung dobel', after > capBefore, { capBefore, after });
  await call(C.SPV, 'POST', '/api/capacity/overtime', { day: lemburDay, remove: true });
  check('lembur dihapus', (await capOf()) === capBefore);
  check('jam produksi salah ditolak', (await call(master, 'PUT', '/api/admin/settings', { work_blocks: '13:00-12:00' })).status === 400);
  check('persen kapasitas di atas 100 ditolak', (await call(master, 'PUT', '/api/admin/settings', { capPct: 120 })).status === 400);

  console.log('# Penolakan dan loss sales');
  r = await call(C.CS, 'POST', '/api/orders', order({ customer_code: 'TK-0001' }));
  await post(C.CS, r.data.id, 'reject', { reason: 'Double input' });
  r = await call(C.CS, 'POST', '/api/orders', order({ customer_code: 'TK-0001' }));
  await post(C.CS, r.data.id, 'reject', { reason: 'Customer batal' });
  const loss = (await state(C.SPV)).loss.filter((l) => l.type === 'Loss Sales' && l.id !== '-');
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
  check('manager tidak mencatat pemakaian', (await call(C.MGR, 'POST', '/api/stock/use', { request_key: key(), lot: 'FLM001-01', produksi: 1 })).status === 403);

  console.log('# Hak akses dan sesi');
  check('master mencabut menu produksi operator', (await call(master, 'PUT', '/api/admin/access', { role: 'op', pages: ['cekfile', 'qc'] })).status === 200);
  check('tindakan ikut dicabut', (await post(C.OPR, B, 'start')).status === 403);
  await call(master, 'DELETE', '/api/admin/access');
  check('dikembalikan: operator bisa lagi', (await post(C.OPR, B, 'start')).status === 200);
  check('menu master tidak bisa diberikan', (await call(master, 'PUT', '/api/admin/access', { role: 'cs', pages: ['pengguna'] })).status === 400);
  const uid = (await state(master)).users.find((u) => u.code === 'OPR').id;
  await call(master, 'PATCH', `/api/admin/users/${uid}`, { active: false });
  check('akun nonaktif: sesi dicabut', (await call(C.OPR, 'GET', '/api/state')).status === 401);

  console.log('# Foto QC');
  const bad = SHEETS
    ? await call(C.QC1, 'POST', '/api/files/upload', { kind: 'qc_photo', file_name: 'a.pdf', content_type: 'application/pdf', data: Buffer.from('x').toString('base64') })
    : await call(C.QC1, 'POST', '/api/files/init', { kind: 'qc_photo', file_name: 'a.pdf', content_type: 'application/pdf', size_bytes: 1 });
  check('foto QC selain gambar ditolak', bad.status === 400, bad);
  if (SHEETS) {
    const send = (cl, kind, mb, type) => call(cl, 'POST', '/api/files/upload', { kind, label: 'Printer DTF Nozzle check', file_name: 'IMG_1.jpg', content_type: type, data: Buffer.alloc(mb * 1048576, 7).toString('base64') });
    r = await send(C.QC1, 'qc_photo', 12, 'image/jpeg');
    check('foto 12 MB diterima utuh', r.status === 201 && r.data.size_bytes === 12 * 1048576 && r.data.drive_id && r.data.shared === true, r.data?.error ?? r.status);
    check('foto di atas 20 MB ditolak', (await send(C.QC1, 'qc_photo', 21, 'image/jpeg')).status === 400);
    check('berkas customer tetap maksimal 8 MB', (await send(C.CS, 'artwork', 9, 'application/pdf')).status === 400);
    const files = await (await fetch(BASE + '/__drive')).json();
    const photo = files.find((f) => f.size === 12 * 1048576);
    check('foto masuk folder QC Pagi per tanggal', /^SDP\/QC Pagi\/\d{4}-\d\d\/\d{4}-\d\d-\d\d$/.test(photo.path) && /^\d{4}-\d\d-\d\d_\d{6}_Printer-DTF-Nozzle-check_QC1\.jpg$/.test(photo.name), photo);
    check('hanya foto QC yang dibagikan lewat tautan', files.every((f) => !!f.shared === f.path.includes('QC Pagi')) && photo.shared === 'LINK/VIEW', files.filter((f) => f.shared).length);
    check('laporan QC membawa tautan Drive', (await state(C.SPV)).qcReports.every((q) => q.photos.every((p) => p.drive)));
  }

  console.log('# Analysis');
  const today = (await state(master)).today;
  const ana = (cl, period, date = today) => call(cl, 'POST', '/api/analytics', { period, date });
  r = await ana(C.MGR, 'day');
  const day = r.data?.current;
  check('manager melihat rekap harian', r.status === 200 && day.summary.orders > 3 && day.summary.value > 0 && day.summary.paid > 0, r);
  check('ketepatan waktu dan lead time dihitung', day.ready.count >= 2 && day.ready.pct !== null && day.ready.leadHours !== null, day.ready);
  check('reject dan pemakaian bahan masuk rekap', day.quality.rejectM === 3 && day.quality.testM >= 0.5 && day.quality.produced >= 30, day.quality);
  check('utilisasi mesin DTF dihitung', day.machines.find((m) => m.machine === 'dtf').meter >= 10, day.machines);
  check('loss sales dikelompokkan', day.loss.reasons.some((x) => x.reason === 'Kapasitas penuh') && day.loss.reasons.some((x) => x.reason === 'Customer batal') && !day.loss.reasons.some((x) => x.reason === 'Double input'), day.loss);
  check('penjualan per layanan cocok dengan total', day.sales.service.reduce((a, x) => a + x.value, 0) === day.summary.value && day.sales.top.length > 0, day.sales);
  for (const p of ['week', 'month', 'year']) {
    r = await ana(C.SPV, p);
    check('rekap ' + p + ' memuat data hari ini', r.status === 200 && r.data.current.summary.orders >= day.summary.orders && r.data.from <= today && r.data.to >= today && r.data.previousTo < r.data.from, r.data?.from);
  }
  const trends = {};
  for (const p of ['day', 'week', 'month', 'year']) trends[p] = (await ana(C.SPV, p)).data;
  check('tren: 14 hari, 7 hari, sebulan, 12 bulan', trends.day.trend.length === 14 && trends.week.trend.length === 7 && trends.month.trend.length >= 28 && trends.year.trend.length === 12, Object.values(trends).map((x) => x.trend?.length));
  for (const p of ['week', 'month', 'year']) check('tren ' + p + ' berjumlah sama dengan ringkasan', trends[p].trend.reduce((a, x) => a + x.value, 0) === trends[p].current.summary.value && trends[p].trend.reduce((a, x) => a + x.paid, 0) === trends[p].current.summary.paid);
  check('tren harian berakhir di tanggal terpilih', trends.day.trend.at(-1).key === today && trends.day.trend.at(-1).value === trends.day.current.summary.value);
  check('FAT boleh melihat Analysis', (await ana(C.FAT, 'month')).status === 200);
  check('CS tidak boleh melihat Analysis', (await ana(C.CS, 'day')).status === 403);
  check('tanggal tidak valid ditolak', (await ana(C.MGR, 'day', '2026-13-45')).status === 400);

  console.log('# Database customer');
  const find = async (cl, body = {}) => (await call(cl, 'POST', '/api/customers/search', body)).data;
  const old = '2024-01-05', recent = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const rows = Array.from({ length: 120 }, (_, i) => ({ name: 'MK01 Toko ' + String(i).padStart(3, '0'), wa: i % 2 ? '6281100000' + String(i).padStart(3, '0') : undefined, city: 'Makassar', since: '2022-03-01', last_visit: i < 100 ? recent : old, visits: i, spending: 1000 * i }));
  r = await call(C.CRM, 'POST', '/api/customers/bulk', { rows });
  check('impor massal 120 customer', r.status === 201 && r.data.added === 120 && r.data.updated === 0, r);
  r = await call(C.CRM, 'POST', '/api/customers/bulk', { rows: [{ name: 'mk01  toko 000', wa: '628999000111', last_visit: old }, { name: 'MK02 Baru', category: 'Konveksi', kind: 'B2B' }] });
  check('impor ulang memperbarui tanpa menggandakan', r.data.added === 1 && r.data.updated === 1, r);
  let list = await find(C.CRM, { q: 'toko 000' });
  check('ID CUS, nomor terisi, kunjungan terbaru dipertahankan', list.total === 1 && /^CUS-\d{5}$/.test(list.rows[0].code) && list.rows[0].wa === '628999000111' && list.rows[0].last_visit === recent && list.rows[0].city === 'Makassar', list.rows[0]);
  list = await find(C.CRM, { status: 'inactive', q: 'mk01' });
  check('tidak aktif bila kunjungan lebih dari 1 tahun', list.total === 20 && list.rows.every((x) => x.active === 0), list.total);
  list = await find(C.CRM, { q: 'mk01', page: 2 });
  check('halaman 50 baris', list.total === 120 && list.rows.length === 20 && list.size === 50, list.rows.length);
  const two = (await find(C.CRM, { q: 'toko 00' })).rows.slice(0, 2).map((x) => x.id);
  check('ubah tipe dan kategori massal', (await call(C.CRM, 'POST', '/api/customers/update', { ids: two, kind: 'B2B', category: 'Sablon' })).status === 200 && (await find(C.CRM, { category: 'Sablon', kind: 'B2B' })).total === 2);
  check('operator tidak membuka database customer', (await call(C.QC1, 'POST', '/api/customers/search', {})).status === 403);
  check('Store Head tidak mengimpor', (await call(C.STH, 'POST', '/api/customers/bulk', { rows: [{ name: 'x' }] })).status === 403);
  check('daftar customer tidak lagi dikirim di state', (await state(C.CS)).customers.length === 0 && (await state(C.CS)).customerCount > 120);
  const vip = (await find(C.CS, { q: 'toko 119' })).rows[0];
  r = await call(C.CS, 'POST', '/api/orders', order({ type: 'retail', customer_code: vip.code }));
  check('order retail memakai customer terdaftar dan membuatnya aktif', r.status === 201 && (await find(C.CS, { q: 'toko 119' })).rows[0].active === 1, r);

  console.log('# Yield PET film');
  const filmAt = async () => (await call(C.MGR, 'POST', '/api/analytics', { period: 'day', date: today })).data.current.film;
  const filmBefore = await filmAt();
  check('film: print bagus, test print, dan yield dihitung', filmBefore.good > 0 && filmBefore.test >= 0.5 && filmBefore.total >= filmBefore.good && filmBefore.yield > 0 && filmBefore.yield <= 100, filmBefore);
  const stockBefore = (await state(master)).skus.find((x) => x.code === 'SDP-DTF-FLM-60').stock;
  r = await call(C.SPV, 'POST', '/api/stock/reclass', { order_no: orderA, type: 'Refund', meter: 2, reason: 'Refund customer' });
  const filmAfter = await filmAt();
  check('refund memindahkan produksi tanpa mengubah stok', r.status === 201 && filmAfter.refund === 2 && filmAfter.good === Math.round((filmBefore.good - 2) * 10) / 10 && filmAfter.total === filmBefore.total && (await state(master)).skus.find((x) => x.code === 'SDP-DTF-FLM-60').stock === stockBefore, { r: r.data, filmAfter });
  check('pindahan melebihi produksi ditolak', (await call(C.SPV, 'POST', '/api/stock/reclass', { order_no: orderA, type: 'Reject', meter: 500, reason: 'x' })).status === 409);
  check('alasan tercatat', filmAfter.reasons.some((x) => x.type === 'Refund' && x.reason === 'Refund customer' && x.meter === 2), filmAfter.reasons);

  console.log('# Laporan Harian');
  const daily = (cl, date = today) => call(cl, 'POST', '/api/daily', { date });
  r = await daily(C.STH);
  const dtf = r.data?.checks?.filter((x) => x.service === 'dtf' && x.result === 'lolos') ?? [];
  check('order lolos QC masuk laporan harian beserta nama customer', r.status === 200 && dtf.some((x) => x.customer === 'Konveksi Uji' && x.by === 'QC1' && [1, 2].includes(x.shift)), r);
  check('reject tercatat dengan meternya', r.data.checks.some((x) => x.result === 'reject' && x.service === 'sub' && x.rejectM === 3), r.data.checks);
  check('QC pagi hari ini masuk laporan', r.data.morning.length >= 3 && r.data.morning.every((q) => q.photos.length >= 1 && (!SHEETS || q.photos.every((p) => p.drive))), r.data.morning.length);
  check('tanpa nomor telepon dan harga', !/0811|230000|"wa"|total/.test(JSON.stringify(r.data)));
  const items = r.data.items;
  const done = items.find((x) => x.order_no === orderA);
  check('order selesai produksi terekap otomatis dengan meter', done && done.meter === 10 && done.finishedAt > 0 && done.result === 'lolos' && done.customer === 'Konveksi Uji', done);
  check('cetak ulang yang lolos tercatat sekali beserta meter reject', items.filter((x) => x.rejectM === 3).length === 1 && items.find((x) => x.rejectM === 3).result === 'lolos', items);
  check('tiap order muncul satu kali', new Set(items.map((x) => x.order_no)).size === items.length);
  check('CS tidak mengirim laporan shift', (await call(C.CS, 'POST', '/api/daily/submit', { date: today, shift: '1', service: 'dtf' })).status === 403);
  check('petugas QC mengirim laporan shift', (await call(C.QC1, 'POST', '/api/daily/submit', { date: today, shift: '1', service: 'dtf', note: 'awal' })).status === 201);
  await call(C.SPV, 'POST', '/api/daily/submit', { date: today, shift: '1', service: 'dtf', note: 'sudah sesuai' });
  r = await daily(C.MGR);
  check('kirim ulang memakai laporan terbaru', r.data.submissions.length === 1 && r.data.submissions[0].note === 'sudah sesuai' && r.data.submissions[0].by === 'SPV', r.data.submissions);
  const ymd = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  r = await call(C.MGR, 'POST', '/api/daily', { from: ymd(-6), to: today });
  check('rentang 7 hari memuat order hari ini beserta tanggalnya', r.status === 200 && r.data.items.length > 0 && r.data.items.every((x) => x.day === today) && r.data.morning.every((q) => q.day), r.data?.items?.[0]);
  check('rentang terbalik ditolak', (await call(C.MGR, 'POST', '/api/daily', { from: today, to: ymd(-1) })).status === 400);
  check('rentang lebih dari 31 hari ditolak', (await call(C.MGR, 'POST', '/api/daily', { from: ymd(-40), to: today })).status === 400);
  check('tanggal depan ditolak', (await call(C.QC1, 'POST', '/api/daily/submit', { date: '2099-01-01', shift: '1', service: 'dtf' })).status === 400);
  check('gudang tidak melihat laporan harian', (await daily(C.GDG)).status === 403);
  check('jam shift tidak valid ditolak', (await call(master, 'PUT', '/api/admin/settings', { shift2_start: '25:00' })).status === 400);
  await call(master, 'PUT', '/api/admin/settings', { shift2_start: '00:00' });
  check('jam mulai shift 2 mengubah pembagian', (await daily(C.MGR)).data.checks.every((x) => x.shift === 2));
  await call(master, 'PUT', '/api/admin/settings', { shift2_start: '16:30' });
  const extra = [];
  for (const label of ['Nozzle check', 'Test print', 'Hasil press', 'Bukti tambahan 1', 'Label tak dikenal']) extra.push({ label, key: (await upload(C.QC1, 'qc_photo', 'x.jpg')).data.key });
  await call(master, 'DELETE', '/api/manage/qc/' + (await state(master)).qcReports.filter((q) => q.machine === 'dtf').at(-1).id);
  r = await call(C.QC1, 'POST', '/api/qc/morning', { machine: 'dtf', answers: Array(8).fill('OK'), photos: extra });
  const last = (await daily(C.MGR)).data.morning.filter((q) => q.machine === 'dtf').at(-1);
  check('bukti tambahan disimpan, label asing diabaikan', r.status === 201 && last.photos.map((p) => p.label).join() === 'Nozzle check,Test print,Hasil press,Bukti tambahan 1', last?.photos);

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
  check('master menghapus roll', (await call(master, 'DELETE', '/api/manage/lots/FLM001-01')).status === 200 && (await stockOf()) === 0);
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
  check('data kosong, akun dan harga tetap', st2.orders.length === 0 && (await call(master, 'POST', '/api/customers/search', {})).data.total === 0 && st2.qcReports.length === 0 && st2.skus.length === 15 && st2.lots.length === 0 && st2.bins.length === 1 && st2.skus.every((s) => s.stock === 0) && st2.users.length > 5 && st2.settings.priceDtf === 23000, st2);
  r = await call(C.CS, 'POST', '/api/orders', order({ name: 'Setelah Reset', wa: '0800' }));
  check('input order setelah reset berjalan', r.status === 201, r);
  const fresh = (await call(master, 'POST', '/api/daily', { date: (await state(master)).today })).data;
  check('riwayat order lama tidak menempel pada order baru', fresh.checks.length === 0 && (await call(master, 'POST', '/api/analytics', { period: 'day', date: fresh.date })).data.current.ready.count === 0, fresh.checks);
  for (let i = 0; i < 5; i++) await login(client(), 'MGR', 'salah-salah-1');
  check('login dibatasi setelah 5 gagal', (await login(client(), 'MGR', PW2)).status === 429);

  console.log(`\nHasil: ${pass} lolos, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
