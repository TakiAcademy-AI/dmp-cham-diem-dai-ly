import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { canOpenScreen, type Role } from '@dmp/shared';
import type { IconName } from '../ds';

/** Danh mục màn hình (mục 5.3 DMP_01) — nguồn duy nhất cho router, sidebar và điều hướng con. */
export interface ScreenDef {
  code: string;
  path: string;
  title: string;
  group: string;
  /** Không hiện trên điều hướng con (màn chi tiết có tham số). */
  hidden?: boolean;
  Component: LazyExoticComponent<ComponentType>;
}

const w = (code: string, path: string, title: string, group: string, load: () => Promise<{ default: ComponentType }>, hidden = false): ScreenDef =>
  ({ code, path, title, group, hidden, Component: lazy(load) });

export const WEB_SCREENS: ScreenDef[] = [
  w('W02', '/', 'Trang chủ', 'home', () => import('../screens/web/W02Dashboard')),
  w('W03', '/agents', 'Danh sách đại lý', 'agents', () => import('../screens/web/W03AgentList')),
  w('W05', '/agents/new', 'Đề xuất & duyệt đại lý mới', 'agents', () => import('../screens/web/W05NewAgent')),
  w('W04', '/agents/:id', 'Hồ sơ đại lý', 'agents', () => import('../screens/web/W04AgentProfile'), true),
  w('W06', '/contracts', 'Hợp đồng & cam kết', 'contracts', () => import('../screens/web/W06Contracts')),
  w('W08', '/orders', 'Đơn hàng', 'orders', () => import('../screens/web/W08Orders')),
  w('W09', '/returns', 'Trả hàng / huỷ đơn', 'orders', () => import('../screens/web/W09Returns')),
  w('W13', '/approvals', 'Hàng chờ duyệt', 'points', () => import('../screens/web/W13ApprovalQueue')),
  w('W14', '/points/bulk', 'Cộng điểm hàng loạt', 'points', () => import('../screens/web/W14BulkPoints')),
  w('W15', '/points/ledger', 'Sổ cái điểm', 'points', () => import('../screens/web/W15Ledger')),
  w('W11', '/points/rules', 'Cấu hình quy tắc điểm', 'points', () => import('../screens/web/W11PointRules')),
  w('W12', '/points/tiers', 'Cấu hình bảng hạng', 'points', () => import('../screens/web/W12TierConfig')),
  w('W16', '/gifts', 'Danh mục quà', 'gifts', () => import('../screens/web/W16GiftCatalog')),
  w('W17', '/redemptions', 'Yêu cầu đổi quà', 'gifts', () => import('../screens/web/W17Redemptions')),
  w('W10', '/debt', 'Thanh toán & công nợ', 'debt', () => import('../screens/web/W10Debt')),
  w('W20', '/notify', 'Gửi thông báo', 'notify', () => import('../screens/web/W20Notify')),
  w('W22', '/reports', 'Trung tâm báo cáo', 'reports', () => import('../screens/web/W22Reports')),
  w('W18', '/campaigns', 'Campaign điểm', 'points', () => import('../screens/web/W18Campaigns')),
  w('W19', '/training', 'Đào tạo & sự kiện', 'training', () => import('../screens/web/W19Training')),
  w('W21', '/complaints', 'Khiếu nại điểm', 'notify', () => import('../screens/web/W21Complaints')),
  w('W26', '/me', 'Tài khoản & bảo mật', 'home', () => import('../screens/web/W26Security'), true),
  w('W07', '/products', 'Sản phẩm & bảng giá', 'config', () => import('../screens/web/W07Products')),
  w('W23', '/users', 'Người dùng & phân quyền', 'config', () => import('../screens/web/W23Users')),
  w('W24', '/audit', 'Nhật ký thao tác', 'config', () => import('../screens/web/W24AuditLog')),
  w('W25', '/system', 'Hệ thống & tích hợp', 'config', () => import('../screens/web/W25System')),
];

export const APP_SCREENS: ScreenDef[] = [
  w('M02', '/app', 'Trang chủ', 'home', () => import('../screens/app/M02Home')),
  w('M03', '/app/ledger', 'Sổ điểm', 'points', () => import('../screens/app/M03Ledger')),
  w('M04', '/app/tiers', 'Hạng & quyền lợi', 'points', () => import('../screens/app/M04Tiers')),
  w('M05', '/app/gifts', 'Cửa hàng quà', 'gifts', () => import('../screens/app/M05GiftShop')),
  w('M06', '/app/redemptions', 'Quà đã đổi', 'gifts', () => import('../screens/app/M06MyRedemptions')),
  w('M07', '/app/orders', 'Đơn hàng', 'orders', () => import('../screens/app/M07Orders')),
  w('M08', '/app/debt', 'Công nợ', 'account', () => import('../screens/app/M08Debt')),
  w('M09', '/app/notifications', 'Thông báo', 'account', () => import('../screens/app/M09Notifications')),
  w('M10', '/app/account', 'Tài khoản', 'account', () => import('../screens/app/M10Account')),
  w('M11', '/app/cart', 'Đặt hàng', 'orders', () => import('../screens/app/M11Cart')),
  w('M12', '/app/evidence', 'Nộp bằng chứng', 'points', () => import('../screens/app/M12Evidence')),
  w('M13', '/app/learning', 'Học tập', 'account', () => import('../screens/app/M13Learning')),
  w('M14', '/app/leaderboard', 'Bảng xếp hạng', 'points', () => import('../screens/app/M14Leaderboard')),
  w('M15', '/app/complaints', 'Khiếu nại điểm', 'points', () => import('../screens/app/M15Complaint')),
  w('M16', '/app/saleskit', 'Tài liệu bán hàng', 'account', () => import('../screens/app/M16SalesKit')),
];

/** Nhóm menu sidebar web (mục 5.1). Nhóm hiện nếu vai trò mở được ít nhất một màn trong nhóm. */
export const MENU: Array<{ key: string; label: string; icon: IconName }> = [
  { key: 'home', label: 'Tổng quan', icon: 'home' },
  { key: 'agents', label: 'Đại lý', icon: 'users' },
  { key: 'contracts', label: 'Hợp đồng', icon: 'file' },
  { key: 'orders', label: 'Đơn hàng', icon: 'box' },
  { key: 'points', label: 'Điểm thưởng', icon: 'star' },
  { key: 'gifts', label: 'Quà tặng', icon: 'gift' },
  { key: 'debt', label: 'Công nợ', icon: 'wallet' },
  { key: 'training', label: 'Đào tạo & sự kiện', icon: 'book' },
  { key: 'notify', label: 'Thông báo', icon: 'bell' },
  { key: 'reports', label: 'Báo cáo', icon: 'chart' },
  { key: 'config', label: 'Cấu hình', icon: 'sliders' },
];

export const screenByCode = (code: string) => WEB_SCREENS.find((s) => s.code === code) ?? APP_SCREENS.find((s) => s.code === code);
export const screensInGroup = (group: string, role: Role) => WEB_SCREENS.filter((s) => s.group === group && !s.hidden && canOpenScreen(role, s.code));
/** Đường dẫn tới màn theo mã, thay tham số: pathOf('W04', { id: 'DL00125' }). */
export function pathOf(code: string, params: Record<string, string> = {}) {
  const s = screenByCode(code);
  if (!s) return '/';
  return s.path.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k] ?? ''));
}
