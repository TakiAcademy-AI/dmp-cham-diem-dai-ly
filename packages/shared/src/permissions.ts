import type { ApprovalKind, InternalRole, Role } from './types';

/**
 * Quyền theo ma trận mục 4.2 (DMP_01). API kiểm tra bằng `can()`; web dùng cùng bảng để ẩn menu/nút.
 * Phạm vi dữ liệu (Sale chỉ thấy đại lý mình phụ trách) xử lý riêng ở tầng truy vấn.
 */
export const PERMISSIONS = {
  'users.view': ['SA', 'BOD'],
  'users.manage': ['SA'],
  'system.manage': ['SA'],
  'demo.reset': ['SA', 'BOD'],

  'agents.view': ['BOD', 'KTT', 'KT', 'TPKD', 'SALE', 'MKT'],
  'agents.propose': ['TPKD', 'SALE'],
  'agents.approve': ['BOD'],
  'agents.issueCode': ['KT'],
  'agents.editSensitive': ['KT'],
  'agents.handover': ['BOD', 'TPKD'],

  'contracts.view': ['BOD', 'KTT', 'KT', 'TPKD', 'SALE'],
  'products.view': ['BOD', 'KTT', 'KT', 'TPKD', 'SALE', 'MKT'],
  'products.viewCost': ['BOD', 'KTT'],

  'orders.view': ['BOD', 'KTT', 'KT', 'TPKD', 'SALE'],
  'orders.sync': ['SA', 'KT'],
  'payments.record': ['KT'],
  'returns.create': ['KT'],
  'debt.view': ['BOD', 'KTT', 'KT', 'TPKD', 'SALE'],

  'rules.view': ['BOD', 'KTT', 'TPKD', 'MKT'],
  'rules.propose': ['KTT', 'MKT'],
  'points.manualPropose': ['KTT', 'TPKD', 'SALE', 'MKT'],
  'points.adjustPropose': ['KTT'],
  'tier.manualPropose': ['TPKD', 'SALE'],
  'credit.exceptionPropose': ['KT', 'TPKD', 'SALE'],
  'ledger.view': ['BOD', 'KTT', 'KT'],
  'periods.lock': ['KTT'],
  'approvals.view': ['BOD', 'KTT', 'MKT'],

  'gifts.view': ['BOD', 'KTT', 'KT', 'MKT', 'SALE', 'KHO'],
  'gifts.manage': ['MKT'],
  'redemptions.view': ['BOD', 'KTT', 'KT', 'SALE', 'KHO'],
  'redemptions.confirm': ['SALE'],
  'redemptions.approve': ['KTT', 'KT'],
  'redemptions.ship': ['KHO'],

  'notify.broadcast': ['MKT', 'TPKD'],
  'reports.view': ['BOD', 'KTT', 'KT', 'TPKD', 'SALE', 'MKT'],
  'export.excel': ['BOD', 'KTT', 'KT', 'TPKD', 'MKT'],
  'audit.view': ['SA', 'BOD', 'KTT'],

  // GĐ2 & bổ sung sau MVP
  'agents.suspend': ['BOD', 'TPKD'],
  'products.propose': ['KTT'],
  'payments.import': ['KT'],
  'gifts.stock': ['KHO', 'MKT'],
  'campaigns.view': ['BOD', 'KTT', 'TPKD', 'MKT'],
  'campaigns.manage': ['MKT'],
  'training.view': ['BOD', 'MKT', 'TPKD', 'SALE'],
  'training.manage': ['MKT'],
  'complaints.view': ['BOD', 'KTT', 'KT', 'TPKD', 'SALE'],
  'complaints.resolve': ['KT', 'KTT'],
  'evidence.confirm': ['SALE'],
  'saleskit.manage': ['MKT'],
} as const satisfies Record<string, readonly InternalRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[perm] as readonly string[]).includes(role);
}

/** Người duyệt theo loại yêu cầu (maker-checker: người tạo không tự duyệt). */
export const APPROVER: Record<ApprovalKind, InternalRole[]> = {
  manual: ['BOD'], bulk: ['BOD'], adjust: ['BOD'], tier: ['BOD'], credit: ['BOD'],
  evidence: ['MKT'], rules: ['BOD'], reopen: ['BOD'],
  campaign: ['BOD'], gift: ['BOD'], product: ['BOD'],
};
export function canApprove(role: Role, kind: ApprovalKind): boolean {
  return (APPROVER[kind] as string[]).includes(role);
}

export type SensitiveField = 'phone' | 'idCard' | 'dob' | 'bank' | 'cost' | 'debt';
/** Trường nhạy cảm hiện đầy đủ cho ai (mục 4.3). `own` = Sale đang xem đại lý mình phụ trách. */
export function canSeeField(role: Role, field: SensitiveField, own = false): boolean {
  const full: Record<SensitiveField, string[]> = {
    phone: ['BOD', 'KTT', 'KT', 'TPKD'],
    idCard: ['BOD', 'KTT', 'KT'],
    dob: ['BOD', 'KTT', 'KT'],
    bank: ['BOD', 'KTT', 'KT'],
    cost: ['BOD', 'KTT'],
    debt: ['BOD', 'KTT', 'KT', 'TPKD'],
  };
  if (role === 'SALE' && own && (field === 'phone' || field === 'debt')) return true;
  return full[field].includes(role);
}
/** Trường được phép bấm "Xem" để hiện (có ghi audit). */
export function canRevealField(role: Role, field: SensitiveField): boolean {
  return ['BOD', 'KTT', 'KT'].includes(role) && field !== 'cost';
}

/** Màn web và vai trò được mở (danh mục 5.3). */
export const SCREEN_ROLES: Record<string, InternalRole[]> = {
  W02: ['SA', 'BOD', 'KTT', 'KT', 'TPKD', 'SALE', 'MKT', 'KHO'],
  W03: ['BOD', 'KTT', 'KT', 'TPKD', 'SALE', 'MKT'],
  W04: ['BOD', 'KTT', 'KT', 'TPKD', 'SALE', 'MKT'],
  W05: ['BOD', 'KT', 'TPKD', 'SALE'],
  W06: ['BOD', 'KTT', 'KT', 'TPKD', 'SALE'],
  W07: ['BOD', 'KTT', 'KT', 'TPKD', 'SALE', 'MKT'],
  W08: ['BOD', 'KTT', 'KT', 'TPKD', 'SALE'],
  W09: ['BOD', 'KTT', 'KT'],
  W10: ['BOD', 'KTT', 'KT', 'TPKD', 'SALE'],
  W11: ['BOD', 'KTT', 'TPKD', 'MKT'],
  W12: ['BOD', 'KTT', 'TPKD', 'MKT'],
  W13: ['BOD', 'KTT', 'MKT'],
  W14: ['BOD', 'TPKD', 'SALE', 'MKT'],
  W15: ['BOD', 'KTT', 'KT'],
  W16: ['BOD', 'KTT', 'KT', 'MKT', 'SALE', 'KHO'],
  W17: ['BOD', 'KTT', 'KT', 'SALE', 'KHO'],
  W20: ['BOD', 'MKT', 'TPKD', 'SALE'],
  W22: ['BOD', 'KTT', 'KT', 'TPKD', 'SALE', 'MKT'],
  W23: ['SA', 'BOD'],
  W24: ['SA', 'BOD', 'KTT'],
  W25: ['SA'],
  W18: ['BOD', 'KTT', 'TPKD', 'MKT'],
  W19: ['BOD', 'MKT', 'TPKD', 'SALE'],
  W21: ['BOD', 'KTT', 'KT', 'TPKD', 'SALE'],
};
export function canOpenScreen(role: Role, screen: string): boolean {
  const r = SCREEN_ROLES[screen];
  return !r || (r as string[]).includes(role);
}
