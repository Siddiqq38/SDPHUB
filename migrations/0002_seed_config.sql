-- Konfigurasi awal. Tidak ada akun, customer, order, atau stok contoh di database sungguhan.
-- Harga DTF maklon Rp23.000/meter (dikonfirmasi). Harga sublim dan norma sublim sengaja kosong: diisi di Pengaturan.
INSERT INTO settings (key, value) VALUES
 ('priceDtf', '23000'),
 ('priceSub120', ''), ('priceSub160', ''), ('priceSub180', ''),
 ('normDtf', '240'), ('normSubPrint', ''), ('normPress', ''),
 ('prod_blocks', '09:00-12:00,13:00-16:00'), ('closed_weekdays', '0'), ('tz_offset_min', '480');

-- Daftar SKU bahan. Stok 0 dan pemakaian per meter kosong sampai stock opname dan pengukuran aktual.
INSERT INTO skus (code, name, svc, unit, machine) VALUES
 ('SDP-DTF-FLM-60', 'PET Film DTF 60 cm', 'dtf', 'meter', 'dtf'),
 ('SDP-DTF-INK-WH', 'Tinta DTF White', 'dtf', 'ml', 'dtf'),
 ('SDP-DTF-INK-CY', 'Tinta DTF Cyan', 'dtf', 'ml', 'dtf'),
 ('SDP-DTF-INK-MG', 'Tinta DTF Magenta', 'dtf', 'ml', 'dtf'),
 ('SDP-DTF-INK-YL', 'Tinta DTF Yellow', 'dtf', 'ml', 'dtf'),
 ('SDP-DTF-INK-BK', 'Tinta DTF Black', 'dtf', 'ml', 'dtf'),
 ('SDP-DTF-PWD-01', 'Powder Hot Melt', 'dtf', 'gram', 'dtf'),
 ('SDP-DTF-CLN-01', 'Cairan Cleaning DTF', 'dtf', 'ml', 'dtf'),
 ('SDP-SUB-PPR-01', 'Kertas Sublim Roll', 'sub', 'meter', 'subp'),
 ('SDP-SUB-INK-CY', 'Tinta Sublim Cyan', 'sub', 'ml', 'subp'),
 ('SDP-SUB-INK-MG', 'Tinta Sublim Magenta', 'sub', 'ml', 'subp'),
 ('SDP-SUB-INK-YL', 'Tinta Sublim Yellow', 'sub', 'ml', 'subp'),
 ('SDP-SUB-INK-BK', 'Tinta Sublim Black', 'sub', 'ml', 'subp'),
 ('SDP-SUB-TSU-01', 'Kertas Pelindung Press', 'sub', 'meter', 'cal');
