/**
 * SDP Print Hub - backend SEMENTARA di Google Spreadsheet (Apps Script).
 * Kontrak API sama dengan server Supabase (src/routes), dan nama sheet serta kolom sama dengan tabel Postgres,
 * sehingga perpindahan nanti cukup menjalankan eksporSupabase() lalu mengosongkan sheetsUrl di public/config.js.
 *
 * Pemasangan: lihat docs/SPREADSHEET.md. Jalankan setup() sekali, lalu buatMaster().
 */

// '#' = kolom angka. Selain itu teks.
var SCHEMA = {
  users: 'id#,code,name,role,store,active#,pass_hash,pass_salt,pass_iter#,must_change_password#,session_epoch#,created_at#',
  sessions: 'id,user_id#,epoch#,created_at#,expires_at#',
  settings: 'key,value',
  role_access: 'role,pages',
  customers: 'id#,code,name,wa,source,status,verified_by,verified_at#,created_at#',
  orders: 'id#,order_no,track_code,type,service,customer_id#,customer_name,wa,source,store,items,meter#,total#,file_ref,file_key,deadline,note,status,stage,priority#,issue,rework_m#,process,receiver,created_by,created_at#,approved_at#,started_at#,finished_at#,qc_by,handed_at#,request_key',
  payments: 'id#,order_id#,amount#,method,by_user,at#,request_key',
  skus: 'code,name,svc,unit,stock#,min_stock#,use_per_m#,machine',
  stock_ledger: 'id#,sku_code,type,qty#,ref,by_user,at#',
  qc_reports: 'id#,machine,day,answers,ng,note,action,photos,status,by_user,at#,approved_by,approved_at#,leader_note',
  logs: 'id#,order_no,type,reason,value#,counted#,by_user,at#',
  files: 'key,kind,file_name,content_type,size_bytes#,uploaded_by#,uploaded_at#,confirmed#,drive_id',
  audit_log: 'id#,at#,user_id#,action,entity,entity_id,detail'
};

var PBKDF2_ITER = 20000;               // tersimpan per akun; server Supabase memverifikasi hash yang sama
var SESSION_TTL_MS = 12 * 3600 * 1000;
var MAX_FILE_BYTES = 8 * 1024 * 1024;  // batas praktis unggah lewat Apps Script

// ---------- Aturan bisnis (harus sama dengan src/domain.ts) ----------
var ROLES = ['master', 'manager', 'spv', 'cs', 'crm', 'store', 'op', 'qc', 'gudang', 'fat'];
var GRANTABLE = ['dashboard', 'laporan', 'input', 'cs', 'toko', 'pelanggan', 'cekfile', 'produksi', 'qc', 'serah', 'bayar', 'stok', 'loss', 'layanan', 'lacak'];
var ACCESS_DEFAULT = {
  manager: ['dashboard', 'laporan', 'pelanggan', 'produksi', 'bayar', 'stok', 'loss', 'layanan', 'lacak'],
  spv: ['dashboard', 'laporan', 'cs', 'cekfile', 'produksi', 'qc', 'serah', 'stok', 'loss', 'layanan', 'lacak'],
  cs: ['dashboard', 'input', 'cs', 'pelanggan', 'bayar', 'produksi', 'serah', 'loss', 'layanan', 'lacak'],
  crm: ['pelanggan', 'layanan', 'lacak'],
  store: ['input', 'toko', 'layanan', 'lacak'],
  op: ['cekfile', 'produksi', 'qc', 'stok'],
  qc: ['qc', 'produksi'],
  gudang: ['stok', 'serah'],
  fat: ['bayar', 'laporan', 'layanan', 'lacak']
};
var ORDER_PAGES = ['dashboard', 'laporan', 'input', 'cs', 'toko', 'pelanggan', 'cekfile', 'produksi', 'qc', 'serah', 'bayar'];
var RETAIL = {
  'DTF Logo': { w: 15, l: 10, p: [6000, 5500, 4500] },
  'DTF A': { w: 21, l: 15, p: [10000, 9000, 7000] },
  'DTF B': { w: 30, l: 21, p: [17000, 16000, 12000] },
  'DTF C': { w: 42, l: 30, p: [25000, 23000, 18000] },
  'DTF D': { w: 59, l: 42, p: [45000, 41000, 32000] }
};
var CANVAS_CM = 58;
var WIDTHS = [['priceSub120', 'Lebar kain sampai 120 cm'], ['priceSub160', 'Lebar kain 121 sampai 160 cm'], ['priceSub180', 'Lebar kain 161 sampai 180 cm']];
var NORM_KEY = { dtf: 'normDtf', subp: 'normSubPrint', cal: 'normPress' };
// Perencanaan kapasitas (sama dengan src/core.ts).
var PLAN_DEFAULT = { capPct: 90, holdMin: 120, finDtf: 30, finSub: 60 };
var WORK_BLOCKS_DEFAULT = '09:00-12:00,13:00-21:30';
var FILE_CHECK_COUNT = 4;
var QC_CHECK_COUNT = { dtf: 5, sub: 5 };
var CURING = { minC: 130, maxC: 150, minS: 60, maxS: 90 };
// QC pagi: [jumlah butir, [foto wajib]]
var MORNING = { dtf: [8, ['Nozzle check', 'Test print', 'Hasil press']], subp: [4, ['Nozzle check / test print']], cal: [3, ['Hasil press']] };
var MORNING_TEXT = {
  dtf: ['Mesin dan area kerja bersih, aman, serta mesin menyala sesuai prosedur', 'Tinta putih/CMYK, PET film, dan powder adhesive tersedia dan siap digunakan', 'Cleaning sesuai kebutuhan; hasil nozzle check lengkap tanpa garis putus atau hilang', 'Test print file standar: detail, warna, dan gambar sesuai file', 'Curing sesuai parameter; powder meleleh dan menempel merata', 'Press pada kain uji sesuai parameter; hasil transfer rata dan tidak mudah terkelupas', 'Hasil uji press dilaporkan kepada leader; kendala dan tindakan awal dicatat jika ada', 'Seluruh hasil QC sudah diperiksa, bahan cukup, serta mesin dan area aman untuk produksi'],
  subp: ['Mesin dan area bersih dan aman', 'Tinta dan kertas sublim tersedia', 'Nozzle check lengkap', 'Test print sesuai file'],
  cal: ['Mesin dan area bersih dan aman', 'Suhu dan kecepatan sesuai instruksi', 'Hasil transfer pada kain uji rata dan warna sesuai']
};
var SKU_SEED = [
  ['SDP-DTF-FLM-60', 'PET Film DTF 60 cm', 'dtf', 'meter', 'dtf'], ['SDP-DTF-INK-WH', 'Tinta DTF White', 'dtf', 'ml', 'dtf'], ['SDP-DTF-INK-CY', 'Tinta DTF Cyan', 'dtf', 'ml', 'dtf'], ['SDP-DTF-INK-MG', 'Tinta DTF Magenta', 'dtf', 'ml', 'dtf'], ['SDP-DTF-INK-YL', 'Tinta DTF Yellow', 'dtf', 'ml', 'dtf'], ['SDP-DTF-INK-BK', 'Tinta DTF Black', 'dtf', 'ml', 'dtf'], ['SDP-DTF-PWD-01', 'Powder Hot Melt', 'dtf', 'gram', 'dtf'], ['SDP-DTF-CLN-01', 'Cairan Cleaning DTF', 'dtf', 'ml', 'dtf'],
  ['SDP-SUB-PPR-01', 'Kertas Sublim Roll', 'sub', 'meter', 'subp'], ['SDP-SUB-INK-CY', 'Tinta Sublim Cyan', 'sub', 'ml', 'subp'], ['SDP-SUB-INK-MG', 'Tinta Sublim Magenta', 'sub', 'ml', 'subp'], ['SDP-SUB-INK-YL', 'Tinta Sublim Yellow', 'sub', 'ml', 'subp'], ['SDP-SUB-INK-BK', 'Tinta Sublim Black', 'sub', 'ml', 'subp'], ['SDP-SUB-TSU-01', 'Kertas Pelindung Press', 'sub', 'meter', 'cal']
];
var SETTING_SEED = [['priceDtf', '23000'], ['priceSub120', ''], ['priceSub160', ''], ['priceSub180', ''], ['normDtf', '240'], ['normSubPrint', ''], ['normPress', ''], ['prod_blocks', '09:00-12:00,13:00-16:00'], ['closed_weekdays', '0'], ['tz_offset_min', '480']];

// ---------- Lapisan sheet ----------
function columns_(name) {
  return SCHEMA[name].split(',').map(function (c) { return c.charAt(c.length - 1) === '#' ? { n: c.slice(0, -1), num: true } : { n: c, num: false }; });
}
function book_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
// Teks yang diawali = + - @ diberi apostrof agar tidak dibaca sebagai rumus.
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^[=+\-@']/.test(v)) return "'" + v;
  return v;
}
function makeStore_() {
  var cache = {};
  var ss = book_();
  function sheet(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw err_(500, 'Sheet "' + name + '" belum ada. Jalankan setup().');
    return sh;
  }
  var store = {
    all: function (name) {
      if (cache[name]) return cache[name];
      var cols = columns_(name);
      var values = sheet(name).getDataRange().getValues();
      var rows = [];
      for (var i = 1; i < values.length; i++) {
        if (values[i].every(function (x) { return x === ''; })) continue;
        var o = { _row: i + 1 };
        for (var j = 0; j < cols.length; j++) {
          var v = values[i][j];
          o[cols[j].n] = v === '' || v === undefined ? null : cols[j].num ? Number(v) : String(v);
        }
        rows.push(o);
      }
      cache[name] = rows;
      return rows;
    },
    find: function (name, fn) { return store.all(name).filter(fn)[0] || null; },
    filter: function (name, fn) { return store.all(name).filter(fn); },
    insert: function (name, obj) {
      var rows = store.all(name);
      var cols = columns_(name);
      if (cols[0].n === 'id' && cols[0].num && obj.id == null) obj.id = rows.reduce(function (m, r) { return Math.max(m, r.id); }, 0) + 1;
      var sh = sheet(name);
      var at = sh.getLastRow() + 1;
      if (at > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500); // grid Sheets terbatas (awal 1.000 baris)
      sh.getRange(at, 1, 1, cols.length).setNumberFormat('@').setValues([cols.map(function (c) { return cell_(obj[c.n]); })]);
      var rec = { _row: at };
      cols.forEach(function (c) { rec[c.n] = obj[c.n] === undefined ? null : obj[c.n]; });
      rows.push(rec);
      return rec;
    },
    update: function (name, row, patch) {
      var cols = columns_(name);
      Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
      sheet(name).getRange(row._row, 1, 1, cols.length).setNumberFormat('@').setValues([cols.map(function (c) { return cell_(row[c.n]); })]);
    },
    remove: function (name, fn) {
      var sh = sheet(name);
      var nums = store.all(name).filter(fn).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
      for (var i = 0; i < nums.length;) {
        var count = 1;
        while (i + count < nums.length && nums[i + count] === nums[i] - count) count++;
        // Baris beku tidak boleh habis: sisakan satu baris kosong di bawah judul.
        if (sh.getMaxRows() - count < 2) sh.insertRowsAfter(sh.getMaxRows(), count);
        sh.deleteRows(nums[i] - count + 1, count);
        i += count;
      }
      delete cache[name];
    }
  };
  return store;
}

// ---------- Kripto: SHA-256 dan PBKDF2 murni JS (hasil sama dengan WebCrypto di server Supabase) ----------
var K_ = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
function sha256Bytes_(bytes) {
  var len = bytes.length, blocks = ((len + 8) >> 6) + 1, w = new Array(blocks * 16).fill(0), i, t;
  for (i = 0; i < len; i++) w[i >> 2] |= (bytes[i] & 255) << (24 - (i % 4) * 8);
  w[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  w[blocks * 16 - 1] = (len * 8) >>> 0;
  w[blocks * 16 - 2] = Math.floor(len / 0x20000000);
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], m = new Array(64);
  for (var b = 0; b < blocks; b++) {
    for (t = 0; t < 64; t++) {
      if (t < 16) m[t] = w[b * 16 + t] | 0;
      else {
        var x = m[t - 15], y = m[t - 2];
        m[t] = ((((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + m[t - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + m[t - 16]) | 0;
      }
    }
    var a = H[0], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7], bb = H[1];
    for (t = 0; t < 64; t++) {
      var T1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K_[t] + m[t]) | 0;
      var T2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + T1) | 0; d = c; c = bb; bb = a; a = (T1 + T2) | 0;
    }
    H = [(H[0] + a) | 0, (H[1] + bb) | 0, (H[2] + c) | 0, (H[3] + d) | 0, (H[4] + e) | 0, (H[5] + f) | 0, (H[6] + g) | 0, (H[7] + h) | 0];
  }
  var out = [];
  H.forEach(function (v) { out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); });
  return out;
}
function utf8_(s) {
  var e = unescape(encodeURIComponent(s)), a = [];
  for (var i = 0; i < e.length; i++) a.push(e.charCodeAt(i));
  return a;
}
function pbkdf2_(password, salt, iter) {
  var key = utf8_(password);
  if (key.length > 64) key = sha256Bytes_(key);
  var ipad = [], opad = [], i;
  for (i = 0; i < 64; i++) { ipad.push((key[i] || 0) ^ 0x36); opad.push((key[i] || 0) ^ 0x5c); }
  function hmac(msg) { return sha256Bytes_(opad.concat(sha256Bytes_(ipad.concat(msg)))); }
  var u = hmac(salt.concat([0, 0, 0, 1])), out = u.slice();
  for (var n = 1; n < iter; n++) { u = hmac(u); for (i = 0; i < 32; i++) out[i] ^= u[i]; }
  return out;
}
var B64_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64url_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var n = ((bytes[i] & 255) << 16) | ((bytes[i + 1] & 255) << 8) | (bytes[i + 2] & 255), k = bytes.length - i;
    s += B64_[n >> 18] + B64_[(n >> 12) & 63] + (k > 1 ? B64_[(n >> 6) & 63] : '') + (k > 2 ? B64_[n & 63] : '');
  }
  return s;
}
function unb64url_(s) {
  var out = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) { buf = (buf << 6) | B64_.indexOf(s[i]); bits += 6; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } }
  return out;
}
// Acak dari UUID acak Google, dipadatkan dengan SHA-256.
function random_(n) { return b64url_(sha256Bytes_(utf8_(Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid())).slice(0, n)); }
function sha_(s) { return b64url_(sha256Bytes_(utf8_(s))); }
function hashPassword_(p) {
  var salt = random_(16);
  return { hash: b64url_(pbkdf2_(p, unb64url_(salt), PBKDF2_ITER)), salt: salt, iter: PBKDF2_ITER };
}
function verifyPassword_(p, u) { return b64url_(pbkdf2_(p, unb64url_(u.pass_salt), u.pass_iter)) === u.pass_hash; }

// ---------- Bantuan ----------
function err_(status, message) { var e = new Error(message); e.status = status; return e; }
function str_(b, k, max) {
  var v = b[k];
  if (typeof v !== 'string' || !v.trim()) throw err_(400, 'Field "' + k + '" wajib diisi');
  if (v.length > (max || 500)) throw err_(400, 'Field "' + k + '" terlalu panjang');
  return v.trim();
}
function opt_(b, k, max) {
  var v = b[k];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > (max || 2000)) throw err_(400, 'Field "' + k + '" tidak valid');
  return v.trim() || null;
}
function num_(b, k, allowZero) {
  var v = b[k];
  if (typeof v !== 'number' || !isFinite(v) || (allowZero ? v < 0 : v <= 0)) throw err_(400, 'Field "' + k + '" harus angka lebih dari 0');
  return v;
}
function one_(b, k, list) { if (list.indexOf(b[k]) < 0) throw err_(400, 'Field "' + k + '" harus salah satu dari: ' + list.join(', ')); return b[k]; }
function round2_(n) { return Math.round(n * 100) / 100; }
function passwordProblem_(p) {
  if (typeof p !== 'string' || p.length < 10) return 'Password minimal 10 karakter';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Password harus berisi huruf dan angka';
  return null;
}
function settings_(db) { var o = {}; db.all('settings').forEach(function (r) { o[r.key] = r.value || ''; }); return o; }
function numeric_(s) {
  var o = {};
  ['priceDtf', 'priceSub120', 'priceSub160', 'priceSub180', 'normDtf', 'normSubPrint', 'normPress'].forEach(function (k) { o[k] = s[k] ? Number(s[k]) : null; });
  Object.keys(PLAN_DEFAULT).forEach(function (k) { o[k] = s[k] ? Number(s[k]) : PLAN_DEFAULT[k]; });
  return o;
}
function overtimeOf_(s) {
  try { var list = JSON.parse(s.overtime || '[]'); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}
function blocksOf_(day, c) {
  if (c.days && c.days[day]) return c.days[day];
  return c.closedWeekdays.indexOf((day + 4) % 7) >= 0 ? [] : c.blocks;
}
// Gabungkan jam lembur ke jam biasa tanpa menghitung dobel.
function withOvertime_(c, overtime) {
  var days = {};
  var min = function (t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); };
  overtime.forEach(function (o) {
    var index = Date.parse(o.day + 'T00:00:00Z') / 864e5;
    var base = days[index] || blocksOf_(index, c);
    var merged = [];
    base.concat([[min(o.start), min(o.end)]]).map(function (b) { return b.slice(); }).sort(function (x, y) { return x[0] - y[0]; }).forEach(function (b) {
      var tail = merged[merged.length - 1];
      if (tail && b[0] <= tail[1]) tail[1] = Math.max(tail[1], b[1]); else merged.push(b);
    });
    days[index] = merged;
  });
  c.days = days;
  return c;
}
function calendar_(s) {
  var blocks = (s.work_blocks || WORK_BLOCKS_DEFAULT).split(',').map(function (b) {
    return b.split('-').map(function (t) { var p = t.trim().split(':'); return Number(p[0]) * 60 + Number(p[1]); });
  });
  var closed = (s.closed_weekdays === undefined ? '0' : s.closed_weekdays).split(',').filter(String).map(Number);
  return withOvertime_({ offsetMin: Number(s.tz_offset_min || 480), blocks: blocks, closedWeekdays: closed }, overtimeOf_(s));
}
function localDay_(ms, cal) { return new Date(ms + cal.offsetMin * 60000).toISOString().slice(0, 10); }
function addWork_(start, sec, c) {
  var M = 60000, D = 864e5, off = c.offsetMin * M, left = sec * 1000, day = Math.floor((start + off) / D), min = ((start + off) - day * D) / M;
  for (var g = 0; g < 3650; g++, day++, min = 0) {
    var blocks = blocksOf_(day, c);
    for (var i = 0; i < blocks.length; i++) {
      var f = Math.max(min, blocks[i][0]), b = blocks[i][1];
      if (f >= b) continue;
      var av = (b - f) * M;
      if (left <= av) return Math.round(day * D + f * M + left - off);
      left -= av;
    }
  }
  return null;
}
function validBlocks_(v) {
  var previous = '';
  return v.split(',').every(function (block) {
    var m = /^(([01]\d|2[0-3]):[0-5]\d)-(([01]\d|2[0-3]):[0-5]\d)$/.exec(block.trim());
    if (!m || m[1] >= m[3] || m[1] < previous) return false;
    previous = m[3];
    return true;
  });
}
function pages_(db, role) {
  var row = db.find('role_access', function (r) { return r.role === role; });
  return row ? JSON.parse(row.pages) : ACCESS_DEFAULT[role] || [];
}
function allow_(ctx, roles, page) {
  var u = ctx.user;
  if (u.role === 'master') return;
  if (roles.indexOf(u.role) < 0) throw err_(403, 'Tidak punya hak akses');
  if (page && pages_(ctx.db, u.role).indexOf(page) < 0) throw err_(403, 'Menu ini tidak diizinkan untuk peran Anda');
}
function audit_(ctx, action, entity, id, detail) {
  ctx.db.insert('audit_log', { at: Date.now(), user_id: ctx.user ? ctx.user.id : null, action: action, entity: entity || null, entity_id: id == null ? null : String(id), detail: detail ? JSON.stringify(detail).slice(0, 2000) : null });
}

// ---------- Kapasitas produksi (sama dengan src/lib/capacity.ts) ----------
var MACHINE_LIST = ['dtf', 'subp', 'cal'];
var CONFIRMED_ = ['antrian', 'produksi', 'curing'], PENDING_ = ['cek', 'revisi', 'bayar'];
function planConfig_(raw) {
  var s = numeric_(raw);
  return { cal: calendar_(raw), norms: { dtf: s.normDtf, subp: s.normSubPrint, cal: s.normPress }, pct: s.capPct, holdMin: s.holdMin, finDtf: s.finDtf, finSub: s.finSub };
}
function activeJobs_(db) {
  var since = Date.now() - 864e5, paid = {};
  db.all('payments').forEach(function (p) { paid[p.order_id] = (paid[p.order_id] || 0) + p.amount; });
  return db.filter('orders', function (o) { return CONFIRMED_.indexOf(o.status) >= 0 || PENDING_.indexOf(o.status) >= 0 || (o.finished_at || 0) >= since; }).map(function (o) {
    return { id: o.id, order_no: o.order_no, service: o.service, status: o.status, stage: o.stage, meter: o.meter, rework_m: o.rework_m, priority: o.priority || 0, approved_at: o.approved_at, started_at: o.started_at, created_at: o.created_at, finished_at: o.finished_at, paid: (paid[o.id] || 0) >= o.total };
  }).sort(function (a, b) { return a.id - b.id; });
}
function effective_(start, end, c) {
  if (end <= start) return 0;
  var M = 60000, D = 864e5, off = c.offsetMin * M, total = 0;
  for (var day = Math.floor((start + off) / D), last = Math.floor((end + off) / D); day <= last; day++) {
    blocksOf_(day, c).forEach(function (b) {
      var s = Math.max(day * D + b[0] * M - off, start), e = Math.min(day * D + b[1] * M - off, end);
      if (e > s) total += e - s;
    });
  }
  return Math.round(total / 1000);
}
function chainOf_(service, stage) { return service === 'dtf' ? ['dtf'] : stage === 'cal' ? ['cal'] : ['subp', 'cal']; }
function plan_(jobs, now, cfg) {
  var confirmed = jobs.filter(function (j) { return CONFIRMED_.indexOf(j.status) >= 0; }).sort(function (a, b) {
    return (b.status !== 'antrian') - (a.status !== 'antrian') || b.priority - a.priority || (a.approved_at || 0) - (b.approved_at || 0) || a.id - b.id;
  });
  var pending = jobs.filter(function (j) { return PENDING_.indexOf(j.status) >= 0 && (j.paid || now - j.created_at < cfg.holdMin * 60000); })
    .sort(function (a, b) { return a.created_at - b.created_at || a.id - b.id; });
  var cursor = { dtf: now, subp: now, cal: now }, slots = [], last = {};
  confirmed.concat(pending).forEach(function (j) {
    var meter = j.rework_m == null ? j.meter : j.rework_m, previous = now;
    chainOf_(j.service, j.stage).forEach(function (m) {
      var norm = cfg.norms[m];
      if (!norm) return;
      var running = (j.status === 'produksi' || j.status === 'curing') && m === j.stage;
      var start = running ? j.started_at : addWork_(Math.max(cursor[m], previous), 0, cfg.cal);
      var end = running ? Math.max(now, addWork_(start, meter * norm, cfg.cal)) : addWork_(start, (meter * norm * 100) / cfg.pct, cfg.cal);
      cursor[m] = Math.max(cursor[m], end);
      previous = end;
      slots.push({ id: j.id, order_no: j.order_no, machine: m, start: start, end: end, meter: meter, hold: !j.paid && PENDING_.indexOf(j.status) >= 0 });
    });
    last[j.id] = previous;
  });
  return { slots: slots, last: last };
}
function readyFor_(jobs, now, cfg, service, meter) {
  var stage = service === 'dtf' ? 'dtf' : 'subp';
  if (!chainOf_(service, stage).some(function (m) { return cfg.norms[m]; })) return null;
  var probe = { id: -1, order_no: '', service: service, status: 'cek', stage: stage, meter: meter, rework_m: null, priority: 0, approved_at: null, started_at: null, created_at: now, finished_at: null, paid: true };
  var printed = plan_(jobs.concat([probe]), now, cfg).last[-1];
  return addWork_(printed, (service === 'dtf' ? cfg.finDtf : cfg.finSub) * 60, cfg.cal);
}
function dayStart_(day, cal) { return Date.parse(day + 'T00:00:00Z') - cal.offsetMin * 60000; }
// Batas SLA standar: lunas sebelum 12.00 selesai hari itu, selebihnya hari kerja berikutnya.
function slaDue_(now, cal) {
  var D = 864e5, today = dayStart_(localDay_(now, cal), cal), from = now - today < 12 * 3600000 ? today : today + D;
  for (var i = 0; i < 60; i++, from += D) {
    if (effective_(from, from + D, cal)) {
      var blocks = blocksOf_(Math.floor((from + cal.offsetMin * 60000) / D), cal);
      return from + Math.max.apply(null, blocks.map(function (b) { return b[1]; })) * 60000;
    }
  }
  return from;
}
function days_(jobs, now, cfg) {
  var slots = plan_(jobs, now, cfg).slots, out = [], D = 864e5;
  var round = function (n) { return Math.round(n * 10) / 10; };
  MACHINE_LIST.forEach(function (m) {
    var norm = cfg.norms[m];
    if (!norm) return;
    var perMeter = (norm * 100) / cfg.pct, start = dayStart_(localDay_(now, cfg.cal), cfg.cal);
    for (var n = 0, guard = 0; n < 7 && guard < 60; guard++, start += D) {
      var seconds = effective_(start, start + D, cfg.cal);
      if (!seconds) continue;
      n++;
      var capacity = seconds / perMeter;
      var booked = slots.filter(function (x) { return x.machine === m; }).reduce(function (a, x) { return a + effective_(Math.max(x.start, start), Math.min(x.end, start + D), cfg.cal); }, 0) / perMeter;
      var isToday = start <= now;
      var done = isToday ? jobs.filter(function (j) { return m !== 'subp' && (j.finished_at || 0) >= start && (j.service === 'dtf' ? m === 'dtf' : m === 'cal'); }).reduce(function (a, j) { return a + j.meter; }, 0) : 0;
      var free = capacity - booked - done;
      if (isToday) free = Math.min(free, effective_(now, start + D, cfg.cal) / perMeter - booked);
      out.push({ day: localDay_(start + 1, cfg.cal), machine: m, capacity: round(capacity), booked: round(booked), done: round(done), free: round(Math.max(0, free)) });
    }
  });
  return out;
}
function suggestDeadline_(ready, cal) {
  var step = 30 * 60000, t = Math.ceil((ready + 15 * 60000) / step) * step + cal.offsetMin * 60000;
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}
function deadlineTime_(d, cal) { return Date.parse(d.slice(0, 10) + 'T' + (d.slice(11) || '23:59') + ':00Z') - cal.offsetMin * 60000; }
function showTime_(ms, cal) { var s = new Date(ms + cal.offsetMin * 60000).toISOString(); return s.slice(8, 10) + '/' + s.slice(5, 7) + ' ' + s.slice(11, 16).replace(':', '.'); }
function evaluate_(db, raw, service, meter, deadline) {
  var cfg = planConfig_(raw), t = Date.now();
  var ready = readyFor_(activeJobs_(db), t, cfg, service, meter);
  var target = deadline ? deadlineTime_(deadline, cfg.cal) : slaDue_(t, cfg.cal);
  var fits = ready === null || ready <= target;
  return { ready: ready, target: target, fits: fits, byDeadline: !!deadline, suggest: ready === null ? null : suggestDeadline_(ready, cfg.cal),
    message: fits ? '' : 'Kapasitas tidak cukup untuk ' + (deadline ? 'deadline' : 'SLA standar') + ' ' + showTime_(target, cfg.cal) + '. Paling cepat selesai ' + showTime_(ready, cfg.cal) + '.' };
}
function quote_(db, b) {
  var service = one_(b, 'service', ['dtfr', 'dtfm', 'sub']), deadline = deadline_(b), raw = settings_(db);
  var items = buildItems_(b, numeric_(raw));
  var meter = round2_(items.reduce(function (a, i) { return a + i.meter; }, 0));
  var total = Math.round(items.reduce(function (a, i) { return a + i.price * i.qty; }, 0));
  return { raw: raw, meter: meter, total: total, result: evaluate_(db, raw, service === 'sub' ? 'sub' : 'dtf', meter, deadline) };
}
function capacityRoute_(ctx, action, b) {
  var db = ctx.db, u = ctx.user;
  if (action === 'check') {
    allow_(ctx, ['cs', 'store'], 'input');
    var q = quote_(db, b), data = { meter: q.meter, total: q.total };
    Object.keys(q.result).forEach(function (k) { data[k] = q.result[k]; });
    return { status: 200, data: data };
  }
  if (action === 'loss') {
    allow_(ctx, ['cs', 'store'], 'input');
    var name = str_(b, 'name', 150), x = quote_(db, b);
    if (x.result.fits) throw err_(400, 'Kapasitas masih tersedia; loss sales kapasitas hanya dicatat bila penuh');
    var cal = calendar_(x.raw);
    db.insert('logs', { order_no: '-', type: 'Loss Sales', reason: 'Kapasitas penuh: ' + name + ', ' + x.meter + ' m, target ' + showTime_(x.result.target, cal) + ', tersedia ' + showTime_(x.result.ready, cal), value: x.total, counted: 1, by_user: u.code, at: Date.now() });
    audit_(ctx, 'capacity_loss', 'log', null, { meter: x.meter, total: x.total });
    return { status: 201, data: { ok: true } };
  }
  allow_(ctx, ['spv'], 'produksi');
  var day = str_(b, 'day', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || isNaN(Date.parse(day + 'T00:00:00Z'))) throw err_(400, 'Tanggal tidak valid');
  var settings = settings_(db), today = localDay_(Date.now(), calendar_(settings));
  var list = overtimeOf_(settings).filter(function (o) { return o.day >= today; });
  if (b.remove === true) list = list.filter(function (o) { return o.day !== day; });
  else {
    var start = str_(b, 'start', 5), end = str_(b, 'end', 5), reason = str_(b, 'reason', 200), time = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!time.test(start) || !time.test(end) || start >= end) throw err_(400, 'Jam lembur tidak valid');
    if (day < today) throw err_(400, 'Tanggal lembur sudah lewat');
    list.push({ day: day, start: start, end: end, reason: reason, by: u.code });
    if (list.length > 60) throw err_(400, 'Terlalu banyak jadwal lembur');
  }
  var row = db.find('settings', function (r) { return r.key === 'overtime'; });
  if (row) db.update('settings', row, { value: JSON.stringify(list) }); else db.insert('settings', { key: 'overtime', value: JSON.stringify(list) });
  audit_(ctx, b.remove === true ? 'overtime_removed' : 'overtime_added', 'settings', day, b);
  return { status: 200, data: { ok: true } };
}

// ---------- Order ----------
function buildItems_(b, s) {
  if (b.service === 'dtfr') {
    var items = [];
    Object.keys(RETAIL).forEach(function (k) {
      var d = RETAIL[k], n = Number((b.qty || {})[k] || 0);
      if (n === 0) return;
      if (n % 1 !== 0 || n < 0 || n > 100000) throw err_(400, 'Jumlah pcs harus bilangan bulat positif');
      var best = Infinity;
      [[d.w, d.l], [d.l, d.w]].forEach(function (p) { var per = Math.floor(CANVAS_CM / p[0]); if (per > 0) best = Math.min(best, Math.ceil(n / per) * p[1]); });
      items.push({ name: k, qty: n, unit: 'pcs', price: d.p[n <= 11 ? 0 : n <= 36 ? 1 : 2], meter: best / 100 });
    });
    if (!items.length) throw err_(400, 'Isi jumlah minimal satu ukuran');
    return items;
  }
  var m = Number(b.meter);
  if (!(m > 0) || m > 100000 || Math.abs(Math.round(m * 100) - m * 100) > 1e-6) throw err_(400, 'Panjang harus lebih dari 0 meter, maksimal 2 angka desimal');
  if (b.service === 'dtfm') {
    if (!s.priceDtf) throw err_(400, 'Harga DTF maklon belum diatur');
    return [{ name: 'DTF maklon per meter', qty: m, unit: 'meter', price: s.priceDtf, meter: m }];
  }
  var w = WIDTHS.filter(function (x) { return x[0] === b.width; })[0];
  if (!w) throw err_(400, 'Pilih lebar kain');
  if (!s[w[0]]) throw err_(400, 'Harga sublim untuk lebar ini belum diatur di Pengaturan');
  return [{ name: 'Sublim print + press, ' + w[1].toLowerCase(), qty: m, unit: 'meter', price: s[w[0]], meter: m }];
}
function paidOf_(db, id) { return db.filter('payments', function (p) { return p.order_id === id; }).reduce(function (a, p) { return a + p.amount; }, 0); }
function release_(db, o) {
  if (o.status !== 'bayar' || paidOf_(db, o.id) < o.total) return false;
  db.update('orders', o, { status: 'antrian', approved_at: Date.now() });
  return true;
}
// Deadline: tanggal, boleh diikuti jam (WITA).
var DEADLINE_RE = /^\d{4}-\d{2}-\d{2}( ([01]\d|2[0-3]):[0-5]\d)?$/;
function deadline_(b) {
  var d = opt_(b, 'deadline', 16);
  if (d && !DEADLINE_RE.test(d)) throw err_(400, 'Format deadline tidak valid');
  return d;
}
// Resi untuk customer: 10 karakter acak tanpa I, L, O, U.
function newResi_() {
  var chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var s = sha256Bytes_(utf8_(Utilities.getUuid() + Utilities.getUuid())).slice(0, 10).map(function (x) { return chars.charAt(x & 31); }).join('');
  return 'RS-' + s.slice(0, 5) + '-' + s.slice(5);
}
function checkFile_(ctx, key, kind) {
  var f = ctx.db.find('files', function (x) { return x.key === key && x.kind === kind && x.confirmed === 1 && x.uploaded_by === ctx.user.id; });
  if (!f) throw err_(400, 'Berkas unggahan tidak ditemukan');
}

function createOrder_(ctx, b) {
  allow_(ctx, ['cs', 'store'], 'input');
  var db = ctx.db, u = ctx.user;
  var requestKey = str_(b, 'request_key', 64);
  var type = one_(b, 'type', ['retail', 'maklon']);
  var service = one_(b, 'service', ['dtfr', 'dtfm', 'sub']);
  var source = u.role === 'store' ? 'Toko' : one_(b, 'source', ['WhatsApp', 'Datang langsung', 'Toko']);
  var fileRef = str_(b, 'file_ref', 300), fileKey = opt_(b, 'file_key', 200), deadline = deadline_(b);
  var method = b.paid_method == null ? null : one_(b, 'paid_method', ['Transfer', 'QRIS', 'Tunai']);
  var dup = db.find('orders', function (o) { return o.request_key === requestKey; });
  if (dup) return { status: 201, data: { id: dup.id, order_no: dup.order_no, track_code: dup.track_code, duplicate: true } };
  if (fileKey) checkFile_(ctx, fileKey, 'artwork');
  var raw = settings_(db);
  var items = buildItems_(b, numeric_(raw));
  var total = Math.round(items.reduce(function (a, i) { return a + i.price * i.qty; }, 0));
  var meter = round2_(items.reduce(function (a, i) { return a + i.meter; }, 0));
  // Order hanya diterima bila jadwal masih cukup (deadline, atau SLA standar bila kosong).
  var capacity = evaluate_(db, raw, service === 'sub' ? 'sub' : 'dtf', meter, deadline);
  if (!capacity.fits) throw err_(409, capacity.message);
  var customerId = null, name, wa;
  if (type === 'maklon' && b.customer_code) {
    var code = str_(b, 'customer_code', 40);
    var cu = db.find('customers', function (c) { return c.code === code; });
    if (!cu || cu.status === 'ditolak') throw err_(400, 'Pelanggan tidak ditemukan atau dinonaktifkan');
    customerId = cu.id; name = cu.name; wa = cu.wa;
  } else {
    name = str_(b, 'name', 150); wa = str_(b, 'wa', 40);
    if (type === 'maklon') {
      var n = db.filter('customers', function (c) { return c.code.indexOf('BR-') === 0; }).length;
      customerId = db.insert('customers', { code: 'BR-' + ('000' + (n + 1)).slice(-4), name: name, wa: wa, source: 'Customer baru', status: 'aktif', created_at: Date.now() }).id;
    }
  }
  var t = Date.now(), svc = service === 'sub' ? 'sub' : 'dtf', track = newResi_();
  var id = db.all('orders').reduce(function (m, o) { return Math.max(m, o.id); }, 0) + 1;
  var orderNo = 'SDP-' + localDay_(t, calendar_(raw)).slice(2).replace(/-/g, '') + '-' + ('00' + id).slice(-Math.max(3, String(id).length));
  db.insert('orders', {
    id: id, order_no: orderNo, track_code: track, type: type, service: svc, customer_id: customerId, customer_name: name, wa: wa, source: source,
    store: source === 'Toko' ? u.store || opt_(b, 'store', 100) || 'Toko' : null, items: JSON.stringify(items), meter: meter, total: total, file_ref: fileRef, file_key: fileKey,
    deadline: deadline, note: opt_(b, 'note', 500), status: 'cek', stage: svc === 'dtf' ? 'dtf' : 'subp', priority: 0, created_by: u.code, created_at: t, request_key: requestKey
  });
  if (method) db.insert('payments', { order_id: id, amount: total, method: method, by_user: u.code, at: t });
  audit_(ctx, 'order_created', 'order', id);
  return { status: 201, data: { id: id, order_no: orderNo, track_code: track, total: total } };
}

function orderAction_(ctx, id, action, b) {
  var db = ctx.db, u = ctx.user, now = Date.now();
  var rules = {
    'file-check': [['op', 'spv'], 'cekfile'], revise: [['cs', 'spv'], 'cs'], reject: [['cs', 'spv'], 'cs'], payments: [['cs', 'store'], null],
    priority: [['spv'], 'produksi'], start: [['op', 'spv'], 'produksi'], curing: [['op', 'spv'], 'produksi'], finish: [['op', 'spv'], 'produksi'],
    qc: [['op', 'qc', 'spv'], 'qc'], pack: [['op', 'qc', 'spv'], 'qc'], handover: [['cs', 'spv', 'gudang'], 'serah']
  };
  var rule = rules[action];
  if (!rule) throw err_(404, 'Endpoint tidak ditemukan');
  allow_(ctx, rule[0], rule[1]);
  var o = db.find('orders', function (x) { return x.id === id; });
  if (!o || (u.role === 'store' && o.created_by !== u.code)) throw err_(404, 'Order tidak ditemukan');
  function done(data, status) { audit_(ctx, action, 'order', o.id); return { status: status || 200, data: data || { ok: true } }; }
  function need(cond, msg) { if (!cond) throw err_(409, msg); }

  if (action === 'file-check') {
    var ok = b.ok === true;
    if (ok && !(Array.isArray(b.checks) && b.checks.length === FILE_CHECK_COUNT && b.checks.every(function (x) { return x === true; }))) throw err_(400, 'Centang semua butir, atau tandai tidak layak');
    var issue = ok ? null : str_(b, 'issue', 500);
    need(o.status === 'cek', 'Order tidak sedang menunggu cek file');
    db.update('orders', o, { status: ok ? 'bayar' : 'revisi', issue: issue });
    return done({ ok: true, released: ok ? release_(db, o) : false });
  }
  if (action === 'revise') {
    var ref = str_(b, 'file_ref', 300), key = opt_(b, 'file_key', 200);
    need(o.status === 'revisi', 'Order tidak sedang menunggu revisi');
    if (key) checkFile_(ctx, key, 'artwork');
    db.update('orders', o, { status: 'cek', file_ref: ref, file_key: key, issue: null });
    return done();
  }
  if (action === 'reject') {
    var reason = one_(b, 'reason', ['Harga tidak cocok', 'Customer batal', 'Deadline tidak terkejar', 'Bahan habis', 'Double input']);
    need(['cek', 'revisi', 'bayar'].indexOf(o.status) >= 0, 'Order sudah masuk produksi dan tidak dapat ditolak');
    db.update('orders', o, { status: 'ditolak' });
    db.insert('logs', { order_no: o.order_no, type: 'Loss Sales', reason: reason, value: o.total, counted: reason === 'Double input' ? 0 : 1, by_user: u.code, at: now });
    return done({ ok: true, paid: paidOf_(db, o.id) });
  }
  if (action === 'payments') {
    var amount = num_(b, 'amount');
    if (amount % 1 !== 0) throw err_(400, 'Nominal rupiah harus bilangan bulat');
    var method = one_(b, 'method', ['Transfer', 'QRIS', 'Tunai']), rk = str_(b, 'request_key', 64);
    if (db.find('payments', function (p) { return p.request_key === rk; })) return { status: 201, data: { ok: true, duplicate: true, released: false } };
    need(o.status !== 'ditolak', 'Order sudah ditolak');
    var left = o.total - paidOf_(db, o.id);
    need(amount <= left, 'Nominal melebihi sisa tagihan (' + left + ')');
    db.insert('payments', { order_id: o.id, amount: amount, method: method, by_user: u.code, at: now, request_key: rk });
    return done({ ok: true, released: release_(db, o) }, 201);
  }
  if (action === 'priority') {
    need(o.status === 'antrian', 'Hanya order di antrian yang dapat diprioritaskan');
    db.update('orders', o, { priority: b.on ? 1 : 0 });
    return done();
  }
  var busy = function (x) { return x.status === 'produksi' || x.status === 'curing'; };
  if (action === 'start') {
    need(o.status === 'antrian', 'Order tidak berada di antrian');
    need(paidOf_(db, o.id) >= o.total, 'Order belum lunas');
    var day = localDay_(now, calendar_(settings_(db)));
    var reports = db.filter('qc_reports', function (r) { return r.machine === o.stage && r.day === day; });
    need(reports.length && reports[reports.length - 1].status === 'siap', 'QC pagi mesin ini belum disetujui leader');
    need(!db.find('orders', function (x) { return x.stage === o.stage && busy(x); }), 'Mesin masih mengerjakan order lain');
    db.update('orders', o, { status: 'produksi', started_at: now });
    return done({ ok: true, stage: o.stage });
  }
  if (action === 'curing') {
    need(o.stage === 'dtf' && o.status === 'produksi', 'Order tidak sedang dicetak di mesin DTF');
    db.update('orders', o, { status: 'curing' });
    return done();
  }
  if (action === 'finish') {
    var process = null;
    if (o.stage === 'subp') need(o.status === 'produksi', 'Order tidak sedang dicetak');
    else {
      need(o.status === (o.stage === 'dtf' ? 'curing' : 'produksi'), o.stage === 'dtf' ? 'Order belum masuk tahap curing' : 'Order tidak sedang dipress');
      var temp = num_(b, 'temp'), sec = num_(b, 'seconds');
      if (o.stage === 'dtf' && (temp < CURING.minC || temp > CURING.maxC || sec < CURING.minS || sec > CURING.maxS)) throw err_(400, 'Standar curing ' + CURING.minC + ' sampai ' + CURING.maxC + ' °C selama ' + CURING.minS + ' sampai ' + CURING.maxS + ' detik');
      process = temp + ' °C, ' + sec + ' detik';
    }
    var meter = o.rework_m == null ? o.meter : o.rework_m;
    var used = db.filter('skus', function (k) { return k.machine === o.stage && k.use_per_m > 0; });
    used.forEach(function (k) {
      var q = round2_(k.use_per_m * meter);
      db.update('skus', k, { stock: round2_((k.stock || 0) - q) });
      db.insert('stock_ledger', { sku_code: k.code, type: 'Pakai', qty: -q, ref: o.order_no, by_user: u.code, at: now });
    });
    var next = o.stage === 'subp' ? 'press' : 'qc';
    db.update('orders', o, o.stage === 'subp' ? { status: 'antrian', stage: 'cal' } : { status: 'qc', process: process, finished_at: now });
    return done({ ok: true, next: next, deducted: used.length });
  }
  if (action === 'qc') {
    need(o.status === 'qc', 'Order tidak sedang menunggu QC');
    if (b.pass === true) {
      if (!(Array.isArray(b.checks) && b.checks.length === QC_CHECK_COUNT[o.service] && b.checks.every(function (x) { return x === true; }))) throw err_(400, 'Centang semua butir, atau catat reject');
      db.update('orders', o, { status: 'packing', rework_m: null, qc_by: u.code });
    } else {
      var reject = num_(b, 'reject_m'), max = o.rework_m == null ? o.meter : o.rework_m;
      if (reject > max) throw err_(400, 'Meter reject tidak boleh melebihi ' + max);
      db.insert('logs', { order_no: o.order_no, type: 'Reject', reason: 'Tidak lolos QC, ' + reject + ' m dicetak ulang', value: null, counted: 0, by_user: u.code, at: now });
      db.update('orders', o, { status: 'antrian', approved_at: now, stage: o.service === 'dtf' ? 'dtf' : 'subp', rework_m: reject, qc_by: u.code });
    }
    return done();
  }
  if (action === 'pack') {
    need(o.status === 'packing', 'Order belum lolos QC');
    db.update('orders', o, { status: 'siap' });
    return done();
  }
  var receiver = str_(b, 'receiver', 120);
  need(o.status === 'siap', 'Order belum siap kirim');
  db.update('orders', o, { status: 'selesai', receiver: receiver, handed_at: now });
  return done();
}

// ---------- Kelola Data: khusus master (sama dengan src/routes/manage.ts). audit_log tidak pernah dihapus. ----------
var STATUSES = ['cek', 'revisi', 'bayar', 'antrian', 'produksi', 'curing', 'qc', 'packing', 'siap', 'selesai', 'ditolak'];
function manage_(ctx, method, path, b) {
  allow_(ctx, []);
  var db = ctx.db, m, ok = { status: 200, data: { ok: true } };
  function byId(table, id, label) { var r = db.find(table, function (x) { return x.id === id; }); if (!r) throw err_(404, label + ' tidak ditemukan'); return r; }
  if ((m = /^\/api\/manage\/orders\/(\d+)$/.exec(path))) {
    var o = byId('orders', Number(m[1]), 'Order');
    if (method === 'DELETE') {
      var used = {};
      db.filter('stock_ledger', function (l) { return l.ref === o.order_no && l.type === 'Pakai'; }).forEach(function (l) { used[l.sku_code] = (used[l.sku_code] || 0) + l.qty; });
      Object.keys(used).forEach(function (code) { var k = db.find('skus', function (x) { return x.code === code; }); if (k) db.update('skus', k, { stock: round2_((k.stock || 0) - used[code]) }); });
      var oid = o.id, no = o.order_no, total = o.total;
      db.remove('stock_ledger', function (l) { return l.ref === no; });
      db.remove('payments', function (p) { return p.order_id === oid; });
      db.remove('logs', function (l) { return l.order_no === no; });
      db.remove('orders', function (x) { return x.id === oid; });
      audit_(ctx, 'manage_order_delete', 'order', oid, { order_no: no, total: total });
      return ok;
    }
    if (method === 'PATCH') {
      var status = b.status === undefined ? o.status : one_(b, 'status', STATUSES);
      var stage = b.stage === undefined ? o.stage : one_(b, 'stage', ['dtf', 'subp', 'cal']);
      if ((stage === 'dtf') !== (o.service === 'dtf')) throw err_(400, 'Tahap mesin tidak sesuai layanan order');
      if (status === 'curing' && stage !== 'dtf') throw err_(400, 'Curing hanya untuk DTF');
      var running = ['produksi', 'curing'];
      if (running.indexOf(status) >= 0 && db.find('orders', function (x) { return x.stage === stage && x.id !== o.id && running.indexOf(x.status) >= 0; })) throw err_(409, 'Mesin masih mengerjakan order lain');
      var t = Date.now();
      db.update('orders', o, {
        customer_name: b.customer_name === undefined ? o.customer_name : str_(b, 'customer_name', 150),
        wa: b.wa === undefined ? o.wa : str_(b, 'wa', 40),
        file_ref: b.file_ref === undefined ? o.file_ref : str_(b, 'file_ref', 300),
        note: b.note === undefined ? o.note : opt_(b, 'note', 500),
        deadline: b.deadline === undefined ? o.deadline : deadline_(b),
        status: status, stage: stage,
        approved_at: o.approved_at || (['antrian', 'produksi', 'curing'].indexOf(status) >= 0 ? t : null),
        started_at: o.started_at || (running.indexOf(status) >= 0 ? t : null)
      });
      audit_(ctx, 'manage_order_edit', 'order', o.id, b);
      return ok;
    }
  }
  if (method === 'DELETE' && (m = /^\/api\/manage\/(payments|logs|qc)\/(\d+)$/.exec(path))) {
    var table = m[1] === 'qc' ? 'qc_reports' : m[1], rid = Number(m[2]);
    var row = byId(table, rid, m[1] === 'payments' ? 'Pembayaran' : m[1] === 'qc' ? 'Laporan QC' : 'Catatan');
    audit_(ctx, 'manage_' + m[1] + '_delete', table, rid, row);
    db.remove(table, function (x) { return x.id === rid; });
    return ok;
  }
  if ((m = /^\/api\/manage\/customers\/(\d+)$/.exec(path))) {
    var c = byId('customers', Number(m[1]), 'Pelanggan'), cid = c.id;
    if (method === 'DELETE') {
      if (db.find('orders', function (x) { return x.customer_id === cid; })) throw err_(409, 'Pelanggan masih punya order. Hapus ordernya dahulu.');
      db.remove('customers', function (x) { return x.id === cid; });
      audit_(ctx, 'manage_customer_delete', 'customer', cid);
      return ok;
    }
    if (method === 'PATCH') {
      db.update('customers', c, {
        name: b.name === undefined ? c.name : str_(b, 'name', 150),
        wa: b.wa === undefined ? c.wa : str_(b, 'wa', 40),
        status: b.status === undefined ? c.status : one_(b, 'status', ['aktif', 'menunggu', 'ditolak'])
      });
      audit_(ctx, 'manage_customer_edit', 'customer', cid, b);
      return ok;
    }
  }
  if (method === 'PUT' && (m = /^\/api\/manage\/stock\/([A-Za-z0-9_-]+)$/.exec(path))) {
    var stock = num_(b, 'stock', true), sku = db.find('skus', function (x) { return x.code === m[1]; });
    if (!sku) throw err_(404, 'SKU tidak ditemukan');
    db.update('skus', sku, { stock: stock });
    audit_(ctx, 'manage_stock_set', 'sku', sku.code, { stock: stock });
    return ok;
  }
  if (method === 'DELETE' && (m = /^\/api\/manage\/users\/(\d+)$/.exec(path))) {
    var uid = Number(m[1]);
    if (uid === ctx.user.id) throw err_(403, 'Akun yang sedang dipakai tidak dapat dihapus');
    var target = byId('users', uid, 'Pengguna'), code = target.code;
    if (db.find('files', function (f) { return f.uploaded_by === uid; })) throw err_(409, 'Pengguna ini punya berkas unggahan. Nonaktifkan saja, atau bersihkan data simulasi dahulu.');
    db.remove('sessions', function (x) { return x.user_id === uid; });
    db.remove('users', function (x) { return x.id === uid; });
    audit_(ctx, 'manage_user_delete', 'user', uid, { code: code });
    return ok;
  }
  if (method === 'POST' && path === '/api/manage/reset') {
    if (b.confirm !== 'HAPUS SEMUA') throw err_(400, 'Ketik HAPUS SEMUA untuk melanjutkan');
    // Berkas di Drive tidak dihapus; hanya catatannya di spreadsheet.
    ['payments', 'logs', 'stock_ledger', 'qc_reports', 'orders', 'files'].concat(b.customers === true ? ['customers'] : []).forEach(function (t2) { db.remove(t2, function () { return true; }); });
    db.all('skus').forEach(function (k) { db.update('skus', k, { stock: 0 }); });
    audit_(ctx, 'manage_reset', 'all', null, { customers: b.customers === true });
    return ok;
  }
  throw err_(404, 'Endpoint tidak ditemukan');
}

// ---------- Potret data untuk layar ----------
function state_(ctx) {
  var db = ctx.db, u = ctx.user, master = u.role === 'master';
  var pages = master ? GRANTABLE.concat(['atur', 'pengguna', 'akses', 'data', 'akun']) : pages_(db, u.role).concat(['akun']);
  function has() { return Array.prototype.slice.call(arguments).some(function (p) { return pages.indexOf(p) >= 0; }); }
  var raw = settings_(db), cal = calendar_(raw);
  var out = { api: 3, workBlocks: raw.work_blocks || WORK_BLOCKS_DEFAULT, me: { code: u.code, name: u.name, role: u.role, store: u.store }, pages: pages, today: localDay_(Date.now(), cal), calendar: cal, settings: numeric_(raw), orders: [], customers: [], skus: [], ledger: [], loss: [], qcReports: [], users: [], access: {} };
  if (ORDER_PAGES.some(function (p) { return pages.indexOf(p) >= 0; })) {
    var custCode = {};
    db.all('customers').forEach(function (c) { custCode[c.id] = c.code; });
    var all = db.filter('orders', function (o) { return u.role !== 'store' || o.created_by === u.code; });
    var closed = all.filter(function (o) { return o.status === 'selesai' || o.status === 'ditolak'; }).slice(-300);
    var list = all.filter(function (o) { return o.status !== 'selesai' && o.status !== 'ditolak'; }).concat(closed).sort(function (a, b) { return a.id - b.id; });
    var pays = {};
    db.all('payments').forEach(function (p) { (pays[p.order_id] = pays[p.order_id] || []).push({ id: p.id, amount: p.amount, method: p.method, by: p.by_user, at: p.at }); });
    var contact = master || ['cs', 'crm', 'store', 'spv', 'manager', 'fat'].indexOf(u.role) >= 0;
    out.orders = list.map(function (o) {
      return {
        dbId: o.id, id: o.order_no, track: o.track_code, type: o.type, service: o.service, custCode: custCode[o.customer_id] || null, customer: o.customer_name, wa: contact ? o.wa : '', source: o.source, store: o.store || '-',
        items: JSON.parse(o.items), total: o.total, meter: o.meter, file: o.file_ref, fileKey: o.file_key, deadline: o.deadline, note: o.note, status: o.status, stage: o.stage, priority: !!o.priority, issue: o.issue, reworkM: o.rework_m, process: o.process,
        receiver: o.receiver, createdBy: o.created_by, created: o.created_at, approved: o.approved_at, started: o.started_at, pay: pays[o.id] || []
      };
    });
  }
  if (has('input', 'pelanggan', 'cs', 'cekfile')) out.customers = db.all('customers').map(function (c) { return { id: c.id, code: c.code, name: c.name, wa: c.wa, source: c.source, status: c.status }; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  if (has('stok', 'dashboard')) out.skus = db.all('skus').map(function (k) { return { code: k.code, name: k.name, svc: k.svc, unit: k.unit, stock: k.stock || 0, min: k.min_stock || 0, use: k.use_per_m, machine: k.machine }; }).sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  if (has('stok')) out.ledger = db.all('stock_ledger').slice(-50).reverse().map(function (l) { return { at: l.at, code: l.sku_code, type: l.type, qty: l.qty, ref: l.ref }; });
  if (has('input', 'dashboard', 'produksi')) {
    var cfg = planConfig_(raw), jobs = activeJobs_(db), t = Date.now();
    out.capacity = { days: days_(jobs, t, cfg), slots: plan_(jobs, t, cfg).slots, slaDue: slaDue_(t, cfg.cal), overtime: overtimeOf_(raw).filter(function (o) { return o.day >= out.today; }) };
  }
  if (has('loss', 'dashboard', 'laporan')) out.loss = db.all('logs').slice(-300).reverse().map(function (l) { return { logId: l.id, id: l.order_no, type: l.type, reason: l.reason, value: l.value, count: l.counted, at: l.at }; });
  if (has('qc', 'produksi')) out.qcReports = db.all('qc_reports').slice(-60).map(function (r) { return { id: r.id, machine: r.machine, day: r.day, ng: JSON.parse(r.ng), note: r.note || '', action: r.action || '', photos: JSON.parse(r.photos), status: r.status, by: r.by_user, at: r.at, approvedBy: r.approved_by, leaderNote: r.leader_note || '' }; });
  if (master) {
    out.users = db.all('users').map(function (x) { return { id: x.id, code: x.code, name: x.name, role: x.role, store: x.store, active: x.active, must_change_password: x.must_change_password }; });
    Object.keys(ACCESS_DEFAULT).forEach(function (r) { out.access[r] = pages_(db, r); });
  }
  return { status: 200, data: out };
}

// ---------- Rute ----------
function findUser_(db, code) { var c = String(code).toUpperCase(); return db.find('users', function (u) { return u.code.toUpperCase() === c; }); }
function addUser_(db, code, name, role, store, password, mustChange) {
  var h = hashPassword_(password);
  return db.insert('users', { code: code, name: name, role: role, store: store, active: 1, pass_hash: h.hash, pass_salt: h.salt, pass_iter: h.iter, must_change_password: mustChange, session_epoch: 0, created_at: Date.now() });
}

function route_(req) {
  var method = req.method, path = String(req.path || '').split('?')[0], b = req.body || {};
  var db = makeStore_(), ctx = { db: db, user: null }, m;

  if (method === 'GET' && path === '/api/public/info') {
    var s = numeric_(settings_(db));
    return { status: 200, data: { settings: { priceDtf: s.priceDtf, priceSub120: s.priceSub120, priceSub160: s.priceSub160, priceSub180: s.priceSub180 } } };
  }
  if (method === 'GET' && (m = /^\/api\/public\/track\/([A-Za-z0-9_-]{20,64}|[Rr][Ss]-[0-9A-Za-z]{5}-[0-9A-Za-z]{5})$/.exec(path))) {
    var resi = /^rs-/i.test(m[1]) ? m[1].toUpperCase() : m[1];
    var o = db.find('orders', function (x) { return x.track_code === resi; });
    if (!o) throw err_(404, 'Resi tidak ditemukan');
    var estimate = null;
    if (['antrian', 'produksi', 'curing'].indexOf(o.status) >= 0) {
      var raw = settings_(db), norm = numeric_(raw)[NORM_KEY[o.stage]];
      if (norm) {
        var cal = calendar_(raw), cursor = Date.now();
        var q = db.filter('orders', function (x) { return x.stage === o.stage && ['antrian', 'produksi', 'curing'].indexOf(x.status) >= 0; })
          .sort(function (a, c) { return (c.status !== 'antrian') - (a.status !== 'antrian') || c.priority - a.priority || a.approved_at - c.approved_at || a.id - c.id; });
        for (var i = 0; i < q.length; i++) {
          var end = addWork_(q[i].status === 'antrian' ? cursor : q[i].started_at, (q[i].rework_m == null ? q[i].meter : q[i].rework_m) * norm, cal);
          cursor = Math.max(cursor, end);
          if (q[i].id === o.id) { estimate = end; break; }
        }
      }
    }
    return { status: 200, data: { service: o.service, items: JSON.parse(o.items).map(function (i) { return { name: i.name, qty: i.qty, unit: i.unit }; }), status: o.status, estimate: estimate } };
  }

  if (method === 'POST' && path === '/api/bootstrap') {
    var props = PropertiesService.getScriptProperties(), secret = props.getProperty('BOOTSTRAP_TOKEN');
    if (!secret || secret.length < 16) throw err_(503, 'Bootstrap belum diaktifkan');
    if (sha_(str_(b, 'token', 200)) !== sha_(secret)) throw err_(403, 'Token bootstrap salah');
    if (db.find('users', function (u) { return u.role === 'master'; })) throw err_(403, 'Master sudah ada');
    var problem = passwordProblem_(b.password);
    if (problem) throw err_(400, problem);
    addUser_(db, str_(b, 'username', 32).toUpperCase(), str_(b, 'full_name', 120), 'master', null, b.password, 0);
    return { status: 200, data: { ok: true } };
  }

  if (method === 'POST' && path === '/api/auth/login') {
    var code = str_(b, 'username', 32), password = str_(b, 'password', 200);
    var cache = CacheService.getScriptCache(), ck = 'fail:' + code.toUpperCase(), fails = Number(cache.get(ck) || 0);
    if (fails >= 5) throw err_(429, 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.');
    var u = findUser_(db, code);
    if (!u || !verifyPassword_(password, u) || !u.active) { cache.put(ck, String(fails + 1), 900); throw err_(401, 'Username atau password salah'); }
    cache.remove(ck);
    db.remove('sessions', function (x) { return x.expires_at < Date.now(); });
    var token = random_(32);
    db.insert('sessions', { id: sha_(token), user_id: u.id, epoch: u.session_epoch, created_at: Date.now(), expires_at: Date.now() + SESSION_TTL_MS });
    return { status: 200, data: { token: token, role: u.role, code: u.code, must_change_password: !!u.must_change_password } };
  }

  // ---- Wajib login ----
  if (!req.token) throw err_(401, 'Belum login');
  var sid = sha_(String(req.token));
  var session = db.find('sessions', function (x) { return x.id === sid; });
  var me = session && db.find('users', function (x) { return x.id === session.user_id; });
  if (!me || session.expires_at < Date.now() || !me.active || session.epoch !== me.session_epoch) throw err_(401, 'Sesi tidak berlaku, silakan login lagi');
  ctx.user = me;

  if (path === '/api/auth/me' && method === 'GET') return { status: 200, data: { id: me.id, code: me.code, name: me.name, role: me.role, store: me.store, must_change: !!me.must_change_password, csrf: 'sheets' } };
  if (path === '/api/auth/logout' && method === 'POST') { db.remove('sessions', function (x) { return x.id === sid; }); return { status: 200, data: { ok: true } }; }
  if (path === '/api/auth/change-password' && method === 'POST') {
    var cur = str_(b, 'current_password', 200), next = str_(b, 'new_password', 200), p = passwordProblem_(next);
    if (p) throw err_(400, p);
    if (!verifyPassword_(cur, me)) throw err_(403, 'Password saat ini salah');
    if (cur === next) throw err_(400, 'Password baru harus berbeda');
    var h = hashPassword_(next);
    db.update('users', me, { pass_hash: h.hash, pass_salt: h.salt, pass_iter: h.iter, must_change_password: 0, session_epoch: me.session_epoch + 1 });
    db.remove('sessions', function (x) { return x.user_id === me.id; });
    audit_(ctx, 'password_changed');
    return { status: 200, data: { ok: true, relogin: true } };
  }
  if (me.must_change_password) throw err_(403, 'Password awal wajib diganti terlebih dahulu');

  if (path === '/api/state' && method === 'GET') return state_(ctx);
  if (path === '/api/orders' && method === 'POST') return createOrder_(ctx, b);
  if (method === 'POST' && (m = /^\/api\/orders\/(\d+)\/([a-z-]+)$/.exec(path))) return orderAction_(ctx, Number(m[1]), m[2], b);

  if (method === 'POST' && (m = /^\/api\/capacity\/(check|loss|overtime)$/.exec(path))) return capacityRoute_(ctx, m[1], b);

  if (path === '/api/files/upload' && method === 'POST') {
    var kind = one_(b, 'kind', ['artwork', 'qc_photo']);
    if ((kind === 'artwork' ? ['master', 'cs', 'store'] : ['master', 'op', 'qc', 'spv']).indexOf(me.role) < 0) throw err_(403, 'Tidak punya hak akses');
    var name = str_(b, 'file_name', 200).replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'file';
    var type = typeof b.content_type === 'string' && b.content_type.length < 100 ? b.content_type : 'application/octet-stream';
    var bytes = Utilities.base64Decode(str_(b, 'data', Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8));
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw err_(400, 'Ukuran file maksimal 8 MB. File lebih besar: bagikan tautan Drive.');
    var file = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID')).createFile(Utilities.newBlob(bytes, type, name));
    var key = kind + '/' + random_(16);
    db.insert('files', { key: key, kind: kind, file_name: name, content_type: type, size_bytes: bytes.length, uploaded_by: me.id, uploaded_at: Date.now(), confirmed: 1, drive_id: file.getId() });
    audit_(ctx, 'file_uploaded', 'file', key);
    return { status: 201, data: { ok: true, key: key, file_name: name, size_bytes: bytes.length } };
  }
  if (method === 'GET' && (m = /^\/api\/files\/(artwork|qc_photo)\/([A-Za-z0-9_-]+)$/.exec(path))) {
    var f = db.find('files', function (x) { return x.key === m[1] + '/' + m[2]; });
    var readers = m[1] === 'artwork' ? ['master', 'manager', 'spv', 'cs', 'store', 'op'] : ['master', 'manager', 'spv', 'op', 'qc'];
    if (!f || readers.indexOf(me.role) < 0 || (me.role === 'store' && f.uploaded_by !== me.id)) throw err_(404, 'Data tidak ditemukan');
    // Berkas Drive tetap privat; isinya dikirim hanya setelah hak akses diperiksa.
    return { status: 200, data: { file_name: f.file_name, content_type: f.content_type, data: Utilities.base64Encode(DriveApp.getFileById(f.drive_id).getBlob().getBytes()) } };
  }

  if (path === '/api/qc/morning' && method === 'POST') {
    allow_(ctx, ['op', 'qc', 'spv'], 'qc');
    var machine = one_(b, 'machine', ['dtf', 'subp', 'cal']), def = MORNING[machine];
    if (!(Array.isArray(b.answers) && b.answers.length === def[0] && b.answers.every(function (x) { return x === 'OK' || x === 'NG'; }))) throw err_(400, 'Setiap butir wajib dipilih OK atau Tidak sesuai');
    var ng = MORNING_TEXT[machine].filter(function (_, i) { return b.answers[i] === 'NG'; });
    var photos = def[1].map(function (label) {
      var ph = (Array.isArray(b.photos) ? b.photos : []).filter(function (x) { return x && x.label === label; })[0];
      if (!ph || typeof ph.key !== 'string') throw err_(400, 'Lampirkan foto ' + label);
      checkFile_(ctx, ph.key, 'qc_photo');
      return { label: label, key: ph.key };
    });
    var note = opt_(b, 'note', 1500), act = opt_(b, 'action', 1500);
    if (ng.length && (!note || !act)) throw err_(400, 'Temuan dan tindakan awal wajib diisi');
    var day = localDay_(Date.now(), calendar_(settings_(db)));
    var today = db.filter('qc_reports', function (r) { return r.machine === machine && r.day === day; });
    if (today.length && today[today.length - 1].status !== 'tahan') throw err_(409, 'Laporan hari ini sudah dikirim');
    var rec = db.insert('qc_reports', { machine: machine, day: day, answers: JSON.stringify(b.answers), ng: JSON.stringify(ng), note: note, action: act, photos: JSON.stringify(photos), status: 'menunggu', by_user: me.code, at: Date.now() });
    audit_(ctx, 'qc_morning', 'qc', rec.id);
    return { status: 201, data: { ok: true } };
  }
  if (method === 'POST' && (m = /^\/api\/qc\/morning\/(\d+)\/decide$/.exec(path))) {
    allow_(ctx, ['spv'], 'qc');
    var decision = one_(b, 'decision', ['siap', 'tahan']), ln = opt_(b, 'note', 1500);
    if (decision === 'tahan' && !ln) throw err_(400, 'Alasan tahan produksi wajib diisi');
    var r = db.find('qc_reports', function (x) { return x.id === Number(m[1]); });
    if (!r) throw err_(404, 'Laporan QC tidak ditemukan');
    if (r.status !== 'menunggu') throw err_(409, 'Laporan ini sudah diputuskan');
    if (decision === 'siap' && JSON.parse(r.ng).length) throw err_(409, 'Ada butir tidak sesuai. Operator perbaiki lalu kirim QC baru');
    db.update('qc_reports', r, { status: decision, approved_by: me.code, approved_at: Date.now(), leader_note: ln });
    audit_(ctx, 'qc_morning_' + decision, 'qc', r.id);
    return { status: 200, data: { ok: true } };
  }

  if (path === '/api/customers/import' && method === 'POST') {
    allow_(ctx, ['crm'], 'pelanggan');
    if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 2000) throw err_(400, 'Isi 1 sampai 2000 baris');
    var rows = b.rows.map(function (row, i) {
      try { return { code: str_(row, 'code', 40).toUpperCase(), name: str_(row, 'name', 150), wa: str_(row, 'wa', 40) }; }
      catch (e) { throw err_(400, 'Baris ' + (i + 1) + ': kode, nama, dan WhatsApp wajib diisi'); }
    });
    var have = {}, added = 0;
    db.all('customers').forEach(function (c) { have[c.code] = true; });
    rows.forEach(function (c) {
      if (have[c.code]) return;
      have[c.code] = true; added++;
      db.insert('customers', { code: c.code, name: c.name, wa: c.wa, source: 'Tigalapan Kaos', status: 'aktif', verified_by: me.code, verified_at: Date.now(), created_at: Date.now() });
    });
    audit_(ctx, 'customers_imported', 'customer', null, { added: added });
    return { status: 201, data: { ok: true, added: added, skipped: rows.length - added } };
  }
  if (path === '/api/stock/move' && method === 'POST') {
    allow_(ctx, ['gudang', 'op', 'spv'], 'stok');
    var skuCode = str_(b, 'sku', 60), kindMove = one_(b, 'type', ['Stok masuk', 'Waste', 'Cleaning', 'Koreksi kurang']), qty = num_(b, 'qty');
    var delta = kindMove === 'Stok masuk' ? qty : -qty;
    var k = db.find('skus', function (x) { return x.code === skuCode; });
    if (!k) throw err_(404, 'SKU tidak ditemukan');
    if ((k.stock || 0) + delta < 0) throw err_(409, 'Stok tidak cukup');
    db.update('skus', k, { stock: round2_((k.stock || 0) + delta) });
    db.insert('stock_ledger', { sku_code: skuCode, type: kindMove, qty: delta, ref: opt_(b, 'ref', 100) || 'manual', by_user: me.code, at: Date.now() });
    return { status: 201, data: { ok: true } };
  }
  if (method === 'PUT' && (m = /^\/api\/stock\/sku\/([A-Za-z0-9_-]+)$/.exec(path))) {
    allow_(ctx, ['gudang', 'spv'], 'stok');
    var min = num_(b, 'min', true), use = b.use === null || b.use === '' ? null : num_(b, 'use', true);
    var sku = db.find('skus', function (x) { return x.code === m[1]; });
    if (!sku) throw err_(404, 'SKU tidak ditemukan');
    db.update('skus', sku, { min_stock: min, use_per_m: use });
    audit_(ctx, 'sku_updated', 'sku', sku.code, { min: min, use: use });
    return { status: 200, data: { ok: true } };
  }

  if (path === '/api/admin/users' && method === 'POST') {
    allow_(ctx, []);
    var nc = str_(b, 'code', 32).toUpperCase();
    if (!/^[A-Z0-9._-]{3,32}$/.test(nc)) throw err_(400, 'Kode 3 sampai 32 huruf, angka, titik, atau garis');
    var role = one_(b, 'role', ROLES), pp = passwordProblem_(b.password);
    if (pp) throw err_(400, pp);
    if (findUser_(db, nc)) throw err_(409, 'Kode sudah dipakai');
    var nu = addUser_(db, nc, str_(b, 'name', 120), role, opt_(b, 'store', 100), b.password, 1);
    audit_(ctx, 'user_created', 'user', nu.id, { role: role });
    return { status: 201, data: { ok: true } };
  }
  if (method === 'PATCH' && (m = /^\/api\/admin\/users\/(\d+)$/.exec(path))) {
    allow_(ctx, []);
    var target = db.find('users', function (x) { return x.id === Number(m[1]); });
    if (!target) throw err_(404, 'Data tidak ditemukan');
    if (target.id === me.id) throw err_(403, 'Gunakan menu Akun Saya untuk akun sendiri');
    var patch = {};
    if (b.active !== undefined) patch.active = b.active ? 1 : 0;
    if (b.role !== undefined) patch.role = one_(b, 'role', ROLES);
    if (b.name !== undefined) patch.name = str_(b, 'name', 120);
    if (b.store !== undefined) patch.store = opt_(b, 'store', 100);
    if (b.new_password !== undefined) {
      var np = passwordProblem_(b.new_password);
      if (np) throw err_(400, np);
      var nh = hashPassword_(b.new_password);
      patch.pass_hash = nh.hash; patch.pass_salt = nh.salt; patch.pass_iter = nh.iter; patch.must_change_password = 1;
    }
    if (!Object.keys(patch).length) throw err_(400, 'Tidak ada perubahan');
    patch.session_epoch = target.session_epoch + 1;
    db.update('users', target, patch);
    db.remove('sessions', function (x) { return x.user_id === target.id; });
    audit_(ctx, 'user_updated', 'user', target.id);
    return { status: 200, data: { ok: true } };
  }
  if (path === '/api/admin/access' && method === 'PUT') {
    allow_(ctx, []);
    var ar = one_(b, 'role', ROLES.filter(function (x) { return x !== 'master'; }));
    if (!Array.isArray(b.pages) || !b.pages.length || !b.pages.every(function (x) { return GRANTABLE.indexOf(x) >= 0; })) throw err_(400, 'Daftar menu tidak valid (minimal satu)');
    var list = JSON.stringify(b.pages.filter(function (x, i) { return b.pages.indexOf(x) === i; }));
    var row = db.find('role_access', function (x) { return x.role === ar; });
    if (row) db.update('role_access', row, { pages: list }); else db.insert('role_access', { role: ar, pages: list });
    audit_(ctx, 'access_updated', 'role', ar, b.pages);
    return { status: 200, data: { ok: true } };
  }
  if (path === '/api/admin/access' && method === 'DELETE') {
    allow_(ctx, []);
    db.remove('role_access', function () { return true; });
    return { status: 200, data: { ok: true } };
  }
  if (path === '/api/admin/settings' && method === 'PUT') {
    allow_(ctx, []);
    var keys = Object.keys(b);
    if (!keys.length) throw err_(400, 'Tidak ada perubahan');
    keys.forEach(function (key2) {
      var v = b[key2];
      if (['priceDtf', 'priceSub120', 'priceSub160', 'priceSub180', 'normDtf', 'normSubPrint', 'normPress', 'capPct', 'holdMin', 'finDtf', 'finSub', 'work_blocks'].indexOf(key2) < 0) throw err_(400, 'Pengaturan "' + key2 + '" tidak dikenal');
      if (key2 === 'work_blocks') { if (typeof v !== 'string' || !validBlocks_(v)) throw err_(400, 'Jam produksi ditulis seperti 09:00-12:00,13:00-21:30'); return; }
      if (key2 === 'capPct' && v !== null && v > 100) throw err_(400, 'Persen kapasitas maksimal 100');
      if (v !== null && !(typeof v === 'number' && isFinite(v) && v > 0 && v < 1e9)) throw err_(400, 'Nilai "' + key2 + '" harus angka lebih dari 0, atau kosong');
      if (key2 === 'priceDtf' && v === null) throw err_(400, 'Harga DTF tidak boleh kosong');
      if (key2.indexOf('price') === 0 && v !== null && v % 1 !== 0) throw err_(400, 'Harga rupiah harus bilangan bulat');
    });
    keys.forEach(function (key2) {
      var row2 = db.find('settings', function (x) { return x.key === key2; }), val = b[key2] === null ? '' : String(b[key2]);
      if (row2) db.update('settings', row2, { value: val }); else db.insert('settings', { key: key2, value: val });
    });
    audit_(ctx, 'settings_updated', 'settings', null, b);
    return { status: 200, data: { ok: true } };
  }
  if (path.indexOf('/api/manage/') === 0) return manage_(ctx, method, path, b);
  throw err_(404, 'Endpoint tidak ditemukan');
}

// Semua perubahan diserialkan dengan kunci skrip: berfungsi sebagai transaksi.
function handle_(req) {
  var lock = null;
  try {
    if (req.method !== 'GET') { lock = LockService.getScriptLock(); lock.waitLock(25000); }
    var res = route_(req);
    if (lock) SpreadsheetApp.flush();
    return res;
  } catch (e) {
    if (e.status) return { status: e.status, data: { error: e.message } };
    console.error(e && e.stack ? e.stack : e);
    return { status: 500, data: { error: 'Terjadi kesalahan pada server' } };
  } finally {
    if (lock) lock.releaseLock();
  }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return json_({ status: 400, data: { error: 'Body tidak valid' } }); }
  return json_(handle_(req));
}
function doGet() { return json_({ status: 200, data: { app: 'SDP Print Hub', backend: 'spreadsheet' } }); }

// ---------- Dijalankan dari editor Apps Script ----------
function setup() {
  var ss = book_();
  Object.keys(SCHEMA).forEach(function (name) {
    var cols = columns_(name).map(function (c) { return c.n; });
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var db = makeStore_();
  SETTING_SEED.forEach(function (s) { if (!db.find('settings', function (x) { return x.key === s[0]; })) db.insert('settings', { key: s[0], value: s[1] }); });
  SKU_SEED.forEach(function (k) { if (!db.find('skus', function (x) { return x.code === k[0]; })) db.insert('skus', { code: k[0], name: k[1], svc: k[2], unit: k[3], stock: 0, min_stock: 0, use_per_m: null, machine: k[4] }); });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('FOLDER_ID')) props.setProperty('FOLDER_ID', DriveApp.createFolder('SDP Print Hub - File').getId());
  console.log('Setup selesai.');
}
/** Isi Script Properties MASTER_KODE dan MASTER_PASSWORD, jalankan sekali. Password dihapus dari properti setelah dipakai. */
function buatMaster() {
  var props = PropertiesService.getScriptProperties(), code = props.getProperty('MASTER_KODE'), pass = props.getProperty('MASTER_PASSWORD');
  if (!code || !pass) throw new Error('Isi Script Properties MASTER_KODE dan MASTER_PASSWORD dahulu.');
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(code)) throw new Error('MASTER_KODE 3 sampai 32 huruf atau angka.');
  var problem = passwordProblem_(pass);
  if (problem) throw new Error(problem);
  var db = makeStore_();
  if (db.find('users', function (u) { return u.role === 'master'; })) throw new Error('Master sudah ada.');
  addUser_(db, code.toUpperCase(), 'Admin Sistem', 'master', null, pass, 0);
  props.deleteProperty('MASTER_PASSWORD');
  console.log('Master ' + code.toUpperCase() + ' dibuat.');
}

// ---------- Pindah ke Supabase ----------
function sqlValue_(v) { return v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"; }
/** SQL berisi seluruh data. Jalankan di Supabase SQL Editor SETELAH migrations 0001 dan 0002, pada database kosong. */
function buatSqlSupabase_() {
  var db = makeStore_(), lines = ['BEGIN;'];
  ['users', 'settings', 'role_access', 'customers', 'orders', 'payments', 'skus', 'stock_ledger', 'qc_reports', 'logs', 'files', 'audit_log'].forEach(function (name) {
    var cols = columns_(name).map(function (c) { return c.n; }).filter(function (n) { return n !== 'drive_id'; });
    var key = name === 'settings' ? 'key' : name === 'skus' ? 'code' : null; // sudah diisi migrasi 0002
    db.all(name).forEach(function (r) {
      var sql = 'INSERT INTO ' + name + ' (' + cols.join(', ') + ') VALUES (' + cols.map(function (c) { return sqlValue_(name === 'settings' && c === 'value' && r[c] === null ? '' : r[c]); }).join(', ') + ')';
      if (key) sql += ' ON CONFLICT (' + key + ') DO UPDATE SET ' + cols.filter(function (c) { return c !== key; }).map(function (c) { return c + ' = excluded.' + c; }).join(', ');
      lines.push(sql + ';');
    });
  });
  ['users', 'customers', 'orders', 'payments', 'stock_ledger', 'qc_reports', 'logs', 'audit_log'].forEach(function (name) {
    lines.push("SELECT setval(pg_get_serial_sequence('" + name + "', 'id'), (SELECT COALESCE(MAX(id), 0) + 1 FROM " + name + '), false);');
  });
  lines.push('UPDATE bootstrap SET used_at = ' + Date.now() + ' WHERE id = 1;', 'COMMIT;');
  return lines.join('\n') + '\n';
}
function eksporSupabase() {
  var folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID'));
  var file = folder.createFile(Utilities.newBlob(buatSqlSupabase_(), 'text/plain', 'ekspor-supabase-' + new Date().toISOString().slice(0, 10) + '.sql'));
  console.log('Berkas dibuat di folder Drive: ' + file.getName() + ' (berisi data pelanggan dan hash password, jangan dibagikan)');
}
