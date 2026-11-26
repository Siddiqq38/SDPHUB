# Panduan per peran

Login memakai kode pengguna. Password awal atau hasil reset wajib diganti saat login pertama (minimal 10 karakter, huruf dan angka).

| Peran | Tugas di aplikasi |
|---|---|
| Master Akun | Pengguna, hak akses, harga, norma waktu; semua menu |
| Manager | Memantau dashboard, laporan, pembayaran, stok; tanpa tombol tindakan |
| SPV SDP | Menyetujui atau menahan QC pagi, prioritas antrian, dapat menjalankan produksi dan QC |
| CS | Input order, Meja CS (revisi file, tagihan, tolak = loss sales), catat pembayaran, serah terima |
| Store Head | Input order toko, catat pembayaran order sendiri, pantau Order Toko Saya |
| CRM | Verifikasi customer B2B baru, impor pelanggan Tigalapan Kaos |
| Operator | Cek file, QC pagi, produksi, QC hasil, kemas, mutasi stok |
| QC | QC pagi, QC hasil, kemas |
| Gudang | Stok, minimum dan pemakaian per meter, serah terima |
| FAT | Melihat pembayaran dan laporan |

## Urutan pertama kali dipakai
1. Admin: buat akun, isi harga dan norma sublim di **Pengaturan**.
2. CRM: impor daftar pelanggan B2B (kode, nama, WhatsApp; bisa ditempel dari Excel).
3. Gudang: isi stok awal hasil stock opname (Catat mutasi: Stok masuk), lalu pemakaian per meter setelah diukur.
4. Setiap pagi: Operator mengisi QC pagi tiap mesin, SPV menyetujui.

## Kelola Data (hanya Master Akun)
Untuk masa simulasi: ubah atau hapus order, pembayaran, pelanggan, laporan QC pagi, catatan loss, dan angka stok. Akun dapat diubah atau dihapus di menu **Pengguna**.

Sebelum dipakai sungguhan, buka **Kelola Data > Bersihkan data**, ketik `HAPUS SEMUA`. Akun, harga, hak akses, dan daftar SKU tetap. Setiap tindakan tercatat di audit log.
