# Panduan per peran

Semua peran login di `/#/login`. Password awal/reset wajib diganti saat login pertama.

## Customer (member)
1. Daftar di **Daftar New Member**. Akun belum aktif sampai CS memverifikasi, CRM survei, dan master ACC.
2. **Pesanan Maklon > Buat pesanan**: isi item layanan, jumlah, satuan pesanan/produksi/penagihan (isi faktor konversi bila satuan berbeda), bahan, deadline.
3. Unggah artwork pada tiap item. Revisi menjadi versi baru dan wajib menyebut dampak biaya, bahan, deadline.
4. Pantau status dan resi tracking SDP. Tracking publik di **Lacak pesanan**.

## CS (satu meja untuk DTF dan Sublim)
1. **Pendaftaran Member**: catat kontak/verifikasi (aplikasi tidak mengirim WhatsApp; Anda yang menghubungi lalu mencatat). Customer yang datang ke workshop didaftarkan dari form workshop.
2. **Pesanan**: periksa artwork (Lolos periksa / Perlu revisi), catat persetujuan PIC dengan nama dan referensi bukti, lalu **Validasi CS** (detail dikonfirmasi, bukti, kebijakan pembayaran, deadline layak).
3. Setelah penanggung jawab merilis: buat WO per mesin dan tugaskan ke operator yang sudah check-in dan Standby.
4. Bila proyeksi melewati deadline, konfirmasi ulang ke customer. Deadline tidak berubah otomatis.
5. Setelah QC hasil: serah terima (boleh sebagian), tandai produksi selesai, tutup order.

## Penanggung jawab
Menyetujui **rilis produksi** pada order yang sudah divalidasi CS dan artwork-nya disetujui. Memantau Production dan Planning.

## CRM
Mengisi hasil **survei** pendaftar (layak / tidak layak) dan catatan Loss Sales.

## Operator
1. **Attendance dan Task**: Check-in lalu Standby.
2. **QC Kesiapan Mesin**: isi checklist OK/NG. DTF wajib foto nozzle check, test print, hasil uji press (pada kain uji). Ada NG berarti produksi ditahan; perbaikan lalu laporan baru, verifikasi ulang oleh QC.
3. Tekan **Mulai** pada WO milik Anda, lalu **Selesai** dengan qty output.

## QC
Verifikasi ulang kesiapan mesin setelah NG. **QC Hasil**: Pass / Hold / Rework / Reject. Baik + reject + rework harus sama dengan output awal; hasil hold/rework diperiksa ulang dengan `recheck_of`.

## Gudang
**Inventory dan Bahan Titipan**: receiving (jumlah dinyatakan dan hasil ukur terpisah, selisih dikonfirmasi), pemakaian/waste/return (idempotent per sumber). Serah terima paket pada detail order.

## FAT / Finance
Catat penawaran, DP, invoice (nominal diisi manual). **Verifikasi pembayaran** hanya oleh FAT; unggah bukti oleh customer belum berarti terverifikasi.

## Master
Daftarkan karyawan dan peran, aktif/nonaktif, reset password (mencabut sesi), ACC pendaftaran, mesin, norma waktu, kalender, informasi publik. Jabatan tidak memberi hak admin.
