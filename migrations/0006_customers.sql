-- Database customer: tipe, kategori, kontak, dan riwayat kunjungan.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_source_check;
ALTER TABLE customers ADD COLUMN kind TEXT;           -- B2B / B2C
ALTER TABLE customers ADD COLUMN category TEXT;
ALTER TABLE customers ADD COLUMN email TEXT;
ALTER TABLE customers ADD COLUMN city TEXT;
ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN since TEXT;          -- YYYY-MM-DD
ALTER TABLE customers ADD COLUMN last_visit TEXT;     -- YYYY-MM-DD; aktif bila kurang dari 1 tahun
ALTER TABLE customers ADD COLUMN visits BIGINT;
ALTER TABLE customers ADD COLUMN spending BIGINT;
CREATE INDEX idx_customers_name ON customers (lower(name));
