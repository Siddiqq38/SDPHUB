# Bukti pengujian

Dijalankan 19 November 2026 pada Windows 11, Node.js 26.13.1. Server uji: aplikasi yang sama dengan produksi (`createApp`) di atas **Postgres asli (PGlite, WASM)** dan penyimpanan file lokal; database dibuat ulang dari migrasi sebelum uji. Supabase dan Vercel sungguhan belum diuji.

| Pemeriksaan | Hasil |
|---|---|
| `npm run typecheck` (`tsc`) | bersih, 0 galat |
| `npm test` (uji unit) | 10 lolos, 0 gagal |
| `npm run test:e2e` terhadap server dev (Postgres PGlite) | **125 lolos, 0 gagal** (keluaran: [e2e-output.txt](e2e-output.txt)) |
| Port dari D1/SQLite ke Postgres | uji alur yang sama dijalankan sebelum dan sesudah; satu perbedaan dialek ditemukan dan diperbaiki (kode galat unik `23505`) |

Uji alur penuh ini menemukan dan memperbaiki dua bug selama pengerjaan: (1) setelah serah terima sebagian, WO lain pada order yang sama tidak bisa dimulai; (2) hasil baik Sublim kain terhitung ganda (print kertas + transfer calender). Keduanya kini dijaga oleh uji.

## Pemetaan ke daftar uji minimal spesifikasi

| Uji yang diminta | Status | Dasar |
|---|---|---|
| Ketiga layanan mengikuti jalur yang benar | **Sebagian** | DTF dan Sublim kain diuji sampai penutupan. Sublim kertas hanya divalidasi lewat aturan tahap/mesin, belum satu order penuh. |
| Satu CS menangani DTF dan Sublim | Lolos | order dua layanan dalam satu inbox CS |
| CS tidak ACC master/rilis di luar izin | Lolos | CS ditolak ACC (403) dan rilis (403) |
| Pendaftar publik bukan admin/member aktif otomatis | Lolos | akun pending tidak bisa login; ACC butuh verifikasi CS + survei layak |
| Customer A tidak melihat order/file/bahan B | **Sebagian** | order, daftar, unggah ke item, dan unduh file diuji (404). Pembatasan bahan titipan lintas customer ada di kode tetapi belum diuji otomatis (hanya kasus yang diizinkan). |
| Reset/disable akun mencabut sesi | Lolos | sesi lama 401 setelah reset dan setelah nonaktif |
| Assignment memeriksa check-in dan Standby | Lolos | ditolak sebelum check-in dan sebelum Standby |
| Start memeriksa rilis, operator, kesiapan mesin | **Sebagian** | operator pemilik, QC kesiapan ada/NG diuji. Pemeriksaan status rilis pada Start ada di kode; pembuatan WO sebelum rilis diuji, Start langsung pada order belum dirilis tidak. |
| Mesin sama tidak menjalankan dua WO | Lolos | WO kedua pada mesin sama ditolak saat Start; mesin berbeda jalan paralel |
| Kalender melewati istirahat, jam tutup, Minggu | Lolos | uji unit, termasuk contoh 11.40 → 13.20 |
| Konversi satuan dan baseline benar | Lolos | konversi tanpa faktor ditolak; `est_initial_end_at` = estimasi awal tidak bergeser |
| Revisi desain menjaga versi lama | Lolos | v2 dibuat, v1 tetap versi produksi |
| Pemakaian bahan/return/waste tidak double count | **Sebagian** | pemakaian idempotent diuji. Waste, return, dan pelepasan reservasi otomatis belum diuji otomatis. |
| Rework dan serah terima parsial menjaga sisa | Lolos | sisa hasil dan sisa pekerjaan dihitung; recheck rework melebihi sisa ditolak |
| Upload bukti bukan verifikasi pembayaran | Lolos | `verified:false`; hanya FAT yang dapat memverifikasi |
| Tracking publik tidak membocorkan data | Lolos | pemeriksaan pola nama/kontak/harga/operator/file pada respons |
| Simulasi tidak menyentuh data produksi | Lolos (pemeriksaan kode) | `public/simulasi.js` tidak memuat `fetch`/XHR/penyimpanan; hanya komentar yang menyebut kata itu |

## Belum diuji
Uji UI otomatis di browser, uji beban, uji di perangkat HP, uji deploy ke Cloudflare sungguhan, dan uji keamanan eksternal. Halaman utama, login, dan semua menu master diperiksa manual di browser lokal tanpa galat konsol selain respons 401/429 yang diharapkan.
