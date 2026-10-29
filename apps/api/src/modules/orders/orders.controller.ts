import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { can, computeOrderPoints, fmtNumber, fmtVND, type OrderLineInput, type Tier } from '@dmp/shared';
import { schema, type DB, type Tx } from '../../db/db';
import { actorLabel, AgentOnly, AuditService, Can, CurrentActor, InjectDb, SeqService, ZnsService, type Actor } from '../../common/core';
import { PointsService } from '../points/points.service';
import { scopeAgentIds } from '../agents/scope';
import { activeCampaigns } from '../engage/engage.controller';
import { KiotVietClient, parseMisaCsv } from '../integrations/integrations';
import { ApprovalsService } from '../points/approvals.service';

const { orders, agents, products, returns, users, payments, campaigns, jobRuns } = schema;

@Controller()
export class OrdersController {
  constructor(@InjectDb() private db: DB, private points: PointsService, private seq: SeqService, private zns: ZnsService, private audit: AuditService, private kiot: KiotVietClient, private approvals: ApprovalsService) {}

  private async withNames(rows: Array<typeof orders.$inferSelect>) {
    const ag = await this.db.select({ id: agents.id, name: agents.name, saleId: agents.saleId }).from(agents);
    const us = await this.db.select({ id: users.id, name: users.name }).from(users);
    const am = new Map(ag.map((a) => [a.id, a]));
    const um = new Map(us.map((u) => [u.id, u.name]));
    return rows.map((o) => ({ ...o, agentName: am.get(o.agentId)?.name ?? '', saleName: um.get(am.get(o.agentId)?.saleId ?? '') ?? '' }));
  }

  @Get('orders')
  @Can('orders.view')
  async list(@CurrentActor() actor: Actor, @Query('agentId') agentId?: string) {
    const scope = await scopeAgentIds(this.db, actor);
    const conds = [];
    if (scope) conds.push(inArray(orders.agentId, scope.length ? scope : ['-']));
    if (agentId) conds.push(eq(orders.agentId, agentId));
    const rows = await this.db.select().from(orders).where(conds.length ? and(...conds) : undefined).orderBy(desc(orders.orderedAt));
    return this.withNames(rows);
  }

  @Get('orders/:id')
  @Can('orders.view')
  async detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, id));
    if (!o) throw new NotFoundException('Không tìm thấy đơn ' + id);
    const scope = await scopeAgentIds(this.db, actor);
    if (scope && !scope.includes(o.agentId)) throw new ForbiddenException('Đơn không thuộc đại lý bạn phụ trách');
    const [r] = await this.withNames([o]);
    const rets = await this.db.select().from(returns).where(eq(returns.orderId, id));
    return { ...r, returns: rets };
  }

  /** Bổ sung nhãn/dòng/hệ số/không tính điểm từ danh mục SP để engine xét campaign. */
  private async enrich(tx: Tx | DB, lines: OrderLineInput[]): Promise<OrderLineInput[]> {
    const prods = await tx.select().from(products).where(inArray(products.sku, lines.map((l) => l.sku).concat('-')));
    const m = new Map(prods.map((p) => [p.sku, p]));
    // Hệ số SP hết hiệu lực sau ngày multiplierUntil (dd/mm/yyyy)
    const live = (p: typeof products.$inferSelect) => {
      if (!p.multiplierUntil) return p.multiplier;
      const [d, mo, y] = p.multiplierUntil.split('/').map(Number);
      return y && new Date(y, mo - 1, d, 23, 59, 59) < new Date() ? 1 : p.multiplier;
    };
    return lines.map((l) => { const p = m.get(l.sku); return p ? { ...l, name: l.name || p.name, brand: p.brand, line: p.line, noPoint: l.noPoint ?? p.noPoint, multiplier: l.multiplier ?? live(p) } : l; });
  }

  /** Tính điểm có campaign; ghi phần điểm do campaign tạo ra vào ngân sách campaign. */
  private async pointsFor(tx: Tx | DB, lines: OrderLineInput[], a: typeof agents.$inferSelect, ship = 0) {
    const { version, params } = await this.points.activeRules(tx);
    const camps = await activeCampaigns(tx as DB);
    const cp = computeOrderPoints(lines, a.tier as Tier, params, { ship, campaigns: camps, agentType: a.type });
    const extra = cp.campaignIds.length ? cp.total - computeOrderPoints(lines, a.tier as Tier, params, { ship }).total : 0;
    return { cp, version, extra };
  }
  private async chargeCampaigns(tx: Tx, ids: string[], extra: number) {
    if (!ids.length || extra <= 0) return;
    const share = Math.round(extra / ids.length);
    for (const id of ids) await tx.update(campaigns).set({ used: sql`${campaigns.used} + ${share}` }).where(eq(campaigns.id, id));
  }

  /** Tạo đơn hoàn tất + ghi điểm Treo theo bộ quy tắc hiệu lực. Dùng cho đồng bộ KiotViet. */
  private async createCompleted(tx: Tx, agentId: string, rawLines: OrderLineInput[], source: string, ship = 0, extId?: string, at = new Date()) {
    const [a] = await tx.select().from(agents).where(eq(agents.id, agentId));
    const lines = await this.enrich(tx, rawLines);
    const { cp, version, extra } = await this.pointsFor(tx, lines, a, ship);
    const id = extId ?? (await this.seq.next('DH', 4, tx));
    await tx.insert(orders).values({ id, agentId, orderedAt: at, source, status: 'Hoàn tất', pay: 'Chưa thanh toán', ship, value: cp.value + cp.excluded + ship, lines, points: cp.total, pointState: cp.total ? 'pending' : 'none', tierAtOrder: a.tier, ruleVersion: version, calc: { steps: cp.steps, total: cp.total }, campaignIds: cp.campaignIds });
    if (cp.total) {
      await this.points.post(tx, { agentId, type: 'earn', fund: 'both', points: cp.total, state: 'pending', item: `Lên đơn ${id}` + (cp.bonus ? ' + thưởng mốc đơn' : '') + (cp.campaignIds.length ? ' · ' + cp.campaignIds.join(', ') : ''), ref: id, rule: `R01${cp.bonus ? ', R02' : ''} v${version}`, ruleVersion: version, byUser: 'Tự động' });
    }
    await this.chargeCampaigns(tx, cp.campaignIds, extra);
    await tx.update(agents).set({ salesMonth: a.salesMonth + cp.value, debt: a.debt + cp.value + cp.excluded + ship, lastOrder: at.toLocaleDateString('vi-VN'), status: a.status === 'dormant' ? 'ok' : a.status }).where(eq(agents.id, agentId));
    await this.zns.send({ agentId, phone: a.phone, template: 'order_approved', title: 'Đơn được duyệt', body: `Đơn ${id} trị giá ${fmtVND(cp.value + cp.excluded + ship)} đã được duyệt. Dự kiến +${fmtNumber(cp.total)} điểm.`, data: { order_code: id, amount: fmtVND(cp.value + cp.excluded + ship), points: fmtNumber(cp.total) } }, tx);
    return { id, points: cp.total };
  }

  /**
   * Đồng bộ đơn KiotViet. Có cấu hình KIOTVIET_* → kéo hoá đơn thật từ lần đồng bộ trước (mã KH = mã đại lý);
   * chưa cấu hình → sinh đơn ngẫu nhiên để demo.
   */
  @Post('orders/sync')
  @Can('orders.sync')
  async sync(@CurrentActor() actor: Actor, @Body() b: { agentId?: string; count?: number }) {
    const r = await this.runSync(b);
    await this.audit.log(actor, 'Đồng bộ đơn KiotViet', 'Tích hợp', '—', `${r.created.length} đơn mới${r.mode === 'mock' ? ' (giả lập)' : ''}`);
    return r;
  }

  async runSync(b: { agentId?: string; count?: number } = {}) {
    if (this.kiot.configured) {
      const [last] = await this.db.select().from(jobRuns).where(and(eq(jobRuns.job, 'kiotviet'), eq(jobRuns.status, 'OK'))).orderBy(desc(jobRuns.at)).limit(1);
      const since = last?.at ?? new Date(Date.now() - 86400e3);
      const invoices = await this.kiot.invoicesSince(since);
      const known = new Set((await this.db.select({ id: agents.id }).from(agents)).map((x) => x.id));
      const existing = new Set((await this.db.select({ id: orders.id }).from(orders).where(inArray(orders.id, invoices.map((i) => i.code).concat('-')))).map((x) => x.id));
      const skipped: string[] = [];
      const created = await this.db.transaction(async (tx) => {
        const out = [];
        for (const inv of invoices) {
          if (existing.has(inv.code)) continue;
          if (!known.has(inv.customerCode)) { skipped.push(`${inv.code}: mã KH ${inv.customerCode} chưa có trong hệ thống`); continue; }
          out.push(await this.createCompleted(tx, inv.customerCode, inv.lines, 'KiotViet', 0, inv.code, new Date(inv.purchaseDate)));
        }
        return out;
      });
      await this.db.insert(jobRuns).values({ job: 'kiotviet', status: 'OK', message: `${created.length} đơn mới, bỏ qua ${skipped.length}` });
      return { mode: 'live', created, skipped };
    }
    const prods = await this.db.select().from(products);
    const pool = b?.agentId ? [b.agentId] : (await this.db.select({ id: agents.id }).from(agents).where(and(ne(agents.status, 'dormant'), ne(agents.status, 'locked')))).map((r) => r.id);
    const n = Math.min(5, Math.max(1, b?.count ?? 2));
    const created = await this.db.transaction(async (tx) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const agentId = pool[Math.floor(Math.random() * pool.length)];
        const lines: OrderLineInput[] = Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => {
          const p = prods[Math.floor(Math.random() * prods.length)];
          return { sku: p.sku, name: p.name, price: p.price, qty: 5 + Math.floor(Math.random() * 30), discount: [0, 0.05, 0.1][Math.floor(Math.random() * 3)] };
        });
        out.push(await this.createCompleted(tx, agentId, lines, 'KiotViet'));
      }
      return out;
    });
    await this.db.insert(jobRuns).values({ job: 'kiotviet', status: 'OK', message: `${created.length} đơn mới (giả lập)` });
    return { mode: 'mock', created, skipped: [] as string[] };
  }

  /**
   * KT ghi nhận thanh toán. Không truyền `amount` = thanh toán đủ phần còn lại.
   * Thanh toán một phần chỉ trừ công nợ; điểm Treo chỉ chuyển Khả dụng khi đã trả đủ.
   */
  @Post('orders/:id/payment')
  @Can('payments.record')
  async pay(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { amount?: number; method?: string } = {}) {
    return this.db.transaction((tx) => this.applyPayment(tx, actor, id, b?.amount, b?.method ?? 'Chuyển khoản', 'Thủ công'));
  }

  private async applyPayment(tx: Tx, actor: Actor, id: string, amount: number | undefined, method: string, source: string) {
    const [o] = await tx.select().from(orders).where(eq(orders.id, id));
    if (!o) throw new NotFoundException('Không tìm thấy đơn ' + id);
    if (o.pay === 'Đã thanh toán') throw new BadRequestException(`Đơn ${id} đã thanh toán đủ`);
    if (o.status === 'Huỷ') throw new BadRequestException(`Đơn ${id} đã huỷ`);
    const remaining = Math.max(0, Math.round(o.value * (1 - o.returnedPct)) - o.paidAmount);
    const amt = amount == null ? remaining : Math.round(Number(amount));
    if (!(amt > 0)) throw new BadRequestException('Số tiền phải lớn hơn 0');
    if (amt > remaining + 1) throw new BadRequestException(`Số tiền vượt phần còn nợ của đơn (${fmtVND(remaining)})`);
    const full = amt >= remaining - 1;
    await tx.insert(payments).values({ orderId: id, agentId: o.agentId, amount: amt, method, source, byUser: actorLabel(actor) });
    const activated = full ? await this.points.activatePending(tx, id) : 0;
    await tx.update(orders).set({ paidAmount: o.paidAmount + amt, pay: full ? 'Đã thanh toán' : 'Thanh toán một phần', paidAt: full ? new Date() : o.paidAt, pointState: full && o.pointState === 'pending' ? 'available' : o.pointState }).where(eq(orders.id, id));
    const [a] = await tx.select().from(agents).where(eq(agents.id, o.agentId));
    const debt = Math.max(0, a.debt - amt);
    await tx.update(agents).set({ debt, overdueDays: debt ? a.overdueDays : 0, status: a.status === 'overdue' && !debt ? 'ok' : a.status }).where(eq(agents.id, a.id));
    if (activated) await this.zns.send({ agentId: a.id, phone: a.phone, template: 'points', title: 'Cộng điểm', body: `Quý đại lý ${a.name} vừa nhận +${fmtNumber(activated)} điểm từ đơn ${id}. Điểm khả dụng: ${fmtNumber(a.rewardPoints)}.`, data: { name: a.name, points: fmtNumber(activated), source: 'đơn ' + id, balance: fmtNumber(a.rewardPoints) } }, tx);
    await this.audit.log(actor, full ? 'Ghi nhận thanh toán đủ' : 'Ghi nhận thanh toán một phần', id, o.pay, `${fmtVND(amt)} (${source})`, tx);
    return { id, amount: amt, full, activated, remaining: remaining - amt, rewardPoints: a.rewardPoints };
  }

  @Get('payments')
  @Can('debt.view')
  async paymentList(@CurrentActor() actor: Actor, @Query('agentId') agentId?: string) {
    const scope = await scopeAgentIds(this.db, actor);
    const conds = [];
    if (scope) conds.push(inArray(payments.agentId, scope.length ? scope : ['-']));
    if (agentId) conds.push(eq(payments.agentId, agentId));
    const rows = await this.db.select({ p: payments, name: agents.name }).from(payments).innerJoin(agents, eq(agents.id, payments.agentId)).where(conds.length ? and(...conds) : undefined).orderBy(desc(payments.at)).limit(500);
    return rows.map((r) => ({ ...r.p, agentName: r.name }));
  }

  /** Import file thanh toán xuất từ MISA (CSV). `dryRun` để xem trước. */
  @Post('payments/import')
  @Can('payments.import')
  async importMisa(@CurrentActor() actor: Actor, @Body() b: { csv: string; dryRun?: boolean }) {
    const { rows, errors } = parseMisaCsv(b?.csv ?? '');
    const results: Array<{ orderId: string; amount: number; ok: boolean; message: string }> = [];
    for (const r of rows) {
      try {
        if (b.dryRun) {
          const [o] = await this.db.select().from(orders).where(eq(orders.id, r.orderId));
          if (!o) throw new Error('Không tìm thấy đơn');
          const remaining = Math.max(0, Math.round(o.value * (1 - o.returnedPct)) - o.paidAmount);
          if (o.pay === 'Đã thanh toán') throw new Error('Đơn đã thanh toán đủ');
          if (r.amount > remaining + 1) throw new Error(`Vượt phần còn nợ ${fmtVND(remaining)}`);
          results.push({ ...r, ok: true, message: r.amount >= remaining - 1 ? 'Thanh toán đủ' : 'Thanh toán một phần' });
        } else {
          const res = await this.db.transaction((tx) => this.applyPayment(tx, actor, r.orderId, r.amount, r.method || 'Chuyển khoản', 'MISA'));
          results.push({ ...r, ok: true, message: res.full ? `Đủ · +${fmtNumber(res.activated)} điểm` : 'Một phần' });
        }
      } catch (e) { results.push({ ...r, ok: false, message: (e as Error).message }); }
    }
    if (!b.dryRun) await this.audit.log(actor, 'Import thanh toán MISA', 'payments', '—', `${results.filter((x) => x.ok).length}/${results.length} dòng`);
    return { dryRun: !!b.dryRun, errors, results };
  }

  /** Trả hàng một phần: bút toán đảo theo tỷ lệ (kịch bản 7). Có thể làm điểm âm. */
  @Post('orders/:id/returns')
  @Can('returns.create')
  async createReturn(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { pct: number; reason?: string }) {
    const pct = Number(b?.pct);
    if (!(pct > 0 && pct <= 1)) throw new BadRequestException('Tỷ lệ trả hàng phải trong khoảng 1–100%');
    return this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id));
      if (!o) throw new NotFoundException();
      if (o.status !== 'Hoàn tất' && o.status !== 'Trả hàng một phần') throw new BadRequestException('Chỉ trả hàng cho đơn đã hoàn tất');
      if (o.returnedPct + pct > 1 + 1e-9) throw new BadRequestException(`Đã trả ${Math.round(o.returnedPct * 100)}%, chỉ còn trả tối đa ${Math.round((1 - o.returnedPct) * 100)}%`);
      const back = Math.round(o.points * pct);
      const thId = await this.seq.next('TH', 4, tx);
      const isPending = o.pointState === 'pending';
      if (back) {
        await this.points.post(tx, { agentId: o.agentId, type: 'reverse', fund: 'both', points: -back, state: isPending ? 'pending' : 'available', item: `Trả hàng một phần ${o.id} (${Math.round(pct * 100)}%)`, ref: o.id, rule: `R01 v${o.ruleVersion}`, ruleVersion: o.ruleVersion, byUser: 'Tự động (bút toán đảo) · ' + actorLabel(actor) });
      }
      await tx.insert(returns).values({ id: thId, orderId: o.id, agentId: o.agentId, pct, value: Math.round(o.value * pct), points: back, reason: b.reason ?? '', createdBy: actorLabel(actor) });
      const total = o.returnedPct + pct;
      await tx.update(orders).set({ returnedPct: total, status: total >= 1 - 1e-9 ? 'Huỷ' : 'Trả hàng một phần' }).where(eq(orders.id, id));
      const [a] = await tx.select().from(agents).where(eq(agents.id, o.agentId));
      await tx.update(agents).set({ debt: Math.max(0, a.debt - Math.round(o.value * pct)) }).where(eq(agents.id, a.id));
      await this.audit.log(actor, 'Tạo phiếu trả hàng', thId, o.id, `−${fmtNumber(back)} điểm`, tx);
      return { id: thId, orderId: o.id, points: -back, rewardPoints: a.rewardPoints };
    });
  }

  /** Huỷ đơn: thu hồi điểm Treo, hoặc đảo toàn bộ nếu đã Khả dụng. */
  @Post('orders/:id/cancel')
  @Can('returns.create')
  async cancel(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { reason?: string }) {
    return this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id));
      if (!o) throw new NotFoundException();
      if (o.status === 'Huỷ') throw new BadRequestException('Đơn đã huỷ');
      if (o.pointState === 'pending') await this.points.revokePending(tx, id);
      else if (o.pointState === 'available') {
        const left = Math.round(o.points * (1 - o.returnedPct));
        if (left) await this.points.post(tx, { agentId: o.agentId, type: 'reverse', fund: 'both', points: -left, item: `Huỷ đơn ${o.id}`, ref: o.id, rule: `R01 v${o.ruleVersion}`, ruleVersion: o.ruleVersion, byUser: actorLabel(actor) });
      }
      await tx.update(orders).set({ status: 'Huỷ', pay: '—', pointState: 'revoked' }).where(eq(orders.id, id));
      await this.audit.log(actor, 'Huỷ đơn', id, o.status, 'Huỷ' + (b?.reason ? ': ' + b.reason : ''), tx);
      return { id, status: 'Huỷ' };
    });
  }

  /** KT duyệt đơn đặt từ app (GĐ2) → Hoàn tất, ghi điểm Treo. */
  @Post('orders/:id/approve')
  @Can('payments.record')
  async approveAppOrder(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id));
      if (!o || o.status !== 'Chờ duyệt') throw new BadRequestException('Đơn không ở trạng thái Chờ duyệt');
      const [a] = await tx.select().from(agents).where(eq(agents.id, o.agentId));
      const lines = await this.enrich(tx, o.lines);
      const { cp, version, extra } = await this.pointsFor(tx, lines, a, o.ship);
      await tx.update(orders).set({ status: 'Hoàn tất', lines, points: cp.total, pointState: cp.total ? 'pending' : 'none', calc: { steps: cp.steps, total: cp.total }, ruleVersion: version, tierAtOrder: a.tier, campaignIds: cp.campaignIds }).where(eq(orders.id, id));
      await this.chargeCampaigns(tx, cp.campaignIds, extra);
      await tx.update(agents).set({ salesMonth: a.salesMonth + cp.value, debt: a.debt + o.value, lastOrder: new Date().toLocaleDateString('vi-VN') }).where(eq(agents.id, a.id));
      if (cp.total) await this.points.post(tx, { agentId: o.agentId, type: 'earn', fund: 'both', points: cp.total, state: 'pending', item: `Lên đơn ${id}`, ref: id, rule: `R01 v${version}`, ruleVersion: version, byUser: 'Tự động' });
      await this.audit.log(actor, 'Duyệt đơn', id, 'Chờ duyệt', 'Hoàn tất', tx);
      return { id, points: cp.total };
    });
  }

  @Get('returns')
  @Can('returns.create', 'orders.view')
  async listReturns() {
    const rows = await this.db.select({ r: returns, agentName: agents.name }).from(returns).innerJoin(agents, eq(agents.id, returns.agentId)).orderBy(desc(returns.createdAt));
    return rows.map((x) => ({ ...x.r, agentName: x.agentName }));
  }

  @Get('products')
  @Can('products.view')
  async products(@CurrentActor() actor: Actor) {
    const rows = await this.db.select().from(products).orderBy(products.sku);
    return can(actor.role, 'products.viewCost') ? rows : rows.map(({ cost, ...p }) => ({ ...p, cost: null }));
  }

  /** KTT đề xuất đổi "không tính điểm" / hệ số điểm SKU → BOD duyệt (ma trận: bảng giá KTT P, BOD A). */
  @Post('products/:sku/proposal')
  @Can('products.propose')
  async proposeProduct(@CurrentActor() actor: Actor, @Param('sku') sku: string, @Body() b: { noPoint?: boolean; multiplier?: number; multiplierUntil?: string; reason: string }) {
    const [p] = await this.db.select().from(products).where(eq(products.sku, sku));
    if (!p) throw new NotFoundException('Không tìm thấy SKU');
    if (!b?.reason?.trim()) throw new BadRequestException('Cần lý do');
    const changes: Record<string, unknown> = {};
    if (b.noPoint != null && b.noPoint !== p.noPoint) changes.noPoint = !!b.noPoint;
    if (b.multiplier != null && Number(b.multiplier) !== p.multiplier) {
      if (!(Number(b.multiplier) >= 1 && Number(b.multiplier) <= 5)) throw new BadRequestException('Hệ số từ ×1 đến ×5');
      changes.multiplier = Number(b.multiplier);
    }
    if (b.multiplierUntil != null && b.multiplierUntil !== p.multiplierUntil) changes.multiplierUntil = b.multiplierUntil;
    if (!Object.keys(changes).length) throw new BadRequestException('Không có thay đổi');
    const desc = [changes.noPoint != null ? (changes.noPoint ? 'không tính điểm' : 'tính điểm') : '', changes.multiplier != null ? `hệ số ×${changes.multiplier}` : '', changes.multiplierUntil ? `tới ${changes.multiplierUntil}` : ''].filter(Boolean).join(', ');
    return this.approvals.create(actor, { kind: 'product', title: `${sku} ${p.name}: ${desc}`, reason: b.reason, payload: { sku, changes, before: { noPoint: p.noPoint, multiplier: p.multiplier, multiplierUntil: p.multiplierUntil } } });
  }

  @Get('debt')
  @Can('debt.view')
  async debt(@CurrentActor() actor: Actor) {
    const scope = await scopeAgentIds(this.db, actor);
    const rows = await this.db.select().from(agents).where(and(gt(agents.debt, 0), scope ? inArray(agents.id, scope.length ? scope : ['-']) : undefined)).orderBy(desc(agents.overdueDays));
    const unpaid = await this.db.select().from(orders).where(and(ne(orders.pay, 'Đã thanh toán'), ne(orders.status, 'Huỷ')));
    const us = await this.db.select({ id: users.id, name: users.name }).from(users);
    const um = new Map(us.map((u) => [u.id, u.name]));
    return rows.map((a) => ({ id: a.id, name: a.name, saleName: um.get(a.saleId) ?? '', tier: a.tier, debt: a.debt, overdueDays: a.overdueDays, creditLimit: a.creditLimit, creditDays: a.creditDays, flags: a.flags, invoices: unpaid.filter((o) => o.agentId === a.id).map((o) => ({ id: o.id, value: o.value, pay: o.pay, orderedAt: o.orderedAt })) }));
  }

  /* ---------- App đại lý ---------- */
  @Post('app/orders')
  @AgentOnly()
  async appOrder(@CurrentActor() actor: Actor, @Body() b: { lines: Array<{ sku: string; qty: number }> }) {
    if (!b?.lines?.length) throw new BadRequestException('Giỏ hàng trống');
    const [a] = await this.db.select().from(agents).where(eq(agents.id, actor.agentId!));
    if (a.overdueDays > 0 && !a.flags.includes('creditException')) throw new BadRequestException('Quý đại lý có hoá đơn quá hạn. Vui lòng thanh toán hoặc liên hệ sale để được hỗ trợ');
    const prods = await this.db.select().from(products).where(inArray(products.sku, b.lines.map((l) => l.sku)));
    if (a.status === 'locked') throw new BadRequestException('Tài khoản đại lý đang tạm ngưng');
    if (prods.length !== new Set(b.lines.map((l) => l.sku)).size) throw new BadRequestException('Có sản phẩm không tồn tại');
    const lines: OrderLineInput[] = b.lines.map((l) => { const p = prods.find((x) => x.sku === l.sku)!; return { sku: p.sku, name: p.name, price: p.price, qty: Math.max(1, Math.floor(l.qty)), discount: 0, noPoint: p.noPoint, multiplier: p.multiplier, brand: p.brand, line: p.line }; });
    const { cp, version } = await this.pointsFor(this.db, lines, a);
    const id = await this.seq.next('DH');
    await this.db.insert(orders).values({ id, agentId: a.id, orderedAt: new Date(), source: 'App', status: 'Chờ duyệt', pay: 'Chưa thanh toán', value: cp.value + cp.excluded, lines, points: cp.total, pointState: 'none', tierAtOrder: a.tier, ruleVersion: version, calc: { steps: cp.steps, total: cp.total } });
    return { id, status: 'Chờ duyệt', estimatedPoints: cp.total };
  }
}
