-- Pemeriksaan ulang hasil rework mengacu ke QC awal agar tidak dihitung ganda.
ALTER TABLE qc_results ADD COLUMN recheck_of BIGINT REFERENCES qc_results(id);
