import { boolean, doublePrecision, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { Campaign, OrderLineInput, PointStep, RuleParams } from '@dmp/shared';

/** Người dùng nội bộ (web quản trị). */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  twoFA: boolean('two_fa').notNull().default(false),
  scope: text('scope').notNull().default(''),
  status: text('status').notNull().default('Đang hoạt động'),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  phone: text('phone').notNull().default(''),
  /** Khoá TOTP (Authenticator) — null = chưa đăng ký. */
  totpSecret: text('totp_secret'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Đại lý. Số dư điểm là bộ nhớ đệm của sổ cái, cập nhật trong cùng giao dịch ghi sổ. */
export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  owner: text('owner').notNull().default(''),
  phone: text('phone').notNull(),
  idCard: text('id_card').notNull().default(''),
  dob: text('dob').notNull().default(''),
  address: text('address').notNull().default(''),
  city: text('city').notNull().default(''),
  taxCode: text('tax_code').notNull().default(''),
  bank: text('bank').notNull().default(''),
  bankName: text('bank_name').notNull().default(''),
  saleId: text('sale_id').notNull(),
  tier: text('tier').notNull().default('member'),
  tierProtectedUntil: timestamp('tier_protected_until', { withTimezone: true }),
  status: text('status').notNull().default('ok'),
  flags: jsonb('flags').$type<string[]>().notNull().default([]),
  startDate: text('start_date').notNull().default(''),
  creditLimit: doublePrecision('credit_limit').notNull().default(0),
  creditDays: integer('credit_days').notNull().default(30),
  referrerId: text('referrer_id'),
  appActivated: boolean('app_activated').notNull().default(false),
  push: text('push').notNull().default('—'),
  docFiles: jsonb('doc_files').$type<Record<string, string>>().notNull().default({}),
  suspendReason: text('suspend_reason'),
  rankPoints: integer('rank_points').notNull().default(0),
  rewardPoints: integer('reward_points').notNull().default(0),
  pendingPoints: integer('pending_points').notNull().default(0),
  salesMonth: doublePrecision('sales_month').notNull().default(0),
  salesLastMonth: doublePrecision('sales_last_month').notNull().default(0),
  debt: doublePrecision('debt').notNull().default(0),
  overdueDays: integer('overdue_days').notNull().default(0),
  lastOrder: text('last_order').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('agents_sale_idx').on(t.saleId)]);

/** Tài khoản app đại lý: chủ (DLC) và nhân viên (DLNV), đăng nhập SĐT + OTP Zalo. */
export const agentAccounts = pgTable('agent_accounts', {
  id: serial('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  phone: text('phone').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').notNull().default('DLC'),
  active: boolean('active').notNull().default(true),
  /** Thời điểm đồng ý xử lý dữ liệu cá nhân (Luật BVDLCN) — bằng chứng đồng ý. */
  consentAt: timestamp('consent_at', { withTimezone: true }),
  consentDevice: text('consent_device'),
});

export const otpCodes = pgTable('otp_codes', {
  id: serial('id').primaryKey(),
  target: text('target').notNull(),
  purpose: text('purpose').notNull(),
  code: text('code').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  used: boolean('used').notNull().default(false),
});

export const contracts = pgTable('contracts', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  commitMonth: doublePrecision('commit_month').notNull(),
  policy: text('policy').notNull().default(''),
  status: text('status').notNull().default('Hiệu lực'),
});

export const products = pgTable('products', {
  sku: text('sku').primaryKey(),
  brand: text('brand').notNull(),
  line: text('line').notNull(),
  name: text('name').notNull(),
  price: doublePrecision('price').notNull(),
  cost: doublePrecision('cost').notNull(),
  noPoint: boolean('no_point').notNull().default(false),
  multiplier: doublePrecision('multiplier').notNull().default(1),
  multiplierUntil: text('multiplier_until').notNull().default(''),
  reg: text('reg').notNull().default(''),
  stock: integer('stock').notNull().default(0),
});

export const orders = pgTable('orders', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  orderedAt: timestamp('ordered_at', { withTimezone: true }).notNull(),
  source: text('source').notNull().default('KiotViet'),
  status: text('status').notNull(),
  pay: text('pay').notNull(),
  ship: doublePrecision('ship').notNull().default(0),
  value: doublePrecision('value').notNull(),
  lines: jsonb('lines').$type<OrderLineInput[]>().notNull(),
  points: integer('points').notNull().default(0),
  pointState: text('point_state').notNull().default('none'),
  tierAtOrder: text('tier_at_order').notNull(),
  ruleVersion: integer('rule_version').notNull(),
  calc: jsonb('calc').$type<{ steps: PointStep[]; total: number }>(),
  returnedPct: doublePrecision('returned_pct').notNull().default(0),
  paidAmount: doublePrecision('paid_amount').notNull().default(0),
  campaignIds: jsonb('campaign_ids').$type<string[]>().notNull().default([]),
  paidAt: timestamp('paid_at', { withTimezone: true }),
}, (t) => [index('orders_agent_idx').on(t.agentId)]);

export const returns = pgTable('returns', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id),
  agentId: text('agent_id').notNull(),
  pct: doublePrecision('pct').notNull(),
  value: doublePrecision('value').notNull(),
  points: integer('points').notNull(),
  reason: text('reason').notNull().default(''),
  status: text('status').notNull().default('Đã xử lý'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Sổ cái điểm — CHỈ GHI THÊM. Không sửa số điểm, không xoá dòng.
 * Ngoại lệ duy nhất: `state` của dòng Treo chuyển một lần sang Khả dụng/Thu hồi (có audit).
 * Sửa sai bằng bút toán đảo (`reversalOf`).
 */
export const ledger = pgTable('point_ledger', {
  id: serial('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  period: text('period').notNull(),
  type: text('type').notNull(),
  fund: text('fund').notNull(),
  deltaRank: integer('delta_rank').notNull().default(0),
  deltaReward: integer('delta_reward').notNull().default(0),
  state: text('state').notNull(),
  item: text('item').notNull(),
  ref: text('ref').notNull().default(''),
  rule: text('rule').notNull().default('—'),
  ruleVersion: integer('rule_version'),
  byUser: text('by_user').notNull(),
  reversalOf: integer('reversal_of'),
  approvalId: text('approval_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (t) => [index('ledger_agent_idx').on(t.agentId), index('ledger_ref_idx').on(t.ref)]);

/** Lô điểm thưởng để trừ FIFO và cho hết hạn sau N tháng. */
export const pointLots = pgTable('point_lots', {
  id: serial('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  ledgerId: integer('ledger_id').notNull(),
  amount: integer('amount').notNull(),
  remaining: integer('remaining').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [index('lots_agent_idx').on(t.agentId)]);

export const periods = pgTable('periods', {
  period: text('period').primaryKey(),
  locked: boolean('locked').notNull().default(false),
  lockedBy: text('locked_by'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
});

/** Bộ quy tắc có phiên bản: Nháp → Chờ BOD duyệt → Hiệu lực → Hết hiệu lực. */
export const ruleSets = pgTable('rule_sets', {
  version: serial('version').primaryKey(),
  status: text('status').notNull(),
  params: jsonb('params').$type<RuleParams>().notNull(),
  note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull(),
  approvedBy: text('approved_by'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const gifts = pgTable('gifts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  points: integer('points').notNull(),
  value: doublePrecision('value').notNull(),
  minTier: text('min_tier'),
  stock: integer('stock'),
  window: text('window').notNull().default(''),
  status: text('status').notNull().default('Đang mở'),
  tag: text('tag'),
  imageFileId: text('image_file_id'),
});

export const redemptions = pgTable('redemptions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  giftId: text('gift_id').notNull().references(() => gifts.id),
  giftName: text('gift_name').notNull(),
  points: integer('points').notNull(),
  qty: integer('qty').notNull().default(1),
  stage: text('stage').notNull(),
  note: text('note').notNull().default(''),
  history: jsonb('history').$type<Array<{ stage: string; by: string; at: string; note?: string }>>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Hàng chờ duyệt chung cho mọi luồng maker-checker. */
export const approvals = pgTable('approvals', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('pending'),
  agentId: text('agent_id'),
  title: text('title').notNull(),
  points: integer('points'),
  payload: jsonb('payload').$type<Record<string, any>>().notNull().default({}),
  reason: text('reason').notNull().default(''),
  files: integer('files').notNull().default(0),
  requestedBy: text('requested_by').notNull(),
  requestedRole: text('requested_role').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  phase: text('phase'),
});

/** Hồ sơ đề xuất đại lý mới: Sale đề xuất → BOD duyệt → KT cấp mã → ZNS kích hoạt. */
export const applications = pgTable('applications', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  owner: text('owner').notNull().default(''),
  phone: text('phone').notNull(),
  city: text('city').notNull().default(''),
  address: text('address').notNull().default(''),
  taxCode: text('tax_code').notNull().default(''),
  idCard: text('id_card').notNull().default(''),
  commitMonth: doublePrecision('commit_month').notNull().default(0),
  creditDays: integer('credit_days').notNull().default(0),
  policy: text('policy').notNull().default(''),
  referrerId: text('referrer_id'),
  docs: jsonb('docs').$type<string[]>().notNull().default([]),
  /** Giấy tờ đã tải lên: { 'CCCD mặt trước': fileId, ... } */
  docFiles: jsonb('doc_files').$type<Record<string, string>>().notNull().default({}),
  stage: text('stage').notNull(),
  reason: text('reason'),
  agentId: text('agent_id'),
  saleId: text('sale_id').notNull(),
  history: jsonb('history').$type<Array<{ stage: string; by: string; at: string; note?: string }>>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Hộp thư gửi ZNS / thông báo app (giả lập cổng Zalo). */
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  agentId: text('agent_id'),
  phone: text('phone'),
  channel: text('channel').notNull().default('ZNS'),
  template: text('template').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('Đã gửi'),
  read: boolean('read').notNull().default(false),
  sender: text('sender').notNull().default('Hệ thống'),
  batchId: text('batch_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  userName: text('user_name').notNull(),
  role: text('role').notNull(),
  action: text('action').notNull(),
  target: text('target').notNull().default(''),
  oldValue: text('old_value').notNull().default('—'),
  newValue: text('new_value').notNull().default('—'),
  ip: text('ip').notNull().default(''),
});

/** Chuỗi số liệu lịch sử 12 tháng cho dashboard (dữ liệu đã có trước khi chạy hệ thống). */
export const monthlyStats = pgTable('monthly_stats', {
  month: text('month').primaryKey(),
  ord: integer('ord').notNull(),
  revenue: doublePrecision('revenue').notNull(),
  revenueLY: doublePrecision('revenue_ly').notNull(),
  issued: integer('issued').notNull(),
  redeemed: integer('redeemed').notNull(),
  activeRate: integer('active_rate').notNull(),
  commitActual: doublePrecision('commit_actual').notNull(),
});

export const counters = pgTable('counters', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
}, (t) => [uniqueIndex('counters_key').on(t.key)]);

/* ---------- Bổ sung sau MVP & GĐ2 ---------- */

/** Lịch sử thanh toán (ghi nhận tay hoặc import MISA). */
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  orderId: text('order_id').notNull(),
  agentId: text('agent_id').notNull(),
  amount: doublePrecision('amount').notNull(),
  method: text('method').notNull().default('Chuyển khoản'),
  source: text('source').notNull().default('Thủ công'),
  byUser: text('by_user').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('payments_agent_idx').on(t.agentId)]);

/** File tải lên (giấy tờ, bằng chứng, ảnh quà, tài liệu bán hàng). */
export const files = pgTable('files', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  path: text('path').notNull(),
  owner: text('owner').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  value: doublePrecision('value').notNull(),
  scope: jsonb('scope').$type<Pick<Campaign, 'brands' | 'lines' | 'skus' | 'types' | 'minTier' | 'minOrderVND'>>().notNull().default({}),
  fromDate: timestamp('from_date', { withTimezone: true }).notNull(),
  toDate: timestamp('to_date', { withTimezone: true }).notNull(),
  budget: integer('budget').notNull().default(0),
  used: integer('used').notNull().default(0),
  status: text('status').notNull().default('Nháp'),
  note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Khoá đào tạo / sự kiện (W19, M13). */
export const courses = pgTable('courses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  date: text('date').notNull().default(''),
  points: integer('points').notNull().default(0),
  rule: text('rule').notNull().default('R07'),
  content: text('content').notNull().default(''),
  fileId: text('file_id'),
  quiz: jsonb('quiz').$type<Array<{ q: string; options: string[]; answer: number }>>().notNull().default([]),
  passPct: integer('pass_pct').notNull().default(80),
  status: text('status').notNull().default('Đang mở'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const courseAttempts = pgTable('course_attempts', {
  id: serial('id').primaryKey(),
  courseId: text('course_id').notNull(),
  agentId: text('agent_id').notNull(),
  score: integer('score').notNull().default(0),
  total: integer('total').notNull().default(0),
  passed: boolean('passed').notNull().default(false),
  method: text('method').notNull().default('quiz'),
  approvalId: text('approval_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('attempts_course_idx').on(t.courseId)]);

/** Bằng chứng hoạt động đại lý nộp (M12): đăng bài, trưng bày, mở điểm bán. */
export const evidence = pgTable('evidence', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  category: text('category').notNull(),
  points: integer('points').notNull(),
  link: text('link').notNull().default(''),
  fileIds: jsonb('file_ids').$type<string[]>().notNull().default([]),
  note: text('note').notNull().default(''),
  stage: text('stage').notNull(),
  approvalId: text('approval_id'),
  history: jsonb('history').$type<Array<{ stage: string; by: string; at: string; note?: string }>>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Khiếu nại điểm (W21, M15) — SLA 3 ngày. */
export const complaints = pgTable('complaints', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  ledgerId: integer('ledger_id'),
  ref: text('ref').notNull().default(''),
  txLabel: text('tx_label').notNull().default(''),
  claim: text('claim').notNull(),
  wantPoints: integer('want_points').notNull().default(0),
  fileIds: jsonb('file_ids').$type<string[]>().notNull().default([]),
  status: text('status').notNull().default('Mới'),
  assignee: text('assignee'),
  resolution: text('resolution'),
  approvalId: text('approval_id'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  history: jsonb('history').$type<Array<{ stage: string; by: string; at: string; note?: string }>>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Tài liệu bán hàng (M16). */
export const salesDocs = pgTable('sales_docs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  kind: text('kind').notNull().default('file'),
  sizeLabel: text('size_label').notNull().default(''),
  fileId: text('file_id'),
  url: text('url').notNull().default(''),
  minTier: text('min_tier'),
  downloads: integer('downloads').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Thông báo hẹn giờ (W20). */
export const scheduledBroadcasts = pgTable('scheduled_broadcasts', {
  id: serial('id').primaryKey(),
  payload: jsonb('payload').$type<Record<string, any>>().notNull(),
  sendAt: timestamp('send_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('Chờ gửi'),
  sender: text('sender').notNull(),
  result: text('result'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Doanh số theo tháng của từng đại lý (biểu đồ cam kết W04/W06). */
export const agentMonthly = pgTable('agent_monthly', {
  agentId: text('agent_id').notNull(),
  month: text('month').notNull(),
  sales: doublePrecision('sales').notNull(),
  commit: doublePrecision('commit').notNull(),
}, (t) => [uniqueIndex('agent_monthly_pk').on(t.agentId, t.month)]);

/** Phân bổ hạng theo tháng (ghi sau mỗi lần xét hạng). */
export const tierHistory = pgTable('tier_history', {
  month: text('month').primaryKey(),
  counts: jsonb('counts').$type<Record<string, number>>().notNull(),
});

/** Nhật ký job định kỳ và đồng bộ tích hợp. */
export const jobRuns = pgTable('job_runs', {
  id: serial('id').primaryKey(),
  job: text('job').notNull(),
  status: text('status').notNull(),
  message: text('message').notNull().default(''),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('job_runs_job_idx').on(t.job)]);
