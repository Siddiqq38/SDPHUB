# SDP Print Hub

Aplikasi internal departemen SDP (DTF dan Sublim), PT Tigalapan Sukses Indonesia. Alur mengikuti diagram **WIC-OPR-005** dan simulasi yang disetujui (26 November 2026).

Platform: **GitHub + Vercel + Supabase**. Hono + TypeScript (fungsi Vercel), Postgres dan Storage Supabase, frontend HTML/JS tanpa build. Bahasa Indonesia, WITA, rupiah.

## Alur
CS atau Store Head input order, Operator cek file (revisi lewat CS), **lunas** (dicatat CS atau Store Head), antrian, cetak (RIP mirror dan white underbase), powder dan curing 130-150 °C 60-90 detik (Sublim: print kertas lalu press), QC (reject masuk Log QC FRM-OPR-005 dan dicetak ulang), kemas dan label, siap kirim, serah terima.

QC pagi mesin (STD-OPR-006): checklist, foto wajib, disetujui SPV sebelum mesin dipakai. Customer B2B baru diverifikasi CRM.

## Isi repo
| Lokasi | Isi |
|---|---|
| `src/domain.ts` | Aturan bisnis: peran, hak akses, harga retail, checklist |
| `src/routes/` | `auth`, `orders` (alur order), `ops` (QC pagi, pelanggan, stok, master), `state`, `files`, `public` |
| `src/db.ts`, `src/storage.ts` | Adapter Postgres dan Supabase Storage |
| `public/` | Aplikasi web |
| `migrations/` | Skema Postgres |
| `api/index.mjs` | Fungsi Vercel hasil bundel (`npm run build:vercel`) |
| `prototype/` | Simulasi klik tanpa server |

## Lokal
```bash
npm install
npm run dev          # http://127.0.0.1:8787, data dikosongkan tiap dijalankan (FRESH=0 untuk mempertahankan)
npm test             # uji unit
npm run test:e2e     # terminal lain, pada server yang baru dijalankan
```
Master pertama lokal: langkah bootstrap di [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md), token dev `token-uji-lokal-0123456789`.

## Dokumen
[Deploy](docs/DEPLOY-VERCEL.md) · [Panduan per peran](docs/PANDUAN-PERAN.md) · [Bukti pengujian](docs/BUKTI-PENGUJIAN.md) · [Batas implementasi](docs/BATAS-IMPLEMENTASI.md)
