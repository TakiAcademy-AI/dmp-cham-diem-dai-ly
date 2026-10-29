import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { canRevealField, mask, type SensitiveField } from '@dmp/shared';
import { schema, type DB } from '../../db/db';
import { actorLabel, AuditService, Can, CurrentActor, InjectDb, SeqService, ZnsService, type Actor } from '../../common/core';
import { scopeAgentIds, serializeAgent } from './scope';
import { ApprovalsService } from '../points/approvals.service';
import { ZaloCrmClient } from '../integrations/integrations';

const { agents, users, contracts, applications, agentAccounts, orders, redemptions, agentMonthly, auditLog, ledger } = schema;

@Controller()
export class AgentsController {
  constructor(@InjectDb() private db: DB, private audit: AuditService, private seq: SeqService, private zns: ZnsService, private approvals: ApprovalsService, private crm: ZaloCrmClient) {}

  private async saleNames() {
    const rows = await this.db.select({ id: users.id, name: users.name }).from(users);
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  @Get('agents')
  @Can('agents.view')
  async list(@CurrentActor() actor: Actor) {
    const scope = await scopeAgentIds(this.db, actor);
    const rows = await this.db.select().from(agents).where(scope ? inArray(agents.id, scope.length ? scope : ['-']) : undefined).orderBy(agents.id);
    const cs = await this.db.select().from(contracts);
    const byAgent = new Map(cs.map((c) => [c.agentId, c]));
    const names = await this.saleNames();
    return rows.map((a) => {
      const c = byAgent.get(a.id);
      return serializeAgent(a, actor, {
        saleName: names.get(a.saleId) ?? '', commitMonth: c?.commitMonth ?? 0, contractEnd: c?.endDate ?? '', contractNo: c?.id ?? '',
        commitPct: c?.commitMonth ? Math.round((a.salesMonth / c.commitMonth) * 100) : 0,
      });
    });
  }

  @Get('agents/:id')
  @Can('agents.view')
  async detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const scope = await scopeAgentIds(this.db, actor);
    if (scope && !scope.includes(id)) throw new ForbiddenException('Đại lý không thuộc phạm vi phụ trách của bạn');
    const [a] = await this.db.select().from(agents).where(eq(agents.id, id));
    if (!a) throw new NotFoundException('Không tìm thấy đại lý');
    const [c] = await this.db.select().from(contracts).where(eq(contracts.agentId, id));
    const names = await this.saleNames();
    const accounts = await this.db.select().from(agentAccounts).where(eq(agentAccounts.agentId, id));
    const ords = await this.db.select().from(orders).where(eq(orders.agentId, id)).orderBy(desc(orders.orderedAt));
    const reds = await this.db.select().from(redemptions).where(eq(redemptions.agentId, id)).orderBy(desc(redemptions.createdAt));
    return serializeAgent(a, actor, {
      saleName: names.get(a.saleId) ?? '', contract: c ?? null, commitPct: c?.commitMonth ? Math.round((a.salesMonth / c.commitMonth) * 100) : 0,
      accounts: accounts.map((x) => ({ ...x, phone: mask.phone(x.phone) })), orders: ords, redemptions: reds,
    });
  }

  /** Bấm "Xem" trường bị che: chỉ BOD/KTT/KT, mọi lần xem đều ghi audit. */
  @Post('agents/:id/reveal')
  @Can('agents.view')
  async reveal(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { field: SensitiveField }) {
    if (!canRevealField(actor.role, b.field)) throw new ForbiddenException('Vai trò của bạn không được xem trường này');
    const [a] = await this.db.select().from(agents).where(eq(agents.id, id));
    if (!a) throw new NotFoundException();
    const map: Record<string, string> = { phone: a.phone, idCard: a.idCard, dob: a.dob, bank: a.bank };
    const label: Record<string, string> = { phone: 'SĐT', idCard: 'CCCD', dob: 'ngày sinh', bank: 'số tài khoản' };
    await this.audit.log(actor, `Xem đầy đủ ${label[b.field]}`, id);
    return { field: b.field, value: map[b.field] ?? '' };
  }

  /** Sửa thông tin nhạy cảm (ngân hàng, CCCD): chỉ Kế toán, có log giá trị cũ/mới (đã che). */
  @Patch('agents/:id/sensitive')
  @Can('agents.editSensitive')
  async editSensitive(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { bank?: string; bankName?: string; idCard?: string }) {
    const [a] = await this.db.select().from(agents).where(eq(agents.id, id));
    if (!a) throw new NotFoundException();
    const set: Partial<typeof agents.$inferInsert> = {};
    if (b.bank) { set.bank = b.bank; await this.audit.log(actor, 'Sửa số tài khoản ngân hàng', id, mask.bank(a.bank), mask.bank(b.bank)); }
    if (b.bankName) set.bankName = b.bankName;
    if (b.idCard) { set.idCard = b.idCard; await this.audit.log(actor, 'Sửa CCCD', id, mask.idCard(a.idCard), mask.idCard(b.idCard)); }
    if (!Object.keys(set).length) throw new BadRequestException('Không có thay đổi');
    await this.db.update(agents).set(set).where(eq(agents.id, id));
    return { ok: true };
  }

  /** Bàn giao đại lý hàng loạt khi Sale nghỉ việc. */
  @Post('agents/handover')
  @Can('agents.handover')
  async handover(@CurrentActor() actor: Actor, @Body() b: { agentIds: string[]; toSaleId: string }) {
    const [to] = await this.db.select().from(users).where(and(eq(users.id, b.toSaleId), eq(users.role, 'SALE')));
    if (!to) throw new BadRequestException('Sale nhận bàn giao không hợp lệ');
    if (!b.agentIds?.length) throw new BadRequestException('Chọn đại lý cần bàn giao');
    await this.db.update(agents).set({ saleId: to.id }).where(inArray(agents.id, b.agentIds));
    await this.audit.log(actor, 'Bàn giao đại lý', b.agentIds.length + ' đại lý', '—', to.name);
    return { moved: b.agentIds.length, to: to.name };
  }

  /** Đề xuất nâng hạng tay / ngoại lệ công nợ → hàng chờ BOD. */
  @Post('agents/:id/requests')
  @Can('tier.manualPropose', 'credit.exceptionPropose')
  async request(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { kind: 'tier' | 'credit'; tier?: string; amount?: number; reason: string }) {
    const [a] = await this.db.select().from(agents).where(eq(agents.id, id));
    if (!a) throw new NotFoundException();
    if (!b.reason?.trim()) throw new BadRequestException('Cần nhập lý do');
    if (b.kind === 'tier') return this.approvals.create(actor, { kind: 'tier', agentId: id, title: `Nâng hạng tay: ${b.tier}`, reason: b.reason, payload: { tier: b.tier } });
    return this.approvals.create(actor, { kind: 'credit', agentId: id, title: `Ngoại lệ đặt hàng khi nợ quá hạn (đơn ${Math.round((b.amount ?? 0) / 1e6)} triệu)`, reason: b.reason, payload: { amount: b.amount } });
  }

  private async assertScope(actor: Actor, id: string) {
    const scope = await scopeAgentIds(this.db, actor);
    if (scope && !scope.includes(id)) throw new ForbiddenException('Đại lý không thuộc phạm vi phụ trách của bạn');
  }

  /** Doanh số & cam kết 12 tháng của một đại lý (biểu đồ W04/W06). */
  @Get('agents/:id/monthly')
  @Can('agents.view', 'contracts.view')
  async monthly(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.assertScope(actor, id);
    const rows = await this.db.select().from(agentMonthly).where(eq(agentMonthly.agentId, id));
    const key = (m: string) => { const [mm, yy] = m.slice(1).split('/').map(Number); return yy * 100 + mm; };
    return rows.sort((a, b) => key(a.month) - key(b.month));
  }

  /** Lịch sử thay đổi của đại lý: audit log nhắm tới đại lý + biến động hạng (W04 tab Lịch sử). */
  @Get('agents/:id/history')
  @Can('agents.view')
  async history(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.assertScope(actor, id);
    const logs = await this.db.select().from(auditLog).where(eq(auditLog.target, id)).orderBy(desc(auditLog.at)).limit(200);
    const sensitive = /Xem đầy đủ|tài khoản ngân hàng|CCCD/;
    return logs.map((l) => (['BOD', 'KTT', 'KT', 'SA'].includes(actor.role) || !sensitive.test(l.action) ? l : { ...l, oldValue: '—', newValue: '—' }));
  }

  /** Đính kèm giấy tờ đã upload (POST /files) vào hồ sơ đại lý. */
  @Patch('agents/:id/docs')
  @Can('agents.editSensitive', 'agents.propose')
  async attachDoc(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { label: string; fileId: string | null }) {
    await this.assertScope(actor, id);
    const [a] = await this.db.select().from(agents).where(eq(agents.id, id));
    if (!a || !b?.label) throw new BadRequestException('Thiếu thông tin giấy tờ');
    const docFiles = { ...a.docFiles };
    if (b.fileId) docFiles[b.label] = b.fileId; else delete docFiles[b.label];
    await this.db.update(agents).set({ docFiles }).where(eq(agents.id, id));
    await this.audit.log(actor, b.fileId ? 'Tải lên giấy tờ' : 'Gỡ giấy tờ', id, '—', b.label);
    return { docFiles };
  }

  /** Tạm ngưng đại lý: khoá app, chặn đặt hàng, không tích điểm mới. */
  @Post('agents/:id/suspend')
  @Can('agents.suspend')
  async suspend(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { reason: string }) {
    if (!b?.reason?.trim()) throw new BadRequestException('Cần lý do tạm ngưng');
    const [a] = await this.db.select().from(agents).where(eq(agents.id, id));
    if (!a) throw new NotFoundException();
    if (a.status === 'locked') throw new BadRequestException('Đại lý đã tạm ngưng');
    await this.db.update(agents).set({ status: 'locked', suspendReason: b.reason, flags: [...a.flags.filter((f) => !f.startsWith('prev:')), 'prev:' + a.status] }).where(eq(agents.id, id));
    await this.db.update(agentAccounts).set({ active: false }).where(eq(agentAccounts.agentId, id));
    await this.audit.log(actor, 'Tạm ngưng đại lý', id, a.status, 'Tạm ngưng: ' + b.reason);
    await this.crm.emit('agent.suspended', { agentId: id, reason: b.reason });
    return { id, status: 'locked' };
  }

  @Post('agents/:id/reactivate')
  @Can('agents.suspend')
  async reactivate(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const [a] = await this.db.select().from(agents).where(eq(agents.id, id));
    if (!a || a.status !== 'locked') throw new BadRequestException('Đại lý không ở trạng thái tạm ngưng');
    const prev = a.flags.find((f) => f.startsWith('prev:'))?.slice(5) ?? 'ok';
    await this.db.update(agents).set({ status: prev, suspendReason: null, flags: a.flags.filter((f) => !f.startsWith('prev:')) }).where(eq(agents.id, id));
    await this.db.update(agentAccounts).set({ active: true }).where(eq(agentAccounts.agentId, id));
    await this.audit.log(actor, 'Kích hoạt lại đại lý', id, 'Tạm ngưng', prev);
    return { id, status: prev };
  }

  /* ---------- Hồ sơ đại lý mới ---------- */
  @Get('applications')
  @Can('agents.propose', 'agents.approve', 'agents.issueCode')
  async apps(@CurrentActor() actor: Actor) {
    const rows = await this.db.select().from(applications).where(actor.role === 'SALE' ? eq(applications.saleId, actor.id) : undefined).orderBy(desc(applications.createdAt));
    const names = await this.saleNames();
    const seeId = ['BOD', 'KTT', 'KT'].includes(actor.role);
    return rows.map((r) => ({ ...r, saleName: names.get(r.saleId) ?? '', idCard: mask.idCard(r.idCard), docFiles: seeId ? r.docFiles : Object.fromEntries(Object.entries(r.docFiles ?? {}).filter(([k]) => !/CCCD/i.test(k))) }));
  }

  @Post('applications')
  @Can('agents.propose')
  async propose(@CurrentActor() actor: Actor, @Body() b: Partial<typeof applications.$inferInsert>) {
    if (!b.name?.trim() || !b.phone?.trim() || !b.type) throw new BadRequestException('Cần nhập tên, loại hình và SĐT');
    if (!/^0\d{9}$/.test(b.phone)) throw new BadRequestException('SĐT phải có 10 số, bắt đầu bằng 0');
    const dupe = await this.db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.phone, b.phone));
    if (dupe.length) throw new BadRequestException(`SĐT đã thuộc đại lý ${dupe[0].id} — ${dupe[0].name}`);
    const id = await this.seq.next('HS');
    const now = new Date();
    const at = now.toLocaleString('vi-VN');
    await this.db.insert(applications).values({
      id, name: b.name, type: b.type, owner: b.owner ?? '', phone: b.phone, city: b.city ?? '', address: b.address ?? '', taxCode: b.taxCode ?? '', idCard: b.idCard ?? '',
      commitMonth: Number(b.commitMonth) || 0, creditDays: Number(b.creditDays) || 0, policy: b.policy ?? '', referrerId: b.referrerId || null, docs: b.docs ?? Object.keys(b.docFiles ?? {}), docFiles: b.docFiles ?? {},
      stage: 'BOD duyệt', saleId: actor.role === 'SALE' ? actor.id : (b.saleId ?? actor.id), history: [{ stage: 'Sale đề xuất', by: actorLabel(actor), at }], createdAt: now,
    });
    await this.audit.log(actor, 'Đề xuất đại lý mới', id, '—', b.name);
    return { id, stage: 'BOD duyệt' };
  }

  @Post('applications/:id/approve')
  @Can('agents.approve')
  async approveApp(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { note?: string }) {
    const [ap] = await this.db.select().from(applications).where(eq(applications.id, id));
    if (!ap || ap.stage !== 'BOD duyệt') throw new BadRequestException('Hồ sơ không ở bước BOD duyệt');
    await this.db.update(applications).set({ stage: 'KT cấp mã', history: [...ap.history, { stage: 'BOD đã duyệt', by: actorLabel(actor), at: new Date().toLocaleString('vi-VN'), note: b?.note }] }).where(eq(applications.id, id));
    await this.audit.log(actor, 'Duyệt hồ sơ đại lý mới', id);
    return { id, stage: 'KT cấp mã' };
  }

  @Post('applications/:id/reject')
  @Can('agents.approve')
  async rejectApp(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { reason: string }) {
    const [ap] = await this.db.select().from(applications).where(eq(applications.id, id));
    if (!ap || ap.stage !== 'BOD duyệt') throw new BadRequestException('Hồ sơ không ở bước BOD duyệt');
    if (!b?.reason?.trim()) throw new BadRequestException('Cần nhập lý do từ chối');
    await this.db.update(applications).set({ stage: 'Từ chối', reason: b.reason, history: [...ap.history, { stage: 'Từ chối', by: actorLabel(actor), at: new Date().toLocaleString('vi-VN'), note: b.reason }] }).where(eq(applications.id, id));
    await this.audit.log(actor, 'Từ chối hồ sơ đại lý mới', id, '—', b.reason);
    return { id, stage: 'Từ chối' };
  }

  /** KT cấp mã: tạo đại lý + hợp đồng + tài khoản app chủ, gửi ZNS kích hoạt. */
  @Post('applications/:id/issue-code')
  @Can('agents.issueCode')
  async issue(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.db.transaction(async (tx) => {
      const [ap] = await tx.select().from(applications).where(eq(applications.id, id));
      if (!ap || ap.stage !== 'KT cấp mã') throw new BadRequestException('Hồ sơ chưa được BOD duyệt');
      const code = await this.seq.next('DL', 5, tx);
      const contractNo = 'HĐ-2026/' + (await this.seq.next('HD', 3, tx)).slice(2);
      await tx.insert(agents).values({
        id: code, name: ap.name, type: ap.type, owner: ap.owner, phone: ap.phone, idCard: ap.idCard, city: ap.city, address: ap.address, taxCode: ap.taxCode,
        saleId: ap.saleId, tier: 'member', status: 'ok', flags: ['new'], startDate: new Date().toLocaleDateString('vi-VN'), creditDays: ap.creditDays,
        creditLimit: ap.commitMonth * 2, referrerId: ap.referrerId, docFiles: ap.docFiles,
      });
      const end = new Date(); end.setFullYear(end.getFullYear() + 1);
      await tx.insert(contracts).values({ id: contractNo, agentId: code, startDate: new Date().toLocaleDateString('vi-VN'), endDate: end.toLocaleDateString('vi-VN'), commitMonth: ap.commitMonth, policy: ap.policy });
      await tx.insert(agentAccounts).values({ agentId: code, phone: ap.phone, name: ap.owner || ap.name, role: 'DLC' });
      await tx.update(applications).set({ stage: 'Đã kích hoạt', agentId: code, history: [...ap.history, { stage: 'KT đã cấp mã ' + code, by: actorLabel(actor), at: new Date().toLocaleString('vi-VN') }] }).where(eq(applications.id, id));
      await this.zns.send({ agentId: code, phone: ap.phone, template: 'welcome', title: 'Kích hoạt tài khoản', body: `Chào mừng ${ap.name} trở thành đại lý DMP Việt Pháp. Mã đại lý: ${code}. Đăng nhập app bằng SĐT ${ap.phone} để bắt đầu tích điểm.` }, tx);
      await this.audit.log(actor, 'Cấp mã đại lý', code, id, ap.name, tx);
      await this.crm.emit('agent.created', { agentId: code, name: ap.name, phone: ap.phone, saleId: ap.saleId, city: ap.city });
      return { id, agentId: code, stage: 'Đã kích hoạt' };
    });
  }

  @Get('contracts')
  @Can('contracts.view')
  async contracts(@CurrentActor() actor: Actor) {
    const scope = await scopeAgentIds(this.db, actor);
    const rows = await this.db.select({ c: contracts, a: agents }).from(contracts).innerJoin(agents, eq(agents.id, contracts.agentId))
      .where(scope ? inArray(contracts.agentId, scope.length ? scope : ['-']) : undefined);
    const names = await this.saleNames();
    return rows.map(({ c, a }) => ({ ...c, agentName: a.name, tier: a.tier, saleName: names.get(a.saleId) ?? '', salesMonth: a.salesMonth, salesLastMonth: a.salesLastMonth, commitPct: c.commitMonth ? Math.round((a.salesMonth / c.commitMonth) * 100) : 0, status: c.status }));
  }

  @Get('sales')
  async sales() {
    return this.db.select({ id: users.id, name: users.name, status: users.status }).from(users).where(eq(users.role, 'SALE'));
  }

  @Get('agents-lookup')
  async lookup(@CurrentActor() actor: Actor, @Query('q') q = '') {
    const scope = await scopeAgentIds(this.db, actor);
    const rows = await this.db.select({ id: agents.id, name: agents.name, tier: agents.tier }).from(agents).where(scope ? inArray(agents.id, scope.length ? scope : ['-']) : undefined);
    const s = q.toLowerCase();
    return rows.filter((r) => !s || r.id.toLowerCase().includes(s) || r.name.toLowerCase().includes(s)).slice(0, 20);
  }
}
