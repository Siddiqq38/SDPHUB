// Hanya tahap akhir yang menghasilkan output item. Untuk Sublim kain, print kertas adalah antara;
// menjumlahkannya dengan hasil transfer calender akan menghitung ganda. Alias tabel work_orders wajib `w`.
export const FINAL_STAGE = `(w.stage = 'transfer_calender' OR (SELECT service_code FROM order_items WHERE id = w.item_id) <> 'SUBLIM_KAIN')`;
