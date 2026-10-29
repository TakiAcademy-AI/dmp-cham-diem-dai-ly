/** Kiểu dữ liệu trả về từ API (khớp apps/api/src/db/schema.ts + trường bổ sung của controller). */
import type { OrderLineInput, PointStep, RuleParams } from '@dmp/shared';

export interface Agent {
  id: string; name: string; type: string; owner: string; phone: string; idCard: string; dob: string; address: string; city: string; taxCode: string;
  bank: string; bankName: string; saleId: string; saleName: string; tier: string; tierProtectedUntil: string | null; status: string; flags: string[];
  startDate: string; creditLimit: number | null; creditDays: number; referrerId: string | null; appActivated: boolean; push: string;
  rankPoints: number; rewardPoints: number; pendingPoints: number; salesMonth: number; salesLastMonth: number; debt: number | null; overdueDays: number; lastOrder: string;
  commitMonth?: number; commitPct: number; contractEnd?: string; contractNo?: string;
  masked: { phone: boolean; idCard: boolean; dob: boolean; bank: boolean; debt: boolean };
}
export interface AgentDetail extends Agent {
  contract: Contract | null;
  accounts: Array<{ id: number; phone: string; name: string; role: string; active: boolean }>;
  orders: Order[];
  redemptions: Redemption[];
}
export interface Contract { id: string; agentId: string; startDate: string; endDate: string; commitMonth: number; policy: string; status: string; agentName?: string; tier?: string; saleName?: string; salesMonth?: number; salesLastMonth?: number; commitPct?: number }

export interface Order {
  id: string; agentId: string; agentName: string; saleName: string; orderedAt: string; source: string; status: string; pay: string; ship: number; value: number;
  lines: OrderLineInput[]; points: number; pointState: 'none' | 'pending' | 'available' | 'revoked'; tierAtOrder: string; ruleVersion: number;
  calc: { steps: PointStep[]; total: number } | null; returnedPct: number; paidAt: string | null;
  returns: ReturnSlip[];
}
export interface ReturnSlip { id: string; orderId: string; agentId: string; agentName?: string; pct: number; value: number; points: number; reason: string; status: string; createdBy: string; createdAt: string }

export interface LedgerRow {
  id: number; agentId: string; agentName: string; createdAt: string; period: string; type: string; fund: 'both' | 'rank' | 'reward';
  deltaRank: number; deltaReward: number; state: 'pending' | 'available' | 'expired' | 'revoked'; item: string; ref: string; rule: string; byUser: string;
  reversalOf: number | null; approvalId: string | null; expiresAt: string | null;
}
export interface PointSummary {
  agentId: string; tier: string; rank: number; reward: number; pending: number; protectedUntil: string | null;
  progress: { tier: string; next: string | null; value: number; target: number; remaining: number };
  expiring: Array<{ date: string; points: number }>; ruleVersion: number; pointValueVND: number; vndPerPoint: number;
}

export interface Gift { id: string; name: string; type: string; points: number; value: number; minTier: string | null; stock: number | null; window: string; status: string; tag: string | null; imageFileId?: string | null; redeemed?: number }
export interface AppGift extends Gift { tierOk: boolean; shortfall: number; shortfallVND: number; canRedeem: boolean }
export interface Redemption {
  id: string; agentId: string; agentName?: string; tier?: string; saleName?: string; giftId: string; giftName: string; points: number; qty: number; stage: string; note: string;
  history: Array<{ stage: string; by: string; at: string; note?: string }>; createdAt: string; next?: { to: string; roles: string[]; label: string } | null;
}
export interface Approval {
  id: string; kind: string; status: 'pending' | 'approved' | 'rejected'; agentId: string | null; agentName: string | null; agentTier: string | null; title: string; points: number | null;
  payload: Record<string, any>; reason: string; files: number; requestedBy: string; requestedRole: string; requestedAt: string; dueAt: string | null;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; phase: string | null;
}
export interface Application {
  id: string; name: string; type: string; owner: string; phone: string; city: string; address: string; taxCode: string; idCard: string; commitMonth: number; creditDays: number;
  policy: string; referrerId: string | null; docs: string[]; stage: string; reason: string | null; agentId: string | null; saleId: string; saleName: string;
  history: Array<{ stage: string; by: string; at: string; note?: string }>; createdAt: string;
}
export interface RuleSet { version: number; status: string; params: RuleParams; note: string; createdBy: string; approvedBy: string | null; effectiveFrom: string | null; createdAt: string }
export interface Product { sku: string; brand: string; line: string; name: string; price: number; cost: number | null; noPoint: boolean; multiplier: number; multiplierUntil: string; reg: string; stock: number }
export interface Notification { id: number; agentId: string | null; agentName?: string | null; phone: string | null; channel: string; template: string; title: string; body: string; status: string; read: boolean; createdAt: string }
export interface AuditRow { id: number; at: string; userName: string; role: string; action: string; target: string; oldValue: string; newValue: string; ip: string }
export interface User { id: string; name: string; email: string; role: string; roleLabel: string; twoFA: boolean; scope: string; status: string; agents: number; lockedUntil: string | null; createdAt: string }
