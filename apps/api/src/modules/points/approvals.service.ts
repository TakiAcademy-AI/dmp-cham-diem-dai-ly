import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { APPROVAL_KIND_LABEL, canApprove, fmtNumber, TIER_NAME, type ApprovalKind, type Fund, type Tier } from '@dmp/shared';
import { schema, type DB, type Tx } from '../../db/db';
import { actorLabel, AuditService, InjectDb, SeqService, ZnsService, type Actor } from '../../common/core';
import { PointsService } from './points.service';
import { afterDecision } from '../engage/sync';

const { approvals, agents, ruleSets, periods, gifts, products } = schema;

export interface CreateApproval {
  kind: ApprovalKind;
  title: string;
  agentId?: string | null;
  points?: number | null;
  reason: string;
  payload?: Record<string, any>;
  files?: number;
}

/** Maker-checker: mọi thao tác nhạy cảm tạo yêu cầu duyệt; người tạo không được tự duyệt. */
@Injectable()
export class ApprovalsService {
  constructor(@InjectDb() private db: DB, private seq: SeqService, private points: PointsService, private audit: AuditService, private zns: ZnsService) {}

  async create(actor: Actor, c: CreateApproval, tx?: Tx) {
    const run = async (t: Tx) => {
      const id = await this.seq.next('YC', 4, t);
      const now = new Date();
      const [row] = await t.insert(approvals).values({
        id, kind: c.kind, agentId: c.agentId ?? null, title: c.title, points: c.points ?? null, reason: c.reason, files: c.files ?? 0,
        payload: { ...(c.payload ?? {}), requesterId: actor.id }, requestedBy: actorLabel(actor), requestedRole: actor.role,
        requestedAt: now, dueAt: new Date(+now + 48 * 3600e3),
      }).returning();
      await this.audit.log(actor, 'Tạo yêu cầu duyệt: ' + APPROVAL_KIND_LABEL[c.kind], id, '—', c.points != null ? (c.points > 0 ? '+' : '') + fmtNumber(c.points) : c.title, t);
      return row;
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  async list(status?: string) {
    const rows = await this.db.select({ a: approvals, agentName: agents.name, agentTier: agents.tier })
      .from(approvals).leftJoin(agents, eq(agents.id, approvals.agentId))
      .where(status ? eq(approvals.status, status) : undefined).orderBy(desc(approvals.requestedAt));
    return rows.map((r) => ({ ...r.a, agentName: r.agentName, agentTier: r.agentTier }));
  }

  async decide(actor: Actor, id: string, approve: boolean, note?: string) {
    return this.db.transaction(async (tx) => {
      const [ap] = await tx.select().from(approvals).where(eq(approvals.id, id));
      if (!ap) throw new NotFoundException('Không tìm thấy yêu cầu ' + id);
      if (ap.status !== 'pending') throw new BadRequestException('Yêu cầu đã được xử lý');
      if (!canApprove(actor.role, ap.kind as ApprovalKind)) throw new ForbiddenException('Vai trò của bạn không có quyền duyệt loại yêu cầu này');
      if (ap.payload?.requesterId === actor.id) throw new ForbiddenException('Người tạo yêu cầu không được tự duyệt (maker-checker)');
      if (!approve && !note?.trim()) throw new BadRequestException('Cần nhập lý do từ chối');
      if (approve) await this.apply(tx, actor, ap);
      else if (ap.kind === 'rules') await tx.update(ruleSets).set({ status: 'Bị trả lại', note: `Bị trả lại: ${note}` }).where(eq(ruleSets.version, Number(ap.payload?.version)));
      await tx.update(approvals).set({ status: approve ? 'approved' : 'rejected', decidedBy: actorLabel(actor), decidedAt: new Date(), decisionNote: note ?? null }).where(eq(approvals.id, id));
      await afterDecision(tx as unknown as DB, ap, approve, actorLabel(actor), note);
      if (!approve && ap.kind === 'gift' && ap.payload?.giftId) await tx.update(gifts).set({ status: ap.payload.prevStatus ?? 'Tạm ẩn' }).where(eq(gifts.id, ap.payload.giftId));
      await this.audit.log(actor, approve ? 'Duyệt yêu cầu' : 'Từ chối yêu cầu', id, 'Chờ duyệt', approve ? 'Đã duyệt' : 'Từ chối: ' + note, tx);
      return { id, status: approve ? 'approved' : 'rejected' };
    });
  }

  /** Thực thi tác động của yêu cầu sau khi duyệt. */
  private async apply(tx: Tx, actor: Actor, ap: typeof approvals.$inferSelect) {
    const by = actorLabel(actor);
    const p = ap.payload ?? {};
    const { version } = await this.points.activeRules(tx);
    switch (ap.kind as ApprovalKind) {
      case 'manual':
      case 'evidence':
      case 'adjust': {
        if (!ap.agentId || !ap.points) throw new BadRequestException('Yêu cầu thiếu đại lý hoặc số điểm');
        await this.points.post(tx, {
          agentId: ap.agentId, type: ap.kind === 'adjust' ? 'adjust' : 'activity', fund: (p.fund as Fund) ?? (ap.kind === 'adjust' ? 'both' : 'reward'),
          points: ap.points, item: ap.title, ref: ap.id, rule: p.rule ? `${p.rule} v${version}` : '—', ruleVersion: p.rule ? version : null, byUser: `${ap.requestedBy} · duyệt: ${by}`, approvalId: ap.id,
        });
        await this.notifyPoints(tx, ap.agentId, ap.points, ap.title);
        break;
      }
      case 'bulk': {
        const ids: string[] = p.agentIds ?? [];
        if (!ids.length || !ap.points) throw new BadRequestException('Lô cộng điểm trống');
        for (const agentId of ids) {
          await this.points.post(tx, { agentId, type: 'activity', fund: (p.fund as Fund) ?? 'reward', points: ap.points, item: ap.title, ref: ap.id, rule: p.rule ? `${p.rule} v${version}` : '—', ruleVersion: p.rule ? version : null, byUser: `${ap.requestedBy} · duyệt: ${by}`, approvalId: ap.id });
          await this.notifyPoints(tx, agentId, ap.points, ap.title);
        }
        break;
      }
      case 'tier': {
        if (!ap.agentId || !p.tier) throw new BadRequestException('Yêu cầu thiếu hạng');
        const until = new Date(); until.setMonth(until.getMonth() + (p.months ?? 3));
        await tx.update(agents).set({ tier: p.tier, tierProtectedUntil: until }).where(eq(agents.id, ap.agentId));
        const [a] = await tx.select().from(agents).where(eq(agents.id, ap.agentId));
        await this.zns.send({ agentId: a.id, phone: a.phone, template: 'tier_up', title: 'Cập nhật hạng', body: `${a.name} được xếp hạng ${TIER_NAME[p.tier as Tier]} theo quyết định của BOD.` }, tx);
        break;
      }
      case 'credit': {
        if (!ap.agentId) break;
        const [a] = await tx.select().from(agents).where(eq(agents.id, ap.agentId));
        await tx.update(agents).set({ flags: [...new Set([...(a.flags ?? []), 'creditException'])] }).where(eq(agents.id, a.id));
        break;
      }
      case 'rules': {
        const v = Number(p.version);
        await tx.update(ruleSets).set({ status: 'Hết hiệu lực' }).where(eq(ruleSets.status, 'Hiệu lực'));
        await tx.update(ruleSets).set({ status: 'Hiệu lực', approvedBy: by, effectiveFrom: new Date() }).where(eq(ruleSets.version, v));
        break;
      }
      case 'campaign':
        break; // trạng thái campaign cập nhật trong afterDecision
      case 'gift': {
        const { giftId, changes } = p;
        await tx.update(gifts).set({ ...(changes ?? {}), status: changes?.status && changes.status !== 'Chờ BOD duyệt' ? changes.status : 'Đang mở' }).where(eq(gifts.id, giftId));
        break;
      }
      case 'product': {
        const { sku, changes } = p;
        await tx.update(products).set(changes ?? {}).where(eq(products.sku, sku));
        break;
      }
      case 'reopen': {
        await tx.update(periods).set({ locked: false, lockedBy: null, lockedAt: null }).where(eq(periods.period, p.period));
        break;
      }
    }
  }

  private async notifyPoints(tx: Tx, agentId: string, points: number, item: string) {
    const [a] = await tx.select().from(agents).where(eq(agents.id, agentId));
    await this.zns.send({ agentId, phone: a.phone, template: 'points', title: points > 0 ? 'Cộng điểm' : 'Điều chỉnh điểm', body: `Quý đại lý ${a.name} vừa nhận ${points > 0 ? '+' : ''}${fmtNumber(points)} điểm từ ${item}. Điểm khả dụng: ${fmtNumber(a.rewardPoints)}.` }, tx);
  }

  async pendingCount() {
    const rows = await this.db.select({ kind: approvals.kind }).from(approvals).where(eq(approvals.status, 'pending'));
    return rows;
  }

  async byIds(ids: string[]) {
    return ids.length ? this.db.select().from(approvals).where(and(inArray(approvals.id, ids))) : [];
  }
}
