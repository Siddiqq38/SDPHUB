# Deploy: GitHub + Vercel + Supabase

Semua langkah akun (Supabase, Vercel, GitHub) dilakukan oleh pemilik akun. Rahasia hanya dimasukkan ke dashboard Vercel, tidak pernah ke repo.

## 1. Supabase (database dan file)

1. Buat proyek di supabase.com (catat password database yang Anda buat).
2. **Storage**: buat bucket bernama `sdp-files`, **Private** (jangan centang Public).
3. Ambil nilai berikut:
   - `DATABASE_URL`: Project Settings > Database > Connection string > **Transaction pooler** (port 6543). Ganti `[YOUR-PASSWORD]`.
   - `SUPABASE_URL`: Project Settings > API > Project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: Project Settings > API > `service_role` key. **Rahasia**, hanya untuk server.
4. Terapkan skema dari komputer Anda (satu kali; aman diulang):

```bash
DATABASE_URL="<nilai di atas>" npm run db:migrate
```

   Di Windows PowerShell: `$env:DATABASE_URL="<nilai>"; npm run db:migrate`.
   Alternatif: tempel isi `migrations/0001` sampai `0005` berurutan di Supabase > SQL Editor.
   Migrasi terakhir (`0005_rls.sql`) mengaktifkan RLS tanpa policy, sehingga tabel tidak bisa dibaca lewat API publik Supabase; hanya server yang mengakses lewat `DATABASE_URL`.

## 2. GitHub
Repo ini di-push ke GitHub (private). Vercel membaca dari sana.

## 3. Vercel
1. Vercel > Add New > Project > impor repo `sdp-ops`.
2. Framework Preset: **Other**. Biarkan Build Command dan Output Directory (sudah diatur di `vercel.json`).
3. Environment Variables (Production), isi lima nilai ini:

| Nama | Isi |
|---|---|
| `DATABASE_URL` | Connection string transaction pooler |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `SUPABASE_BUCKET` | `sdp-files` |
| `BOOTSTRAP_TOKEN` | string acak minimal 16 karakter (buat sendiri) |

4. Deploy. Alamatnya `https://<nama-proyek>.vercel.app`.

## 4. Buat master pertama (sekali)
Dari komputer Anda, ganti alamat dan nilai:

```bash
curl -X POST https://<alamat>/api/bootstrap -H "Content-Type: application/json" -d '{"token":"<BOOTSTRAP_TOKEN>","username":"<username-master>","password":"<password-kuat>","full_name":"<nama>"}'
```

Panggilan berikutnya ditolak otomatis. Setelah berhasil, **hapus `BOOTSTRAP_TOKEN`** di Vercel dan deploy ulang.

## 5. Setelah online
Login sebagai master: daftarkan karyawan (Master Data), mesin, atur norma waktu, kalender, dan informasi publik.

## Catatan teknis
- Fungsi `api/index.mjs` dibundel dari `src/vercel.ts`. Setelah mengubah kode di `src/`, jalankan `npm run build:vercel` dan commit hasilnya (Vercel juga menjalankannya saat build).
- Unggah file langsung dari browser ke Supabase Storage lewat URL bertanda tangan; server hanya memberi izin dan mengonfirmasi (batas body fungsi Vercel 4,5 MB tidak terpengaruh). Batas ukuran 50 MB per file (batas plan gratis Supabase).
- Unduh file: server memeriksa peran/kepemilikan lalu mengalihkan ke URL bertanda tangan berumur 60 detik.
