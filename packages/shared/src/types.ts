export type Tier = 'member' | 'bronze' | 'silver' | 'gold' | 'diamond' | 'strategic';
export const TIER_ORDER: Tier[] = ['member', 'bronze', 'silver', 'gold', 'diamond', 'strategic'];
export const TIER_NAME: Record<Tier, string> = {
  member: 'Thành viên', bronze: 'Đồng', silver: 'Bạc', gold: 'Vàng', diamond: 'Kim Cương', strategic: 'Đối tác chiến lược',
};

/** Nội bộ: 8 vai trò. Đại lý: chủ (DLC) và nhân viên (DLNV). */
export type InternalRole = 'SA' | 'BOD' | 'KTT' | 'KT' | 'TPKD' | 'SALE' | 'MKT' | 'KHO';
export type AgentRole = 'DLC' | 'DLNV';
export type Role = InternalRole | AgentRole;
export const INTERNAL_ROLES: InternalRole[] = ['SA', 'BOD', 'KTT', 'KT', 'TPKD', 'SALE', 'MKT', 'KHO'];
export const ROLE_LABEL: Record<Role, string> = {
  SA: 'Quản trị hệ thống', BOD: 'BOD', KTT: 'Kế toán trưởng', KT: 'Kế toán', TPKD: 'TP Kinh doanh',
  SALE: 'Sale', MKT: 'Marketing', KHO: 'Kho', DLC: 'Chủ đại lý', DLNV: 'Nhân viên đại lý',
};
/** Vai trò bắt buộc 2FA khi đăng nhập web (mục 4.4). */
export const TWO_FA_ROLES: InternalRole[] = ['SA', 'BOD', 'KTT', 'KT'];

export type PointState = 'pending' | 'available' | 'expired' | 'revoked';
/** Quỹ điểm: hạng (xét hạng, không bị trừ khi đổi quà) và thưởng (đổi quà). */
export type Fund = 'both' | 'rank' | 'reward';
export const FUND_LABEL: Record<Fund, string> = { both: 'Cả 2 quỹ', rank: 'Điểm hạng', reward: 'Điểm thưởng' };

export type LedgerType = 'earn' | 'bonus' | 'activity' | 'manual' | 'adjust' | 'redeem' | 'refund' | 'reverse' | 'expire';

export type OrderStatus = 'Chờ duyệt' | 'Đang giao' | 'Hoàn tất' | 'Huỷ' | 'Trả hàng một phần';
export type PayStatus = 'Chưa thanh toán' | 'Thanh toán một phần' | 'Đã thanh toán' | 'Quá hạn' | '—';

export type RedemptionStage = 'new' | 'confirmed' | 'approved' | 'shipping' | 'done' | 'cancelled' | 'rejected';
export const REDEMPTION_STAGE_LABEL: Record<RedemptionStage, string> = {
  new: 'Mới gửi', confirmed: 'Sale đã xác nhận', approved: 'Kế toán đã duyệt', shipping: 'Kho đang giao',
  done: 'Đã nhận quà', cancelled: 'Đã huỷ', rejected: 'Từ chối',
};

export type ApprovalKind = 'manual' | 'bulk' | 'adjust' | 'tier' | 'credit' | 'evidence' | 'rules' | 'reopen' | 'campaign' | 'gift' | 'product';
export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  manual: 'Cộng điểm thủ công', bulk: 'Cộng điểm hàng loạt', adjust: 'Điều chỉnh điểm', tier: 'Nâng hạng tay',
  credit: 'Ngoại lệ công nợ', evidence: 'Bằng chứng hoạt động', rules: 'Thay đổi quy tắc điểm', reopen: 'Mở lại kỳ đã khoá sổ',
  campaign: 'Campaign điểm', gift: 'Quà giá trị lớn', product: 'Hệ số điểm sản phẩm',
};
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface OrderLineInput {
  sku: string;
  name: string;
  price: number;      // đơn giá chưa VAT
  qty: number;
  discount?: number;  // 0..1
  noPoint?: boolean;
  multiplier?: number;
  /** Nhãn hàng / dòng SP — để xét campaign. */
  brand?: string;
  line?: string;
}

/** Campaign điểm (GĐ2, W18): nhân hệ số theo nhãn/dòng/SKU hoặc thưởng thêm khi đơn đạt ngưỡng. */
export interface Campaign {
  id: string;
  name: string;
  kind: 'multiplier' | 'bonus';
  value: number;
  brands?: string[];
  lines?: string[];
  skus?: string[];
  /** Loại hình đại lý áp dụng (Nhà thuốc / Spa / Phòng khám); trống = tất cả. */
  types?: string[];
  minTier?: Tier;
  minOrderVND?: number;
  from: string;
  to: string;
}

export interface TierDef {
  key: Tier;
  name: string;
  /** Ngưỡng lên hạng (theo `tierBasis`); null = xét tay (Đối tác chiến lược). */
  threshold: number | null;
  /** Ngưỡng giữ hạng. */
  keep: number | null;
  multiplier: number;
  protectMonths: number;
  benefits: string[];
  special?: boolean;
  proposed?: boolean;
}

export interface RuleDef {
  id: string;
  group: string;
  name: string;
  formula: string;
  when: string;
  approval: string;
  cap: string;
  fund: Fund;
  status: 'Hiệu lực' | 'Nháp' | 'Chờ BOD duyệt' | 'Tắt';
  phase?: 'GĐ1' | 'GĐ1.5' | 'GĐ2';
  points?: number;
  conflict?: string;
}

/** Bộ tham số điểm & hạng có phiên bản. Mọi con số đều là CẤU HÌNH [CHỜ CHỐT]. */
export interface RuleParams {
  vndPerPoint: number;
  pointValueVND: number;
  vatRate: number;
  milestoneOrderVND: number;
  milestoneBonus: number;
  minOrderVND: number;
  expiryMonths: number;
  lockDay: number;
  minRedeem: number;
  /** Cơ sở xét hạng: điểm hạng tích luỹ 3 tháng (theo khảo sát) hoặc doanh số 3 tháng (PA3). */
  tierBasis: 'points' | 'revenue3m';
  tiers: TierDef[];
  rules: RuleDef[];
}
