# Bukti pengujian

Dijalankan 26 November 2026, Windows 11, Node.js 26. Server uji menjalankan aplikasi yang sama dengan produksi di atas Postgres (PGlite) dan penyimpanan lokal, dari database kosong.

| Pemeriksaan | Hasil |
|---|---|
| `npm run typecheck` | bersih |
| `npm test` | 9 lolos, 0 gagal (harga, retail bertingkat, panjang film, kalender, hash, kesamaan konstanta layar dan server) |
| `npm run test:e2e` (Supabase/Postgres) | 108 lolos, 0 gagal |
| `npm run test:e2e` mode spreadsheet (tiruan layanan Google) | 107 lolos, 0 gagal (tanpa uji CSRF: token dikirim di body) |
| `npm run test:migrasi` | ekspor dimuat ke Postgres, password tetap berlaku, aturan Code.gs sama dengan server |
| Layar (skrip di browser) | semua menu tiap peran terbuka; alur DTF dari input sampai serah terima, QC pagi dengan foto, impor pelanggan, akun, hak akses, pengaturan, lacak publik |

Cakupan uji alur: bootstrap sekali pakai, CSRF, ganti password awal, harga dihitung server, order dan pembayaran tidak ganda, wajib lunas, cek file dan revisi, QC pagi (foto, NG, tahan, setujui), satu mesin satu order, standar curing, potong stok, QC dan cetak ulang, kemas, serah terima, verifikasi CRM, loss sales, pembatasan data per peran, cabut hak akses dan sesi, lacak publik tanpa data pribadi, pembatasan login.
