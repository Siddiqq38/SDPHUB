'use strict';
// SDP - Tigalapan Operations System: frontend tanpa build. Semua data dinamis dirender lewat textContent.
const root = document.getElementById('app');
let me = null;
let info = null;

const fmtDT = (ms) => (ms ? new Date(ms).toLocaleString('id-ID', { timeZone: 'Asia/Makassar', dateStyle: 'medium', timeStyle: 'short' }) + ' WITA' : '-');
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const SVC = { DTF: 'DTF - print transfer', SUBLIM_KERTAS: 'Sublim - print kertas', SUBLIM_KAIN: 'Sublim - print dan transfer kain' };
const ROLE = { master: 'Master', supervisor: 'Penanggung jawab', cs: 'CS', crm: 'CRM', operator: 'Operator', gudang: 'Gudang', qc: 'QC', fat: 'FAT/Finance', customer: 'Customer' };
const STATUS_TAG = { selesai: 'ok', aktif: 'ok', siap: 'ok', dibatalkan: 'bad', ditolak: 'bad', tahan_produksi: 'bad' };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const tag = (s) => h('span', { class: 'tag ' + (STATUS_TAG[s] || '') }, String(s).replaceAll('_', ' '));
const msgBox = () => h('div');
function flash(box, text, ok) { box.replaceChildren(h('div', { class: 'msg ' + (ok ? 'okk' : 'err') }, text)); }

async function api(method, path, body, raw) {
  const headers = {};
  let payload;
  if (me?.csrf && method !== 'GET') headers['X-CSRF-Token'] = me.csrf;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* kosong */ }
  if (res.status === 401 && me) { me = null; location.hash = '#/login'; throw new Error('Sesi berakhir, silakan login lagi'); }
  if (!res.ok) throw new Error(data?.error || 'Permintaan gagal (' + res.status + ')');
  return data;
}

// Pembungkus aksi: tampilkan hasil/galat pada box, lalu jalankan callback.
function act(box, fn, after) {
  return async (e) => {
    const btn = e?.currentTarget;
    if (btn) btn.disabled = true;
    try { const r = await fn(); if (r?.message) flash(box, r.message, true); if (after) await after(r); }
    catch (err) { flash(box, err.message, false); }
    finally { if (btn) btn.disabled = false; }
  };
}
const field = (label, input) => h('div', {}, h('label', {}, label), input);
const inp = (name, type = 'text', extra = {}) => h('input', { name, type, ...extra });
const sel = (name, opts) => h('select', { name }, opts.map(([v, t]) => h('option', { value: v }, t)));
const val = (form, n) => form.elements[n]?.value?.trim();
const num = (form, n) => (val(form, n) === '' || val(form, n) == null ? null : Number(val(form, n)));
function table(cols, rows) {
  return h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c[0])))),
    h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, cols.map((c) => h('td', {}, c[1](r))))) : h('tr', {}, h('td', { colspan: cols.length, class: 'muted' }, 'Belum ada data'))));
}
function toMs(localValue) { return localValue ? Date.parse(localValue + ':00+08:00') : null; } // input datetime-local dianggap WITA

// ---------- Situs publik ----------
function publicShell(content) {
  return h('div', {},
    h('header', { class: 'top' }, h('div', { class: 'wrap' },
      h('a', { class: 'brand', href: '#/' }, info?.settings?.brand_name || 'SDP'),
      h('a', { href: '#/lacak' }, 'Lacak pesanan'), h('a', { href: '/simulasi.html' }, 'Simulasi alur'),
      h('a', { class: 'btn', href: '#/login' }, 'Login Member'), h('a', { class: 'btn primary', href: '#/daftar' }, 'Daftar New Member'))),
    h('div', { class: 'wrap' }, content));
}

function viewHome() {
  const s = info?.settings || {};
  return publicShell([
    h('section', { class: 'hero' },
      h('h1', {}, s.company_name || 'PT Tigalapan Sukses Indonesia'),
      h('p', {}, 'Jasa maklon DTF dan sublimasi untuk bisnis: usaha sablon, konveksi, pembuat jersey, brand, dan reseller jasa. Anda memesan jasa, kami memproses sesuai lingkup layanan, lalu hasil diserahkan kepada Anda.')),
    h('h2', {}, 'Layanan'),
    h('div', { class: 'grid' },
      (info?.services || []).length ? info.services.map((v) => h('div', { class: 'card' }, h('h3', {}, v.name), h('p', { class: 'muted' }, 'Hasil: ' + v.output_label))) : h('p', { class: 'muted' }, 'Belum ada layanan aktif.')),
    h('p', { class: 'muted small' }, 'Harga, kapasitas, dan estimasi waktu diberikan CS setelah pesanan dikonfirmasi.'),
    h('div', { class: 'card' }, h('h2', {}, 'Sistem member'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Daftar online, atau datang ke workshop dan dibantu CS.'),
        h('li', {}, 'CS menghubungi dan memverifikasi data Anda.'),
        h('li', {}, 'Tim CRM melakukan survei.'),
        h('li', {}, 'Master menyetujui, lalu akun member aktif dan dapat membuat pesanan.')),
      h('p', { class: 'muted small' }, 'Pelanggan dibedakan In City dan Out City. Akun yang masih menunggu belum dapat membuat pesanan.')),
    h('div', { class: 'card' }, h('h2', {}, 'Informasi workshop dan kontak'),
      s.workshop_info || s.contact_info ? [h('p', {}, s.workshop_info), h('p', {}, s.contact_info)] : h('p', { class: 'muted' }, 'Informasi akan ditampilkan setelah diisi oleh master.')),
  ]);
}

function viewRegister() {
  const box = msgBox();
  const form = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() },
    h('h2', {}, 'Daftar New Member'),
    field('Nama bisnis', inp('business_name', 'text', { required: true })), field('Nama PIC', inp('pic_name', 'text', { required: true })),
    field('Kontak / WhatsApp', inp('contact', 'tel', { required: true })), field('Email (opsional)', inp('email', 'email')),
    field('Alamat lengkap', h('textarea', { name: 'address', rows: 2, required: true })), field('Jenis usaha', inp('business_type', 'text', { required: true, placeholder: 'mis. konveksi, sablon, brand' })),
    field('Wilayah', sel('city_scope', [['in_city', 'In City'], ['out_city', 'Out City']])),
    field('Username', inp('username', 'text', { required: true, minlength: 3 })), field('Password (min. 10 karakter, huruf dan angka)', inp('password', 'password', { required: true, minlength: 10 })),
    h('label', {}, h('input', { type: 'checkbox', name: 'consent_contact', style: 'width:auto;margin-right:6px' }), 'Saya setuju dihubungi untuk proses verifikasi'),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'primary', type: 'submit' }, 'Kirim pendaftaran')), box);
  form.addEventListener('submit', act(box, async () => {
    const f = form.elements;
    const r = await api('POST', '/api/public/register', {
      business_name: val(form, 'business_name'), pic_name: val(form, 'pic_name'), contact: val(form, 'contact'), email: val(form, 'email') || undefined,
      address: val(form, 'address'), business_type: val(form, 'business_type'), city_scope: val(form, 'city_scope'), username: val(form, 'username'),
      password: f.password.value, consent_contact: f.consent_contact.checked,
    });
    form.reset();
    return { message: r.message };
  }));
  return publicShell(h('div', { style: 'max-width:520px;margin:24px auto' }, form));
}

function viewLogin() {
  const box = msgBox();
  const form = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() }, h('h2', {}, 'Login'),
    field('Username', inp('username', 'text', { required: true, autocomplete: 'username' })),
    field('Password', inp('password', 'password', { required: true, autocomplete: 'current-password' })),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'primary', type: 'submit' }, 'Masuk')), box);
  form.addEventListener('submit', act(box, async () => {
    await api('POST', '/api/auth/login', { username: val(form, 'username'), password: form.elements.password.value });
    me = await api('GET', '/api/auth/me');
    location.hash = me.must_change ? '#/app/akun' : '#/app/' + defaultView();
  }));
  return publicShell(h('div', { style: 'max-width:420px;margin:24px auto' }, form));
}

function viewTrack(code) {
  const box = h('div');
  const form = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() }, h('h2', {}, 'Lacak pesanan'),
    field('Resi tracking SDP', inp('code', 'text', { required: true, value: code || '' })),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'primary', type: 'submit' }, 'Cari')));
  const run = act(box, async () => {
    const d = await api('GET', '/api/public/track/' + encodeURIComponent(val(form, 'code')));
    box.replaceChildren(h('div', { class: 'card' }, h('h3', {}, d.status),
      table([['Hasil', (i) => i.output], ['Qty baik', (i) => i.qty_baik + ' ' + i.unit], ['Sudah diserahkan', (i) => i.qty_diserahkan + ' ' + i.unit]], d.items),
      h('p', { class: 'muted' }, 'Janji selesai: ' + fmtDT(d.janji_selesai) + ' | Estimasi: ' + (d.estimasi_selesai ? fmtDT(d.estimasi_selesai) : 'Belum diatur'))));
  });
  form.addEventListener('submit', run);
  if (code) setTimeout(() => form.dispatchEvent(new Event('submit')), 0);
  return publicShell(h('div', { style: 'max-width:640px;margin:24px auto' }, form, box,
    h('p', { class: 'muted small' }, 'Ini resi tracking SDP, bukan nomor order dan bukan resi kurir. Hanya ringkasan status yang ditampilkan.')));
}

// ---------- Ruang kerja ----------
const MENU = [
  ['dashboard', 'Dashboard', ['master', 'supervisor', 'cs', 'crm', 'qc', 'fat', 'gudang']],
  ['pesanan', 'Pesanan Maklon', ['customer', 'cs', 'master', 'supervisor', 'crm', 'qc', 'fat', 'gudang', 'operator']],
  ['pendaftaran', 'Pendaftaran Member', ['cs', 'crm', 'master']],
  ['tugas', 'Attendance dan Task', ['operator']],
  ['produksi', 'Production dan Planning', ['master', 'supervisor', 'cs', 'qc']],
  ['qc-mesin', 'QC Kesiapan Mesin', ['operator', 'qc', 'supervisor', 'master']],
  ['qc-hasil', 'QC Hasil', ['qc']],
  ['inventory', 'Inventory dan Bahan Titipan', ['gudang', 'master', 'supervisor']],
  ['finance', 'Finance', ['fat', 'cs', 'master']],
  ['komplain', 'Complaint dan Loss Sales', ['cs', 'qc', 'supervisor', 'master', 'crm']],
  ['master', 'Master Data dan Settings', ['master']],
  ['akun', 'Akun', ['master', 'supervisor', 'cs', 'crm', 'operator', 'gudang', 'qc', 'fat', 'customer']],
];
const visibleMenu = () => MENU.filter((m) => m[2].includes(me.role));
const defaultView = () => (me.role === 'customer' ? 'pesanan' : me.role === 'operator' ? 'tugas' : 'dashboard');

function shell(viewId, content) {
  return h('div', { class: 'shell' },
    h('nav', { class: 'side' }, h('p', { class: 'small muted' }, (me.employee?.full_name || me.customer?.business_name || me.username) + ' - ' + ROLE[me.role]),
      visibleMenu().map(([id, label]) => h('a', { href: '#/app/' + id, class: id === viewId ? 'on' : '' }, label)),
      h('a', { href: '#', onclick: async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout', {}); me = null; location.hash = '#/'; } }, 'Keluar')),
    h('main', { class: 'work' }, content));
}

async function vDashboard() {
  const d = await api('GET', '/api/prod/dashboard');
  const st = (label, n) => h('div', { class: 'card' }, h('div', { class: 'stat' }, n), h('div', { class: 'muted' }, label));
  return h('div', {}, h('h1', {}, 'Dashboard'),
    h('h3', {}, 'Hambatan'), h('div', { class: 'grid' }, st('Menunggu CS', d.hambatan.menunggu_cs), st('Menunggu rilis penanggung jawab', d.hambatan.menunggu_rilis), st('Item belum ada artwork disetujui', d.hambatan.item_belum_artwork_disetujui)),
    h('h3', {}, 'Produksi'), h('div', { class: 'grid' }, st('Siap dijadwalkan', d.siap_dijadwalkan), st('WO berjalan', d.wo_berjalan), st('WO menunggu', d.wo_menunggu), st('Hasil siap / sebagian diserahkan', d.hasil_siap_atau_sebagian_diserahkan), st('Lewat deadline customer', d.lewat_deadline)),
    h('h3', {}, 'Output baik, reject, rework per layanan dan satuan'),
    table([['Layanan', (r) => SVC[r.service_code]], ['Satuan', (r) => r.prod_unit], ['Baik', (r) => r.good], ['Reject', (r) => r.reject], ['Rework', (r) => r.rework]], d.output_per_layanan_dan_satuan),
    h('p', { class: 'muted small' }, 'Satuan berbeda tidak dijumlahkan.'));
}

async function vOrders() {
  const rows = await api('GET', '/api/orders');
  const box = msgBox();
  const list = table([['No. order', (o) => h('a', { href: '#/app/order/' + o.id }, o.order_no)], ['Customer', (o) => o.business_name], ['Layanan', (o) => (o.services || '').split(',').map((s) => SVC[s]).join(', ')],
    ['Status', (o) => tag(o.status)], ['Deadline customer', (o) => fmtDT(o.customer_deadline)]], rows);
  const parts = [h('h1', {}, 'Pesanan Maklon'), box, h('div', { class: 'card' }, list)];
  if (me.role === 'customer' || me.role === 'cs') parts.splice(2, 0, newOrderForm(box));
  return h('div', {}, parts);
}

function newOrderForm(box) {
  const itemRow = () => h('div', { class: 'card item' },
    field('Layanan', sel('service_code', [['DTF', SVC.DTF], ['SUBLIM_KERTAS', SVC.SUBLIM_KERTAS], ['SUBLIM_KAIN', SVC.SUBLIM_KAIN]])),
    h('div', { class: 'grid' }, field('Jumlah pesanan', inp('order_qty', 'number', { step: 'any', min: 0, required: true })), field('Satuan pesanan', inp('order_unit', 'text', { value: 'meter', required: true })),
      field('Satuan produksi', inp('prod_unit', 'text', { value: 'meter', required: true })), field('Satuan penagihan', inp('bill_unit', 'text', { value: 'meter', required: true }))),
    h('div', { class: 'grid' }, field('Faktor order→produksi (bila satuan beda)', inp('prod_per_order', 'number', { step: 'any' })), field('Faktor order→tagih (bila satuan beda)', inp('bill_per_order', 'number', { step: 'any' })),
      field('Lebar bahan (mm)', inp('media_width_mm', 'number')), field('Lebar cetak efektif (mm)', inp('print_width_mm', 'number'))),
    h('div', { class: 'grid' }, field('Ukuran desain / repeat', inp('design_size')), field('Jenis bahan', inp('material_type')), field('Pemilik bahan', sel('material_owner', [['sdp', 'SDP'], ['customer', 'Customer (titipan)']])), field('Bentuk hasil', inp('output_form'))));
  const items = h('div', {}, itemRow());
  const form = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() }, h('h2', {}, 'Buat pesanan'),
    me.role === 'cs' ? field('ID customer', inp('customer_id', 'number', { required: true })) : null,
    h('div', { class: 'grid' }, field('Referensi PO / proyek', inp('po_ref')), field('Deadline (WITA)', inp('deadline', 'datetime-local')), field('Prioritas', sel('priority', [['normal', 'Normal'], ['rendah', 'Rendah'], ['tinggi', 'Tinggi'], ['urgent', 'Urgent']]))),
    field('Deskripsi / catatan', h('textarea', { name: 'description', rows: 2 })), field('Referensi pemesan akhir (opsional)', inp('end_customer_ref')),
    h('h3', {}, 'Item layanan'), items,
    h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => items.append(itemRow()) }, '+ Tambah item'), h('button', { class: 'primary', type: 'submit' }, 'Kirim pesanan')));
  form.addEventListener('submit', act(box, async () => {
    const its = [...items.querySelectorAll('.item')].map((el) => {
      const g = (n) => el.querySelector(`[name=${n}]`).value.trim();
      const n = (k) => (g(k) === '' ? undefined : Number(g(k)));
      return { service_code: g('service_code'), order_qty: Number(g('order_qty')), order_unit: g('order_unit'), prod_unit: g('prod_unit'), bill_unit: g('bill_unit'), prod_per_order: n('prod_per_order'), bill_per_order: n('bill_per_order'),
        media_width_mm: n('media_width_mm'), print_width_mm: n('print_width_mm'), design_size: g('design_size') || undefined, material_type: g('material_type') || undefined, material_owner: g('material_owner'), output_form: g('output_form') || undefined };
    });
    const r = await api('POST', '/api/orders', { customer_id: num(form, 'customer_id') ?? undefined, po_ref: val(form, 'po_ref') || undefined, customer_deadline: toMs(val(form, 'deadline')) ?? undefined, priority: val(form, 'priority'),
      description: val(form, 'description') || undefined, end_customer_ref: val(form, 'end_customer_ref') || undefined, items: its });
    location.hash = '#/app/order/' + r.id;
  }));
  return form;
}

// Unggah dua langkah: izin dari server -> unggah langsung ke storage (bukan lewat server) -> konfirmasi.
async function uploadFile(kind, file, extra) {
  const init = await api('POST', '/api/files/init', { kind, file_name: file.name, content_type: file.type || 'application/octet-stream', size_bytes: file.size, ...(extra || {}) });
  const { url, method, fields, file_field } = init.upload;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set(file_field, file, file.name);
  const put = await fetch(url, { method, body: fd });
  if (!put.ok) throw new Error('Unggah ke penyimpanan gagal (' + put.status + ')');
  return api('POST', '/api/files/confirm', { key: init.key });
}

async function vOrderDetail(id) {
  const o = await api('GET', '/api/orders/' + id);
  const box = msgBox();
  const reload = () => render();
  const R = me.role;
  const parts = [h('p', {}, h('a', { href: '#/app/pesanan' }, '← Daftar pesanan')),
    h('h1', {}, o.order_no, ' ', tag(o.status)), box];
  parts.push(h('div', { class: 'card' }, h('p', {}, 'Customer: ', o.customer.business_name, ' (', o.customer.code, ')'),
    h('p', {}, 'Masuk: ', fmtDT(o.received_at), ' | Deadline customer: ', fmtDT(o.customer_deadline), ' | Janji SDP: ', fmtDT(o.sdp_promise_at)),
    o.needs_reconfirm ? h('div', { class: 'msg err' }, 'Proyeksi melewati deadline customer. CS wajib mengonfirmasi ulang; deadline tidak diubah otomatis.') : null,
    o.tracking_code ? h('p', { class: 'small' }, 'Resi tracking SDP: ', h('code', {}, o.tracking_code), ' ', h('a', { href: '#/lacak/' + o.tracking_code }, 'buka')) : null));

  for (const it of o.items) {
    const arts = o.artworks.filter((a) => a.item_id === it.id);
    const card = h('div', { class: 'card' }, h('h3', {}, 'Item #', it.id, ' - ', SVC[it.service_code]),
      h('p', {}, 'Pesanan: ', it.order_qty, ' ', it.order_unit, ' → produksi ', it.prod_unit, ' | bahan: ', it.material_owner === 'customer' ? 'titipan customer' : 'SDP'),
      h('h4', {}, 'Artwork'),
      table([['Versi', (a) => 'v' + a.version + (a.id === it.approved_artwork_id ? ' (produksi)' : '')], ['Status', (a) => tag(a.preflight_status)], ['File', (a) => h('a', { href: '/api/prod/artworks/' + a.id + '/file' }, a.file_name)],
        ['Persetujuan PIC', (a) => (a.approved_by_pic ? a.approved_by_pic + ', ' + fmtDT(a.approved_at) : '-')],
        ['Aksi', (a) => (['cs', 'master'].includes(R) && a.preflight_status !== 'disetujui' ? artworkActions(a, box, reload) : '')]], arts));
    if (['customer', 'cs', 'master'].includes(R) && !['selesai', 'dibatalkan'].includes(o.status)) card.append(artworkUpload(it, o, box, reload));
    if (['cs', 'supervisor', 'master'].includes(R) && ['dirilis', 'berjalan', 'serah_terima_sebagian'].includes(o.status) && it.approved_artwork_id) card.append(woForm(o, it, box, reload));
    if (['gudang', 'cs', 'qc'].includes(R) && ['berjalan', 'selesai_produksi', 'serah_terima_sebagian'].includes(o.status)) card.append(handoverForm(o, it, box, reload));
    parts.push(card);
  }
  if (R !== 'customer') parts.push(h('div', { class: 'card' }, h('h3', {}, 'Work Order'),
    table([['WO', (w) => w.wo_no], ['Tahap', (w) => w.stage], ['Mesin', (w) => w.machine_code], ['Qty', (w) => w.planned_qty + ' ' + w.planned_unit], ['Status', (w) => tag(w.status)],
      ['Estimasi selesai', (w) => (w.est_end_at ? fmtDT(w.est_end_at) + (w.est_manual ? ' (manual)' : '') : 'Belum diatur')], ['Baseline', (w) => (w.est_initial_end_at ? fmtDT(w.est_initial_end_at) : '-')],
      ['Durasi mentah / efektif', (w) => (w.raw_duration_s != null ? Math.round(w.raw_duration_s / 60) + ' / ' + Math.round(w.effective_s / 60) + ' menit' : '-')]], o.work_orders)));

  const actions = h('div', { class: 'card row' });
  if (R === 'cs' && ['menunggu_cs', 'menunggu_rilis'].includes(o.status)) actions.append(csValidateForm(o, box, reload));
  if (['supervisor', 'master'].includes(R) && o.status === 'menunggu_rilis') actions.append(h('button', { class: 'primary', onclick: act(box, () => api('POST', `/api/orders/${o.id}/release`, {}), reload) }, 'Setujui rilis produksi'));
  if (['cs', 'supervisor', 'master'].includes(R) && ['dirilis', 'berjalan', 'serah_terima_sebagian'].includes(o.status)) actions.append(h('button', { onclick: act(box, () => api('POST', `/api/prod/orders/${o.id}/finish-production`, {}), reload) }, 'Tandai produksi selesai'));
  if (['cs', 'supervisor', 'master'].includes(R) && ['serah_terima_sebagian', 'selesai_produksi'].includes(o.status)) actions.append(h('button', { class: 'primary', onclick: act(box, () => api('POST', `/api/orders/${o.id}/close`, {}), reload) }, 'Tutup order'));
  if ((R === 'customer' || ['cs', 'master', 'supervisor'].includes(R)) && ['menunggu_cs', 'menunggu_rilis', 'dirilis'].includes(o.status)) actions.append(h('button', { class: 'danger', onclick: act(box, () => api('POST', `/api/orders/${o.id}/cancel`, {}), reload) }, 'Batalkan pesanan'));
  if (actions.children.length) parts.push(actions);
  return h('div', {}, parts);
}

function artworkActions(a, box, reload) {
  const note = h('input', { placeholder: 'Catatan / PIC / referensi bukti' });
  const pic = h('input', { placeholder: 'Nama PIC yang menyetujui' });
  return h('div', {}, note,
    h('div', { class: 'row', style: 'margin-top:4px' },
      a.preflight_status !== 'menunggu_persetujuan' ? h('button', { onclick: act(box, () => api('POST', `/api/prod/artworks/${a.id}/review`, { status: 'menunggu_persetujuan', preflight_note: note.value }), reload) }, 'Lolos periksa') : null,
      h('button', { onclick: act(box, () => api('POST', `/api/prod/artworks/${a.id}/review`, { status: 'perlu_revisi', preflight_note: note.value }), reload) }, 'Perlu revisi')),
    a.preflight_status === 'menunggu_persetujuan' ? h('div', { style: 'margin-top:6px' }, pic, h('button', { class: 'primary', onclick: act(box, () => api('POST', `/api/prod/artworks/${a.id}/approve`, { approved_by_pic: pic.value, approval_ref: note.value }), reload) }, 'Catat persetujuan PIC')) : null);
}

function artworkUpload(it, o, box, reload) {
  const file = h('input', { type: 'file' });
  const impact = h('input', { placeholder: it.approved_artwork_id ? 'Dampak revisi: biaya, bahan, deadline (wajib)' : 'Catatan ukuran/repeat (opsional)' });
  return h('div', { class: 'row', style: 'margin-top:8px' }, file, impact, h('button', { onclick: act(box, async () => {
    if (!file.files[0]) throw new Error('Pilih file artwork dulu');
    const up = await uploadFile('artwork', file.files[0], me.role === 'customer' ? {} : { customer_id: o.customer_id });
    await api('POST', `/api/prod/items/${it.id}/artworks`, { file_key: up.key, ...(it.approved_artwork_id ? { revision_impact_note: impact.value } : { size_note: impact.value || undefined }) });
  }, reload) }, 'Unggah versi artwork'));
}

function csValidateForm(o, box, reload) {
  const f = h('form', { onsubmit: (e) => e.preventDefault(), style: 'width:100%' }, h('h3', {}, 'Validasi CS'),
    h('label', {}, h('input', { type: 'checkbox', name: 'd', style: 'width:auto;margin-right:6px' }), 'Detail sudah dikonfirmasi ke PIC customer'),
    field('Referensi bukti / PIC konfirmasi', inp('ref')),
    h('label', {}, h('input', { type: 'checkbox', name: 'p', style: 'width:auto;margin-right:6px' }), 'Kebijakan pembayaran sudah diperiksa'),
    h('label', {}, h('input', { type: 'checkbox', name: 'dl', style: 'width:auto;margin-right:6px' }), 'Deadline layak'),
    field('Janji selesai SDP (WITA, opsional)', inp('promise', 'datetime-local')), field('Catatan validasi', h('textarea', { name: 'note', rows: 2 })),
    h('button', { class: 'primary', type: 'submit' }, 'Simpan validasi'));
  f.addEventListener('submit', act(box, () => api('POST', `/api/orders/${o.id}/cs-validate`, { detail_confirmed: f.elements.d.checked, confirm_ref: val(f, 'ref'), payment_policy_checked: f.elements.p.checked,
    deadline_feasible: f.elements.dl.checked, validation_note: val(f, 'note'), sdp_promise_at: toMs(val(f, 'promise')) ?? undefined }), reload));
  return f;
}

function woForm(o, it, box, reload) {
  const f = h('form', { onsubmit: (e) => e.preventDefault(), class: 'row', style: 'margin-top:8px' });
  const stages = it.service_code === 'DTF' ? [['print_film', 'Print film']] : it.service_code === 'SUBLIM_KERTAS' ? [['print_kertas', 'Print kertas']] : [['print_kertas', 'Print kertas'], ['transfer_calender', 'Transfer calender']];
  f.append(sel('stage', stages), inp('machine_id', 'number', { placeholder: 'ID mesin', required: true, style: 'width:90px' }), inp('planned_qty', 'number', { step: 'any', placeholder: 'Qty (' + it.prod_unit + ')', required: true, style: 'width:120px' }),
    inp('assigned_to', 'number', { placeholder: 'ID operator', style: 'width:110px' }), h('button', { type: 'submit' }, 'Buat WO'));
  f.addEventListener('submit', act(box, () => api('POST', `/api/prod/orders/${o.id}/work-orders`, { item_id: it.id, stage: val(f, 'stage'), machine_id: num(f, 'machine_id'), planned_qty: num(f, 'planned_qty'), assigned_to: num(f, 'assigned_to') ?? undefined }), reload));
  return f;
}

function handoverForm(o, it, box, reload) {
  const f = h('form', { onsubmit: (e) => e.preventDefault(), class: 'row', style: 'margin-top:8px' },
    inp('label', 'text', { placeholder: 'Paket / rol', required: true, style: 'width:120px' }), inp('qty', 'number', { step: 'any', placeholder: 'Qty diserahkan', required: true, style: 'width:130px' }),
    inp('receiver', 'text', { placeholder: 'Nama penerima', required: true, style: 'width:150px' }), inp('courier', 'text', { placeholder: 'Resi kurir (opsional)', style: 'width:150px' }), h('button', { type: 'submit' }, 'Catat serah terima'));
  f.addEventListener('submit', act(box, async () => {
    const r = await api('POST', `/api/prod/orders/${o.id}/handover`, { item_id: it.id, package_label: val(f, 'label'), qty_this: num(f, 'qty'), received_by_name: val(f, 'receiver'), courier_receipt: val(f, 'courier') || undefined });
    return { message: `Tercatat. Kumulatif ${r.qty_cumulative}, sisa hasil ${r.remaining_result}, sisa pekerjaan ${r.remaining_work}.` };
  }, reload));
  return f;
}

async function vMembers() {
  const rows = await api('GET', '/api/applications');
  const box = msgBox();
  const reload = () => render();
  const actions = (a) => {
    const note = h('input', { placeholder: 'Catatan' });
    if (a.status === 'menunggu_cs' && me.role === 'cs') return h('div', {}, note, h('button', { onclick: act(box, () => api('POST', `/api/applications/${a.id}/cs`, { note: note.value }), reload) }, 'Catat kontak/verifikasi'));
    if (['menunggu_survei', 'menunggu_acc'].includes(a.status) && me.role === 'crm') return h('div', {}, note, h('button', { onclick: act(box, () => api('POST', `/api/applications/${a.id}/survey`, { note: note.value, feasible: true }), reload) }, 'Survei layak'), h('button', { class: 'danger', onclick: act(box, () => api('POST', `/api/applications/${a.id}/survey`, { note: note.value, feasible: false }), reload) }, 'Tidak layak'));
    if (['menunggu_cs', 'menunggu_survei', 'menunggu_acc'].includes(a.status) && me.role === 'master') {
      const code = h('input', { placeholder: 'Kode customer baru (atau kosong bila link)' });
      const link = h('input', { type: 'number', placeholder: 'ID customer lama (opsional)' });
      return h('div', {}, code, link, note, h('button', { class: 'primary', onclick: act(box, () => api('POST', `/api/applications/${a.id}/decide`, { approve: true, note: note.value, customer_code: code.value || undefined, link_customer_id: link.value ? Number(link.value) : undefined }), reload) }, 'ACC'),
        h('button', { class: 'danger', onclick: act(box, () => api('POST', `/api/applications/${a.id}/decide`, { approve: false, note: note.value }), reload) }, 'Tolak'));
    }
    return '';
  };
  const parts = [h('h1', {}, 'Pendaftaran Member'), box];
  if (me.role === 'cs') parts.push(workshopForm(box, reload));
  parts.push(h('div', { class: 'card' }, table([['Bisnis', (a) => h('div', {}, a.business_name, h('div', { class: 'small muted' }, a.pic_name + ' | ' + a.contact + ' | ' + (a.city_scope === 'in_city' ? 'In City' : 'Out City') + ' | ' + a.source))],
    ['Status', (a) => tag(a.status)], ['CS', (a) => (a.cs_at ? a.cs_note : '-')], ['Survei CRM', (a) => (a.crm_at ? (a.crm_feasible ? 'Layak: ' : 'Tidak layak: ') + a.crm_note : '-')], ['Aksi', actions]], rows)));
  return h('div', {}, parts);
}

function workshopForm(box, reload) {
  const f = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() }, h('h3', {}, 'Daftarkan customer yang datang ke workshop'),
    h('div', { class: 'grid' }, field('Nama bisnis', inp('business_name')), field('Nama PIC', inp('pic_name')), field('Kontak', inp('contact')), field('Jenis usaha', inp('business_type')),
      field('Alamat', inp('address')), field('Wilayah', sel('city_scope', [['in_city', 'In City'], ['out_city', 'Out City']])), field('Username', inp('username')), field('Password awal', inp('password', 'password'))),
    h('label', {}, h('input', { type: 'checkbox', name: 'consent', style: 'width:auto;margin-right:6px' }), 'Customer setuju dihubungi untuk verifikasi'), h('button', { type: 'submit' }, 'Daftarkan (tetap melalui verifikasi dan survei)'));
  f.addEventListener('submit', act(box, () => api('POST', '/api/applications/workshop', { business_name: val(f, 'business_name'), pic_name: val(f, 'pic_name'), contact: val(f, 'contact'), business_type: val(f, 'business_type'),
    address: val(f, 'address'), city_scope: val(f, 'city_scope'), username: val(f, 'username'), password: f.elements.password.value, consent_contact: f.elements.consent.checked }), reload));
  return f;
}

async function vTasks() {
  const [wos, att] = await Promise.all([api('GET', '/api/prod/wo'), api('GET', '/api/master/attendance/today')]);
  const box = msgBox();
  const reload = () => render();
  const mine = att.find((a) => a.user_id === me.id);
  const out = h('input', { type: 'number', step: 'any', placeholder: 'Qty output', style: 'width:110px' });
  return h('div', {}, h('h1', {}, 'Attendance dan Task'), box,
    h('div', { class: 'card row' }, h('span', {}, 'Status hari ini: ', mine ? (mine.check_out_at ? 'Sudah check-out' : mine.standby ? 'Check-in, Standby' : 'Check-in, belum Standby') : 'Belum check-in'),
      h('button', { onclick: act(box, () => api('POST', '/api/master/attendance/checkin', {}), reload) }, 'Check-in'),
      h('button', { onclick: act(box, () => api('POST', '/api/master/attendance/standby', { standby: !mine?.standby }), reload) }, mine?.standby ? 'Keluar Standby' : 'Standby'),
      h('button', { onclick: act(box, () => api('POST', '/api/master/attendance/checkout', {}), reload) }, 'Check-out')),
    h('div', { class: 'card' }, h('h3', {}, 'Tugas saya'), out, table([['WO', (w) => w.wo_no], ['Order', (w) => w.order_no], ['Tahap', (w) => w.stage], ['Mesin', (w) => w.machine_code], ['Qty', (w) => w.planned_qty + ' ' + w.planned_unit], ['Status', (w) => tag(w.status)],
      ['Aksi', (w) => (w.status === 'menunggu' ? h('button', { class: 'primary', onclick: act(box, () => api('POST', `/api/prod/wo/${w.id}/start`, {}), reload) }, 'Mulai')
        : w.status === 'berjalan' ? h('button', { class: 'primary', onclick: act(box, () => api('POST', `/api/prod/wo/${w.id}/finish`, { qty_out: Number(out.value) }), reload) }, 'Selesai') : '')]], wos)));
}

async function vMachineQC() {
  const ms = await api('GET', '/api/prod/machines/status');
  const box = msgBox();
  const holder = h('div');
  const open = async (m) => {
    const items = await api('GET', `/api/prod/machines/${m.id}/checklist`);
    const f = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() }, h('h3', {}, 'QC kesiapan ', m.code, ' (', m.kind, ')'),
      items.map((i) => h('div', { class: 'row', 'data-key': i.key }, h('strong', { style: 'min-width:260px' }, i.label), h('label', {}, h('input', { type: 'radio', name: 'r_' + i.key, value: 'ok', style: 'width:auto' }), ' OK'),
        h('label', {}, h('input', { type: 'radio', name: 'r_' + i.key, value: 'ng', style: 'width:auto' }), ' NG'), i.photo ? h('input', { type: 'file', name: 'p_' + i.key, accept: 'image/*' }) : null)),
      field('Temuan (wajib bila ada NG)', h('textarea', { name: 'finding', rows: 2 })), field('Tindakan awal (wajib bila ada NG)', h('textarea', { name: 'action', rows: 2 })), h('button', { class: 'primary', type: 'submit' }, 'Kirim laporan'));
    f.addEventListener('submit', act(box, async () => {
      const checklist = [];
      for (const i of items) {
        const r = f.querySelector(`[name=r_${i.key}]:checked`);
        if (!r) throw new Error(`Isi OK/NG untuk "${i.label}"`);
        const e = { key: i.key, ok: r.value === 'ok' };
        const file = i.photo ? f.querySelector(`[name=p_${i.key}]`).files[0] : null;
        if (file) e.photo_key = (await uploadFile('qc_photo', file)).key;
        checklist.push(e);
      }
      const r = await api('POST', `/api/prod/machines/${m.id}/qc`, { checklist, finding: val(f, 'finding') || undefined, action_note: val(f, 'action') || undefined });
      return { message: 'Laporan tersimpan. Kesimpulan: ' + r.conclusion.replace('_', ' ') };
    }, () => render()));
    holder.replaceChildren(f);
  };
  return h('div', {}, h('h1', {}, 'QC Kesiapan Mesin'), box, h('div', { class: 'card' }, table([['Mesin', (m) => m.code + ' - ' + m.name], ['Jenis', (m) => m.kind], ['QC hari ini', (m) => (m.qc_today ? tag(m.qc_today) : 'Belum ada')], ['WO berjalan', (m) => m.running_wo || '-'],
    ['Aksi', (m) => (['operator', 'qc'].includes(me.role) ? h('button', { onclick: () => open(m).catch((e) => flash(box, e.message)) }, 'Buat laporan') : '')]], ms)), holder);
}

async function vProduction() {
  const wos = await api('GET', '/api/prod/wo');
  const ops = me.role === 'master' ? [] : [];
  void ops;
  const att = await api('GET', '/api/master/attendance/today');
  return h('div', {}, h('h1', {}, 'Production dan Planning'),
    h('div', { class: 'card' }, h('h3', {}, 'Operator hari ini'), table([['Operator', (a) => a.full_name + ' (ID ' + a.user_id + ')'], ['Check-in', (a) => fmtDT(a.check_in_at)], ['Standby', (a) => (a.standby && !a.check_out_at ? 'Ya' : 'Tidak')], ['WO aktif', (a) => a.active_wo]], att)),
    h('div', { class: 'card' }, h('h3', {}, 'Antrean dan WO'), table([['WO', (w) => w.wo_no], ['Order', (w) => h('a', { href: '#/app/order/' + w.order_id }, w.order_no)], ['Mesin', (w) => w.machine_code], ['Operator', (w) => w.operator_name || '-'], ['Status', (w) => tag(w.status)],
      ['Estimasi', (w) => (w.est_end_at ? fmtDT(w.est_end_at) : 'Belum diatur')]], wos)));
}

async function vQCResult() {
  const wos = (await api('GET', '/api/prod/wo')).filter((w) => w.status === 'selesai' && !w.qc_count);
  const box = msgBox();
  const rows = wos.map((w) => {
    const f = h('form', { class: 'row', onsubmit: (e) => e.preventDefault() }, sel('verdict', [['pass', 'Pass'], ['rework', 'Rework'], ['reject', 'Reject'], ['hold', 'Hold']]),
      inp('good', 'number', { step: 'any', placeholder: 'Baik', style: 'width:80px' }), inp('rej', 'number', { step: 'any', placeholder: 'Reject', style: 'width:80px' }), inp('rw', 'number', { step: 'any', placeholder: 'Rework', style: 'width:80px' }), h('button', { type: 'submit' }, 'Simpan QC'));
    f.addEventListener('submit', act(box, () => api('POST', `/api/prod/wo/${w.id}/qc`, { verdict: val(f, 'verdict'), qty_initial: w.out_total, qty_good_final: num(f, 'good') ?? 0, qty_reject: num(f, 'rej') ?? 0, qty_rework: num(f, 'rw') ?? 0 }), () => render()));
    return h('div', { class: 'card' }, h('strong', {}, w.wo_no), ' - output awal ', w.out_total, ' ', w.planned_unit, f);
  });
  return h('div', {}, h('h1', {}, 'QC Hasil'), box, rows.length ? rows : h('p', { class: 'muted' }, 'Tidak ada WO yang menunggu QC hasil.'), h('p', { class: 'muted small' }, 'Baik + Reject + Rework harus sama dengan output awal agar tidak terhitung ganda.'));
}

async function vInventory() {
  const lots = await api('GET', '/api/stock/lots');
  const box = msgBox();
  const f = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() }, h('h3', {}, 'Receiving'),
    h('div', { class: 'grid' }, field('Roll ID', inp('roll')), field('SKU', inp('sku')), field('Pemilik', sel('owner', [['sdp', 'SDP'], ['customer', 'Customer (titipan)']])), field('ID customer (bila titipan)', inp('cid', 'number')), field('Satuan', inp('unit', 'text', { value: 'meter' })),
      field('Jumlah dinyatakan', inp('decl', 'number', { step: 'any' })), field('Hasil ukur', inp('meas', 'number', { step: 'any' })), field('Kondisi', inp('cond')), field('Lokasi', inp('loc'))),
    h('label', {}, h('input', { type: 'checkbox', name: 'diff', style: 'width:auto;margin-right:6px' }), 'Selisih dinyatakan vs ukur sudah dikonfirmasi'), h('button', { type: 'submit' }, 'Terima barang'));
  f.addEventListener('submit', act(box, () => api('POST', '/api/stock/lots', { roll_id: val(f, 'roll'), sku: val(f, 'sku'), owner: val(f, 'owner'), customer_id: num(f, 'cid') ?? undefined, unit: val(f, 'unit'), declared_qty: num(f, 'decl'), measured_qty: num(f, 'meas'),
    diff_confirmed: f.elements.diff.checked, condition: val(f, 'cond') || undefined, location: val(f, 'loc') || undefined }), () => render()));
  const sdp = lots.filter((l) => l.owner === 'sdp'), cust = lots.filter((l) => l.owner === 'customer');
  const cols = [['Roll', (l) => l.roll_id], ['SKU', (l) => l.sku], ['Lokasi', (l) => l.location || '-'], ['Stok fisik', (l) => l.on_hand + ' ' + l.unit], ['Reservasi', (l) => l.reserved], ['Tersedia', (l) => l.available]];
  return h('div', {}, h('h1', {}, 'Inventory dan Bahan Titipan'), box, f, h('div', { class: 'card' }, h('h3', {}, 'Inventory SDP'), table(cols, sdp)),
    h('div', { class: 'card' }, h('h3', {}, 'Bahan titipan customer (tidak masuk nilai persediaan SDP)'), table([['Customer', (l) => l.customer_name], ...cols], cust)));
}

async function vFinance() {
  const orders = await api('GET', '/api/orders');
  const box = msgBox();
  const rows = [];
  for (const o of orders.slice(0, 30)) rows.push({ o, s: await api('GET', `/api/finance/orders/${o.id}/summary`) });
  const verify = h('input', { type: 'number', placeholder: 'ID pembayaran', style: 'width:140px' });
  const inv = h('form', { class: 'row', onsubmit: (e) => e.preventDefault() }, inp('oid', 'number', { placeholder: 'ID order', style: 'width:100px' }), sel('kind', [['penawaran', 'Penawaran'], ['dp', 'DP'], ['invoice', 'Invoice']]), inp('amount', 'number', { placeholder: 'Nominal Rp', style: 'width:140px' }), h('button', { type: 'submit' }, 'Catat'));
  inv.addEventListener('submit', act(box, () => api('POST', `/api/finance/orders/${num(inv, 'oid')}/invoices`, { kind: val(inv, 'kind'), amount: num(inv, 'amount') }), () => render()));
  return h('div', {}, h('h1', {}, 'Finance'), box,
    h('div', { class: 'card' }, h('h3', {}, 'Angka terpisah per order'), table([['Order', (r) => h('a', { href: '#/app/order/' + r.o.id }, r.o.order_no)], ['Penawaran', (r) => rp(r.s.penawaran)], ['DP', (r) => rp(r.s.dp)], ['Invoice', (r) => rp(r.s.invoice)], ['Dibayar (terverifikasi)', (r) => rp(r.s.pembayaran_terverifikasi)], ['Bukti belum diverifikasi', (r) => rp(r.s.pembayaran_belum_diverifikasi)]], rows),
      h('p', { class: 'muted small' }, 'Unggah bukti bukan verifikasi. Hanya FAT yang memverifikasi pembayaran. Nominal selalu diisi manual; aplikasi tidak memiliki tarif bawaan.')),
    ['fat', 'cs', 'master'].includes(me.role) ? h('div', { class: 'card' }, h('h3', {}, 'Tambah penawaran / DP / invoice'), inv) : null,
    me.role === 'fat' ? h('div', { class: 'card row' }, h('h3', {}, 'Verifikasi pembayaran'), verify, h('button', { class: 'primary', onclick: act(box, () => api('POST', `/api/finance/payments/${verify.value}/verify`, {}), () => render()) }, 'Verifikasi')) : null);
}

async function vComplaints() {
  const list = me.role === 'crm' ? [] : await api('GET', '/api/finance/complaints');
  const box = msgBox();
  const parts = [h('h1', {}, 'Complaint dan Loss Sales'), box];
  if (['cs', 'qc', 'supervisor', 'master'].includes(me.role)) {
    const f = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() }, h('h3', {}, 'Komplain / rework baru'), field('ID order awal', inp('oid', 'number')), field('ID WO (opsional)', inp('wid', 'number')), field('Uraian', h('textarea', { name: 'd', rows: 2 })), h('button', { type: 'submit' }, 'Catat komplain'));
    f.addEventListener('submit', act(box, () => api('POST', '/api/finance/complaints', { order_id: num(f, 'oid'), wo_id: num(f, 'wid') ?? undefined, description: val(f, 'd') }), () => render()));
    parts.push(f, h('div', { class: 'card' }, table([['ID', (c) => c.id], ['Order', (c) => c.order_id], ['Uraian', (c) => c.description], ['Status', (c) => tag(c.status)]], list)));
  }
  if (['cs', 'crm', 'master'].includes(me.role)) {
    const f = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() }, h('h3', {}, 'Loss Sales'), field('Alasan penolakan', inp('reason')), field('Potensi nilai (Rp, opsional)', inp('amt', 'number')),
      h('label', {}, h('input', { type: 'checkbox', name: 'dup', style: 'width:auto;margin-right:6px' }), 'Double input (tidak dihitung)'), h('button', { type: 'submit' }, 'Catat'));
    f.addEventListener('submit', act(box, () => api('POST', '/api/finance/loss-sales', { reason: val(f, 'reason'), potential_amount: num(f, 'amt') ?? undefined, is_duplicate: f.elements.dup.checked })));
    parts.push(f);
  }
  return h('div', {}, parts);
}

async function vMaster() {
  const [users, custs, cfg] = await Promise.all([api('GET', '/api/master/users'), api('GET', '/api/master/customers'), api('GET', '/api/master/config')]);
  const box = msgBox();
  const reload = () => render();
  const uf = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() }, h('h3', {}, 'Daftarkan karyawan'),
    h('div', { class: 'grid' }, field('Kode / no. pendaftaran', inp('reg', 'text', { placeholder: '0001' })), field('Nama', inp('name')), field('No. induk karyawan', inp('eno')), field('Departemen', inp('dept', 'text', { value: 'SDP' })), field('Jabatan', inp('title')),
      field('Username', inp('username')), field('Password awal', inp('password', 'password')), field('Peran akses', sel('role', Object.entries(ROLE).filter(([k]) => k !== 'customer')))),
    h('p', { class: 'muted small' }, 'Jabatan tidak memberi hak akses. Hak akses ditentukan oleh peran. Password awal wajib diganti saat login pertama.'), h('button', { type: 'submit' }, 'Buat akun'));
  uf.addEventListener('submit', act(box, () => api('POST', '/api/master/users', { reg_code: val(uf, 'reg'), full_name: val(uf, 'name'), employee_no: val(uf, 'eno'), department: val(uf, 'dept'), job_title: val(uf, 'title'), username: val(uf, 'username'), password: uf.elements.password.value, role: val(uf, 'role') }), reload));
  const newPass = h('input', { type: 'password', placeholder: 'Password baru', style: 'width:150px' });
  const mf = h('form', { class: 'row', onsubmit: (e) => e.preventDefault() }, inp('code', 'text', { placeholder: 'Kode mesin', style: 'width:110px' }), inp('name', 'text', { placeholder: 'Nama mesin', style: 'width:150px' }), sel('kind', [['dtf_printer', 'Printer DTF'], ['sublim_printer', 'Printer sublim'], ['calender', 'Calender']]), h('button', { type: 'submit' }, 'Tambah mesin'));
  mf.addEventListener('submit', act(box, () => api('POST', '/api/master/config/machines', { code: val(mf, 'code'), name: val(mf, 'name'), kind: val(mf, 'kind') }), reload));
  const normRow = (n) => { const i = h('input', { type: 'number', step: 'any', value: n.seconds_per_unit ?? '', placeholder: 'Belum diatur', style: 'width:110px' }); return h('div', { class: 'row' }, h('strong', { style: 'min-width:140px' }, n.machine_kind), i, h('span', { class: 'muted' }, 'detik per ' + n.unit),
    h('button', { onclick: act(box, () => api('PUT', '/api/master/config/norms/' + n.machine_kind, { seconds_per_unit: i.value === '' ? null : Number(i.value), source_note: 'diubah master' }), reload) }, 'Simpan')); };
  const setting = {}; for (const s of cfg.settings) setting[s.key] = s.value;
  const sf = h('form', { class: 'card', onsubmit: (e) => e.preventDefault() }, h('h3', {}, 'Settings (kalender dan informasi publik)'),
    field('Blok produksi efektif (mis. 09:00-12:00,13:00-16:00)', inp('prod_blocks', 'text', { value: setting.prod_blocks })), field('Hari libur (0 = Minggu)', inp('closed_weekdays', 'text', { value: setting.closed_weekdays })),
    field('Nama brand', inp('brand_name', 'text', { value: setting.brand_name })), field('Informasi workshop', h('textarea', { name: 'workshop_info', rows: 2 }, setting.workshop_info || '')), field('Kontak CS', h('textarea', { name: 'contact_info', rows: 2 }, setting.contact_info || '')), h('button', { type: 'submit' }, 'Simpan settings'));
  sf.addEventListener('submit', act(box, () => api('PUT', '/api/master/config/settings', { prod_blocks: val(sf, 'prod_blocks'), closed_weekdays: val(sf, 'closed_weekdays'), brand_name: val(sf, 'brand_name'), workshop_info: sf.elements.workshop_info.value, contact_info: sf.elements.contact_info.value }), reload));
  return h('div', {}, h('h1', {}, 'Master Data dan Settings'), box, uf,
    h('div', { class: 'card' }, h('h3', {}, 'Pengguna'), table([['ID', (u) => u.id], ['Username', (u) => u.username], ['Nama', (u) => u.full_name || '-'], ['Peran', (u) => ROLE[u.role]], ['Aktif', (u) => (u.active ? 'Ya' : 'Tidak')],
      ['Aksi', (u) => h('div', { class: 'row' }, h('button', { onclick: act(box, () => api('PATCH', '/api/master/users/' + u.id, { active: !u.active }), reload) }, u.active ? 'Nonaktifkan' : 'Aktifkan'),
        h('button', { onclick: act(box, () => api('PATCH', '/api/master/users/' + u.id, { new_password: newPass.value }), reload) }, 'Reset password'))]], users), newPass),
    h('div', { class: 'card' }, h('h3', {}, 'Customer'), table([['Kode', (c) => c.code], ['Bisnis', (c) => c.business_name], ['PIC', (c) => c.pic_name + ' | ' + c.contact], ['Wilayah', (c) => (c.city_scope === 'in_city' ? 'In City' : 'Out City')], ['Pembayaran', (c) => c.payment_policy]], custs)),
    h('div', { class: 'card' }, h('h3', {}, 'Mesin'), table([['ID', (m) => m.id], ['Kode', (m) => m.code], ['Jenis', (m) => m.kind], ['Aktif', (m) => (m.active ? 'Ya' : 'Tidak')]], cfg.machines), mf),
    h('div', { class: 'card' }, h('h3', {}, 'Norma waktu per mesin'), cfg.norms.map(normRow), h('p', { class: 'muted small' }, 'Kosong = Belum diatur. Norma DTF tidak otomatis berlaku untuk Sublim.')),
    sf);
}

function vAccount() {
  const box = msgBox();
  const f = h('form', { class: 'card', style: 'max-width:420px', onsubmit: (e) => e.preventDefault() }, h('h2', {}, 'Ganti password'), me.must_change ? h('div', { class: 'msg' }, 'Password awal/reset wajib diganti sebelum memakai aplikasi.') : null,
    field('Password saat ini', inp('cur', 'password')), field('Password baru (min. 10 karakter, huruf dan angka)', inp('nw', 'password')), h('button', { class: 'primary', type: 'submit' }, 'Simpan'), box);
  f.addEventListener('submit', act(box, async () => { await api('POST', '/api/auth/change-password', { current_password: f.elements.cur.value, new_password: f.elements.nw.value }); me = null; location.hash = '#/login'; }));
  return h('div', {}, f);
}

const VIEWS = { dashboard: vDashboard, pesanan: vOrders, pendaftaran: vMembers, tugas: vTasks, produksi: vProduction, 'qc-mesin': vMachineQC, 'qc-hasil': vQCResult, inventory: vInventory, finance: vFinance, komplain: vComplaints, master: vMaster, akun: async () => vAccount() };

async function render() {
  const hash = location.hash || '#/';
  try {
    if (!info) info = await api('GET', '/api/public/info');
    const path = hash.replace(/^#/, '').split('/').filter(Boolean);
    if (path[0] === 'app') {
      if (!me) { try { me = await api('GET', '/api/auth/me'); } catch { location.hash = '#/login'; return; } }
      if (me.must_change && path[1] !== 'akun') { location.hash = '#/app/akun'; return; }
      const id = path[1] || defaultView();
      let content;
      if (id === 'order') content = await vOrderDetail(path[2]);
      else if (VIEWS[id] && visibleMenu().some((m) => m[0] === id)) content = await VIEWS[id]();
      else content = h('p', { class: 'muted' }, 'Halaman tidak tersedia untuk peran Anda.');
      root.replaceChildren(shell(id === 'order' ? 'pesanan' : id, content));
      return;
    }
    let page;
    if (path[0] === 'daftar') page = viewRegister();
    else if (path[0] === 'login') page = viewLogin();
    else if (path[0] === 'lacak') page = viewTrack(path[1]);
    else page = viewHome();
    root.replaceChildren(page);
  } catch (e) {
    root.replaceChildren(h('div', { class: 'pad' }, h('div', { class: 'msg err' }, e.message), h('a', { href: '#/' }, 'Kembali')));
  }
}
addEventListener('hashchange', render);
render();
