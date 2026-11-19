# Batas implementasi (jujur: apa yang belum ada)

Dokumen ini sengaja ditulis supaya tidak ada klaim "lengkap" yang tidak benar.

## Belum / terbatas

| Area | Status |
|---|---|
| **Source lampiran SDP** | Tidak ditemukan di komputer saat pengerjaan, sehingga tidak dijadikan referensi. Aplikasi ditulis dari spesifikasi dan diagram. Platform akhir GitHub + Vercel + Supabase (bukan Workers/D1/R2). Hanya `Code GS DTF.txt` dan `Index HTML DTF.txt` (aplikasi DTF lama) yang ada; acuan norma DTF 4 menit/meter diambil dari spesifikasi, bukan dari parsing kode lama. |
| **Deploy produksi** | Belum dideploy. Langkahnya ada di DEPLOY-VERCEL.md. **Belum pernah diuji terhadap Supabase dan Vercel sungguhan**: uji berjalan di Postgres lokal (PGlite, satu koneksi) dan penyimpanan file lokal. Jalur Supabase Storage (URL unggah/unduh bertanda tangan) dan koneksi pooler `pg` ditulis sesuai dokumentasi tetapi belum dicoba langsung; uji coba pertama di Vercel perlu dilakukan dengan data contoh. |
| **Menu tanpa halaman sendiri** | Picking, Put Away, Planning terpisah, Performance/Reports, Usage/Waste/Return (API ledger ada, UI hanya receiving dan daftar), Briefing, tampilan Artwork terpisah. Fungsinya sebagian ada lewat API atau halaman lain. |
| **Mini WMS** | Receiving, ledger idempotent, reservasi, pemakaian, kepemilikan SDP/customer ada di API. Tidak ada UI untuk picking/alokasi per WO dan put away. Foto receiving didukung di API, belum di form UI. |
| **Komplain/rework** | Pencatatan dan status ada. Alur persetujuan solusi, biaya, dan bahan rework belum lengkap. Tidak ada tagihan otomatis (sesuai spesifikasi). |
| **Penawaran/invoice** | Hanya pencatatan nominal manual dan tiga angka terpisah. Tidak ada tarif, diskon, pajak, cetak invoice, jatuh tempo otomatis. |
| **Pelaporan/SLA** | Durasi mentah, durasi efektif, estimasi awal (baseline) dan riwayat estimasi tersimpan. Laporan SLA, lead time, waktu menunggu QC belum dibuat. |
| **Customer lama** | Dapat dihubungkan saat ACC, dan master dapat membuat/mengubah customer. Tidak ada impor massal. |
| **Notifikasi** | Tidak ada WhatsApp/email otomatis. Kontak adalah pekerjaan manusia yang dicatat. |
| **Reset password mandiri** | Tidak ada. Reset oleh master. |
| **Norma** | Norma Sublim dan calender belum diatur (tampil "Belum diatur"). Norma DTF 240 detik/meter adalah acuan awal yang dapat diubah master. Estimasi manual per WO didukung di API (`est_manual_end`), belum di form UI. |
| **Kalender** | Mendukung blok produksi dan hari libur yang dapat diatur. Tidak mendukung hari libur nasional per tanggal. Persiapan 08.30-09.00 ada sebagai setting informasi, bukan slot produksi. |
| **Rate limit** | Login dan pendaftaran dibatasi per username+IP lewat tabel database. IP dibaca dari header `x-vercel-forwarded-for`/`x-real-ip` (di luar Vercel semua klien dianggap satu kunci). Tidak setara WAF. |
| **Hash password** | PBKDF2-SHA256 600.000 iterasi, salt acak 16 byte, iterasi tersimpan per hash. Bukan Argon2. |
| **Pengujian** | Lihat BUKTI-PENGUJIAN.md. Uji UI otomatis di browser belum ada; UI hanya diperiksa manual pada sebagian halaman. |
| **Responsif HP** | CSS responsif ada; belum diuji di perangkat nyata. |

## Keputusan desain yang perlu Anda ketahui

- Serah terima sebagian tidak menghentikan produksi sisa; status order `serah_terima_sebagian` tetap boleh membuat/memulai WO. Setelah "Tandai produksi selesai" status tidak mundur.
- Output item dihitung hanya dari **tahap akhir** (untuk Sublim kain: transfer calender). Hasil print kertas adalah antara dan tidak dijumlahkan.
- Hari lokal untuk check-in dan QC kesiapan memakai offset WITA (+8) tetap.
- Batas ukuran file 50 MB (batas plan gratis Supabase). File diunduh lewat URL bertanda tangan 60 detik dengan `download` (attachment). Tidak ada pemindaian virus atau validasi tipe isi file.
