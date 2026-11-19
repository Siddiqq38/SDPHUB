# ERD

Skema lengkap ada di `migrations/0001_init.sql`, `0003_files.sql`, `0004_qc_recheck.sql`. Diagram berikut memakai Mermaid (tampil otomatis di GitHub dan editor Markdown yang mendukungnya). Semua waktu disimpan sebagai epoch milidetik UTC; kode dan nomor disimpan sebagai TEXT.

```mermaid
erDiagram
  users ||--o| employees : "profil karyawan"
  users }o--o| customers : "akun customer"
  users ||--o{ sessions : "sesi"
  member_applications }o--o| customers : "dihubungkan saat ACC"
  member_applications }o--o| users : "akun hasil ACC"
  customers ||--o{ orders : "memesan"
  orders ||--|{ order_items : "berisi"
  orders ||--|| tracking : "resi publik"
  orders ||--o{ invoices : ""
  orders ||--o{ payments : ""
  orders ||--o{ handovers : ""
  orders ||--o{ complaints : ""
  services ||--o{ order_items : "layanan"
  order_items ||--o{ artworks : "versi"
  order_items ||--o{ work_orders : "batch/WO"
  machines ||--o{ work_orders : "dijalankan di"
  artworks ||--o{ work_orders : "versi produksi"
  work_orders ||--o{ qc_results : "QC hasil"
  qc_results ||--o{ qc_results : "recheck_of"
  work_orders ||--o{ estimate_history : "riwayat estimasi"
  machines ||--o{ machine_qc_reports : "QC kesiapan"
  users ||--o{ attendance : "check-in/standby"
  material_lots ||--o{ stock_ledger : "mutasi"
  customers ||--o{ material_lots : "bahan titipan"
  order_items ||--o{ handovers : ""
  customers ||--o{ files : "pemilik file"
```

## Jaminan di tingkat database

- `work_orders`: indeks unik parsial `idx_one_running_per_machine` (satu mesin hanya boleh punya satu WO `berjalan`).
- `stock_ledger`: unik `(source_type, source_id, kind)` sehingga mutasi per sumber idempotent.
- `artworks`: unik `(item_id, version)`; revisi menambah versi, tidak menimpa.
- `member_applications.consent_contact` wajib 1.
- `bootstrap`: satu baris, `used_at` diisi sekali.
- `users.role` dibatasi CHECK; pendaftar publik tidak pernah menulis ke tabel ini.
