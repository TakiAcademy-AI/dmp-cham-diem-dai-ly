import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { fmtNumber, TIER_ORDER, type RedemptionStage, type Tier } from '@dmp/shared';
import { schema, type DB, type Tx } from '../../db/db';
import { actorLabel, AgentOnly, AuditService, Can, CurrentActor, InjectDb, SeqService, ZnsService, type Actor } from '../../common/core';
import { PointsService } from '../points/points.service';
import { scopeAgentIds } from '../agents/scope';
import { ApprovalsService } from '../points/approvals.service';
import { ZaloCrmClient } from '../integrations/integrations';

const { gifts, redemptions, agents, users } = schema;

/** Bước tiếp theo của yêu cầu đổi quà và vai trò được thực hiện (luồng 4.5). */
const NEXT: Partial<Record<RedemptionStage, { to: RedemptionStage; roles: string[]; label: string }>> = {
  new: { to: 'confirmed', roles: ['SALE'], label: 'Sale xác nhận' },
  confirmed: { to: 'approved', roles: ['KT', 'KTT'], label: 'Kế toán duyệt' },
  approved: { to: 'shipping', roles: ['KHO'], label: 'Kho xuất quà' },
  shipping: { to: 'done', roles: ['KHO', 'SALE'], label: 'Xác nhận đã giao' },
};

@Controller()
export class GiftsController {
  constructor(@InjectDb() private db: DB, private points: PointsService, private seq: SeqService, private zns: ZnsService, private audit: AuditService, private approvals: ApprovalsService, private crm: ZaloCrmClient) {}

  @Get('gifts')
  @Can('gifts.view')
  async list() {
    const rows = await this.db.select().from(gifts).orderBy(gifts.id);
    const counts = await this.db.select({ giftId: redemptions.giftId, n: sql<number>`count(*)::int` }).from(redemptions).groupBy(redemptions.giftId);
    const m = new Map(counts.map((c) => [c.giftId, c.n]));
    return rows.map((g) => ({ ...g, redeemed: m.get(g.id) ?? 0 }));
  }

  /** Quà có giá trị ≥ 10 triệu cần BOD duyệt trước khi mở đổi (ma trận 4.2: BOD A quà lớn). */
  private static BIG = 10_000_000;

  @Post('gifts')
  @Can('gifts.manage')
  async create(@CurrentActor() actor: Actor, @Body() b: Partial<typeof gifts.$inferInsert> & { reason?: string }) {
    if (!b.name || !b.points || !b.type) throw new BadRequestException('Cần tên quà, loại và số điểm');
    const all = await this.db.select({ id: gifts.id }).from(gifts);
    const id = 'Q' + String(all.length + 1).padStart(2, '0');
    const value = Number(b.value) || Number(b.points) * 1000;
    const big = value >= GiftsController.BIG;
    const wanted = b.status ?? 'Đang mở';
    await this.db.insert(gifts).values({ id, name: b.name, type: b.type, points: Number(b.points), value, minTier: b.minTier || null, stock: b.stock == null || (b.stock as any) === '' ? null : Number(b.stock), window: b.window ?? '', status: big ? 'Chờ BOD duyệt' : wanted, tag: b.tag ?? null, imageFileId: b.imageFileId ?? null });
    await this.audit.log(actor, 'Thêm quà', id, '—', b.name);
    if (big) {
      const ap = await this.approvals.create(actor, { kind: 'gift', title: `Thêm quà ${id}: ${b.name} (${fmtNumber(value)}đ)`, points: Number(b.points), reason: b.reason || 'Quà giá trị lớn cần BOD duyệt', payload: { giftId: id, changes: { status: wanted }, prevStatus: 'Tạm ẩn' } });
      return { id, status: 'Chờ BOD duyệt', approvalId: ap.id };
    }
    return { id, status: wanted };
  }

  @Put('gifts/:id')
  @Can('gifts.manage')
  async update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: Partial<typeof gifts.$inferInsert> & { reason?: string }) {
    const [g] = await this.db.select().from(gifts).where(eq(gifts.id, id));
    if (!g) throw new NotFoundException();
    if (g.status === 'Chờ BOD duyệt') throw new BadRequestException('Quà đang chờ BOD duyệt, chưa sửa được');
    const { id: _ignore, reason, ...rest } = b as any;
    const value = Number(rest.value ?? g.value);
    const touchesMoney = (rest.points != null && Number(rest.points) !== g.points) || (rest.value != null && Number(rest.value) !== g.value);
    if (value >= GiftsController.BIG && touchesMoney) {
      const ap = await this.approvals.create(actor, { kind: 'gift', title: `Sửa quà ${id}: ${g.name} → ${fmtNumber(Number(rest.points ?? g.points))} điểm / ${fmtNumber(value)}đ`, points: Number(rest.points ?? g.points), reason: reason || 'Đổi điểm/giá trị quà lớn', payload: { giftId: id, changes: { ...rest, status: rest.status ?? g.status }, prevStatus: g.status } });
      await this.db.update(gifts).set({ status: 'Chờ BOD duyệt' }).where(eq(gifts.id, id));
      return { id, status: 'Chờ BOD duyệt', approvalId: ap.id };
    }
    await this.db.update(gifts).set(rest).where(eq(gifts.id, id));
    await this.audit.log(actor, 'Sửa quà', id, `${g.points} điểm · tồn ${g.stock ?? '∞'}`, `${rest.points ?? g.points} điểm · tồn ${rest.stock ?? g.stock ?? '∞'}`);
    return { id, status: rest.status ?? g.status };
  }

  /** Kho/MKT cập nhật tồn kho (nhập thêm, kiểm kê). */
  @Patch('gifts/:id/stock')
  @Can('gifts.stock')
  async stock(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { stock: number | null; note?: string }) {
    const [g] = await this.db.select().from(gifts).where(eq(gifts.id, id));
    if (!g) throw new NotFoundException();
    const stock = b?.stock == null ? null : Math.floor(Number(b.stock));
    if (stock != null && !(stock >= 0)) throw new BadRequestException('Tồn kho không hợp lệ');
    const status = stock === 0 ? 'Hết hàng' : g.status === 'Hết hàng' ? 'Đang mở' : g.status;
    await this.db.update(gifts).set({ stock, status }).where(eq(gifts.id, id));
    await this.audit.log(actor, 'Cập nhật tồn kho quà', id, String(g.stock ?? '∞'), `${stock ?? '∞'}${b?.note ? ' · ' + b.note : ''}`);
    return { id, stock, status };
  }

  @Get('redemptions')
  @Can('redemptions.view')
  async redemptions(@CurrentActor() actor: Actor) {
    const scope = await scopeAgentIds(this.db, actor);
    const rows = await this.db.select({ r: redemptions, agentName: agents.name, saleId: agents.saleId, tier: agents.tier, address: agents.address, city: agents.city, phone: agents.phone, owner: agents.owner })
      .from(redemptions).innerJoin(agents, eq(agents.id, redemptions.agentId))
      .where(scope ? inArray(redemptions.agentId, scope.length ? scope : ['-']) : undefined).orderBy(desc(redemptions.createdAt));
    const us = await this.db.select({ id: users.id, name: users.name }).from(users);
    const um = new Map(us.map((u) => [u.id, u.name]));
    // Thông tin giao quà: Kho chỉ thấy khi quà đã duyệt/đang giao (ma trận 4.2: Kho xem SĐT để giao hàng)
    const delivery = (x: (typeof rows)[number]) => (actor.role !== 'KHO' || ['approved', 'shipping'].includes(x.r.stage)
      ? { receiver: x.owner, address: [x.address, x.city].filter(Boolean).join(', '), phone: x.phone } : null);
    return rows.map((x) => ({ ...x.r, agentName: x.agentName, tier: x.tier, saleName: um.get(x.saleId) ?? '', next: NEXT[x.r.stage as RedemptionStage] ?? null, delivery: delivery(x) }));
  }

  @Post('redemptions/:id/advance')
  @Can('redemptions.confirm', 'redemptions.approve', 'redemptions.ship')
  async advance(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { note?: string }) {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(redemptions).where(eq(redemptions.id, id));
      if (!r) throw new NotFoundException();
      const step = NEXT[r.stage as RedemptionStage];
      if (!step) throw new BadRequestException('Yêu cầu đã kết thúc');
      if (!step.roles.includes(actor.role)) throw new ForbiddenException(`Bước "${step.label}" không thuộc vai trò của bạn`);
      if (actor.role === 'SALE') {
        const [a] = await tx.select().from(agents).where(eq(agents.id, r.agentId));
        if (a.saleId !== actor.id) throw new ForbiddenException('Đại lý không thuộc phạm vi phụ trách');
      }
      await tx.update(redemptions).set({ stage: step.to, history: [...r.history, { stage: step.to, by: actorLabel(actor), at: new Date().toLocaleString('vi-VN'), note: b?.note }] }).where(eq(redemptions.id, id));
      const [a] = await tx.select().from(agents).where(eq(agents.id, r.agentId));
      const msg: Partial<Record<RedemptionStage, string>> = {
        confirmed: `Yêu cầu đổi ${r.giftName} (${id}) đã được Sale xác nhận.`,
        approved: `Yêu cầu đổi ${r.giftName} (${id}) đã được duyệt. Kho sẽ giao trong 3–5 ngày.`,
        shipping: `Quà ${r.giftName} (${id}) đang được giao tới Quý đại lý.`,
        done: `Quý đại lý đã nhận ${r.giftName}. Cảm ơn Quý đại lý đã đồng hành cùng DMP Việt Pháp.`,
      };
      await this.zns.send({ agentId: a.id, phone: a.phone, template: 'redeem', title: 'Yêu cầu đổi quà', body: msg[step.to]! }, tx);
      await this.audit.log(actor, step.label, id, r.stage, step.to, tx);
      return { id, stage: step.to };
    });
  }

  @Post('redemptions/:id/reject')
  @Can('redemptions.confirm', 'redemptions.approve')
  async reject(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { reason: string }) {
    if (!b?.reason?.trim()) throw new BadRequestException('Cần nhập lý do từ chối');
    if (actor.role === 'SALE') {
      const [r] = await this.db.select({ stage: redemptions.stage, agentId: redemptions.agentId }).from(redemptions).where(eq(redemptions.id, id));
      const scope = await scopeAgentIds(this.db, actor);
      if (!r || r.stage !== 'new' || !scope?.includes(r.agentId)) throw new ForbiddenException('Sale chỉ từ chối được yêu cầu mới gửi của đại lý mình phụ trách');
    }
    return this.db.transaction((tx) => this.refund(tx, actor, id, 'rejected', b.reason));
  }

  /** Hoàn điểm khi huỷ/từ chối: bút toán "Hoàn điểm", trả lại tồn kho. */
  private async refund(tx: Tx, actor: Actor, id: string, stage: 'rejected' | 'cancelled', reason: string) {
    const [r] = await tx.select().from(redemptions).where(eq(redemptions.id, id));
    if (!r) throw new NotFoundException();
    if (['done', 'cancelled', 'rejected', 'shipping'].includes(r.stage)) throw new BadRequestException('Không thể huỷ ở bước này');
    await this.points.post(tx, { agentId: r.agentId, type: 'refund', fund: 'reward', points: r.points, item: `Hoàn điểm yêu cầu ${id}: ${reason}`, ref: id, byUser: actorLabel(actor) });
    const [g] = await tx.select().from(gifts).where(eq(gifts.id, r.giftId));
    if (g?.stock != null) await tx.update(gifts).set({ stock: g.stock + r.qty, status: g.status === 'Hết hàng' ? 'Đang mở' : g.status }).where(eq(gifts.id, g.id));
    await tx.update(redemptions).set({ stage, note: reason, history: [...r.history, { stage, by: actorLabel(actor), at: new Date().toLocaleString('vi-VN'), note: reason }] }).where(eq(redemptions.id, id));
    const [a] = await tx.select().from(agents).where(eq(agents.id, r.agentId));
    await this.zns.send({ agentId: a.id, phone: a.phone, template: 'redeem', title: 'Yêu cầu đổi quà', body: `Yêu cầu ${id} đã ${stage === 'rejected' ? 'bị từ chối' : 'được huỷ'}: ${reason}. Đã hoàn ${fmtNumber(r.points)} điểm.` }, tx);
    await this.audit.log(actor, stage === 'rejected' ? 'Từ chối đổi quà' : 'Huỷ đổi quà', id, r.stage, stage, tx);
    return { id, stage, refunded: r.points };
  }

  /* ---------- App đại lý ---------- */
  @Get('app/gifts')
  @AgentOnly()
  async appGifts(@CurrentActor() actor: Actor) {
    const [a] = await this.db.select().from(agents).where(eq(agents.id, actor.agentId!));
    const { params } = await this.points.activeRules();
    const rows = await this.db.select().from(gifts).orderBy(gifts.points);
    return rows.map((g) => {
      const tierOk = !g.minTier || TIER_ORDER.indexOf(a.tier as Tier) >= TIER_ORDER.indexOf(g.minTier as Tier);
      const shortfall = Math.max(0, g.points - a.rewardPoints);
      return { ...g, tierOk, shortfall, shortfallVND: shortfall * params.vndPerPoint, canRedeem: actor.role === 'DLC' && tierOk && !shortfall && g.status === 'Đang mở' && g.stock !== 0 };
    });
  }

  @Post('app/redemptions')
  @AgentOnly()
  async redeem(@CurrentActor() actor: Actor, @Body() b: { giftId: string; qty?: number }) {
    if (actor.role !== 'DLC') throw new ForbiddenException('Tài khoản nhân viên không được đổi quà. Vui lòng liên hệ chủ đại lý');
    const qty = Math.max(1, Math.floor(b?.qty ?? 1));
    return this.db.transaction(async (tx) => {
      const [g] = await tx.select().from(gifts).where(eq(gifts.id, b.giftId));
      if (!g || g.status !== 'Đang mở') throw new BadRequestException('Quà hiện chưa mở đổi');
      if (g.stock != null && g.stock < qty) throw new BadRequestException('Quà đã hết hàng');
      const [a] = await tx.select().from(agents).where(eq(agents.id, actor.agentId!));
      if (g.minTier && TIER_ORDER.indexOf(a.tier as Tier) < TIER_ORDER.indexOf(g.minTier as Tier)) throw new BadRequestException('Quà dành cho hạng cao hơn');
      const { params } = await this.points.activeRules(tx);
      const total = g.points * qty;
      if (total < params.minRedeem) throw new BadRequestException(`Mỗi lần đổi tối thiểu ${fmtNumber(params.minRedeem)} điểm`);
      if (a.rewardPoints < total) throw new BadRequestException(`Còn thiếu ${fmtNumber(total - a.rewardPoints)} điểm`);
      const id = await this.seq.next('DQ', 4, tx);
      await this.points.post(tx, { agentId: a.id, type: 'redeem', fund: 'reward', points: -total, item: `Đổi quà: ${g.name}${qty > 1 ? ' ×' + qty : ''}`, ref: id, byUser: actorLabel(actor) });
      if (g.stock != null) await tx.update(gifts).set({ stock: g.stock - qty, status: g.stock - qty === 0 ? 'Hết hàng' : g.status }).where(eq(gifts.id, g.id));
      await tx.insert(redemptions).values({ id, agentId: a.id, giftId: g.id, giftName: g.name, points: total, qty, stage: 'new', history: [{ stage: 'new', by: actorLabel(actor), at: new Date().toLocaleString('vi-VN') }] });
      await this.zns.send({ agentId: a.id, phone: a.phone, template: 'redeem', title: 'Đã gửi yêu cầu đổi quà', body: `Yêu cầu đổi ${g.name} (${id}) đã được gửi. Sale sẽ xác nhận trong 24 giờ.` }, tx);
      await this.crm.emit('redemption.created', { id, agentId: a.id, gift: g.name, points: total });
      return { id, stage: 'new', points: -total, balance: a.rewardPoints - total };
    });
  }

  @Get('app/redemptions')
  @AgentOnly()
  async myRedemptions(@CurrentActor() actor: Actor) {
    return this.db.select().from(redemptions).where(eq(redemptions.agentId, actor.agentId!)).orderBy(desc(redemptions.createdAt));
  }

  @Post('app/redemptions/:id/cancel')
  @AgentOnly()
  async cancelMine(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const [r] = await this.db.select().from(redemptions).where(eq(redemptions.id, id));
    if (!r || r.agentId !== actor.agentId) throw new NotFoundException();
    if (r.stage !== 'new') throw new BadRequestException('Chỉ huỷ được khi Sale chưa xác nhận');
    return this.db.transaction((tx) => this.refund(tx, actor, id, 'cancelled', 'Đại lý tự huỷ'));
  }
}
