import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { can, computeOrderPoints, DEFAULT_PARAMS, type Fund, type OrderLineInput, type RuleParams, type Tier } from '@dmp/shared';
import { schema, type DB } from '../../db/db';
import { actorLabel, AuditService, Can, CurrentActor, InjectDb, type Actor } from '../../common/core';
import { PointsService } from './points.service';
import { ApprovalsService } from './approvals.service';
import { scopeAgentIds } from '../agents/scope';

const { ruleSets, periods, agents } = schema;

@Controller()
export class PointsController {
  constructor(@InjectDb() private db: DB, private points: PointsService, private approvals: ApprovalsService, private audit: AuditService) {}

  /* ---------- Sổ cái ---------- */
  @Get('ledger')
  @Can('ledger.view', 'agents.view')
  async ledger(@CurrentActor() actor: Actor, @Query('agentId') agentId?: string, @Query('limit') limit?: string) {
    const scope = await scopeAgentIds(this.db, actor);
    if (!agentId && !can(actor.role, 'ledger.view')) throw new BadRequestException('Cần chọn đại lý');
    if (agentId && scope && !scope.includes(agentId)) return [];
    return this.points.ledgerFor({ agentId, agentIds: agentId ? undefined : scope ?? undefined, limit: limit ? Number(limit) : 500 });
  }

  @Get('agents/:id/points')
  @Can('agents.view')
  async agentPoints(@Param('id') id: string) {
    return this.points.summary(id);
  }

  /* ---------- Kỳ khoá sổ ---------- */
  @Get('periods')
  @Can('ledger.view')
  async listPeriods() {
    return this.db.select().from(periods).orderBy(desc(periods.period));
  }

  @Post('periods/:period/lock')
  @Can('periods.lock')
  async lock(@CurrentActor() actor: Actor, @Param('period') period: string) {
    await this.db.insert(periods).values({ period, locked: true, lockedBy: actorLabel(actor), lockedAt: new Date() })
      .onConflictDoUpdate({ target: periods.period, set: { locked: true, lockedBy: actorLabel(actor), lockedAt: new Date() } });
    await this.audit.log(actor, 'Khoá sổ kỳ điểm', period, 'Mở', 'Đã khoá');
    return { period, locked: true };
  }

  @Post('periods/:period/reopen')
  @Can('periods.lock')
  async reopen(@CurrentActor() actor: Actor, @Param('period') period: string, @Body() b: { reason: string }) {
    return this.approvals.create(actor, { kind: 'reopen', title: `Mở lại kỳ ${period}`, reason: b?.reason || 'Cần điều chỉnh số liệu kỳ', payload: { period } });
  }

  /* ---------- Quy tắc điểm & bảng hạng (có phiên bản) ---------- */
  @Get('rules')
  @Can('rules.view')
  async rules() {
    const all = await this.db.select().from(ruleSets).orderBy(desc(ruleSets.version));
    return { active: all.find((r) => r.status === 'Hiệu lực') ?? null, draft: all.find((r) => r.status === 'Nháp' || r.status === 'Chờ BOD duyệt') ?? null, history: all };
  }

  @Put('rules/draft')
  @Can('rules.propose')
  async saveDraft(@CurrentActor() actor: Actor, @Body() b: { params: RuleParams; note?: string }) {
    if (!b?.params?.tiers?.length) throw new BadRequestException('Thiếu tham số');
    const [existing] = await this.db.select().from(ruleSets).where(eq(ruleSets.status, 'Nháp'));
    if (existing) {
      await this.db.update(ruleSets).set({ params: b.params, note: b.note ?? existing.note, createdBy: actorLabel(actor) }).where(eq(ruleSets.version, existing.version));
      return { version: existing.version, status: 'Nháp' };
    }
    const [row] = await this.db.insert(ruleSets).values({ status: 'Nháp', params: b.params, note: b.note ?? '', createdBy: actorLabel(actor) }).returning();
    await this.audit.log(actor, 'Tạo bản nháp quy tắc điểm', 'v' + row.version);
    return { version: row.version, status: 'Nháp' };
  }

  @Post('rules/draft/submit')
  @Can('rules.propose')
  async submitDraft(@CurrentActor() actor: Actor, @Body() b: { reason?: string }) {
    const [d] = await this.db.select().from(ruleSets).where(eq(ruleSets.status, 'Nháp'));
    if (!d) throw new BadRequestException('Chưa có bản nháp');
    await this.db.update(ruleSets).set({ status: 'Chờ BOD duyệt' }).where(eq(ruleSets.version, d.version));
    return this.approvals.create(actor, { kind: 'rules', title: `Áp dụng quy tắc điểm v${d.version}`, reason: b?.reason || d.note || 'Cập nhật tham số điểm/hạng', payload: { version: d.version } });
  }

  @Post('rules/simulate')
  @Can('rules.view')
  async simulate(@Body() b: { params?: RuleParams }) {
    const params = b?.params ?? (await this.points.activeRules()).params;
    return this.points.simulate(params);
  }

  @Post('points/preview')
  async preview(@Body() b: { lines: OrderLineInput[]; tier: Tier; ship?: number; params?: RuleParams }) {
    const params = b.params ?? (await this.points.activeRules()).params ?? DEFAULT_PARAMS;
    return computeOrderPoints(b.lines ?? [], b.tier ?? 'member', params, { ship: b.ship });
  }

  /* ---------- Cộng điểm thủ công / hàng loạt / điều chỉnh → hàng chờ duyệt ---------- */
  @Post('points/manual')
  @Can('points.manualPropose', 'points.adjustPropose')
  async manual(@CurrentActor() actor: Actor, @Body() b: { agentIds: string[]; points: number; title: string; reason: string; rule?: string; fund?: Fund; kind?: 'manual' | 'adjust'; files?: number }) {
    if (!b?.agentIds?.length) throw new BadRequestException('Chọn ít nhất một đại lý');
    if (!b.points || !Number.isInteger(b.points)) throw new BadRequestException('Số điểm phải là số nguyên khác 0');
    if (!b.reason?.trim()) throw new BadRequestException('Cần nhập lý do');
    const kind = b.kind === 'adjust' ? 'adjust' : b.agentIds.length > 1 ? 'bulk' : 'manual';
    if (kind === 'adjust' && !can(actor.role, 'points.adjustPropose')) throw new BadRequestException('Chỉ Kế toán trưởng được đề xuất điều chỉnh điểm');
    if (b.points < 0 && kind !== 'adjust') throw new BadRequestException('Trừ điểm phải đi qua yêu cầu điều chỉnh');
    const scope = await scopeAgentIds(this.db, actor);
    if (scope && b.agentIds.some((id) => !scope.includes(id))) throw new BadRequestException('Có đại lý không thuộc phạm vi phụ trách');
    const existing = await this.db.select({ id: agents.id }).from(agents).where(inArray(agents.id, b.agentIds));
    if (existing.length !== new Set(b.agentIds).size) throw new BadRequestException('Có mã đại lý không tồn tại');
    return this.approvals.create(actor, {
      kind, title: b.title, agentId: kind === 'bulk' ? null : b.agentIds[0], points: b.points, reason: b.reason, files: b.files ?? 0,
      payload: { agentIds: b.agentIds, rule: b.rule, fund: b.fund ?? (kind === 'adjust' ? 'both' : 'reward'), count: b.agentIds.length },
    });
  }

  /* ---------- Hàng chờ duyệt ---------- */
  @Get('approvals')
  @Can('approvals.view')
  async list(@Query('status') status?: string) {
    return this.approvals.list(status);
  }

  @Post('approvals/:id/approve')
  @Can('approvals.view')
  async approve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { note?: string }) {
    return this.approvals.decide(actor, id, true, b?.note);
  }

  @Post('approvals/:id/reject')
  @Can('approvals.view')
  async reject(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { note: string }) {
    return this.approvals.decide(actor, id, false, b?.note);
  }

  /* ---------- Job (chạy tay trong demo; production gắn cron) ---------- */
  @Post('jobs/expire')
  @Can('periods.lock', 'system.manage')
  async expire() { return this.points.expireLots(); }

  @Post('jobs/tier-review')
  @Can('periods.lock', 'system.manage')
  async tierReview() { return this.points.runTierReview(); }

  @Get('rules/history')
  @Can('rules.view')
  async history() { return this.db.select().from(ruleSets).where(ne(ruleSets.status, 'Nháp')).orderBy(asc(ruleSets.version)); }
}
