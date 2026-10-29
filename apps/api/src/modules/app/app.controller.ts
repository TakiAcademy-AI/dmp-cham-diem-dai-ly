import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
import { schema, type DB } from '../../db/db';
import { AgentOnly, AuditService, CurrentActor, InjectDb, type Actor } from '../../common/core';
import { PointsService } from '../points/points.service';

const { agents, contracts, orders, notifications, products, users, payments, agentAccounts } = schema;

/** API cho app đại lý (PWA M01–M11). Mọi truy vấn khoá theo agentId trong token. */
@Controller('app')
@AgentOnly()
export class AgentAppController {
  constructor(@InjectDb() private db: DB, private points: PointsService, private audit: AuditService) {}

  @Get('home')
  async home(@CurrentActor() actor: Actor) {
    const [a] = await this.db.select().from(agents).where(eq(agents.id, actor.agentId!));
    const [c] = await this.db.select().from(contracts).where(eq(contracts.agentId, a.id));
    const [sale] = await this.db.select({ name: users.name, phone: users.phone }).from(users).where(eq(users.id, a.saleId));
    const summary = await this.points.summary(a.id);
    const pendingOrders = await this.db.select({ id: orders.id, points: orders.points }).from(orders).where(and(eq(orders.agentId, a.id), eq(orders.pointState, 'pending')));
    const owner = actor.role === 'DLC';
    return {
      agent: { id: a.id, name: a.name, tier: a.tier, owner: a.owner, type: a.type, city: a.city },
      account: { name: actor.name, role: actor.role },
      points: summary,
      pendingOrders,
      commit: owner && c ? { month: c.commitMonth, actual: a.salesMonth, pct: c.commitMonth ? Math.round((a.salesMonth / c.commitMonth) * 100) : 0 } : null,
      debt: owner ? { amount: a.debt, overdueDays: a.overdueDays, creditLimit: a.creditLimit } : null,
      sale: { name: sale?.name ?? '', phone: sale?.phone || '1900 xxxx' },
      banner: { title: 'Hàng mới NOREVA — ×2 điểm', body: 'Kem chống nắng SPF50 · áp dụng tới 31/12/2026' },
    };
  }

  @Get('ledger')
  async ledger(@CurrentActor() actor: Actor) {
    return this.points.ledgerFor({ agentId: actor.agentId! });
  }

  @Get('tiers')
  async tiers(@CurrentActor() actor: Actor) {
    const { params, version } = await this.points.activeRules();
    const summary = await this.points.summary(actor.agentId!);
    const { rules: _rules, tiers, ...calc } = params;
    return { tiers, tierBasis: params.tierBasis, version, current: summary, params: calc };
  }

  @Get('orders')
  async orders(@CurrentActor() actor: Actor) {
    return this.db.select().from(orders).where(eq(orders.agentId, actor.agentId!)).orderBy(desc(orders.orderedAt));
  }

  @Get('debt')
  async debt(@CurrentActor() actor: Actor) {
    if (actor.role !== 'DLC') throw new ForbiddenException('Tài khoản nhân viên không xem được công nợ');
    const [a] = await this.db.select().from(agents).where(eq(agents.id, actor.agentId!));
    const unpaid = await this.db.select().from(orders).where(and(eq(orders.agentId, a.id), ne(orders.pay, 'Đã thanh toán'), ne(orders.status, 'Huỷ'))).orderBy(desc(orders.orderedAt));
    const history = await this.db.select().from(payments).where(eq(payments.agentId, a.id)).orderBy(desc(payments.at)).limit(50);
    return { history: history.map((p) => ({ id: p.id, orderId: p.orderId, amount: p.amount, method: p.method, source: p.source, at: p.at })), debt: a.debt, overdueDays: a.overdueDays, creditLimit: a.creditLimit, creditDays: a.creditDays, invoices: unpaid.map((o) => ({ id: o.id, value: o.value, paidAmount: o.paidAmount, remaining: Math.max(0, Math.round(o.value * (1 - o.returnedPct)) - o.paidAmount), pay: o.pay, orderedAt: o.orderedAt, dueAt: new Date(+o.orderedAt + a.creditDays * 86400e3) })) };
  }

  @Get('notifications')
  async notifications(@CurrentActor() actor: Actor) {
    return this.db.select().from(notifications).where(eq(notifications.agentId, actor.agentId!)).orderBy(desc(notifications.createdAt)).limit(100);
  }

  @Post('notifications/read')
  async read(@CurrentActor() actor: Actor, @Body() _b: unknown) {
    await this.db.update(notifications).set({ read: true }).where(eq(notifications.agentId, actor.agentId!));
    return { ok: true };
  }

  @Post('notifications/:id/read')
  async readOne(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.db.update(notifications).set({ read: true }).where(and(eq(notifications.id, Number(id)), eq(notifications.agentId, actor.agentId!)));
    return { ok: true };
  }

  /** Hồ sơ đại lý + hợp đồng + thời điểm đồng ý dữ liệu (M10). */
  @Get('profile')
  async profile(@CurrentActor() actor: Actor) {
    const [a] = await this.db.select().from(agents).where(eq(agents.id, actor.agentId!));
    const [c] = await this.db.select().from(contracts).where(eq(contracts.agentId, a.id));
    const [acc] = await this.db.select().from(agentAccounts).where(eq(agentAccounts.id, Number(actor.id.replace('acc-', ''))));
    const owner = actor.role === 'DLC';
    return {
      id: a.id, name: a.name, type: a.type, owner: a.owner, address: a.address, city: a.city, startDate: a.startDate, tier: a.tier,
      phone: acc?.phone, taxCode: owner ? a.taxCode : undefined,
      contract: owner && c ? { id: c.id, startDate: c.startDate, endDate: c.endDate, commitMonth: c.commitMonth, policy: c.policy } : null,
      consentAt: acc?.consentAt ?? null, account: { name: acc?.name, role: acc?.role },
    };
  }

  /** Lưu bằng chứng đồng ý xử lý dữ liệu cá nhân (thời điểm + thiết bị). */
  @Post('consent')
  async consent(@CurrentActor() actor: Actor, @Req() req: { headers: Record<string, string> }) {
    const id = Number(actor.id.replace('acc-', ''));
    const device = (req.headers['user-agent'] || '').slice(0, 200);
    await this.db.update(agentAccounts).set({ consentAt: new Date(), consentDevice: device }).where(eq(agentAccounts.id, id));
    await this.audit.log(actor, 'Đồng ý xử lý dữ liệu cá nhân', actor.agentId!, '—', device.slice(0, 60));
    return { ok: true, at: new Date() };
  }

  /** Tài khoản nhân viên (tối đa 1 ĐL-NV) — chỉ chủ đại lý quản lý. */
  @Get('staff')
  async staff(@CurrentActor() actor: Actor) {
    const rows = await this.db.select().from(agentAccounts).where(eq(agentAccounts.agentId, actor.agentId!));
    return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, role: r.role, active: r.active, consentAt: r.consentAt, me: 'acc-' + r.id === actor.id }));
  }

  @Post('staff')
  async addStaff(@CurrentActor() actor: Actor, @Body() b: { name: string; phone: string }) {
    if (actor.role !== 'DLC') throw new ForbiddenException('Chỉ chủ đại lý thêm được tài khoản nhân viên');
    const phone = (b?.phone ?? '').replace(/\D/g, '');
    if (!b?.name?.trim() || !/^0\d{9}$/.test(phone)) throw new BadRequestException('Cần họ tên và SĐT 10 số');
    const rows = await this.db.select().from(agentAccounts).where(eq(agentAccounts.agentId, actor.agentId!));
    if (rows.some((r) => r.role === 'DLNV')) throw new BadRequestException('Mỗi đại lý tối đa 1 tài khoản nhân viên. Gỡ tài khoản cũ trước khi thêm');
    const [dupe] = await this.db.select().from(agentAccounts).where(eq(agentAccounts.phone, phone));
    if (dupe) throw new BadRequestException('SĐT đã được dùng cho tài khoản khác');
    await this.db.insert(agentAccounts).values({ agentId: actor.agentId!, phone, name: b.name.trim(), role: 'DLNV' });
    await this.audit.log(actor, 'Thêm tài khoản nhân viên đại lý', actor.agentId!, '—', phone.slice(0, 3) + '****' + phone.slice(-3));
    return { ok: true };
  }

  @Delete('staff/:id')
  async removeStaff(@CurrentActor() actor: Actor, @Param('id') id: string) {
    if (actor.role !== 'DLC') throw new ForbiddenException('Chỉ chủ đại lý gỡ được tài khoản nhân viên');
    const [r] = await this.db.select().from(agentAccounts).where(eq(agentAccounts.id, Number(id)));
    if (!r || r.agentId !== actor.agentId || r.role !== 'DLNV') throw new BadRequestException('Không tìm thấy tài khoản nhân viên');
    await this.db.delete(agentAccounts).where(eq(agentAccounts.id, r.id));
    await this.audit.log(actor, 'Gỡ tài khoản nhân viên đại lý', actor.agentId!, r.name, '—');
    return { ok: true };
  }

  @Get('products')
  async products() {
    const rows = await this.db.select().from(products).orderBy(products.sku);
    return rows.map(({ cost, stock, ...p }) => ({ ...p, inStock: stock > 0 }));
  }
}
