import { fmtDec, fmtNumber } from './format';
import { TIER_NAME, TIER_ORDER, type Campaign, type OrderLineInput, type RuleParams, type Tier, type TierDef } from './types';

/**
 * Engine điểm (mục 3.4 DMP_01). Hàm thuần, không đụng DB: API dùng để ghi sổ cái,
 * web dùng để xem trước / mô phỏng. Thứ tự tính B1 → B5:
 *  B1 giá trị tính điểm = Σ(dòng không loại trừ) sau chiết khấu, sau VAT, trừ phí ship
 *  B2 điểm cơ bản = floor(B1 / vndPerPoint)
 *  B3 nhân hệ số SP cao nhất × hệ số hạng (làm tròn xuống)
 *  B4 cộng thưởng mốc đơn (không nhân hệ số)
 *  B5 ghi sổ: Treo nếu chưa thanh toán đủ, Khả dụng khi đã thanh toán
 */
export interface PointStep { code: string; label: string; detail: string; value: string }
export interface OrderPoints {
  value: number;
  base: number;
  productMult: number;
  tierMult: number;
  multiplied: number;
  bonus: number;
  total: number;
  excluded: number;
  ship: number;
  belowMinimum: boolean;
  steps: PointStep[];
  /** Campaign đã áp dụng cho đơn. */
  campaignIds: string[];
}

export interface CampaignContext { tier: Tier; agentType?: string; at?: Date }
/** Campaign có áp dụng cho đại lý/thời điểm này không (chưa xét dòng SP). */
export function campaignActive(c: Campaign, ctx: CampaignContext): boolean {
  const at = ctx.at ?? new Date();
  if (at < new Date(c.from) || at > new Date(c.to)) return false;
  if (c.minTier && TIER_ORDER.indexOf(ctx.tier) < TIER_ORDER.indexOf(c.minTier)) return false;
  if (c.types?.length && (!ctx.agentType || !c.types.includes(ctx.agentType))) return false;
  return true;
}
export function campaignMatchesLine(c: Campaign, l: OrderLineInput): boolean {
  if (c.skus?.length && !c.skus.includes(l.sku)) return false;
  if (c.brands?.length && (!l.brand || !c.brands.includes(l.brand))) return false;
  if (c.lines?.length && (!l.line || !c.lines.includes(l.line))) return false;
  return true;
}

export function tierDef(params: RuleParams, tier: Tier): TierDef {
  return params.tiers.find((t) => t.key === tier) ?? params.tiers[0];
}

export function lineAmount(l: OrderLineInput, vatRate: number): number {
  return l.price * l.qty * (1 - (l.discount || 0)) * (1 + vatRate);
}

export function computeOrderPoints(
  lines: OrderLineInput[],
  tier: Tier,
  params: RuleParams,
  opts: { ship?: number; paid?: boolean; campaigns?: Campaign[]; agentType?: string; at?: Date } = {},
): OrderPoints {
  let eligible = 0;
  let excluded = 0;
  let maxMult = 1;
  let multCampaign: Campaign | null = null;
  const live = (opts.campaigns ?? []).filter((c) => campaignActive(c, { tier, agentType: opts.agentType, at: opts.at }));
  for (const l of lines) {
    const v = lineAmount(l, params.vatRate);
    if (l.noPoint) excluded += v;
    else {
      eligible += v;
      if ((l.multiplier ?? 1) > maxMult) { maxMult = l.multiplier ?? 1; multCampaign = null; }
      for (const c of live) if (c.kind === 'multiplier' && campaignMatchesLine(c, l) && c.value > maxMult) { maxMult = c.value; multCampaign = c; }
    }
  }
  const ship = opts.ship ?? 0;
  const base = Math.max(0, eligible - ship);
  const belowMinimum = base < params.minOrderVND;
  const basePts = belowMinimum ? 0 : Math.floor(base / params.vndPerPoint);
  const tm = tierDef(params, tier).multiplier;
  const multiplied = Math.floor(basePts * maxMult * tm);
  const bonus = base >= params.milestoneOrderVND ? params.milestoneBonus : 0;
  const bonusCampaigns = belowMinimum ? [] : live.filter((c) => c.kind === 'bonus' && base >= (c.minOrderVND ?? 0) && lines.some((l) => !l.noPoint && campaignMatchesLine(c, l)));
  const campBonus = bonusCampaigns.reduce((t, c) => t + c.value, 0);
  const total = multiplied + bonus + campBonus;
  const steps: PointStep[] = [
    {
      code: 'B1', label: 'Giá trị tính điểm',
      detail: 'Sau chiết khấu, sau VAT, trừ phí ship' + (excluded ? `; loại ${fmtNumber(excluded)}đ hàng không tính điểm` : ''),
      value: fmtNumber(base) + 'đ',
    },
    {
      code: 'B2', label: 'Điểm cơ bản',
      detail: belowMinimum ? `Đơn dưới mức tối thiểu ${fmtNumber(params.minOrderVND)}đ` : `floor(${fmtNumber(base)} / ${fmtNumber(params.vndPerPoint)})`,
      value: fmtNumber(basePts),
    },
    {
      code: 'B3', label: 'Hệ số',
      detail: `Hệ số SP cao nhất ×${fmtDec(maxMult)}${multCampaign ? ` (campaign ${multCampaign.id})` : ''} · hạng ${TIER_NAME[tier]} ×${fmtDec(tm)}`,
      value: fmtNumber(multiplied),
    },
    {
      code: 'B4', label: 'Thưởng mốc đơn',
      detail: bonus ? `Đơn ≥ ${fmtNumber(params.milestoneOrderVND / 1e6)} triệu (không nhân hệ số)` : `Chưa đạt mốc ${fmtNumber(params.milestoneOrderVND / 1e6)} triệu`,
      value: bonus ? '+' + fmtNumber(bonus) : '0',
    },
    ...(bonusCampaigns.length ? [{
      code: 'B4+', label: 'Thưởng campaign',
      detail: bonusCampaigns.map((c) => `${c.id} ${c.name}`).join('; ') + ' (không nhân hệ số)',
      value: '+' + fmtNumber(campBonus),
    }] : []),
    {
      code: 'B5', label: 'Ghi sổ cái',
      detail: opts.paid ? `Đã thanh toán đủ → Khả dụng, lô hết hạn sau ${params.expiryMonths} tháng` : 'Trạng thái Treo cho tới khi thanh toán đủ',
      value: opts.paid ? 'Khả dụng' : 'Treo',
    },
  ];
  return {
    value: Math.round(base), base: basePts, productMult: maxMult, tierMult: tm, multiplied, bonus, total,
    excluded: Math.round(excluded), ship, belowMinimum, steps,
    campaignIds: [...new Set([...(multCampaign ? [multCampaign.id] : []), ...bonusCampaigns.map((c) => c.id)])],
  };
}

/** Hạng đạt được theo điểm số xét hạng (bỏ qua hạng đặc biệt xét tay). */
export function tierForScore(score: number, params: RuleParams): Tier {
  let best: Tier = 'member';
  for (const t of params.tiers) {
    if (t.special || t.threshold == null) continue;
    if (score >= t.threshold && TIER_ORDER.indexOf(t.key) > TIER_ORDER.indexOf(best)) best = t.key;
  }
  return best;
}

export interface TierDecision { tier: Tier; change: 'up' | 'down' | 'keep' | 'protected' | 'manual'; reason: string }

/**
 * Xét hạng định kỳ: lên ngay khi đạt ngưỡng; dưới ngưỡng giữ hạng thì rớt 1 bậc,
 * trừ khi còn trong thời gian bảo vệ hạng. Hạng đặc biệt (Đối tác chiến lược) chỉ đổi tay.
 */
export function evaluateTier(current: Tier, score: number, params: RuleParams, protectedUntil: Date | null, today: Date): TierDecision {
  const cur = tierDef(params, current);
  if (cur.special) return { tier: current, change: 'manual', reason: 'Hạng đặc biệt do BOD duyệt' };
  const reach = tierForScore(score, params);
  const ci = TIER_ORDER.indexOf(current);
  if (TIER_ORDER.indexOf(reach) > ci) return { tier: reach, change: 'up', reason: `Đạt ngưỡng hạng ${TIER_NAME[reach]}` };
  if (cur.keep == null || score >= cur.keep) return { tier: current, change: 'keep', reason: 'Đạt ngưỡng giữ hạng' };
  if (protectedUntil && protectedUntil >= today) return { tier: current, change: 'protected', reason: 'Đang trong thời gian bảo vệ hạng' };
  const lower = TIER_ORDER[Math.max(0, ci - 1)];
  return { tier: lower, change: 'down', reason: `Dưới ngưỡng giữ hạng ${fmtNumber(cur.keep)}` };
}

export interface TierProgressInfo { tier: Tier; next: Tier | null; value: number; target: number; remaining: number }
export function tierProgress(tier: Tier, score: number, params: RuleParams): TierProgressInfo {
  const ordered = params.tiers.filter((t) => !t.special && t.threshold != null).sort((a, b) => (a.threshold! - b.threshold!));
  const ci = TIER_ORDER.indexOf(tier);
  const next = ordered.find((t) => TIER_ORDER.indexOf(t.key) > ci) ?? null;
  if (!next) return { tier, next: null, value: score, target: score, remaining: 0 };
  return { tier, next: next.key, value: score, target: next.threshold!, remaining: Math.max(0, next.threshold! - score) };
}

/* ---------- Lô điểm FIFO ---------- */
export interface Lot { id: string | number; remaining: number; expiresAt: Date }
export interface LotTake { id: string | number; take: number }
/** Trừ điểm theo FIFO: lô hết hạn sớm nhất bị trừ trước. Ném lỗi nếu không đủ điểm. */
export function allocateFifo(lots: Lot[], amount: number, now = new Date()): LotTake[] {
  const live = lots.filter((l) => l.remaining > 0 && l.expiresAt >= now).sort((a, b) => +a.expiresAt - +b.expiresAt);
  const out: LotTake[] = [];
  let need = amount;
  for (const l of live) {
    if (need <= 0) break;
    const take = Math.min(l.remaining, need);
    out.push({ id: l.id, take });
    need -= take;
  }
  if (need > 0) throw new Error(`Không đủ điểm khả dụng: còn thiếu ${fmtNumber(need)} điểm`);
  return out;
}

/* ---------- Mô phỏng phân bổ hạng & chi phí điểm (W11/W12) ---------- */
export interface SimAgent { tier: Tier; score: number; monthlyRevenue: number }
export interface SimResult {
  distribution: Array<{ tier: Tier; current: number; simulated: number }>;
  monthlyRevenue: number;
  monthlyPoints: number;
  costPct: number;
  moves: { up: number; down: number };
}
export function simulate(params: RuleParams, agents: SimAgent[]): SimResult {
  const cur: Record<string, number> = {};
  const sim: Record<string, number> = {};
  let rev = 0, pts = 0, up = 0, down = 0;
  for (const a of agents) {
    cur[a.tier] = (cur[a.tier] ?? 0) + 1;
    const t = tierDef(params, a.tier).special ? a.tier : tierForScore(a.score, params);
    sim[t] = (sim[t] ?? 0) + 1;
    const d = TIER_ORDER.indexOf(t) - TIER_ORDER.indexOf(a.tier);
    if (d > 0) up++; else if (d < 0) down++;
    rev += a.monthlyRevenue;
    const mult = tierDef(params, t).multiplier;
    pts += Math.floor((a.monthlyRevenue * (1 + params.vatRate)) / params.vndPerPoint) * mult;
  }
  const costPct = rev ? (pts * params.pointValueVND) / rev * 100 : 0;
  return {
    distribution: TIER_ORDER.map((t) => ({ tier: t, current: cur[t] ?? 0, simulated: sim[t] ?? 0 })),
    monthlyRevenue: rev, monthlyPoints: Math.round(pts), costPct: Math.round(costPct * 100) / 100, moves: { up, down },
  };
}
