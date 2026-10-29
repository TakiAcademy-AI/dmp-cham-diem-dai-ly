import {
  CanActivate, ExecutionContext, ForbiddenException, Global, Inject, Injectable, Module, SetMetadata, UnauthorizedException, createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { eq, sql } from 'drizzle-orm';
import { can, ROLE_LABEL, type Permission, type Role } from '@dmp/shared';
import { createDb, schema, type DB, type Tx } from '../db/db';
import { resetAndSeed } from '../db/seed';
import { KiotVietClient, ZaloCrmClient, ZaloZnsClient } from '../modules/integrations/integrations';

export const DB_TOKEN = 'DB';
export const InjectDb = () => Inject(DB_TOKEN);

/** Người đang gọi API. Nội bộ: kind=user; đại lý: kind=agent kèm agentId. */
export interface Actor {
  kind: 'user' | 'agent';
  id: string;
  name: string;
  role: Role;
  agentId?: string;
  ip?: string;
}
const ROLE_TAG: Record<Role, string> = { SA: 'SA', BOD: 'BOD', KTT: 'KTT', KT: 'KT', TPKD: 'TPKD', SALE: 'Sale', MKT: 'MKT', KHO: 'Kho', DLC: 'ĐL-C', DLNV: 'ĐL-NV' };
/** "Phạm Thị Lan (KT)" — cách ghi người thao tác trên sổ cái và lịch sử duyệt. */
export const actorLabel = (a: Actor) => `${a.name} (${ROLE_TAG[a.role]})`;

const SECRET = () => process.env.JWT_SECRET || 'dmp-dev-secret-change-me';
export function signToken(a: Actor, ttl = '12h') {
  return jwt.sign({ kind: a.kind, id: a.id, name: a.name, role: a.role, agentId: a.agentId }, SECRET(), { expiresIn: ttl } as jwt.SignOptions);
}
export function verifyToken(token: string): Actor {
  return jwt.verify(token, SECRET()) as Actor;
}

/* ---------- Decorators ---------- */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const PERM = 'perm';
/** Yêu cầu một trong các quyền (theo ma trận 4.2). */
export const Can = (...perms: Permission[]) => SetMetadata(PERM, perms);
export const AGENT_ONLY = 'agentOnly';
/** Endpoint chỉ cho tài khoản app đại lý. */
export const AgentOnly = () => SetMetadata(AGENT_ONLY, true);
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers.authorization || '';
    // Link tải file/Excel không gửi được header → cho phép ?t=<token> với GET
    const raw = h.startsWith('Bearer ') ? h.slice(7) : req.method === 'GET' && typeof req.query?.t === 'string' ? req.query.t : '';
    if (!raw) throw new UnauthorizedException('Chưa đăng nhập');
    let actor: Actor;
    try { actor = verifyToken(raw); } catch { throw new UnauthorizedException('Phiên đăng nhập đã hết hạn'); }
    actor.ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || '';
    req.actor = actor;
    const agentOnly = this.reflector.getAllAndOverride<boolean>(AGENT_ONLY, targets);
    if (agentOnly && actor.kind !== 'agent') throw new ForbiddenException('Chỉ dành cho tài khoản đại lý');
    if (!agentOnly && actor.kind === 'agent') {
      // Đại lý không dùng API quản trị, trừ các endpoint chung không gắn quyền
      const perms = this.reflector.getAllAndOverride<Permission[]>(PERM, targets);
      if (perms?.length) throw new ForbiddenException('Đại lý không có quyền vào chức năng này');
    }
    const perms = this.reflector.getAllAndOverride<Permission[]>(PERM, targets);
    if (perms?.length && !perms.some((p) => can(actor.role, p))) {
      throw new ForbiddenException(`Vai trò ${ROLE_LABEL[actor.role]} không có quyền thực hiện thao tác này`);
    }
    return true;
  }
}

/* ---------- Dịch vụ dùng chung ---------- */
@Injectable()
export class AuditService {
  constructor(@InjectDb() private db: DB) {}
  async log(actor: Actor, action: string, target: string, oldValue = '—', newValue = '—', tx?: Tx) {
    await (tx ?? this.db).insert(schema.auditLog).values({ userName: actor.name, role: actor.role, action, target, oldValue, newValue, ip: actor.ip ?? '' });
  }
}

@Injectable()
export class SeqService {
  constructor(@InjectDb() private db: DB) {}
  /** Sinh mã tăng dần: DH1101, DQ0053, YC0232... */
  async next(key: string, width = 4, tx?: Tx): Promise<string> {
    const d = tx ?? this.db;
    const rows = await d.execute(sql`UPDATE counters SET value = value + 1 WHERE key = ${key} RETURNING value`);
    let v: number;
    const r = (rows as any).rows ?? rows;
    if (r.length) v = Number(r[0].value);
    else { await d.insert(schema.counters).values({ key, value: 1 }); v = 1; }
    return key + String(v).padStart(width, '0');
  }
}

/**
 * Gửi thông báo: luôn ghi hộp thư (app đại lý đọc từ đây); kênh ZNS gọi cổng Zalo khi đã cấu hình template,
 * chưa cấu hình thì trạng thái "Giả lập".
 */
@Injectable()
export class ZnsService {
  constructor(@InjectDb() private db: DB, private zalo: ZaloZnsClient) {}
  async send(p: { agentId?: string | null; phone?: string | null; template: string; title: string; body: string; channel?: string; data?: Record<string, string>; sender?: string; batchId?: string }, tx?: Tx) {
    const channel = p.channel ?? 'ZNS';
    const status = channel === 'ZNS' && p.phone ? await this.zalo.send(p.template, p.phone, p.data ?? { content: p.body }) : 'Đã gửi';
    await (tx ?? this.db).insert(schema.notifications).values({ agentId: p.agentId ?? null, phone: p.phone ?? null, template: p.template, title: p.title, body: p.body, channel, status: status === 'Giả lập' ? 'Đã gửi (giả lập)' : status, sender: p.sender ?? 'Hệ thống', batchId: p.batchId ?? null });
  }
}

export async function dbFactory(): Promise<DB> {
  const { db, kind } = await createDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  if (!n) {
    console.log(`[db] ${kind}: DB trống → nạp dữ liệu demo`);
    await resetAndSeed(db);
  } else console.log(`[db] ${kind}: ${n} người dùng`);
  return db;
}

@Global()
@Module({
  providers: [{ provide: DB_TOKEN, useFactory: dbFactory }, AuditService, SeqService, ZnsService, ZaloZnsClient, ZaloCrmClient, KiotVietClient],
  exports: [DB_TOKEN, AuditService, SeqService, ZnsService, ZaloZnsClient, ZaloCrmClient, KiotVietClient],
})
export class CoreModule {}

export async function getUserName(db: DB, id: string) {
  const [u] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, id));
  return u?.name ?? '';
}
