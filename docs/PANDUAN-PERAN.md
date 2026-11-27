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

## Inventory per roll

1. **Master SKU & Bin** (Gudang atau SPV): daftarkan bahan (mis. KIM001 Kain Milano) dan rak (mis. A1.2).
2. **GR** (tim SDP: Operator, CS, Gudang, SPV, Manager): SKU, nomor batch, jumlah roll, isi per roll, supplier. Setiap roll mendapat ID, mis. RCVKN001-01.
3. **Put away**: pilih bin. Stok baru dihitung tersedia setelah langkah ini.
4. **Pemakaian** (Operator, Gudang, SPV): catat Produksi, Test print, Reject, dan Waste terpisah; sisa roll terpotong otomatis. Tinta, powder, dan kertas pelindung cukup ditandai **habis**.
5. **Opname** per roll hanya oleh SPV, dengan alasan. Semua mutasi ada di **Kartu stok**.

## Rekomendasi dan booking roll

- Setiap order aktif mendapat saran roll dan bin: satu roll yang cukup (roll terbuka dulu, lalu GR terlama), atau gabungan beberapa roll. Bila bahan kurang diberi tanda.
- Order sublim memilih **Bahan kain** saat input. Cek kapasitas juga memperingatkan bila bahan bebas tidak cukup.
- Saat **Selesai curing / cetak / press**, roll saran sudah terisi. Operator menambah test print, reject, atau waste. Memakai roll di luar saran wajib diberi alasan.
- Bila bahan belum pernah di-GR, produksi tetap bisa diselesaikan tanpa catatan bahan.

## Laporan Harian

- Terisi otomatis: **QC pagi** (checklist, foto, tautan Drive) dan daftar customer yang lolos **QC hasil**, dipisah per layanan dan shift (shift 2 mulai 16.30, dapat diubah di Pengaturan).
- Operator, QC, atau SPV menekan **Kirim laporan shift** di akhir shift, boleh dengan catatan.
- **Salin untuk WA** tersedia bila masih perlu dikirim ke grup. QC pagi boleh ditambah sampai tiga foto bukti.

## Analysis

- Akses: Master, Manager, SPV, dan FAT. Pilih **Daily, Weekly, Monthly, Yearly** dan tanggalnya; angka dibandingkan dengan periode sebelumnya (harian: hari kerja sebelumnya).
- Target: tepat waktu minimal 95%, reject maksimal 2%, waste maksimal 3%, utilisasi mesin 70 sampai 90%.
- Tepat waktu: dikemas sebelum deadline, atau sebelum SLA bila tanpa deadline. Meter produksi dihitung saat tahap akhir selesai.
- Grafik: tren nilai order dan pembayaran, meter selesai DTF/Sublim, penjualan, dan loss sales. Arahkan kursor (di HP: ketuk) untuk angka; **Lihat angka** membuka tabelnya.
- **Unduh Excel (CSV)** atau **Cetak / PDF**.

## Monitoring produksi

- Buka **Antrian Produksi**: ikon printer per mesin menunjukkan order yang sedang dikerjakan. Arahkan kursor (di HP: ketuk) untuk melihat order dan customer.
- Meter tercetak dan sisa waktu adalah **perkiraan** dari waktu tombol mulai ditekan dan norma waktu, bukan bacaan mesin.
- **On track**: sesuai norma dan deadline. **Delay**: melewati perkiraan lebih dari 5 menit, atau diperkirakan baru siap setelah deadline. **Overdue**: sudah lewat deadline (atau SLA bila tanpa deadline).
- **Jadwal antrian** menampilkan semua order antrian beserta tanggal dan jam mulai serta perkiraan selesai.

## Foto QC dari HP

- Operator login di HP, buka **QC**, lalu tekan **Ambil foto** atau **Pilih dari galeri**. Foto langsung diunggah sesuai aslinya (maksimal 20 MB).
- Tunggu tanda **Tersimpan di Drive**, lalu kirim laporan. Bila gagal, tekan **Coba Lagi**.
- Foto tersimpan di Drive: **SDP Print Hub - File / QC Pagi / bulan / tanggal**. Seperti WOS, siapa pun yang memegang tautan foto dapat melihatnya. Berkas customer tetap privat.

## Kelola Data (hanya Master Akun)

Untuk masa simulasi: ubah atau hapus order, pembayaran, pelanggan, laporan QC pagi, catatan loss, dan angka stok. Akun dapat diubah atau dihapus di menu **Pengguna**.

Sebelum dipakai sungguhan, buka **Kelola Data > Bersihkan data**, ketik `HAPUS SEMUA`. Akun, harga, hak akses, dan daftar SKU tetap. Setiap tindakan tercatat di audit log.
