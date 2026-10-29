import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { fmtNumber, TIER_ORDER, type Campaign, type Tier } from '@dmp/shared';
import { schema, type DB } from '../../db/db';
import { actorLabel, AgentOnly, AuditService, Can, CurrentActor, InjectDb, SeqService, ZnsService, type Actor } from '../../common/core';
import { ApprovalsService } from '../points/approvals.service';
import { PointsService } from '../points/points.service';
import { scopeAgentIds } from '../agents/scope';
import { ZaloCrmClient } from '../integrations/integrations';

const { campaigns, courses, courseAttempts, evidence, complaints, salesDocs, agents, ledger, approvals } = schema;
const nowVN = () => new Date().toLocaleString('vi-VN');

/** Hạng mục bằng chứng app đại lý được nộp (M12) — điểm lấy theo quy tắc R09/R10/R13. */
const EVIDENCE_CATS: Record<string, { name: string; rule: string; needSale: boolean; monthlyCap?: number; perMonth?: number }> = {
  post: { name: 'Đăng bài', rule: 'R09', needSale: false, monthlyCap: 300 },
  display: { name: 'Trưng bày đạt chuẩn', rule: 'R10', needSale: true, perMonth: 1 },
  shop: { name: 'Mở điểm bán mới', rule: 'R13', needSale: true },
};

/** Campaign đang chạy dạng engine (dùng khi tính điểm đơn). */
export async function activeCampaigns(db: DB): Promise<Campaign[]> {
  const rows = await db.select().from(campaigns).where(inArray(campaigns.status, ['Đang chạy', 'Đã duyệt']));
  return rows.map((c) => ({ id: c.id, name: c.name, kind: c.kind as Campaign['kind'], value: c.value, ...c.scope, from: c.fromDate.toISOString(), to: c.toDate.toISOString() }));
}
/** Trạng thái hiển thị theo ngày: Đã duyệt → Đang chạy → Đã kết thúc. */
function liveStatus(c: typeof campaigns.$inferSelect) {
  const now = new Date();
  if (['Đã duyệt', 'Đang chạy'].includes(c.status)) return c.toDate < now ? 'Đã kết thúc' : c.fromDate > now ? 'Đã duyệt' : 'Đang chạy';
  return c.status;
}

@Controller()
export class EngageController {
  constructor(@InjectDb() private db: DB, private seq: SeqService, private approvals: ApprovalsService, private points: PointsService, private audit: AuditService, private zns: ZnsService, private crm: ZaloCrmClient) {}

  /* ================= Campaign (W18) ================= */
  @Get('campaigns')
  @Can('campaigns.view')
  async campaignList() {
    const rows = await this.db.select().from(campaigns).orderBy(desc(campaigns.fromDate));
    return rows.map((c) => ({ ...c, status: liveStatus(c) }));
  }

  @Post('campaigns')
  @Can('campaigns.manage')
  async campaignCreate(@CurrentActor() actor: Actor, @Body() b: { name: string; kind: 'multiplier' | 'bonus'; value: number; scope?: Record<string, any>; from: string; to: string; budget?: number; note?: string }) {
    this.validateCampaign(b);
    const id = await this.seq.next('CP', 2);
    await this.db.insert(campaigns).values({ id, name: b.name, kind: b.kind, value: Number(b.value), scope: b.scope ?? {}, fromDate: new Date(b.from), toDate: new Date(b.to), budget: Number(b.budget) || 0, note: b.note ?? '', createdBy: actorLabel(actor) });
    await this.audit.log(actor, 'Tạo campaign', id, '—', b.name);
    return { id, status: 'Nháp' };
  }

  @Put('campaigns/:id')
  @Can('campaigns.manage')
  async campaignUpdate(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: any) {
    const [c] = await this.db.select().from(campaigns).where(eq(campaigns.id, id));
    if (!c) throw new NotFoundException();
    if (!['Nháp', 'Từ chối'].includes(c.status)) throw new BadRequestException('Chỉ sửa được campaign Nháp hoặc bị từ chối');
    this.validateCampaign({ ...c, from: c.fromDate.toISOString(), to: c.toDate.toISOString(), ...b });
    await this.db.update(campaigns).set({
      ...(b.name ? { name: b.name } : {}), ...(b.kind ? { kind: b.kind } : {}), ...(b.value != null ? { value: Number(b.value) } : {}), ...(b.scope ? { scope: b.scope } : {}),
      ...(b.from ? { fromDate: new Date(b.from) } : {}), ...(b.to ? { toDate: new Date(b.to) } : {}), ...(b.budget != null ? { budget: Number(b.budget) } : {}), ...(b.note != null ? { note: b.note } : {}), status: 'Nháp',
    }).where(eq(campaigns.id, id));
    return { id, status: 'Nháp' };
  }

  @Post('campaigns/:id/submit')
  @Can('campaigns.manage')
  async campaignSubmit(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { reason?: string }) {
    const [c] = await this.db.select().from(campaigns).where(eq(campaigns.id, id));
    if (!c || !['Nháp', 'Từ chối'].includes(c.status)) throw new BadRequestException('Campaign không ở trạng thái Nháp');
    await this.db.update(campaigns).set({ status: 'Chờ BOD duyệt' }).where(eq(campaigns.id, id));
    return this.approvals.create(actor, { kind: 'campaign', title: `Campaign ${id}: ${c.name}`, points: c.budget || null, reason: b?.reason || c.note || 'Đề xuất campaign', payload: { campaignId: id } });
  }

  @Post('campaigns/:id/stop')
  @Can('campaigns.manage', 'rules.view')
  async campaignStop(@CurrentActor() actor: Actor, @Param('id') id: string) {
    if (!['MKT', 'BOD'].includes(actor.role)) throw new ForbiddenException('Chỉ MKT/BOD dừng campaign');
    await this.db.update(campaigns).set({ status: 'Đã kết thúc', toDate: new Date() }).where(eq(campaigns.id, id));
    await this.audit.log(actor, 'Dừng campaign', id);
    return { id, status: 'Đã kết thúc' };
  }

  private validateCampaign(b: any) {
    if (!b.name?.trim()) throw new BadRequestException('Cần tên campaign');
    if (!['multiplier', 'bonus'].includes(b.kind)) throw new BadRequestException('Loại campaign không hợp lệ');
    const v = Number(b.value);
    if (b.kind === 'multiplier' && !(v > 1 && v <= 5)) throw new BadRequestException('Hệ số phải lớn hơn 1 và tối đa ×5');
    if (b.kind === 'bonus' && !(v > 0 && Number.isInteger(v))) throw new BadRequestException('Điểm thưởng phải là số nguyên dương');
    if (!(new Date(b.to) > new Date(b.from))) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
  }

  /* ================= Đào tạo & sự kiện (W19, M13) ================= */
  @Get('courses')
  @Can('training.view')
  async courseList() {
    const rows = await this.db.select().from(courses).orderBy(desc(courses.createdAt));
    const att = await this.db.select().from(courseAttempts);
    return rows.map((c) => {
      const mine = att.filter((a) => a.courseId === c.id);
      const agentsDone = new Set(mine.map((a) => a.agentId));
      const passed = new Set(mine.filter((a) => a.passed).map((a) => a.agentId));
      return { ...c, participants: agentsDone.size, passed: passed.size };
    });
  }

  @Get('courses/:id')
  @Can('training.view')
  async courseDetail(@Param('id') id: string) {
    const [c] = await this.db.select().from(courses).where(eq(courses.id, id));
    if (!c) throw new NotFoundException();
    const att = await this.db.select({ a: courseAttempts, name: agents.name, tier: agents.tier }).from(courseAttempts).innerJoin(agents, eq(agents.id, courseAttempts.agentId)).where(eq(courseAttempts.courseId, id)).orderBy(desc(courseAttempts.createdAt));
    return { ...c, attempts: att.map((x) => ({ ...x.a, agentName: x.name, tier: x.tier })) };
  }

  @Post('courses')
  @Can('training.manage')
  async courseCreate(@CurrentActor() actor: Actor, @Body() b: Partial<typeof courses.$inferInsert>) {
    if (!b.name?.trim() || !b.type) throw new BadRequestException('Cần tên và hình thức');
    this.validateQuiz(b.quiz);
    const id = await this.seq.next(b.type === 'event' ? 'SK' : 'KH', 2);
    await this.db.insert(courses).values({ id, name: b.name, type: b.type, date: b.date ?? '', points: Number(b.points) || 0, rule: b.type === 'event' ? 'R08' : 'R07', content: b.content ?? '', fileId: b.fileId ?? null, quiz: b.quiz ?? [], passPct: Number(b.passPct) || 80, status: b.status ?? 'Đang mở' });
    await this.audit.log(actor, 'Tạo khoá đào tạo / sự kiện', id, '—', b.name);
    return { id };
  }

  @Put('courses/:id')
  @Can('training.manage')
  async courseUpdate(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: Partial<typeof courses.$inferInsert>) {
    const { id: _i, createdAt: _c, ...rest } = b as any;
    this.validateQuiz(rest.quiz);
    const allowed = ['name', 'type', 'date', 'points', 'content', 'fileId', 'quiz', 'passPct', 'status'];
    const set = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)));
    if (set.points != null) set.points = Math.max(0, Math.round(Number(set.points)));
    if (set.passPct != null) set.passPct = Math.min(100, Math.max(1, Math.round(Number(set.passPct))));
    await this.db.update(courses).set(set).where(eq(courses.id, id));
    await this.audit.log(actor, 'Sửa khoá đào tạo / sự kiện', id);
    return { id };
  }

  private validateQuiz(quiz: unknown) {
    if (quiz == null) return;
    if (!Array.isArray(quiz)) throw new BadRequestException('Bài test không hợp lệ');
    quiz.forEach((q: any, i) => {
      if (!q?.q?.trim() || !Array.isArray(q.options) || q.options.length < 2 || q.options.some((o: any) => !String(o ?? '').trim()))
        throw new BadRequestException(`Câu ${i + 1}: cần nội dung và ít nhất 2 đáp án`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) throw new BadRequestException(`Câu ${i + 1}: chưa chọn đáp án đúng`);
    });
  }

  /** Điểm danh offline / QR sự kiện → tạo lô cộng điểm chờ BOD duyệt. */
  @Post('courses/:id/attendance')
  @Can('training.manage')
  async attendance(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { agentIds: string[] }) {
    const [c] = await this.db.select().from(courses).where(eq(courses.id, id));
    if (!c) throw new NotFoundException();
    if (!b?.agentIds?.length) throw new BadRequestException('Chưa chọn đại lý tham dự');
    const existing = new Set((await this.db.select({ agentId: courseAttempts.agentId }).from(courseAttempts).where(and(eq(courseAttempts.courseId, id), eq(courseAttempts.passed, true)))).map((x) => x.agentId));
    const fresh = [...new Set(b.agentIds)].filter((x) => !existing.has(x));
    if (!fresh.length) throw new BadRequestException('Các đại lý này đã được ghi nhận');
    const ap = await this.approvals.create(actor, { kind: fresh.length > 1 ? 'bulk' : 'manual', title: `${c.type === 'event' ? 'Sự kiện' : 'Đào tạo'}: ${c.name}`, agentId: fresh.length > 1 ? null : fresh[0], points: c.points, reason: `Điểm danh ${fresh.length} đại lý`, payload: { agentIds: fresh, rule: c.rule, fund: 'reward', courseId: id, count: fresh.length } });
    await this.db.insert(courseAttempts).values(fresh.map((agentId) => ({ courseId: id, agentId, passed: true, method: c.type === 'event' ? 'qr' : 'attendance', approvalId: ap.id })));
    return { approvalId: ap.id, count: fresh.length };
  }

  @Get('app/courses')
  @AgentOnly()
  async appCourses(@CurrentActor() actor: Actor) {
    const rows = await this.db.select().from(courses).where(inArray(courses.status, ['Đang mở', 'Đã diễn ra'])).orderBy(desc(courses.createdAt));
    const mine = await this.db.select().from(courseAttempts).where(eq(courseAttempts.agentId, actor.agentId!));
    return rows.map(({ quiz, ...c }) => {
      const att = mine.filter((a) => a.courseId === c.id);
      const best = att.sort((x, y) => y.score - x.score)[0];
      return { ...c, questions: quiz.length, attempts: att.length, passed: att.some((a) => a.passed), bestScore: best ? `${best.score}/${best.total}` : null, certificateAt: att.find((a) => a.passed)?.createdAt ?? null };
    });
  }

  /** Câu hỏi quiz (không kèm đáp án). */
  @Get('app/courses/:id')
  @AgentOnly()
  async appCourse(@Param('id') id: string) {
    const [c] = await this.db.select().from(courses).where(eq(courses.id, id));
    if (!c) throw new NotFoundException();
    return { ...c, quiz: c.quiz.map((q) => ({ q: q.q, options: q.options })) };
  }

  /** Nộp bài: đạt ≥ passPct → tạo yêu cầu cộng điểm R07 (cần duyệt). Mỗi khoá chỉ cộng điểm một lần. */
  @Post('app/courses/:id/attempt')
  @AgentOnly()
  async attempt(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { answers: number[] }) {
    const [c] = await this.db.select().from(courses).where(eq(courses.id, id));
    if (!c || !c.quiz.length) throw new BadRequestException('Khoá này không có bài kiểm tra');
    if (c.status !== 'Đang mở') throw new BadRequestException('Khoá học đã đóng');
    const total = c.quiz.length;
    const score = c.quiz.reduce((t, q, i) => t + (b?.answers?.[i] === q.answer ? 1 : 0), 0);
    const passed = score / total * 100 >= c.passPct;
    const already = await this.db.select().from(courseAttempts).where(and(eq(courseAttempts.courseId, id), eq(courseAttempts.agentId, actor.agentId!), eq(courseAttempts.passed, true)));
    let approvalId: string | null = null;
    if (passed && !already.length && c.points) {
      const [a] = await this.db.select().from(agents).where(eq(agents.id, actor.agentId!));
      const ap = await this.approvals.create({ kind: 'user', id: 'system', name: 'Hệ thống (bài test)', role: 'SA' }, { kind: 'manual', agentId: a.id, title: `Đào tạo online: ${c.name}`, points: c.points, reason: `Đạt bài test ${score}/${total}`, payload: { agentIds: [a.id], rule: c.rule, fund: 'reward', courseId: id } });
      approvalId = ap.id;
    }
    await this.db.insert(courseAttempts).values({ courseId: id, agentId: actor.agentId!, score, total, passed, method: 'quiz', approvalId });
    return { score, total, passed, passPct: c.passPct, pointsPending: approvalId ? c.points : 0, alreadyAwarded: passed && already.length > 0 };
  }

  /* ================= Bằng chứng hoạt động (M12) ================= */
  @Get('app/evidence')
  @AgentOnly()
  async myEvidence(@CurrentActor() actor: Actor) {
    const { params } = await this.points.activeRules();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const rows = await this.db.select().from(evidence).where(eq(evidence.agentId, actor.agentId!)).orderBy(desc(evidence.createdAt));
    const cats = Object.entries(EVIDENCE_CATS).map(([key, c]) => {
      const rule = params.rules.find((r) => r.id === c.rule);
      const used = rows.filter((e) => e.category === key && e.createdAt >= monthStart && e.stage !== 'Từ chối');
      return { key, name: c.name, points: rule?.points ?? 0, cap: rule?.cap ?? '—', needSale: c.needSale, usedThisMonth: used.reduce((t, e) => t + e.points, 0), countThisMonth: used.length, monthlyCap: c.monthlyCap ?? null, perMonth: c.perMonth ?? null };
    });
    return { categories: cats, items: rows };
  }

  @Post('app/evidence')
  @AgentOnly()
  async submitEvidence(@CurrentActor() actor: Actor, @Body() b: { category: string; link?: string; fileIds?: string[]; note?: string }) {
    const cat = EVIDENCE_CATS[b?.category];
    if (!cat) throw new BadRequestException('Hạng mục không hợp lệ');
    if (b.category === 'post' && !/^https?:\/\//.test(b.link ?? '')) throw new BadRequestException('Cần link bài đăng (bắt đầu bằng http)');
    if (b.category !== 'post' && !b.fileIds?.length) throw new BadRequestException('Cần ít nhất một ảnh');
    const { params } = await this.points.activeRules();
    const pts = params.rules.find((r) => r.id === cat.rule)?.points ?? 0;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const used = await this.db.select().from(evidence).where(and(eq(evidence.agentId, actor.agentId!), eq(evidence.category, b.category), gte(evidence.createdAt, monthStart)));
    const live = used.filter((e) => e.stage !== 'Từ chối');
    if (cat.monthlyCap && live.reduce((t, e) => t + e.points, 0) + pts > cat.monthlyCap) throw new BadRequestException(`Đã đạt trần ${fmtNumber(cat.monthlyCap)} điểm/tháng cho hạng mục ${cat.name}`);
    if (cat.perMonth && live.length >= cat.perMonth) throw new BadRequestException(`Hạng mục ${cat.name} chỉ nộp ${cat.perMonth} lần/tháng`);
    const id = await this.seq.next('BC', 4);
    const [a] = await this.db.select().from(agents).where(eq(agents.id, actor.agentId!));
    const stage = cat.needSale ? 'Chờ Sale xác nhận' : 'Chờ Marketing duyệt';
    let approvalId: string | null = null;
    if (!cat.needSale) approvalId = (await this.approvals.create(actor, { kind: 'evidence', agentId: a.id, title: `${cat.name}`, points: pts, reason: b.note || b.link || '', files: b.fileIds?.length ?? 0, payload: { evidenceId: id, rule: cat.rule, fund: 'reward' } })).id;
    await this.db.insert(evidence).values({ id, agentId: a.id, category: b.category, points: pts, link: b.link ?? '', fileIds: b.fileIds ?? [], note: b.note ?? '', stage, approvalId, history: [{ stage: 'Đã nộp', by: actorLabel(actor), at: nowVN() }] });
    return { id, stage, points: pts };
  }

  @Get('evidence')
  @Can('evidence.confirm', 'approvals.view')
  async evidenceList(@CurrentActor() actor: Actor) {
    const scope = await scopeAgentIds(this.db, actor);
    const rows = await this.db.select({ e: evidence, name: agents.name, tier: agents.tier }).from(evidence).innerJoin(agents, eq(agents.id, evidence.agentId)).where(scope ? inArray(evidence.agentId, scope.length ? scope : ['-']) : undefined).orderBy(desc(evidence.createdAt));
    return rows.map((x) => ({ ...x.e, agentName: x.name, tier: x.tier, categoryName: EVIDENCE_CATS[x.e.category]?.name ?? x.e.category }));
  }

  /** Sale xác nhận tại điểm bán (trưng bày, điểm bán mới) → chuyển Marketing duyệt. */
  @Post('evidence/:id/confirm')
  @Can('evidence.confirm')
  async confirmEvidence(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { ok: boolean; note?: string }) {
    const [e] = await this.db.select().from(evidence).where(eq(evidence.id, id));
    if (!e || e.stage !== 'Chờ Sale xác nhận') throw new BadRequestException('Bằng chứng không ở bước chờ Sale');
    const scope = await scopeAgentIds(this.db, actor);
    if (scope && !scope.includes(e.agentId)) throw new ForbiddenException('Đại lý không thuộc phạm vi phụ trách');
    const cat = EVIDENCE_CATS[e.category];
    if (!b?.ok) {
      if (!b?.note?.trim()) throw new BadRequestException('Cần lý do không xác nhận');
      await this.db.update(evidence).set({ stage: 'Từ chối', history: [...e.history, { stage: 'Sale không xác nhận', by: actorLabel(actor), at: nowVN(), note: b.note }] }).where(eq(evidence.id, id));
      return { id, stage: 'Từ chối' };
    }
    const ap = await this.approvals.create(actor, { kind: 'evidence', agentId: e.agentId, title: cat.name, points: e.points, reason: (b.note ? b.note + ' · ' : '') + 'Sale đã xác nhận tại điểm bán', files: e.fileIds.length, payload: { evidenceId: id, rule: cat.rule, fund: 'reward' } });
    await this.db.update(evidence).set({ stage: 'Chờ Marketing duyệt', approvalId: ap.id, history: [...e.history, { stage: 'Sale đã xác nhận', by: actorLabel(actor), at: nowVN(), note: b.note }] }).where(eq(evidence.id, id));
    return { id, stage: 'Chờ Marketing duyệt', approvalId: ap.id };
  }

  /* ================= Khiếu nại điểm (W21, M15) — SLA 3 ngày ================= */
  @Get('app/complaints')
  @AgentOnly()
  async myComplaints(@CurrentActor() actor: Actor) {
    return this.db.select().from(complaints).where(eq(complaints.agentId, actor.agentId!)).orderBy(desc(complaints.createdAt));
  }

  @Post('app/complaints')
  @AgentOnly()
  async complain(@CurrentActor() actor: Actor, @Body() b: { ledgerId?: number; claim: string; wantPoints?: number; fileIds?: string[] }) {
    if (!b?.claim?.trim() || b.claim.trim().length < 10) throw new BadRequestException('Vui lòng mô tả rõ nội dung (ít nhất 10 ký tự)');
    let txLabel = '', ref = '';
    if (b.ledgerId) {
      const [l] = await this.db.select().from(ledger).where(and(eq(ledger.id, Number(b.ledgerId)), eq(ledger.agentId, actor.agentId!)));
      if (!l) throw new BadRequestException('Không tìm thấy giao dịch');
      txLabel = `GD${l.id} · ${l.item}`; ref = l.ref;
      const open = await this.db.select().from(complaints).where(and(eq(complaints.ledgerId, l.id), inArray(complaints.status, ['Mới', 'Đang xử lý', 'Chờ duyệt điều chỉnh'])));
      if (open.length) throw new BadRequestException(`Giao dịch này đang có khiếu nại ${open[0].id}`);
    }
    const id = await this.seq.next('KN', 4);
    const [a] = await this.db.select().from(agents).where(eq(agents.id, actor.agentId!));
    await this.db.insert(complaints).values({ id, agentId: a.id, ledgerId: b.ledgerId ? Number(b.ledgerId) : null, ref, txLabel, claim: b.claim.trim(), wantPoints: Math.round(Number(b.wantPoints) || 0), fileIds: b.fileIds ?? [], dueAt: new Date(Date.now() + 3 * 86400e3), history: [{ stage: 'Mới', by: actorLabel(actor), at: nowVN() }] });
    await this.zns.send({ agentId: a.id, phone: a.phone, template: 'complaint', channel: 'App', title: 'Đã nhận khiếu nại', body: `DMP Việt Pháp đã nhận khiếu nại ${id}. Kế toán sẽ phản hồi trong 3 ngày làm việc.` });
    await this.crm.emit('complaint.created', { id, agentId: a.id, claim: b.claim });
    return { id, status: 'Mới' };
  }

  @Get('complaints')
  @Can('complaints.view')
  async complaintList(@CurrentActor() actor: Actor) {
    const scope = await scopeAgentIds(this.db, actor);
    const rows = await this.db.select({ c: complaints, name: agents.name, tier: agents.tier, phone: agents.phone }).from(complaints).innerJoin(agents, eq(agents.id, complaints.agentId)).where(scope ? inArray(complaints.agentId, scope.length ? scope : ['-']) : undefined).orderBy(desc(complaints.createdAt));
    const now = Date.now();
    return rows.map((x) => ({ ...x.c, agentName: x.name, tier: x.tier, overdue: ['Mới', 'Đang xử lý'].includes(x.c.status) && +x.c.dueAt < now }));
  }

  @Post('complaints/:id/take')
  @Can('complaints.resolve')
  async take(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const [c] = await this.db.select().from(complaints).where(eq(complaints.id, id));
    if (!c || c.status !== 'Mới') throw new BadRequestException('Khiếu nại không ở trạng thái Mới');
    await this.db.update(complaints).set({ status: 'Đang xử lý', assignee: actorLabel(actor), history: [...c.history, { stage: 'Đang xử lý', by: actorLabel(actor), at: nowVN() }] }).where(eq(complaints.id, id));
    return { id, status: 'Đang xử lý' };
  }

  /** Chấp nhận → tạo yêu cầu điều chỉnh điểm (BOD duyệt); từ chối → đóng kèm giải thích. */
  @Post('complaints/:id/resolve')
  @Can('complaints.resolve')
  async resolve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() b: { accept: boolean; points?: number; note: string }) {
    const [c] = await this.db.select().from(complaints).where(eq(complaints.id, id));
    if (!c || !['Mới', 'Đang xử lý'].includes(c.status)) throw new BadRequestException('Khiếu nại đã được xử lý');
    if (!b?.note?.trim()) throw new BadRequestException('Cần nội dung phản hồi cho đại lý');
    const [a] = await this.db.select().from(agents).where(eq(agents.id, c.agentId));
    if (!b.accept) {
      await this.db.update(complaints).set({ status: 'Từ chối', resolution: b.note, assignee: c.assignee ?? actorLabel(actor), history: [...c.history, { stage: 'Từ chối', by: actorLabel(actor), at: nowVN(), note: b.note }] }).where(eq(complaints.id, id));
      await this.zns.send({ agentId: a.id, phone: a.phone, template: 'complaint', channel: 'App', title: 'Kết quả khiếu nại', body: `Khiếu nại ${id}: ${b.note}` });
      return { id, status: 'Từ chối' };
    }
    const pts = Math.round(Number(b.points ?? c.wantPoints));
    if (!pts) throw new BadRequestException('Cần số điểm điều chỉnh');
    const ap = await this.approvals.create(actor, { kind: 'adjust', agentId: a.id, title: `Điều chỉnh theo khiếu nại ${id}`, points: pts, reason: b.note, payload: { agentIds: [a.id], fund: 'reward', complaintId: id } });
    await this.db.update(complaints).set({ status: 'Chờ duyệt điều chỉnh', approvalId: ap.id, resolution: b.note, assignee: c.assignee ?? actorLabel(actor), history: [...c.history, { stage: 'Đề xuất điều chỉnh ' + (pts > 0 ? '+' : '') + fmtNumber(pts), by: actorLabel(actor), at: nowVN(), note: b.note }] }).where(eq(complaints.id, id));
    return { id, status: 'Chờ duyệt điều chỉnh', approvalId: ap.id };
  }

  /* ================= Tài liệu bán hàng (M16) ================= */
  @Get('saleskit')
  @Can('training.view', 'saleskit.manage')
  async kitList() { return this.db.select().from(salesDocs).orderBy(desc(salesDocs.createdAt)); }

  @Post('saleskit')
  @Can('saleskit.manage')
  async kitCreate(@CurrentActor() actor: Actor, @Body() b: Partial<typeof salesDocs.$inferInsert>) {
    if (!b.title?.trim() || !b.category) throw new BadRequestException('Cần tiêu đề và nhóm tài liệu');
    if (!b.fileId && !b.url) throw new BadRequestException('Cần file hoặc đường dẫn');
    const id = await this.seq.next('TL', 3);
    await this.db.insert(salesDocs).values({ id, title: b.title, category: b.category, kind: b.kind ?? 'file', sizeLabel: b.sizeLabel ?? '', fileId: b.fileId ?? null, url: b.url ?? '', minTier: b.minTier || null });
    await this.audit.log(actor, 'Thêm tài liệu bán hàng', id, '—', b.title);
    return { id };
  }

  @Delete('saleskit/:id')
  @Can('saleskit.manage')
  async kitDelete(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.db.delete(salesDocs).where(eq(salesDocs.id, id));
    await this.audit.log(actor, 'Gỡ tài liệu bán hàng', id);
    return { ok: true };
  }

  @Get('app/saleskit')
  @AgentOnly()
  async appKit(@CurrentActor() actor: Actor) {
    const [a] = await this.db.select({ tier: agents.tier }).from(agents).where(eq(agents.id, actor.agentId!));
    const rows = await this.db.select().from(salesDocs).orderBy(desc(salesDocs.createdAt));
    return rows.map((d) => ({ ...d, locked: !!d.minTier && TIER_ORDER.indexOf(a.tier as Tier) < TIER_ORDER.indexOf(d.minTier as Tier) }));
  }

  @Post('app/saleskit/:id/download')
  @AgentOnly()
  async kitDownload(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const [d] = await this.db.select().from(salesDocs).where(eq(salesDocs.id, id));
    if (!d) throw new NotFoundException();
    const [a] = await this.db.select({ tier: agents.tier }).from(agents).where(eq(agents.id, actor.agentId!));
    if (d.minTier && TIER_ORDER.indexOf(a.tier as Tier) < TIER_ORDER.indexOf(d.minTier as Tier)) throw new ForbiddenException('Tài liệu dành cho hạng cao hơn');
    await this.db.update(salesDocs).set({ downloads: sql`${salesDocs.downloads} + 1` }).where(eq(salesDocs.id, id));
    return { url: d.fileId ? `/api/files/${d.fileId}` : d.url };
  }

  /* ================= Bảng xếp hạng (M14) ================= */
  /** Xếp theo doanh số tháng hoặc điểm hạng, trong cùng loại hình hoặc tỉnh. Tên đại lý khác được che một phần. */
  @Get('app/leaderboard')
  @AgentOnly()
  async leaderboard(@CurrentActor() actor: Actor, @Query('metric') metric = 'sales', @Query('scope') scope = 'type') {
    const all = await this.db.select().from(agents);
    const me = all.find((a) => a.id === actor.agentId)!;
    const pool = all.filter((a) => a.status !== 'locked' && (scope === 'all' || (scope === 'city' ? a.city === me.city : a.type === me.type)));
    const val = (a: typeof me) => (metric === 'points' ? a.rankPoints : a.salesMonth);
    const sorted = pool.sort((x, y) => val(y) - val(x));
    const maskName = (n: string) => n.split(' ').map((w, i, arr) => (i < arr.length - 1 ? w : w[0] + '***')).join(' ');
    const row = (a: typeof me, i: number) => ({ rank: i + 1, id: a.id === me.id ? a.id : null, name: a.id === me.id ? a.name : maskName(a.name), tier: a.tier, city: a.city, value: val(a), me: a.id === me.id });
    const myRank = sorted.findIndex((a) => a.id === me.id);
    const prev = myRank > 0 ? val(sorted[myRank - 1]) - val(me) : 0;
    return { metric, scope, scopeLabel: scope === 'all' ? 'Toàn quốc' : scope === 'city' ? me.city : me.type, total: sorted.length, top: sorted.slice(0, 20).map(row), me: row(me, myRank), gapToNext: prev };
  }
}
