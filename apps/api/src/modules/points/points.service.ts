import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import {
  addMonths, allocateFifo, endOfMonth, evaluateTier, fmtNumber, periodOf, simulate, TIER_NAME, TIER_ORDER, tierProgress,
  type Fund, type LedgerType, type PointState, type RuleParams, type Tier,
} from '@dmp/shared';
import { schema, type DB, type Tx } from '../../db/db';
import { InjectDb, ZnsService } from '../../common/core';

const { ledger, pointLots, agents, periods, ruleSets } = schema;

export interface PostEntry {
  agentId: string;
  type: LedgerType;
  fund: Fund;
  points: number;           // dương = cộng, âm = trừ
  state?: PointState;
  item: string;
  ref?: string;
  rule?: string;
  ruleVersion?: number | null;
  byUser: string;
  approvalId?: string;
  reversalOf?: number;
  at?: Date;
}

/**
 * Ghi sổ cái điểm. Mọi thay đổi số dư điểm đều đi qua đây, trong giao dịch DB:
 * ghi dòng sổ cái → tạo/tiêu thụ lô FIFO → cập nhật số dư đệm của đại lý → xét lên hạng.
 */
@Injectable()
export class PointsService {
  constructor(@InjectDb() private db: DB, private zns: ZnsService) {}

  async activeRules(tx?: Tx | DB): Promise<{ version: number; params: RuleParams }> {
    const [r] = await (tx ?? this.db).select().from(ruleSets).where(eq(ruleSets.status, 'Hiệu lực')).orderBy(desc(ruleSets.version)).limit(1);
    if (!r) throw new BadRequestException('Chưa có bộ quy tắc điểm hiệu lực');
    return { version: r.version, params: r.params };
  }

  async ensureOpen(tx: Tx | DB, at: Date) {
    const p = periodOf(at);
    const [row] = await tx.select().from(periods).where(eq(periods.period, p));
    if (row?.locked) throw new BadRequestException(`Kỳ ${p} đã khoá sổ. Cần BOD duyệt mở lại kỳ trước khi ghi điểm.`);
    if (!row) await tx.insert(periods).values({ period: p, locked: false }).onConflictDoNothing();
  }

  async post(tx: Tx, e: PostEntry) {
    const at = e.at ?? new Date();
    await this.ensureOpen(tx, at);
    const state = e.state ?? 'available';
    const { params } = await this.activeRules(tx);
    const dRank = e.fund === 'reward' ? 0 : e.points;
    const dReward = e.fund === 'rank' ? 0 : e.points;
    const [agent] = await tx.select().from(agents).where(eq(agents.id, e.agentId));
    if (!agent) throw new BadRequestException('Không tìm thấy đại lý ' + e.agentId);
    if (dReward < 0 && state === 'available' && agent.rewardPoints + dReward < 0 && e.type === 'redeem') {
      throw new BadRequestException(`Không đủ điểm thưởng: còn ${fmtNumber(agent.rewardPoints)}, cần ${fmtNumber(-dReward)}`);
    }
    const expiresAt = dReward > 0 ? endOfMonth(addMonths(at, params.expiryMonths)) : null;
    const [row] = await tx.insert(ledger).values({
      agentId: e.agentId, createdAt: at, period: periodOf(at), type: e.type, fund: e.fund, deltaRank: dRank, deltaReward: dReward, state,
      item: e.item, ref: e.ref ?? '', rule: e.rule ?? '—', ruleVersion: e.ruleVersion ?? null, byUser: e.byUser, approvalId: e.approvalId ?? null,
      reversalOf: e.reversalOf ?? null, expiresAt,
    }).returning();
    if (state === 'available') await this.applyAvailable(tx, row.id, e.agentId, dRank, dReward, expiresAt);
    else if (state === 'pending') await tx.update(agents).set({ pendingPoints: sql`${agents.pendingPoints} + ${dReward}` }).where(eq(agents.id, e.agentId));
    return row;
  }

  /** Số dư + lô FIFO khi một dòng trở thành Khả dụng. */
  private async applyAvailable(tx: Tx, ledgerId: number, agentId: string, dRank: number, dReward: number, expiresAt: Date | null) {
    if (dReward > 0) {
      await tx.insert(pointLots).values({ agentId, ledgerId, amount: dReward, remaining: dReward, expiresAt: expiresAt ?? endOfMonth(addMonths(new Date(), 12)) });
    } else if (dReward < 0) {
      await this.consumeLots(tx, agentId, -dReward);
    }
    await tx.update(agents).set({
      rankPoints: sql`${agents.rankPoints} + ${dRank}`,
      rewardPoints: sql`${agents.rewardPoints} + ${dReward}`,
    }).where(eq(agents.id, agentId));
    if (dRank > 0) await this.checkUpgrade(tx, agentId);
  }

  private async consumeLots(tx: Tx, agentId: string, amount: number) {
    const lots = await tx.select().from(pointLots).where(and(eq(pointLots.agentId, agentId), gt(pointLots.remaining, 0))).orderBy(asc(pointLots.expiresAt));
    let takes: Array<{ id: string | number; take: number }>;
    try {
      takes = allocateFifo(lots.map((l) => ({ id: l.id, remaining: l.remaining, expiresAt: l.expiresAt })), amount);
    } catch {
      // Bút toán đảo có thể vượt phần lô còn lại (điểm đã tiêu): trừ hết lô hiện có, phần âm nằm trên số dư.
      takes = lots.map((l) => ({ id: l.id, take: l.remaining }));
    }
    for (const t of takes) await tx.update(pointLots).set({ remaining: sql`${pointLots.remaining} - ${t.take}` }).where(eq(pointLots.id, Number(t.id)));
  }

  /** Điểm Treo → Khả dụng (khi đơn được thanh toán đủ). Trả về tổng điểm đã kích hoạt. */
  async activatePending(tx: Tx, ref: string): Promise<number> {
    const rows = await tx.select().from(ledger).where(and(eq(ledger.ref, ref), eq(ledger.state, 'pending')));
    let total = 0;
    for (const r of rows) {
      await this.ensureOpen(tx, new Date());
      await tx.update(ledger).set({ state: 'available' }).where(eq(ledger.id, r.id));
      await tx.update(agents).set({ pendingPoints: sql`${agents.pendingPoints} - ${r.deltaReward}` }).where(eq(agents.id, r.agentId));
      await this.applyAvailable(tx, r.id, r.agentId, r.deltaRank, r.deltaReward, r.expiresAt);
      total += r.deltaReward;
    }
    return total;
  }

  /** Thu hồi điểm Treo (đơn huỷ trước khi thanh toán). */
  async revokePending(tx: Tx, ref: string): Promise<number> {
    const rows = await tx.select().from(ledger).where(and(eq(ledger.ref, ref), eq(ledger.state, 'pending')));
    let total = 0;
    for (const r of rows) {
      await tx.update(ledger).set({ state: 'revoked' }).where(eq(ledger.id, r.id));
      await tx.update(agents).set({ pendingPoints: sql`${agents.pendingPoints} - ${r.deltaReward}` }).where(eq(agents.id, r.agentId));
      total += r.deltaReward;
    }
    return total;
  }

  /** Lên hạng ngay khi đạt ngưỡng (rớt hạng chỉ xét ở job định kỳ). */
  private async checkUpgrade(tx: Tx, agentId: string) {
    const [a] = await tx.select().from(agents).where(eq(agents.id, agentId));
    const { params } = await this.activeRules(tx);
    const dec = evaluateTier(a.tier as Tier, a.rankPoints, params, a.tierProtectedUntil, new Date());
    if (dec.change !== 'up') return;
    const t = params.tiers.find((x) => x.key === dec.tier)!;
    await tx.update(agents).set({ tier: dec.tier, tierProtectedUntil: endOfMonth(addMonths(new Date(), t.protectMonths)) }).where(eq(agents.id, agentId));
    await this.zns.send({ agentId, phone: a.phone, template: 'tier_up', title: 'Chúc mừng lên hạng', body: `Chúc mừng ${a.name} đã lên hạng ${TIER_NAME[dec.tier]}! Xem quyền lợi mới trong app.` }, tx);
  }

  /** Job hết hạn điểm: lô quá hạn còn dư → bút toán "Hết hạn". */
  async expireLots(now = new Date()) {
    return this.db.transaction(async (tx) => {
      const due = await tx.select().from(pointLots).where(and(lt(pointLots.expiresAt, now), gt(pointLots.remaining, 0)));
      for (const l of due) {
        await tx.insert(ledger).values({ agentId: l.agentId, createdAt: now, period: periodOf(now), type: 'expire', fund: 'reward', deltaRank: 0, deltaReward: -l.remaining, state: 'expired', item: `Hết hạn lô điểm #${l.ledgerId}`, ref: 'LOT-' + l.id, byUser: 'Tự động' });
        await tx.update(pointLots).set({ remaining: 0 }).where(eq(pointLots.id, l.id));
        await tx.update(agents).set({ rewardPoints: sql`${agents.rewardPoints} - ${l.remaining}` }).where(eq(agents.id, l.agentId));
      }
      return { expiredLots: due.length, points: due.reduce((t, l) => t + l.remaining, 0) };
    });
  }

  /** Job xét hạng ngày 01: lên/giữ/bảo vệ/rớt 1 bậc. */
  async runTierReview(today = new Date()) {
    return this.db.transaction(async (tx) => {
      const { params } = await this.activeRules(tx);
      const all = await tx.select().from(agents);
      const changes: Array<{ id: string; from: string; to: string; change: string }> = [];
      for (const a of all) {
        const dec = evaluateTier(a.tier as Tier, a.rankPoints, params, a.tierProtectedUntil, today);
        if (dec.change === 'up' || dec.change === 'down') {
          await tx.update(agents).set({ tier: dec.tier }).where(eq(agents.id, a.id));
          changes.push({ id: a.id, from: a.tier, to: dec.tier, change: dec.change });
        }
      }
      return { reviewed: all.length, changes };
    });
  }

  async summary(agentId: string) {
    const [a] = await this.db.select().from(agents).where(eq(agents.id, agentId));
    if (!a) throw new BadRequestException('Không tìm thấy đại lý');
    const { version, params } = await this.activeRules();
    const lots = await this.db.select().from(pointLots).where(and(eq(pointLots.agentId, agentId), gt(pointLots.remaining, 0))).orderBy(asc(pointLots.expiresAt));
    const byDate = new Map<string, number>();
    for (const l of lots) {
      const k = l.expiresAt.toISOString().slice(0, 10);
      byDate.set(k, (byDate.get(k) ?? 0) + l.remaining);
    }
    const expiring = [...byDate.entries()].slice(0, 4).map(([date, points]) => ({ date, points }));
    const progress = tierProgress(a.tier as Tier, a.rankPoints, params);
    return {
      agentId, tier: a.tier, rank: a.rankPoints, reward: a.rewardPoints, pending: a.pendingPoints,
      protectedUntil: a.tierProtectedUntil, progress, expiring, ruleVersion: version, pointValueVND: params.pointValueVND, vndPerPoint: params.vndPerPoint,
    };
  }

  async simulate(params: RuleParams) {
    const all = await this.db.select({ tier: agents.tier, rank: agents.rankPoints, sales: agents.salesMonth, last: agents.salesLastMonth }).from(agents);
    return simulate(params, all.map((a) => ({
      tier: a.tier as Tier,
      score: params.tierBasis === 'revenue3m' ? a.sales + a.last * 2 : a.rank,
      monthlyRevenue: a.sales,
    })));
  }

  async ledgerFor(filter: { agentId?: string; agentIds?: string[]; limit?: number }) {
    const conds = [];
    if (filter.agentId) conds.push(eq(ledger.agentId, filter.agentId));
    if (filter.agentIds) conds.push(inArray(ledger.agentId, filter.agentIds.length ? filter.agentIds : ['-']));
    return this.db.select({
      id: ledger.id, agentId: ledger.agentId, agentName: agents.name, createdAt: ledger.createdAt, period: ledger.period, type: ledger.type, fund: ledger.fund,
      deltaRank: ledger.deltaRank, deltaReward: ledger.deltaReward, state: ledger.state, item: ledger.item, ref: ledger.ref, rule: ledger.rule,
      byUser: ledger.byUser, reversalOf: ledger.reversalOf, approvalId: ledger.approvalId, expiresAt: ledger.expiresAt,
    }).from(ledger).innerJoin(agents, eq(agents.id, ledger.agentId)).where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(ledger.createdAt), desc(ledger.id)).limit(filter.limit ?? 500);
  }

  tierRank(t: string) { return TIER_ORDER.indexOf(t as Tier); }
}
