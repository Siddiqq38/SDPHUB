# Matriks hak akses

Dihasilkan dari `src/lib/rbac.ts`. Server memeriksa hak ini pada setiap API; menu frontend hanya cerminan.

| Izin | master | supervisor | cs | crm | operator | gudang | qc | fat | customer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `config.write` | ya |  |  |  |  |  |  |  |  |
| `user.manage` | ya |  |  |  |  |  |  |  |  |
| `customer.read` | ya | ya | ya | ya |  |  |  | ya |  |
| `customer.write` | ya |  |  |  |  |  |  |  |  |
| `app.list` | ya |  | ya | ya |  |  |  |  |  |
| `app.cs` |  |  | ya |  |  |  |  |  |  |
| `app.survey` |  |  |  | ya |  |  |  |  |  |
| `app.decide` | ya |  |  |  |  |  |  |  |  |
| `app.workshop` |  |  | ya |  |  |  |  |  |  |
| `order.create_any` |  |  | ya |  |  |  |  |  |  |
| `order.read_all` | ya | ya | ya | ya | ya | ya | ya | ya |  |
| `order.cs_validate` |  |  | ya |  |  |  |  |  |  |
| `order.release` | ya | ya |  |  |  |  |  |  |  |
| `order.close` | ya | ya | ya |  |  |  |  |  |  |
| `artwork.review` | ya |  | ya |  |  |  |  |  |  |
| `wo.assign` | ya | ya | ya |  |  |  |  |  |  |
| `wo.run` |  |  |  |  | ya |  |  |  |  |
| `machine.qc` |  |  |  |  | ya |  | ya |  |  |
| `result.qc` |  |  |  |  |  |  | ya |  |  |
| `handover.write` |  |  | ya |  |  | ya | ya |  |  |
| `tracking.write` | ya |  | ya |  |  |  |  |  |  |
| `stock.write` | ya |  |  |  |  | ya |  |  |  |
| `stock.use` | ya |  |  |  | ya | ya |  |  |  |
| `payment.verify` |  |  |  |  |  |  |  | ya |  |
| `invoice.write` | ya |  | ya |  |  |  |  | ya |  |
| `complaint.write` | ya | ya | ya |  |  |  | ya |  |  |
| `loss.write` | ya |  | ya | ya |  |  |  |  |  |
| `report.read` | ya | ya | ya |  |  |  | ya | ya |  |

Catatan pembatasan di luar tabel:

- **Customer** hanya melihat order, artwork, file, dan pembayaran bisnisnya sendiri (data customer lain dijawab 404). Customer tidak melihat catatan internal CS.
- **Operator** hanya dapat memulai/menyelesaikan WO yang ditugaskan kepadanya.
- **CS** tidak dapat merilis produksi, tidak dapat ACC member, tidak dapat memverifikasi pembayaran.
- Setelah QC kesiapan mesin NG, kesimpulan "siap" hanya dapat ditetapkan petugas **QC**.
- Tidak ada role yang dapat dipilih pendaftar publik. Role customer hanya dibuat saat master ACC.
- Role karyawan yang dapat dibuat master: master, supervisor, cs, crm, operator, gudang, qc, fat.
