# Backend sementara: Google Spreadsheet

Aplikasi yang sama, tetapi data disimpan di Google Spreadsheet lewat Apps Script. Nama sheet dan kolom sama dengan tabel Supabase.

## Pemasangan (sekitar 15 menit)

1. Buat Spreadsheet baru, misalnya **SDP Print Hub - Database**. **Jangan dibagikan** ke orang yang tidak mengelola sistem: isinya data pelanggan dan hash password.
2. Menu **Extensions > Apps Script**. Hapus isi `Code.gs`, tempel seluruh isi [`apps-script/Code.gs`](../apps-script/Code.gs), simpan.
3. **Project Settings** (ikon roda gigi): Time zone **(GMT+08:00) Makassar**.
4. Pilih fungsi `setup` di editor, klik **Run**, izinkan akses (Spreadsheet dan Drive). Ini membuat semua sheet dan folder Drive `SDP Print Hub - File`.
5. **Project Settings > Script Properties**, tambahkan `MASTER_KODE` (mis. `ADMIN01`) dan `MASTER_PASSWORD` (minimal 10 karakter, huruf dan angka). Jalankan fungsi `buatMaster` sekali. Password otomatis dihapus dari properti.
6. **Deploy > New deployment > Web app**: *Execute as* **Me**, *Who has access* **Anyone**. Salin URL yang berakhiran `/exec`.
7. Isi URL itu di [`public/config.js`](../public/config.js):

```js
window.SDP_CONFIG = { sheetsUrl: 'https://script.google.com/macros/s/XXXX/exec' };
```

8. Commit dan push. Di Vercel impor repo (Framework Preset **Other**) dan Deploy. **Environment Variables tidak diperlukan** selama memakai spreadsheet.

URL Web App ikut terbaca publik (ada di `config.js`). Pengaman datanya adalah login dan hak akses di dalam script, jadi pakai password yang kuat.

## Bila Code.gs diperbarui
Tempel ulang, lalu **Deploy > Manage deployments > Edit > Version: New version**. URL tetap sama.

## Batas selama memakai spreadsheet
- Setiap tindakan memakan waktu beberapa detik (Apps Script lebih lambat dari server biasa). Kecepatan di akun Google sungguhan **belum diukur**.
- Semakin banyak baris, semakin lambat. Rencanakan pindah sebelum order mencapai ribuan.
- Unggah file maksimal **8 MB**. File desain yang lebih besar: isi tautan Drive di kolom nama file.
- Jangan mengubah isi sheet dengan tangan saat aplikasi dipakai; jangan mengubah baris judul.
- Pembatasan login dihitung per kode pengguna. Hash password PBKDF2 20.000 iterasi (server Supabase memakai 600.000 untuk password baru).

## Pindah ke Supabase

1. Umumkan jeda input, lalu di editor Apps Script jalankan `eksporSupabase`. Berkas `ekspor-supabase-TANGGAL.sql` muncul di folder Drive. Berkas ini rahasia.
2. Di Supabase (database baru): jalankan `migrations/0001_schema.sql`, `0002_seed_config.sql`, lalu berkas ekspor tadi di **SQL Editor**.
3. Isi Environment Variables Vercel sesuai [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md) (tanpa `BOOTSTRAP_TOKEN`: akun sudah ikut pindah).
4. Kosongkan `sheetsUrl` di `public/config.js`, commit, push.
5. Nonaktifkan deployment Web App (Deploy > Manage deployments > Archive).

Yang ikut pindah: pengguna beserta password, pelanggan, order, pembayaran, stok, QC pagi, log, pengaturan, hak akses.
**Tidak ikut pindah: isi file** (artwork dan foto QC) tetap di folder Drive; catatannya pindah, tetapi unduhan lewat aplikasi untuk file lama tidak berfungsi di Supabase. Simpan folder Drive itu sebagai arsip.

## Uji tanpa akun Google
```bash
node --no-warnings test/gas-harness.mjs     # Code.gs dengan tiruan layanan Google; layar di http://127.0.0.1:8788
SHEETS=1 BASE_URL=http://127.0.0.1:8788 npm run test:e2e
BASE_URL=http://127.0.0.1:8788 npm run test:migrasi   # setelah uji alur: ekspor, muat ke Postgres, periksa
```
