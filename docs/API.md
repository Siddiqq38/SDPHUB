# Dokumentasi API

Dihasilkan dari kode (`scripts/gen-docs.mjs`). Semua respons JSON kecuali unduhan file. Galat berbentuk `{"error": "pesan"}`.

Autentikasi: cookie sesi `sdp_session` (HttpOnly, SameSite=Strict, Secure di HTTPS). Metode selain GET wajib header `X-CSRF-Token` (nilai dari `/api/auth/login` atau `/api/auth/me`).

| Metode | Path | Akses | Berkas |
|---|---|---|---|
| GET | `/api/public/info` | publik | public.ts |
| GET | `/api/public/track/:code` | publik | public.ts |
| POST | `/api/public/register` | publik | members.ts |
| POST | `/api/auth/login` | publik (dibatasi percobaan) | auth.ts |
| POST | `/api/auth/logout` | login | auth.ts |
| GET | `/api/auth/me` | login | auth.ts |
| POST | `/api/auth/change-password` | login | auth.ts |
| POST | `/api/bootstrap` | publik + BOOTSTRAP_TOKEN, sekali pakai | auth.ts |
| POST | `/api/applications/workshop` | izin `app.workshop`: cs | members.ts |
| GET | `/api/applications` | izin `app.list`: master, cs, crm | members.ts |
| POST | `/api/applications/:id/cs` | izin `app.cs`: cs | members.ts |
| POST | `/api/applications/:id/survey` | izin `app.survey`: crm | members.ts |
| POST | `/api/applications/:id/decide` | izin `app.decide`: master | members.ts |
| GET | `/api/master/users` | izin `user.manage`: master | master.ts |
| POST | `/api/master/users` | izin `user.manage`: master | master.ts |
| PATCH | `/api/master/users/:id` | izin `user.manage`: master | master.ts |
| GET | `/api/master/customers` | izin `customer.read`: master, supervisor, cs, crm, fat | master.ts |
| POST | `/api/master/customers` | izin `customer.write`: master | master.ts |
| PATCH | `/api/master/customers/:id` | izin `customer.write`: master | master.ts |
| GET | `/api/master/config` | login; pemeriksaan peran/kepemilikan di dalam handler | master.ts |
| PUT | `/api/master/config/services/:code` | izin `config.write`: master | master.ts |
| POST | `/api/master/config/machines` | izin `config.write`: master | master.ts |
| PUT | `/api/master/config/machines/:id` | izin `config.write`: master | master.ts |
| PUT | `/api/master/config/norms/:kind` | izin `config.write`: master | master.ts |
| PUT | `/api/master/config/settings` | izin `config.write`: master | master.ts |
| POST | `/api/master/attendance/checkin` | izin `wo.run`: operator | master.ts |
| POST | `/api/master/attendance/standby` | izin `wo.run`: operator | master.ts |
| POST | `/api/master/attendance/checkout` | izin `wo.run`: operator | master.ts |
| GET | `/api/master/attendance/today` | login; pemeriksaan peran/kepemilikan di dalam handler | master.ts |
| POST | `/api/orders` | login; pemeriksaan peran/kepemilikan di dalam handler | orders.ts |
| GET | `/api/orders` | login; pemeriksaan peran/kepemilikan di dalam handler | orders.ts |
| GET | `/api/orders/:id` | login; pemeriksaan peran/kepemilikan di dalam handler | orders.ts |
| POST | `/api/orders/:id/cs-validate` | izin `order.cs_validate`: cs | orders.ts |
| POST | `/api/orders/:id/release` | izin `order.release`: master, supervisor | orders.ts |
| POST | `/api/orders/:id/cancel` | login; pemeriksaan peran/kepemilikan di dalam handler | orders.ts |
| POST | `/api/orders/:id/close` | izin `order.close`: cs, master, supervisor | orders.ts |
| POST | `/api/prod/items/:id/artworks` | login; pemeriksaan peran/kepemilikan di dalam handler | production.ts |
| POST | `/api/prod/artworks/:id/review` | izin `artwork.review`: cs, master | production.ts |
| POST | `/api/prod/artworks/:id/approve` | izin `artwork.review`: cs, master | production.ts |
| GET | `/api/prod/artworks/:id/file` | login; pemeriksaan peran/kepemilikan di dalam handler | production.ts |
| GET | `/api/prod/machines/:id/checklist` | login; pemeriksaan peran/kepemilikan di dalam handler | production.ts |
| GET | `/api/prod/machines/status` | login; pemeriksaan peran/kepemilikan di dalam handler | production.ts |
| POST | `/api/prod/machines/:id/qc` | izin `machine.qc`: operator, qc | production.ts |
| POST | `/api/prod/orders/:id/work-orders` | izin `wo.assign`: cs, supervisor, master | production.ts |
| POST | `/api/prod/wo/:id/assign` | izin `wo.assign`: cs, supervisor, master | production.ts |
| GET | `/api/prod/wo` | login; pemeriksaan peran/kepemilikan di dalam handler | production.ts |
| POST | `/api/prod/wo/:id/start` | izin `wo.run`: operator | production.ts |
| POST | `/api/prod/wo/:id/finish` | izin `wo.run`: operator | production.ts |
| POST | `/api/prod/wo/:id/qc` | izin `result.qc`: qc | production.ts |
| POST | `/api/prod/orders/:id/finish-production` | login; pemeriksaan peran/kepemilikan di dalam handler | production.ts |
| POST | `/api/prod/orders/:id/handover` | izin `handover.write`: gudang, cs, qc | production.ts |
| GET | `/api/prod/dashboard` | login; pemeriksaan peran/kepemilikan di dalam handler | production.ts |
| POST | `/api/files/init` | login; pemeriksaan peran/kepemilikan di dalam handler | files.ts |
| POST | `/api/files/confirm` | login; pemeriksaan peran/kepemilikan di dalam handler | files.ts |
| GET | `/api/files/:kind/:id` | login; pemeriksaan peran/kepemilikan di dalam handler | files.ts |
| POST | `/api/stock/lots` | izin `stock.write`: gudang, master | stock.ts |
| PUT | `/api/stock/lots/:id/location` | izin `stock.write`: gudang, master | stock.ts |
| POST | `/api/stock/lots/:id/ledger` | izin `stock.use`: gudang, operator, master | stock.ts |
| GET | `/api/stock/lots` | login; pemeriksaan peran/kepemilikan di dalam handler | stock.ts |
| POST | `/api/finance/orders/:id/invoices` | izin `invoice.write`: fat, cs, master | finance.ts |
| POST | `/api/finance/orders/:id/payments` | login; pemeriksaan peran/kepemilikan di dalam handler | finance.ts |
| POST | `/api/finance/payments/:id/verify` | izin `payment.verify`: fat | finance.ts |
| GET | `/api/finance/orders/:id/summary` | login; pemeriksaan peran/kepemilikan di dalam handler | finance.ts |
| POST | `/api/finance/loss-sales` | izin `loss.write`: cs, crm, master | finance.ts |
| GET | `/api/finance/loss-sales/total` | izin `report.read`: master, supervisor, cs, fat, qc | finance.ts |
| POST | `/api/finance/complaints` | izin `complaint.write`: cs, qc, supervisor, master | finance.ts |
| PATCH | `/api/finance/complaints/:id` | izin `complaint.write`: cs, qc, supervisor, master | finance.ts |
| GET | `/api/finance/complaints` | login; pemeriksaan peran/kepemilikan di dalam handler | finance.ts |

Unggah file: `POST /api/files` multipart (`file`, `kind`, opsional `customer_id` untuk staf). Unduh: `GET /api/files/:kind/:id` atau `GET /api/prod/artworks/:id/file`, keduanya memeriksa peran dan kepemilikan.
