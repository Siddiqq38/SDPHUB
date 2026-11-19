-- Metadata file privat di Supabase Storage. Download selalu lewat endpoint yang memeriksa hak akses.
CREATE TABLE files (
  key           TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('artwork','payment_proof','qc_photo','receiving_photo','complaint','handover')),
  customer_id   BIGINT REFERENCES customers(id),   -- pemilik data, untuk pembatasan customer
  file_name     TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  uploaded_by   BIGINT NOT NULL REFERENCES users(id),
  uploaded_at   BIGINT NOT NULL,
  confirmed     BIGINT NOT NULL DEFAULT 0   -- 1 setelah objek terbukti ada di storage
);
