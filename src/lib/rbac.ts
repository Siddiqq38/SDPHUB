// Matriks hak akses. Dipakai server pada setiap API; menu frontend hanya cerminan.
export type Role = 'master' | 'supervisor' | 'cs' | 'crm' | 'operator' | 'gudang' | 'qc' | 'fat' | 'customer';

export const STAFF: Role[] = ['master', 'supervisor', 'cs', 'crm', 'operator', 'gudang', 'qc', 'fat'];

export const PERM = {
  'config.write': ['master'],
  'user.manage': ['master'],
  'customer.read': ['master', 'supervisor', 'cs', 'crm', 'fat'],
  'customer.write': ['master'],
  'app.list': ['master', 'cs', 'crm'],
  'app.cs': ['cs'],
  'app.survey': ['crm'],
  'app.decide': ['master'],
  'app.workshop': ['cs'],
  'order.create_any': ['cs'],
  'order.read_all': ['master', 'supervisor', 'cs', 'crm', 'operator', 'gudang', 'qc', 'fat'],
  'order.cs_validate': ['cs'],
  'order.release': ['master', 'supervisor'],
  'order.close': ['cs', 'master', 'supervisor'],
  'artwork.review': ['cs', 'master'],
  'wo.assign': ['cs', 'supervisor', 'master'],
  'wo.run': ['operator'],
  'machine.qc': ['operator', 'qc'],
  'result.qc': ['qc'],
  'handover.write': ['gudang', 'cs', 'qc'],
  'tracking.write': ['cs', 'master'],
  'stock.write': ['gudang', 'master'],
  'stock.use': ['gudang', 'operator', 'master'],
  'payment.verify': ['fat'],
  'invoice.write': ['fat', 'cs', 'master'],
  'complaint.write': ['cs', 'qc', 'supervisor', 'master'],
  'loss.write': ['cs', 'crm', 'master'],
  'report.read': ['master', 'supervisor', 'cs', 'fat', 'qc'],
} as const satisfies Record<string, readonly Role[]>;

export type Perm = keyof typeof PERM;

export function can(role: Role, perm: Perm): boolean {
  return (PERM[perm] as readonly Role[]).includes(role);
}
