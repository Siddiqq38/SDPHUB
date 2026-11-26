# Batas implementasi

| Area | Status |
|---|---|
| Mode spreadsheet | Belum dicoba di akun Google sungguhan (diuji dengan tiruan layanan Google di Node). Lihat batas lain di SPREADSHEET.md. |
| Deploy | Belum online. Belum pernah diuji terhadap Supabase dan Vercel sungguhan (uji berjalan di Postgres PGlite satu koneksi dan penyimpanan lokal). Jalur Supabase Storage dan koneksi pooler ditulis sesuai dokumentasi tetapi belum dicoba. Uji pertama di Vercel dengan data contoh. |
| SOP Sublim | Checklist QC pagi, butir QC hasil, dan parameter press sublim masih usulan; suhu dan waktu press diisi bebas. |
| Harga dan norma | Harga dan norma sublim kosong sampai diisi di Pengaturan; order sublim ditolak sebelum harganya diisi. Price list retail DTF ada di kode (`src/domain.ts` dan `public/app.js`), belum bisa diubah dari layar. |
| Pengembalian uang | Order yang ditolak setelah ada pembayaran hanya diberi peringatan; refund atau deposit dicatat manual. |
| Salah input pembayaran | Belum ada pembatalan pembayaran dari layar. |
| Ubah order | Order tidak dapat diedit; tolak sebagai Double input lalu buat ulang. |
| Kain titipan | Belum dicatat sebagai stok. |
| Data besar | Layar memuat semua order berjalan dan 300 order selesai atau ditolak terakhir; riwayat lebih lama hanya di database. Belum ada ekspor. |
| Penyegaran | Otomatis hanya di Dashboard, Laporan, Order Toko Saya; menu lain lewat tombol Muat ulang atau setelah tindakan. |
| File | Maksimal 50 MB per file (batas paket gratis Supabase); tidak ada pemindaian virus. |
| Notifikasi | Tidak ada pengiriman WhatsApp otomatis; teks disalin lalu ditempel. |
| Fitur aplikasi DTF lama | Room chat, modul evaluasi, status user online, dan QR belum ada. Data lama di Google Sheets tidak diimpor. |
| Keamanan | Login dibatasi per kode dan IP; PBKDF2-SHA256 600.000 iterasi; belum ada uji keamanan eksternal. |
| Pengujian layar | Diperiksa dengan skrip di browser saat pengerjaan, belum menjadi uji otomatis di repo; belum diuji di HP fisik. |
