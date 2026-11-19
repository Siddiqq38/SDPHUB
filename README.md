# SDP - Tigalapan Operations System

Aplikasi operasional jasa maklon **DTF dan Sublimasi** untuk PT Tigalapan Sukses Indonesia. Satu departemen SDP, satu meja CS terpadu.

Platform: **GitHub + Vercel + Supabase**. Backend Hono + TypeScript (fungsi Vercel), database **Postgres Supabase**, file privat di **Supabase Storage**, frontend HTML/JS tanpa build. Bahasa Indonesia, zona waktu Asia/Makassar (WITA), mata uang rupiah.

## Isi repo

| Lokasi | Isi |
|---|---|
| `src/` | `index.ts` (createApp), `core.ts` (auth, CSRF, validasi), `db.ts` (adapter Postgres), `storage.ts` (Supabase Storage), `env.ts`, `vercel.ts`, `routes/*`, `lib/*` |
| `api/index.mjs` | Fungsi Vercel hasil bundel (`npm run build:vercel`); di-commit agar Vercel selalu menemukannya |
| `migrations/` | Migrasi Postgres berurutan (skema, konfigurasi awal, file, recheck QC, RLS) |
| `public/` | Situs publik, ruang kerja per peran, `/simulasi` |
| `test/` | Uji unit dan uji alur penuh (`e2e.mjs`) |
| `scripts/` | Server pengembangan, migrasi, build, pembuat dokumen |
| `docs/` | Deploy, API, hak akses, ERD, alur, panduan peran, bukti uji, batas implementasi |

## Menjalankan lokal (tanpa akun apa pun)

Prasyarat: Node.js 20+.

```bash
npm install
npm run dev          # http://127.0.0.1:8787, Postgres lokal (PGlite) + file lokal
npm run test:e2e     # di terminal lain, butuh server dev yang baru dijalankan (database kosong)
```

Master pertama lokal: `BOOTSTRAP_TOKEN` bawaan dev adalah `token-uji-lokal-0123456789` (hanya untuk lokal). Lihat langkah bootstrap di [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md).

## Online

Ikuti **[docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md)**: buat proyek Supabase, jalankan migrasi, impor repo ini ke Vercel, isi environment variables, lalu buat master pertama. Setiap `git push` ke `main` otomatis deploy ulang.

## Skrip

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server lokal (Postgres PGlite, penyimpanan lokal) |
| `npm run typecheck` | Pemeriksaan tipe |
| `npm test` | Uji unit (kalender, satuan, hash password) |
| `npm run test:e2e` | Uji alur penuh ke server yang berjalan (`BASE_URL` opsional) |
| `npm run db:migrate` | Terapkan migrasi ke Postgres (`DATABASE_URL=...`) |
| `npm run build:vercel` | Bundel fungsi Vercel ke `api/index.mjs` |
| `npm run docs` | Buat ulang `docs/API.md` dan `docs/MATRIKS-HAK-AKSES.md` dari kode |

## Dokumen

[Deploy](docs/DEPLOY-VERCEL.md) · [API](docs/API.md) · [Hak akses](docs/MATRIKS-HAK-AKSES.md) · [ERD](docs/ERD.md) · [Panduan peran](docs/PANDUAN-PERAN.md) · [Bukti pengujian](docs/BUKTI-PENGUJIAN.md) · **[Batas implementasi](docs/BATAS-IMPLEMENTASI.md)** · diagram alur [SVG](docs/alur-pesanan.svg) / [PNG](docs/alur-pesanan.png)
