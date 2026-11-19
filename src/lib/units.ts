// Satuan pesanan, produksi, dan penagihan dipisah. Konversi harus eksplisit.

export interface QtyBundle {
  qty: number;
  unit: string;
}

/** Konversi eksplisit; faktor wajib diberikan bila satuan berbeda. */
export function convert(from: QtyBundle, toUnit: string, factor: number | null | undefined): QtyBundle {
  if (from.unit === toUnit) return { qty: from.qty, unit: toUnit };
  if (factor == null || !(factor > 0)) {
    throw new Error(`Konversi ${from.unit} ke ${toUnit} belum diatur`);
  }
  return { qty: from.qty * factor, unit: toUnit };
}

/** Menjumlahkan hanya satuan yang sama; satuan berbeda ditolak. */
export function sumSameUnit(items: QtyBundle[]): QtyBundle {
  if (items.length === 0) return { qty: 0, unit: '' };
  const unit = items[0].unit;
  let qty = 0;
  for (const i of items) {
    if (i.unit !== unit) throw new Error(`Tidak boleh menjumlahkan ${i.unit} dengan ${unit}`);
    qty += i.qty;
  }
  return { qty, unit };
}

/** Detik kerja = qty x detik per satuan. null bila norma belum diatur. */
export function workSeconds(qty: number, secondsPerUnit: number | null | undefined): number | null {
  if (secondsPerUnit == null || !(secondsPerUnit > 0)) return null;
  return qty * secondsPerUnit;
}
