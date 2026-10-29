import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { can, FUND_LABEL, TIER_NAME, type Fund, type Permission, type Tier } from '@dmp/shared';
import { schema, type DB } from '../../db/db';
import { AuditService, CurrentActor, InjectDb, type Actor } from '../../common/core';
import { scopeAgentIds } from '../agents/scope';

const UPLOAD_DIR = () => process.env.UPLOAD_DIR ?? path.resolve(__dirname, '../../../.data/uploads');
const MAX = 15 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpe?g|webp|heic)|application\/pdf|video\/mp4|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document|presentationml\.presentation)|text\/csv)$/;

/** Upload & tải file. Link tải dùng `?t=<token>` (ảnh/PDF mở trực tiếp trong trình duyệt). Id ngẫu nhiên 24 hex. */
@Controller()
export class FilesController {
  constructor(@InjectDb() private db: DB, private audit: AuditService) {}

  @Post('files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX } }))
  async upload(@CurrentActor() actor: Actor, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Chưa chọn file');
    if (!ALLOWED.test(file.mimetype)) throw new BadRequestException('Chỉ nhận ảnh, PDF, MP4, Excel/Word/PowerPoint hoặc CSV');
    const id = crypto.randomBytes(12).toString('hex');
    const dir = UPLOAD_DIR();
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, id);
    fs.writeFileSync(p, file.buffer);
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    await this.db.insert(schema.files).values({ id, name, mime: file.mimetype, size: file.size, path: p, owner: actor.kind === 'agent' ? actor.agentId! : actor.id });
    return { id, name, mime: file.mimetype, size: file.size };
  }

  @Get('files/:id')
  async download(@CurrentActor() actor: Actor, @Param('id') id: string, @Res() res: Response) {
    const [f] = await this.db.select().from(schema.files).where(eq(schema.files.id, id));
    if (!f || !fs.existsSync(f.path)) throw new NotFoundException('Không tìm thấy file');
    // Đại lý chỉ mở file của mình hoặc tài liệu bán hàng
    if (actor.kind === 'agent' && f.owner !== actor.agentId) {
      const [doc] = await this.db.select({ id: schema.salesDocs.id }).from(schema.salesDocs).where(eq(schema.salesDocs.fileId, id));
      const [course] = await this.db.select({ id: schema.courses.id }).from(schema.courses).where(eq(schema.courses.fileId, id));
      const [gift] = await this.db.select({ id: schema.gifts.id }).from(schema.gifts).where(eq(schema.gifts.imageFileId, id));
      if (!doc && !course && !gift) throw new NotFoundException('Không tìm thấy file');
    }
    // File CCCD trong hồ sơ đại lý / hồ sơ đề xuất: chỉ BOD, KTT, KT
    if (actor.kind === 'user' && !['BOD', 'KTT', 'KT'].includes(actor.role)) {
      const like = `%${id}%`;
      const holders = [
        ...(await this.db.select({ d: schema.agents.docFiles }).from(schema.agents).where(sql`${schema.agents.docFiles}::text like ${like}`)),
        ...(await this.db.select({ d: schema.applications.docFiles }).from(schema.applications).where(sql`${schema.applications.docFiles}::text like ${like}`)),
      ];
      if (holders.some((h) => Object.entries(h.d ?? {}).some(([k, v]) => v === id && /CCCD/i.test(k)))) throw new NotFoundException('Không tìm thấy file');
    }
    res.setHeader('content-type', f.mime);
    res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    fs.createReadStream(f.path).pipe(res);
  }

  /** Xuất Excel phía server — mỗi lần xuất ghi audit log (mục 4.4). */
  @Get('export/:kind')
  async export(@CurrentActor() actor: Actor, @Param('kind') kind: string, @Res() res: Response) {
    const perm: Record<string, Permission> = { agents: 'export.excel', orders: 'export.excel', ledger: 'ledger.view', audit: 'audit.view', redemptions: 'redemptions.view', contracts: 'export.excel', debt: 'export.excel' };
    if (!perm[kind]) throw new NotFoundException('Loại báo cáo không hỗ trợ');
    if (actor.kind !== 'user' || !can(actor.role, perm[kind])) {
      throw new BadRequestException('Vai trò của bạn không được xuất dữ liệu này');
    }
    const scope = await scopeAgentIds(this.db, actor);
    const inScope = (col: any) => (scope ? inArray(col, scope.length ? scope : ['-']) : undefined);
    const S = schema;
    let title = '', cols: Array<{ header: string; key: string; width?: number; numFmt?: string }> = [], rows: any[] = [];
    if (kind === 'agents' || kind === 'debt') {
      const list = await this.db.select().from(S.agents).where(inScope(S.agents.id)).orderBy(S.agents.id);
      const us = new Map((await this.db.select().from(S.users)).map((u) => [u.id, u.name]));
      title = kind === 'agents' ? 'Danh sách đại lý' : 'Công nợ đại lý';
      cols = [{ header: 'Mã', key: 'id', width: 10 }, { header: 'Tên đại lý', key: 'name', width: 34 }, { header: 'Loại', key: 'type' }, { header: 'Hạng', key: 'tier' }, { header: 'Tỉnh/thành', key: 'city' }, { header: 'Sale', key: 'sale', width: 18 },
        { header: 'Điểm hạng', key: 'rank', numFmt: '#,##0' }, { header: 'Điểm thưởng', key: 'reward', numFmt: '#,##0' }, { header: 'Doanh số tháng', key: 'sales', width: 16, numFmt: '#,##0' }, { header: 'Công nợ', key: 'debt', width: 16, numFmt: '#,##0' }, { header: 'Quá hạn (ngày)', key: 'overdue' }];
      rows = list.filter((a) => kind === 'agents' || a.debt > 0).map((a) => ({ id: a.id, name: a.name, type: a.type, tier: TIER_NAME[a.tier as Tier], city: a.city, sale: us.get(a.saleId), rank: a.rankPoints, reward: a.rewardPoints, sales: a.salesMonth, debt: can(actor.role, 'debt.view') ? a.debt : null, overdue: a.overdueDays }));
    } else if (kind === 'orders') {
      const list = await this.db.select({ o: S.orders, name: S.agents.name }).from(S.orders).innerJoin(S.agents, eq(S.agents.id, S.orders.agentId)).where(inScope(S.orders.agentId)).orderBy(desc(S.orders.orderedAt));
      title = 'Đơn hàng';
      cols = [{ header: 'Mã đơn', key: 'id' }, { header: 'Ngày', key: 'at', width: 18 }, { header: 'Đại lý', key: 'agent', width: 34 }, { header: 'Nguồn', key: 'source' }, { header: 'Trạng thái', key: 'status', width: 16 }, { header: 'Thanh toán', key: 'pay', width: 18 }, { header: 'Giá trị', key: 'value', width: 16, numFmt: '#,##0' }, { header: 'Điểm', key: 'points', numFmt: '#,##0' }, { header: 'Trạng thái điểm', key: 'ps' }];
      rows = list.map(({ o, name }) => ({ id: o.id, at: o.orderedAt, agent: `${o.agentId} · ${name}`, source: o.source, status: o.status, pay: o.pay, value: o.value, points: o.points, ps: o.pointState }));
    } else if (kind === 'ledger') {
      const list = await this.db.select({ l: S.ledger, name: S.agents.name }).from(S.ledger).innerJoin(S.agents, eq(S.agents.id, S.ledger.agentId)).orderBy(desc(S.ledger.createdAt)).limit(20000);
      title = 'Sổ cái điểm';
      cols = [{ header: 'Mã GD', key: 'id' }, { header: 'Thời gian', key: 'at', width: 18 }, { header: 'Kỳ', key: 'period' }, { header: 'Đại lý', key: 'agent', width: 34 }, { header: 'Nội dung', key: 'item', width: 40 }, { header: 'Quỹ', key: 'fund', width: 12 }, { header: 'Điểm hạng', key: 'dr', numFmt: '#,##0' }, { header: 'Điểm thưởng', key: 'dw', numFmt: '#,##0' }, { header: 'Trạng thái', key: 'state' }, { header: 'Chứng từ', key: 'ref' }, { header: 'Quy tắc', key: 'rule' }, { header: 'Người thực hiện', key: 'by', width: 30 }];
      rows = list.map(({ l, name }) => ({ id: 'GD' + l.id, at: l.createdAt, period: l.period, agent: `${l.agentId} · ${name}`, item: l.item, fund: FUND_LABEL[l.fund as Fund], dr: l.deltaRank, dw: l.deltaReward, state: l.state, ref: l.ref, rule: l.rule, by: l.byUser }));
    } else if (kind === 'audit') {
      const list = await this.db.select().from(S.auditLog).orderBy(desc(S.auditLog.at)).limit(20000);
      title = 'Nhật ký thao tác';
      cols = [{ header: 'Thời gian', key: 'at', width: 18 }, { header: 'Người dùng', key: 'user', width: 22 }, { header: 'Vai trò', key: 'role' }, { header: 'Thao tác', key: 'action', width: 34 }, { header: 'Đối tượng', key: 'target', width: 16 }, { header: 'Giá trị cũ', key: 'old', width: 16 }, { header: 'Giá trị mới', key: 'next', width: 16 }, { header: 'IP', key: 'ip', width: 16 }];
      rows = list.map((a) => ({ at: a.at, user: a.userName, role: a.role, action: a.action, target: a.target, old: a.oldValue, next: a.newValue, ip: a.ip }));
    } else if (kind === 'redemptions') {
      const list = await this.db.select({ r: S.redemptions, name: S.agents.name }).from(S.redemptions).innerJoin(S.agents, eq(S.agents.id, S.redemptions.agentId)).where(inScope(S.redemptions.agentId)).orderBy(desc(S.redemptions.createdAt));
      title = 'Yêu cầu đổi quà';
      cols = [{ header: 'Mã', key: 'id' }, { header: 'Ngày', key: 'at', width: 18 }, { header: 'Đại lý', key: 'agent', width: 34 }, { header: 'Quà', key: 'gift', width: 34 }, { header: 'SL', key: 'qty' }, { header: 'Điểm', key: 'points', numFmt: '#,##0' }, { header: 'Bước', key: 'stage' }];
      rows = list.map(({ r, name }) => ({ id: r.id, at: r.createdAt, agent: `${r.agentId} · ${name}`, gift: r.giftName, qty: r.qty, points: r.points, stage: r.stage }));
    } else if (kind === 'contracts') {
      const list = await this.db.select({ c: S.contracts, a: S.agents }).from(S.contracts).innerJoin(S.agents, eq(S.agents.id, S.contracts.agentId)).where(inScope(S.contracts.agentId));
      title = 'Hợp đồng & cam kết';
      cols = [{ header: 'Số HĐ', key: 'id', width: 16 }, { header: 'Đại lý', key: 'agent', width: 34 }, { header: 'Hiệu lực', key: 'from' }, { header: 'Hết hạn', key: 'to' }, { header: 'Cam kết/tháng', key: 'commit', width: 16, numFmt: '#,##0' }, { header: 'Thực tế tháng', key: 'actual', width: 16, numFmt: '#,##0' }, { header: '% đạt', key: 'pct' }, { header: 'Trạng thái', key: 'status' }];
      rows = list.map(({ c, a }) => ({ id: c.id, agent: `${a.id} · ${a.name}`, from: c.startDate, to: c.endDate, commit: c.commitMonth, actual: a.salesMonth, pct: c.commitMonth ? Math.round((a.salesMonth / c.commitMonth) * 100) + '%' : '', status: c.status }));
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DMP Việt Pháp';
    const ws = wb.addWorksheet(title.slice(0, 31));
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 12, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5394' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    rows.forEach((r) => ws.addRow(r));
    await this.audit.log(actor, 'Xuất Excel ' + title.toLowerCase(), 'export/' + kind, '—', `${rows.length} dòng`);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`DMP_${title}_${stamp}.xlsx`)}`);
    await wb.xlsx.write(res);
    res.end();
  }
}
