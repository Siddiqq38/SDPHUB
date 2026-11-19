-- Konfigurasi awal (bukan data produksi). Semua dapat diubah master di Settings.
INSERT INTO services (code, family, name, output_label, active, stages_json) VALUES
 ('DTF', 'DTF', 'DTF - print transfer', 'Hasil transfer DTF',
  1, '["preflight","layout_rip","print_film","powdering","curing","qc_hasil","finishing_packing","serah_terima"]'),
 ('SUBLIM_KERTAS', 'SUBLIM', 'Sublim - print kertas', 'Kertas sublim',
  1, '["preflight","layout_rip","print_kertas","qc_hasil","packing","serah_terima"]'),
 ('SUBLIM_KAIN', 'SUBLIM', 'Sublim - print dan transfer kain', 'Kain sublim',
  1, '["preflight","layout_rip","print_kertas","periksa_hasil","transfer_calender","qc_hasil","packing","serah_terima"]');

-- Acuan DTF dari aplikasi DTF lama: 4 menit per meter lari. Sublim sengaja NULL (Belum diatur).
INSERT INTO norms (machine_kind, seconds_per_unit, unit, source_note) VALUES
 ('dtf_printer', 240, 'meter', 'Acuan aplikasi DTF lama; ubah sesuai kondisi aktual'),
 ('sublim_printer', NULL, 'meter', 'Belum diatur'),
 ('calender', NULL, 'meter', 'Belum diatur');

INSERT INTO settings (key, value) VALUES
 ('tz', 'Asia/Makassar'),
 ('tz_offset_min', '480'),
 ('work_open', '08:30'),
 ('work_close', '16:30'),
 ('prep_start', '08:30'),
 ('prod_blocks', '09:00-12:00,13:00-16:00'),
 ('closed_weekdays', '0'),
 ('brand_name', 'SDP - Tigalapan Operations System'),
 ('company_name', 'PT Tigalapan Sukses Indonesia'),
 ('contact_info', ''),
 ('workshop_info', '');
-- Mesin tidak di-seed: master mendaftarkan mesin nyata di Master Data.
