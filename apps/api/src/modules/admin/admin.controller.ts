import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { can, INTERNAL_ROLES, PERMISSIONS, ROLE_LABEL, TIER_ORDER, type Role } from '@dmp/shared';
import { schema, type DB } from '../../db/db';
import { AuditService, Can, CurrentActor, InjectDb, type Actor } from '../../common/core';
import { DEMO_PASSWORD, resetAndSeed } from '../../db/seed';
import { scopeAgentIds } from '../agents/scope';
import { SchedulerService } from './scheduler.service';
import { KiotVietClient, ZaloCrmClient, ZaloZnsClient } from '../integrations/integrations';
import { actorLabel, ZnsService } from '../../common/core';

const { users, agents, auditLog, notifications, approvals, redemptions, applications, orders, monthlyStats, contracts, ledger, tierHistory, agentMonthly, scheduledBroadcasts, products } = schema;

@Controller()
export class AdminController {
  constructor(@InjectDb() private db: DB, private audit: AuditService, private scheduler: SchedulerService, private kiot: KiotVietClient, private zalo: ZaloZnsClient, private crm: ZaloCrmClient, private zns: ZnsService) {}

  /* ---------- Dashboard theo vai trò (W02) ---------- */
  @Get('dashboard')
  async dashboard(@CurrentActor() actor: Actor) {
    const scope = await scopeAgentIds(this.db, actor);
    const all = await this.db.select().from(agents).where(scope ? inArray(agents.id, scope.length ? scope : ['-']) : undefined);
    const cs = await this.db.select().from(contracts);
    const cm = new Map(cs.map((c) => [c.agentId, c]));
    const stats = await this.db.select().from(monthlyStats).orderBy(monthlyStats.ord);
    const pendingAp = await this.db.select().from(approvals).where(eq(approvals.status, 'pending'));
    const reds = await this.db.select().from(redemptions).where(inArray(redemptions.stage, ['new', 'confirmed', 'approved', 'shipping']));
    const apps = await this.db.select().from(applications).where(inArray(applications.stage, ['BOD duyệt', 'KT cấp mã']));
    const pendOrders = await this.db.select({ id: orders.id }).from(orders).where(eq(orders.pointState, 'pending'));
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const issuedNow = await this.db.select({ n: sql<number>`coalesce(sum(delta_reward),0)::int` }).from(ledger).where(and(gte(ledger.createdAt, monthStart), inArray(ledger.state, ['available', 'pending']), sql`delta_reward > 0`));
    const redeemedNow = await this.db.select({ n: sql<number>`coalesce(-sum(delta_reward),0)::int` }).from(ledger).where(and(gte(ledger.createdAt, monthStart), eq(ledger.type, 'redeem')));
    const active = all.filter((a) => a.salesMonth > 0).length;
    const th = await this.db.select().from(tierHistory);
    const prevCounts = th.find((x) => x.month === stats.at(-2)?.month)?.counts ?? {};
    const tierDist = TIER_ORDER.map((t) => ({ tier: t, count: all.filter((a) => a.tier === t).length, prev: scope ? null : prevCounts[t] ?? null }));
    const pick = (flag: string) => all.filter((a) => a.flags.includes(flag) || a.status === flag).map((a) => ({ id: a.id, name: a.name, tier: a.tier, lastOrder: a.lastOrder, salesMonth: a.salesMonth, debt: a.debt, overdueDays: a.overdueDays, dob: a.dob, contractEnd: cm.get(a.id)?.endDate ?? '', commitPct: cm.get(a.id)?.commitMonth ? Math.round(a.salesMonth / cm.get(a.id)!.commitMonth * 100) : 0 }));
    const commitTotal = all.reduce((t, a) => t + (cm.get(a.id)?.commitMonth ?? 0), 0);
    const salesTotal = all.reduce((t, a) => t + a.salesMonth, 0);
    return {
      role: actor.role,
      kpi: {
        agents: all.length, active, activeRate: all.length ? Math.round((active / all.length) * 100) : 0,
        salesMonth: salesTotal, salesLastMonth: all.reduce((t, a) => t + a.salesLastMonth, 0), commitMonth: commitTotal, commitPct: commitTotal ? Math.round((salesTotal / commitTotal) * 100) : 0,
        pointsIssued: stats.at(-1)!.issued + issuedNow[0].n, pointsRedeemed: stats.at(-1)!.redeemed + redeemedNow[0].n,
        pendingPointsOrders: pendOrders.length, approvalsPending: pendingAp.length, redemptionsOpen: reds.length, applicationsOpen: apps.length,
        debtTotal: all.reduce((t, a) => t + a.debt, 0), overdueCount: all.filter((a) => a.overdueDays > 0).length,
      },
      series: stats.map((s) => ({ month: s.month, revenue: s.revenue, revenueLY: s.revenueLY, issued: s.issued, redeemed: s.redeemed, activeRate: s.activeRate, commitActual: s.commitActual })),
      tierDist,
      lists: { dormant: pick('dormant'), atrisk: pick('atrisk'), expiring: pick('expiring'), birthday: pick('birthday'), overdue: pick('overdue') },
      queues: {
        approvals: pendingAp.map((a) => ({ id: a.id, kind: a.kind, title: a.title, points: a.points, requestedBy: a.requestedBy, requestedAt: a.requestedAt, dueAt: a.dueAt })),
        redemptions: reds.map((r) => ({ id: r.id, stage: r.stage, giftName: r.giftName, points: r.points, agentId: r.agentId })),
        applications: apps.map((a) => ({ id: a.id, name: a.name, stage: a.stage })),
      },
    };
  }

  /** Số đếm việc chờ trên menu (badge sidebar). */
  @Get('badges')
  async badges(@CurrentActor() actor: Actor) {
    const out: Record<string, number> = {};
    if (actor.kind === 'agent') return out;
    const ap = await this.db.select({ kind: approvals.kind }).from(approvals).where(eq(approvals.status, 'pending'));
    const reds = await this.db.select({ stage: redemptions.stage, agentId: redemptions.agentId }).from(redemptions).where(inArray(redemptions.stage, ['new', 'confirmed', 'approved', 'shipping']));
    const apps = await this.db.select({ stage: applications.stage, saleId: applications.saleId }).from(applications);
    const pend = await this.db.select({ id: orders.id }).from(orders).where(eq(orders.pointState, 'pending'));
    const scope = await scopeAgentIds(this.db, actor);
    const r = actor.role;
    if (r === 'BOD') { out.points = ap.filter((a) => a.kind !== 'evidence').length; out.agents = apps.filter((a) => a.stage === 'BOD duyệt').length; }
    if (r === 'MKT') out.points = ap.filter((a) => a.kind === 'evidence').length;
    if (r === 'KT') { out.orders = pend.length; out.gifts = reds.filter((x) => x.stage === 'confirmed').length; out.agents = apps.filter((a) => a.stage === 'KT cấp mã').length; }
    if (r === 'KTT') out.gifts = reds.filter((x) => x.stage === 'confirmed').length;
    if (r === 'SALE') out.gifts = reds.filter((x) => x.stage === 'new' && scope?.includes(x.agentId)).length;
    if (r === 'KHO') out.gifts = reds.filter((x) => x.stage === 'approved' || x.stage === 'shipping').length;
    return out;
  }

  /* ---------- Báo cáo (W22) ---------- */
  @Get('reports')
  @Can('reports.view')
  async reports(@CurrentActor() actor: Actor) {
    const scope = await scopeAgentIds(this.db, actor);
    const all = await this.db.select().from(agents).where(scope ? inArray(agents.id, scope.length ? scope : ['-']) : undefined);
    const stats = await this.db.select().from(monthlyStats).orderBy(monthlyStats.ord);
    const us = await this.db.select().from(users).where(eq(users.role, 'SALE'));
    const bySale = us.map((u) => { const mine = all.filter((a) => a.saleId === u.id); return { id: u.id, name: u.name, agents: mine.length, sales: mine.reduce((t, a) => t + a.salesMonth, 0), active: mine.filter((a) => a.salesMonth > 0).length, dormant: mine.filter((a) => a.status === 'dormant').length }; });
    const byTier = TIER_ORDER.map((t) => { const m = all.filter((a) => a.tier === t); return { tier: t, agents: m.length, sales: m.reduce((s, a) => s + a.salesMonth, 0), reward: m.reduce((s, a) => s + a.rewardPoints, 0) }; });
    const liability = all.reduce((t, a) => t + a.rewardPoints, 0);
    const ords = await this.db.select().from(orders).where(scope ? inArray(orders.agentId, scope.length ? scope : ['-']) : undefined);
    const live = ords.filter((o) => o.status !== 'Huỷ');
    const brandMap = new Map<string, { brand: string; revenue: number; qty: number; orders: Set<string> }>();
    for (const o of live) for (const l of o.lines) {
      const brand = l.brand ?? l.sku.split('-')[0];
      const b = brandMap.get(brand) ?? { brand, revenue: 0, qty: 0, orders: new Set<string>() };
      b.revenue += l.price * l.qty * (1 - (l.discount || 0)); b.qty += l.qty; b.orders.add(o.id); brandMap.set(brand, b);
    }
    const BRAND_FULL: Record<string, string> = { NOR: 'NOREVA', TRA: 'TRANACIX', VIT: 'VITILSI', BIO: 'BIOTOPIX', ALP: 'ALPHASCIENCE' };
    const byBrand = [...brandMap.values()].map((b) => ({ brand: BRAND_FULL[b.brand] ?? b.brand, revenue: Math.round(b.revenue), qty: b.qty, orders: b.orders.size })).sort((x, y) => y.revenue - x.revenue);
    const tierHist = scope ? [] : (await this.db.select().from(tierHistory)).sort((a, b) => stats.findIndex((s) => s.month === a.month) - stats.findIndex((s) => s.month === b.month));
    const am = await this.db.select().from(agentMonthly).where(scope ? inArray(agentMonthly.agentId, scope.length ? scope : ['-']) : undefined);
    const commitHistory = stats.map((s) => { const rows = am.filter((r) => r.month === s.month); return { month: s.month, sales: rows.reduce((t, r) => t + r.sales, 0), commit: rows.reduce((t, r) => t + r.commit, 0) }; });
    const in30 = new Date(Date.now() + 30 * 86400e3);
    const lots = await this.db.select().from(schema.pointLots).where(scope ? inArray(schema.pointLots.agentId, scope.length ? scope : ['-']) : undefined);
    const expiring30 = lots.filter((l) => l.remaining > 0 && l.expiresAt <= in30).reduce((t, l) => t + l.remaining, 0);
    const orderStats = { count: live.length, avgValue: live.length ? Math.round(live.reduce((t, o) => t + o.value, 0) / live.length) : 0 };
    return { byBrand, tierHistory: tierHist, commitHistory, expiring30, orderStats, series: stats, bySale, byTier, liability, liabilityVND: liability * 1000, top: [...all].sort((a, b) => b.salesMonth - a.salesMonth).slice(0, 10).map((a) => ({ id: a.id, name: a.name, tier: a.tier, sales: a.salesMonth, reward: a.rewardPoints })) };
  }

  /* ---------- Người dùng & phân quyền (W23) ---------- */
  @Get('users')
  @Can('users.view')
  async users() {
    const rows = await this.db.select().from(users).orderBy(users.createdAt);
    const counts = await this.db.select({ saleId: agents.saleId, n: sql<number>`count(*)::int` }).from(agents).groupBy(agents.saleId);
    const m = new Map(counts.map((c) => [c.saleId, c.n]));
    return rows.map(({ passwordHash, failedLogins, totpSecret, ...u }) => ({ ...u, totpEnabled: !!totpSecret, roleLabel: ROLE_LABEL[u.role as Role], agents: m.get(u.id) ?? 0 }));
  }

  @Post('users')
  @Can('users.manage')
  async createUser(@CurrentActor() actor: Actor, @Body() b: { name: string; email: string; role: string; scope?: string }) {
    if (!b?.name || !b.email || !INTERNAL_ROLES.includes(b.role as any)) throw new BadRequestException('Cần họ tên, email và vai trò hợp lệ');
    const id = 'u-' + Date.now().toString(36);
    await this.db.insert(users).values({ id, name: b.name, email: b.email.toLowerCase(), role: b.role, twoFA: ['SA', 'BOD', 'KTT', 'KT'].includes(b.role), scope: b.scope ?? '', passwordHash: await bcrypt.hash(DEMO_PASSWORD, 8) });
    await this.audit.log(actor, 'Tạo người dùng', b.email, '—', b.role);
    return { id, tempPassword: DEMO_PASSWORD };
  }

  @Patch('users/:id')
  @Can('users.manage')
  async updateUser(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { role?: string; status?: string; twoFA?: boolean; phone?: string; resetTotp?: boolean }) {
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw new BadRequestException('Không tìm thấy người dùng');
    if (b.role && !INTERNAL_ROLES.includes(b.role as any)) throw new BadRequestException('Vai trò không hợp lệ');
    const mustTwoFA = ['SA', 'BOD', 'KTT', 'KT'].includes(b.role ?? u.role);
    if (b.twoFA === false && mustTwoFA) throw new BadRequestException('Vai trò này bắt buộc 2FA (mục 4.4)');
    await this.db.update(users).set({
      ...(b.role ? { role: b.role, twoFA: mustTwoFA || u.twoFA } : {}), ...(b.status ? { status: b.status, ...(b.status === 'Đang hoạt động' ? { lockedUntil: null, failedLogins: 0 } : {}) } : {}),
      ...(b.twoFA != null ? { twoFA: b.twoFA } : {}), ...(b.phone != null ? { phone: b.phone } : {}), ...(b.resetTotp ? { totpSecret: null } : {}),
    }).where(eq(users.id, id));
    const what = b.role ? 'Đổi vai trò' : b.status ? 'Đổi trạng thái tài khoản' : b.twoFA != null ? (b.twoFA ? 'Bật 2FA' : 'Tắt 2FA') : b.resetTotp ? 'Đặt lại Authenticator' : 'Sửa thông tin người dùng';
    await this.audit.log(actor, what, u.email, b.role ? u.role : b.status ? u.status : '—', b.role ?? b.status ?? (b.twoFA != null ? String(b.twoFA) : '') ?? '');
    return { id };
  }

  @Get('permissions')
  @Can('users.view')
  permissions() {
    return { roles: INTERNAL_ROLES, permissions: Object.entries(PERMISSIONS).map(([key, roles]) => ({ key, roles })), check: INTERNAL_ROLES.map((r) => ({ role: r, count: Object.keys(PERMISSIONS).filter((p) => can(r, p as any)).length })) };
  }

  /* ---------- Audit log (W24) ---------- */
  @Get('audit')
  @Can('audit.view')
  async auditLog(@Query('q') q?: string) {
    const rows = await this.db.select().from(auditLog).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(500);
    const s = (q ?? '').toLowerCase();
    return s ? rows.filter((r) => `${r.userName} ${r.action} ${r.target}`.toLowerCase().includes(s)) : rows;
  }

  /* ---------- Thông báo (W20) ---------- */
  @Get('notifications')
  @Can('notify.broadcast', 'reports.view')
  async outbox() {
    const rows = await this.db.select({ n: notifications, agentName: agents.name }).from(notifications).leftJoin(agents, eq(agents.id, notifications.agentId)).orderBy(desc(notifications.createdAt)).limit(200);
    return rows.map((r) => ({ ...r.n, agentName: r.agentName }));
  }

  @Post('notifications/broadcast')
  @Can('notify.broadcast')
  async broadcast(@CurrentActor() actor: Actor, @Body() b: { tiers?: string[]; agentIds?: string[]; channel?: string; title: string; body: string; template?: string; sendAt?: string }) {
    if (!b?.title?.trim() || !b.body?.trim()) throw new BadRequestException('Cần tiêu đề và nội dung');
    if (b.sendAt) {
      const at = new Date(b.sendAt);
      if (!(+at > Date.now() + 60e3)) throw new BadRequestException('Thời điểm hẹn phải sau hiện tại ít nhất 1 phút');
      const [row] = await this.db.insert(scheduledBroadcasts).values({ payload: { tiers: b.tiers, agentIds: b.agentIds, channel: b.channel ?? 'ZNS', title: b.title, body: b.body, template: b.template }, sendAt: at, sender: actorLabel(actor) }).returning();
      await this.audit.log(actor, 'Hẹn giờ gửi thông báo', 'BC' + row.id, '—', at.toLocaleString('vi-VN'));
      return { scheduled: true, id: row.id, sendAt: at };
    }
    let targets = await this.db.select().from(agents).where(ne(agents.status, 'locked'));
    if (b.agentIds?.length) targets = targets.filter((a) => b.agentIds!.includes(a.id));
    else if (b.tiers?.length) targets = targets.filter((a) => b.tiers!.includes(a.tier));
    if (!targets.length) throw new BadRequestException('Không có đại lý nào khớp điều kiện');
    const batchId = 'B' + Date.now().toString(36).toUpperCase();
    for (const a of targets) await this.zns.send({ agentId: a.id, phone: a.phone, channel: b.channel ?? 'ZNS', template: b.template ?? 'broadcast', title: b.title, body: b.body.replace(/<tên>/g, a.name), sender: actorLabel(actor), batchId });
    await this.audit.log(actor, 'Gửi thông báo hàng loạt', b.channel ?? 'ZNS', '—', `${targets.length} đại lý`);
    return { sent: targets.length, costVND: (b.channel ?? 'ZNS') === 'ZNS' ? targets.length * 300 : 0 };
  }

  /** Lịch hẹn gửi & lô đã gửi (W20). Sale chỉ thấy tin gửi tới đại lý mình. */
  @Get('notifications/batches')
  @Can('notify.broadcast', 'reports.view')
  async batches(@CurrentActor() actor: Actor) {
    const scope = await scopeAgentIds(this.db, actor);
    const rows = await this.db.select().from(notifications).where(scope ? inArray(notifications.agentId, scope.length ? scope : ['-']) : undefined).orderBy(desc(notifications.createdAt)).limit(2000);
    const map = new Map<string, any>();
    for (const n of rows) {
      const key = n.batchId ?? `${n.template}:${n.agentId}:${+n.createdAt}`;
      const b = map.get(key) ?? { batchId: n.batchId, title: n.title, body: n.body, channel: n.channel, template: n.template, sender: n.sender, createdAt: n.createdAt, sent: 0, read: 0, failed: 0 };
      b.sent++; if (n.read) b.read++; if (n.status === 'Lỗi') b.failed++;
      map.set(key, b);
    }
    const scheduled = await this.db.select().from(scheduledBroadcasts).orderBy(desc(scheduledBroadcasts.sendAt));
    return { batches: [...map.values()].slice(0, 100), scheduled };
  }

  @Post('notifications/scheduled/:id/cancel')
  @Can('notify.broadcast')
  async cancelScheduled(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const [s] = await this.db.select().from(scheduledBroadcasts).where(eq(scheduledBroadcasts.id, Number(id)));
    if (!s || s.status !== 'Chờ gửi') throw new BadRequestException('Lịch gửi không còn ở trạng thái chờ');
    await this.db.update(scheduledBroadcasts).set({ status: 'Đã huỷ' }).where(eq(scheduledBroadcasts.id, s.id));
    await this.audit.log(actor, 'Huỷ lịch gửi thông báo', 'BC' + s.id);
    return { ok: true };
  }

  /* ---------- Job định kỳ ---------- */
  @Get('system/jobs')
  @Can('system.manage', 'periods.lock')
  async jobs() {
    const last = await this.scheduler.lastRuns();
    return { enabled: process.env.CRON_ENABLED !== 'false', jobs: this.scheduler.jobs.map((j) => ({ key: j.key, name: j.name, schedule: j.schedule, last: last[j.key] })) };
  }

  @Post('system/jobs/:key/run')
  @Can('system.manage')
  async runJob(@CurrentActor() actor: Actor, @Param('key') key: string) {
    const r = await this.scheduler.runJob(key);
    await this.audit.log(actor, 'Chạy job thủ công', key, '—', r.message);
    return r;
  }

  /* ---------- Hệ thống (W25) ---------- */
  @Get('system')
  @Can('system.manage', 'demo.reset')
  async system() {
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(ledger);
    return {
      db: process.env.DATABASE_URL ? 'PostgreSQL' : 'PGlite (PostgreSQL nhúng)', ledgerRows: n,
      integrations: [
        { key: 'kiotviet', name: 'KiotViet', status: this.kiot.configured ? 'Đã kết nối' : 'Giả lập', note: this.kiot.configured ? 'Kéo hoá đơn mỗi 15 phút (mã KH = mã đại lý)' : 'Chưa có KIOTVIET_CLIENT_ID/SECRET/RETAILER — nút "Đồng bộ" sinh đơn ngẫu nhiên', env: ['KIOTVIET_CLIENT_ID', 'KIOTVIET_CLIENT_SECRET', 'KIOTVIET_RETAILER'] },
        { key: 'misa', name: 'MISA', status: 'Import file', note: 'Import CSV thanh toán ở W10 (MISA chưa có API)', env: [] },
        { key: 'zalocrm', name: 'Zalo CRM (tự xây)', status: this.crm.configured ? 'Đã kết nối' : 'Chờ tài liệu API', note: 'Webhook sự kiện: đại lý mới, ngủ đông, đổi hạng, tạm ngưng, đổi quà, khiếu nại (ký HMAC)', env: ['ZALO_CRM_WEBHOOK_URL', 'ZALO_CRM_SECRET'] },
        { key: 'zns', name: 'Zalo OA / ZNS', status: this.zalo.configured ? 'Đã kết nối' : 'Giả lập', note: this.zalo.configured ? 'Gửi theo mã template đã duyệt' : 'Chưa có ZALO_OA_ACCESS_TOKEN / ZNS_TEMPLATES — tin chỉ ghi hộp thư', env: ['ZALO_OA_ACCESS_TOKEN', 'ZNS_TEMPLATES'] },
      ],
      cron: process.env.CRON_ENABLED !== 'false',
    };
  }

  @Post('system/reset')
  @Can('demo.reset')
  async reset(@CurrentActor() actor: Actor) {
    await resetAndSeed(this.db);
    await this.audit.log(actor, 'Nạp lại dữ liệu demo', 'Hệ thống');
    return { ok: true };
  }
}
