# Panduan per peran

Login memakai kode pengguna. Password awal atau hasil reset wajib diganti saat login pertama (minimal 10 karakter, huruf dan angka).

| Peran | Tugas di aplikasi |
|---|---|
| Master Akun | Pengguna, hak akses, harga, norma waktu; semua menu |
| Manager | Memantau dashboard, laporan, pembayaran, stok; tanpa tombol tindakan |
| SPV SDP | Menyetujui atau menahan QC pagi, prioritas antrian, dapat menjalankan produksi dan QC |
| CS | Input order, Meja CS (revisi file, tagihan, tolak = loss sales), catat pembayaran, serah terima |
| Store Head | Input order toko, catat pembayaran order sendiri, pantau Order Toko Saya |
| CRM | Impor dan memantau daftar pelanggan B2B (tanpa verifikasi order) |
| Operator | Cek file, QC pagi, produksi, QC hasil, kemas, mutasi stok |
| QC | QC pagi, QC hasil, kemas |
| Gudang | Stok, minimum dan pemakaian per meter, serah terima |
| FAT | Melihat pembayaran dan laporan |

## Urutan pertama kali dipakai
1. Admin: buat akun, isi harga dan norma sublim di **Pengaturan**.
2. CRM: impor daftar pelanggan B2B (kode, nama, WhatsApp; bisa ditempel dari Excel).
3. Gudang: isi stok awal hasil stock opname (Catat mutasi: Stok masuk), lalu pemakaian per meter setelah diukur.
4. Setiap pagi: Operator mengisi QC pagi tiap mesin, SPV menyetujui.

## Kapasitas produksi

- CS dan Store Head: di **Input Order**, isi ukuran dan deadline lalu tekan **Cek kapasitas**. Bila penuh, tawarkan jadwal yang disarankan; bila customer menolak, tekan **catat Loss Sales**.
- Server menolak order yang tidak muat sebelum deadline. Tanpa deadline dipakai SLA standar: lunas sebelum 12.00 selesai hari itu, selebihnya hari kerja berikutnya.
- Order belum lunas menahan slot selama 2 jam, lalu slot dilepas.
- SPV: tambah **Lembur** di Antrian Produksi bila kapasitas perlu ditambah.
- Kapasitas = jam efektif (09.00-12.00, 13.00-21.30) dibagi norma waktu, dijual 90%. Finishing masih estimasi (DTF 30 menit, sublim 60 menit). Semua angka dapat diubah di Pengaturan.

## Foto QC dari HP

- Operator login di HP, buka **QC**, lalu tekan **Ambil foto** atau **Pilih dari galeri**. Foto langsung diunggah sesuai aslinya (maksimal 20 MB).
- Tunggu tanda **Tersimpan di Drive**, lalu kirim laporan. Bila gagal, tekan **Coba Lagi**.
- Foto tersimpan di Drive: **SDP Print Hub - File / QC Pagi / bulan / tanggal**. Seperti WOS, siapa pun yang memegang tautan foto dapat melihatnya. Berkas customer tetap privat.

## Kelola Data (hanya Master Akun)

Untuk masa simulasi: ubah atau hapus order, pembayaran, pelanggan, laporan QC pagi, catatan loss, dan angka stok. Akun dapat diubah atau dihapus di menu **Pengguna**.

Sebelum dipakai sungguhan, buka **Kelola Data > Bersihkan data**, ketik `HAPUS SEMUA`. Akun, harga, hak akses, dan daftar SKU tetap. Setiap tindakan tercatat di audit log.
