import type * as React from 'react';

export type Tier = 'member' | 'bronze' | 'silver' | 'gold' | 'diamond' | 'strategic';
export type IconName = 'home' | 'users' | 'user' | 'file' | 'box' | 'cart' | 'star' | 'gift' | 'wallet' | 'book' | 'bell' | 'chart' | 'sliders' | 'lock' | 'eye' | 'eyeOff' | 'phone' | 'chat' | 'check' | 'x' | 'search' | 'alert' | 'clock' | 'moon' | 'info' | 'plus' | 'chevronRight' | 'download' | 'history' | 'award' | 'send' | 'upload' | 'printer' | 'filter' | 'edit' | 'shield' | 'logout' | 'qr' | 'image' | 'link' | 'refresh' | 'calendar' | 'arrowLeft' | 'minus' | 'trend' | 'handover' | 'smartphone';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'lg'; icon?: IconName; block?: boolean }

export interface TierBadgeProps { tier: Tier; label?: string; size?: 'sm' | 'lg'; className?: string }

export interface TierIconProps { tier: Tier; size?: number; label?: string; className?: string }

export interface StatusBadgeProps { tone?: 'danger' | 'warning' | 'dormant' | 'pending' | 'success' | 'info' | 'neutral' | 'new'; icon?: IconName | null; children?: React.ReactNode }

export interface PointValueProps { value: number; state?: 'available' | 'pending' | 'expired' | 'revoked'; signed?: boolean; unit?: string | false; size?: 'lg' | 'hero'; showState?: boolean }

export interface PointFundsProps { rank: number; reward: number; pending?: number; rankLabel?: string; rewardLabel?: string; rankNote?: string; rewardNote?: string; emphasis?: 'rank' | 'reward' | 'none'; onExplain?: (fund: 'rank' | 'reward') => void }

export interface TierProgressProps { tier?: Tier; nextTier?: Tier | null; value: number; target: number; unit?: 'points' | 'vnd'; footnote?: React.ReactNode; compact?: boolean }

export interface KpiCardProps { label: React.ReactNode; value: React.ReactNode; delta?: number; deltaLabel?: string; hint?: React.ReactNode; tone?: 'danger' | 'warning'; onClick?: () => void }

export interface DataTableColumn<R> { key: string; label: string; align?: 'left' | 'right'; width?: number | string; primary?: boolean; render?: (row: R) => React.ReactNode }
export interface DataTableProps<R = any> { columns: DataTableColumn<R>[]; rows: R[]; rowKey?: string; selectable?: boolean; defaultSelected?: Array<string | number>; onSelectionChange?: (keys: Array<string | number>) => void; bulkActions?: (rows: R[]) => React.ReactNode; itemLabel?: string; rowTone?: (row: R) => 'overdue' | 'atrisk' | 'dormant' | null; maxHeight?: number | string; onRowClick?: (row: R) => void; empty?: React.ReactNode }

export interface MaskedFieldProps { label?: string; value?: React.ReactNode; masked: React.ReactNode; canReveal?: boolean; onReveal?: () => void }

export interface ApprovalStep { label: string; actor?: string; time?: string; note?: string; status?: 'done' | 'current' | 'todo' | 'rejected' }
export interface ApprovalStepperProps { steps: ApprovalStep[]; orientation?: 'horizontal' | 'vertical' }

export interface PointBreakdownProps { steps: Array<{ code?: string; label: string; detail?: string; value: React.ReactNode }>; total: number; state?: PointValueProps['state']; totalLabel?: string; footnote?: React.ReactNode }

export interface QuickViewProps { title: React.ReactNode; open?: boolean; onClose?: () => void; footer?: React.ReactNode; inline?: boolean; children?: React.ReactNode }

export interface EmptyStateProps { icon?: IconName; title: string; body?: string; action?: React.ReactNode }

export interface ToastProps { tone?: 'success' | 'warning' | 'danger' | 'pending' | 'info'; title: string; body?: string; onClose?: () => void }

export interface GiftCardProps { name: string; image?: string; points: number; balance: number; vndPerPoint?: number; shortfallHint?: string; lockedForTier?: Tier; canRedeem?: boolean; tag?: string; meta?: React.ReactNode; onRedeem?: () => void }

export interface NavItem { key: string; label: string; icon?: IconName; badge?: number }
export interface SidebarProps { items: NavItem[]; active?: string; onSelect?: (key: string) => void; brand?: React.ReactNode; footer?: React.ReactNode }

export interface TopBarProps { title?: string; search?: boolean; searchPlaceholder?: string; onSearch?: (text: string) => void; right?: React.ReactNode }

export interface RoleSwitcherProps { roles?: Array<{ key: string; label: string }>; value?: string; defaultValue?: string; onChange?: (key: string) => void; label?: string }

export interface BottomNavProps { items?: NavItem[]; active?: string; onSelect?: (key: string) => void }

export interface CelebrationProps { title: string; tier?: Tier; body?: string; icon?: IconName; action?: React.ReactNode }

export interface IconProps { name: IconName; size?: number; strokeWidth?: number; label?: string; className?: string }

export interface TabsProps { items: Array<{ key: string; label: string; icon?: IconName; count?: number; alert?: boolean; tag?: string }>; value?: string; defaultValue?: string; onChange?: (key: string) => void; variant?: 'line' | 'pill' }

export interface CardProps { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; flush?: boolean; children?: React.ReactNode; style?: React.CSSProperties }

export interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> { label?: string; required?: boolean; hint?: string; error?: string; as?: 'input' | 'select' | 'textarea'; options?: Array<string | { value: string; label: string }>; prefix?: React.ReactNode; suffix?: React.ReactNode; size?: 'md' | 'lg' }

export interface FilterChipProps { selected?: boolean; onClick?: () => void; count?: number; children?: React.ReactNode }

export interface OtpInputProps { length?: number; value?: string; defaultValue?: string; onChange?: (code: string) => void; error?: boolean; label?: string }

export interface PaginationProps { page: number; total: number; pageSize?: number; itemLabel?: string; onChange?: (page: number) => void }


declare const DMP: {
  Button: (props: ButtonProps) => React.ReactElement;
  TierBadge: (props: TierBadgeProps) => React.ReactElement;
  TierIcon: (props: TierIconProps) => React.ReactElement;
  StatusBadge: (props: StatusBadgeProps) => React.ReactElement;
  PointValue: (props: PointValueProps) => React.ReactElement;
  PointFunds: (props: PointFundsProps) => React.ReactElement;
  TierProgress: (props: TierProgressProps) => React.ReactElement;
  KpiCard: (props: KpiCardProps) => React.ReactElement;
  DataTable: <R>(props: DataTableProps<R>) => React.ReactElement;
  MaskedField: (props: MaskedFieldProps) => React.ReactElement;
  ApprovalStepper: (props: ApprovalStepperProps) => React.ReactElement;
  PointBreakdown: (props: PointBreakdownProps) => React.ReactElement;
  QuickView: (props: QuickViewProps) => React.ReactElement | null;
  EmptyState: (props: EmptyStateProps) => React.ReactElement;
  Toast: (props: ToastProps) => React.ReactElement;
  GiftCard: (props: GiftCardProps) => React.ReactElement;
  Sidebar: (props: SidebarProps) => React.ReactElement;
  TopBar: (props: TopBarProps) => React.ReactElement;
  RoleSwitcher: (props: RoleSwitcherProps) => React.ReactElement;
  BottomNav: (props: BottomNavProps) => React.ReactElement;
  Celebration: (props: CelebrationProps) => React.ReactElement;
  Icon: (props: IconProps) => React.ReactElement;
  Tabs: (props: TabsProps) => React.ReactElement;
  Card: (props: CardProps) => React.ReactElement;
  Field: (props: FieldProps) => React.ReactElement;
  FilterChip: (props: FilterChipProps) => React.ReactElement;
  OtpInput: (props: OtpInputProps) => React.ReactElement;
  Pagination: (props: PaginationProps) => React.ReactElement;
  TIER_LABELS: Record<Tier, string>;
  format: { number(n: number): string; vnd(n: number): string; million(n: number): string; date(d: Date | string): string; dateTime(d: Date | string): string };
  mask: { phone(p: string): string; idCard(id: string): string; birthday(ddmmyyyy: string): string; bank(acc: string): string };
};
export default DMP;
