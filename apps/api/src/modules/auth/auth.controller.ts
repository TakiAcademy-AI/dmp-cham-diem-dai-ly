import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { and, desc, eq } from 'drizzle-orm';
import { TWO_FA_ROLES, type InternalRole, type Role } from '@dmp/shared';
import { schema, type DB } from '../../db/db';
import { AuditService, CurrentActor, InjectDb, Public, signToken, ZnsService, type Actor } from '../../common/core';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../integrations/integrations';

const { users, otpCodes, agentAccounts, agents } = schema;
export const demoMode = () => (process.env.DEMO_MODE ?? 'true') !== 'false';
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

@Controller('auth')
export class AuthController {
  constructor(@InjectDb() private db: DB, private audit: AuditService, private zns: ZnsService) {}

  private async issueOtp(target: string, purpose: string) {
    const code = demoMode() ? '123456' : String(Math.floor(100000 + Math.random() * 900000));
    await this.db.insert(otpCodes).values({ target, purpose, code, expiresAt: new Date(Date.now() + 5 * 60e3) });
    return code;
  }

  private async checkOtp(target: string, purpose: string, code: string) {
    const [o] = await this.db.select().from(otpCodes).where(and(eq(otpCodes.target, target), eq(otpCodes.purpose, purpose), eq(otpCodes.used, false))).orderBy(desc(otpCodes.id)).limit(1);
    if (!o || o.expiresAt < new Date()) throw new UnauthorizedException('Mã xác thực đã hết hạn. Vui lòng gửi lại mã');
    if (o.attempts >= 5) throw new UnauthorizedException('Nhập sai quá 5 lần. Vui lòng gửi lại mã');
    if (o.code !== code) {
      await this.db.update(otpCodes).set({ attempts: o.attempts + 1 }).where(eq(otpCodes.id, o.id));
      throw new UnauthorizedException(`Mã xác thực không đúng (còn ${4 - o.attempts} lần thử)`);
    }
    await this.db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, o.id));
  }

  private userActor(u: typeof users.$inferSelect): Actor {
    return { kind: 'user', id: u.id, name: u.name, role: u.role as Role };
  }

  /** Bước 1: email + mật khẩu. Vai trò SA/BOD/KTT/KT bắt buộc thêm bước 2FA. Khoá 15 phút sau 5 lần sai. */
  @Public()
  @Post('login')
  async login(@Body() b: { email: string; password: string }) {
    const [u] = await this.db.select().from(users).where(eq(users.email, (b?.email ?? '').trim().toLowerCase()));
    if (!u) throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    if (u.status.startsWith('Khoá')) throw new ForbiddenException('Tài khoản đã bị khoá. Liên hệ quản trị hệ thống');
    if (u.lockedUntil && u.lockedUntil > new Date()) throw new ForbiddenException(`Tài khoản tạm khoá do nhập sai ${MAX_FAILS} lần. Thử lại sau ${LOCK_MINUTES} phút`);
    if (!(await bcrypt.compare(b.password ?? '', u.passwordHash))) {
      const fails = u.failedLogins + 1;
      await this.db.update(users).set({ failedLogins: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60e3) : null }).where(eq(users.id, u.id));
      throw new UnauthorizedException(fails >= MAX_FAILS ? `Sai ${MAX_FAILS} lần — tài khoản tạm khoá ${LOCK_MINUTES} phút` : `Email hoặc mật khẩu không đúng (còn ${MAX_FAILS - fails} lần thử)`);
    }
    await this.db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
    if (u.twoFA || TWO_FA_ROLES.includes(u.role as InternalRole)) {
      // Đã đăng ký Authenticator → nhập mã TOTP; chưa đăng ký → mã một lần (bản demo hiện mã ngay)
      if (u.totpSecret) return { step: '2fa', method: 'totp', email: u.email, hint: 'Nhập mã 6 số trong ứng dụng Authenticator' };
      const code = await this.issueOtp(u.email, '2fa');
      return { step: '2fa', method: 'otp', email: u.email, hint: 'Mã 6 số đã gửi tới email công ty', ...(demoMode() ? { devCode: code } : {}) };
    }
    const actor = this.userActor(u);
    await this.audit.log({ ...actor }, 'Đăng nhập', 'Web quản trị');
    return { step: 'done', token: signToken(actor), user: actor };
  }

  @Public()
  @Post('2fa')
  async twoFA(@Body() b: { email: string; code: string }) {
    const [u] = await this.db.select().from(users).where(eq(users.email, (b?.email ?? '').trim().toLowerCase()));
    if (!u) throw new UnauthorizedException();
    if (u.totpSecret) { if (!verifyTotp(u.totpSecret, String(b.code ?? ''))) throw new UnauthorizedException('Mã Authenticator không đúng'); }
    else await this.checkOtp(u.email, '2fa', b.code);
    const actor = this.userActor(u);
    await this.audit.log(actor, 'Đăng nhập (2FA)', 'Web quản trị');
    return { step: 'done', token: signToken(actor), user: actor };
  }

  /** App đại lý: SĐT → OTP qua Zalo ZNS. */
  @Public()
  @Post('agent/otp')
  async agentOtp(@Body() b: { phone: string }) {
    const phone = (b?.phone ?? '').replace(/\D/g, '');
    const [acc] = await this.db.select().from(agentAccounts).where(eq(agentAccounts.phone, phone));
    if (!acc || !acc.active) throw new BadRequestException('Số điện thoại chưa được đăng ký. Vui lòng liên hệ sale phụ trách để được kích hoạt');
    const code = await this.issueOtp(phone, 'agent');
    await this.zns.send({ agentId: acc.agentId, phone, template: 'otp', title: 'Mã xác thực', body: `Mã xác thực DMP Việt Pháp của Quý đại lý là ${code}. Hiệu lực trong 5 phút.` });
    return { sent: true, phone, ...(demoMode() ? { devCode: code } : {}) };
  }

  @Public()
  @Post('agent/verify')
  async agentVerify(@Body() b: { phone: string; code: string }) {
    const phone = (b?.phone ?? '').replace(/\D/g, '');
    await this.checkOtp(phone, 'agent', b.code);
    const [acc] = await this.db.select().from(agentAccounts).where(eq(agentAccounts.phone, phone));
    const [a] = await this.db.select().from(agents).where(eq(agents.id, acc.agentId));
    if (!a.appActivated) await this.db.update(agents).set({ appActivated: true }).where(eq(agents.id, a.id));
    const actor: Actor = { kind: 'agent', id: 'acc-' + acc.id, name: acc.name, role: acc.role as Role, agentId: acc.agentId };
    return { token: signToken(actor, '30d'), user: { ...actor, agentName: a.name } };
  }

  /** Chỉ bật ở DEMO_MODE: đổi vai trò tức thì (nút "Xem với vai trò" khi trình diễn cho khách). */
  @Public()
  @Post('demo-login')
  async demoLogin(@Body() b: { role?: string; userId?: string; phone?: string }) {
    if (!demoMode()) throw new ForbiddenException('Chỉ dùng trong chế độ demo');
    if (b.role === 'DLC' || b.role === 'DLNV' || b.phone) {
      const [acc] = b.phone
        ? await this.db.select().from(agentAccounts).where(eq(agentAccounts.phone, b.phone))
        : await this.db.select().from(agentAccounts).where(and(eq(agentAccounts.agentId, 'DL00125'), eq(agentAccounts.role, b.role!)));
      if (!acc) throw new BadRequestException('Không có tài khoản đại lý');
      const [a] = await this.db.select().from(agents).where(eq(agents.id, acc.agentId));
      const actor: Actor = { kind: 'agent', id: 'acc-' + acc.id, name: acc.name, role: acc.role as Role, agentId: acc.agentId };
      return { token: signToken(actor, '30d'), user: { ...actor, agentName: a.name } };
    }
    const [u] = b.userId
      ? await this.db.select().from(users).where(eq(users.id, b.userId))
      : await this.db.select().from(users).where(eq(users.role, b.role ?? 'BOD')).orderBy(users.id).limit(1);
    if (!u) throw new BadRequestException('Không có người dùng cho vai trò này');
    const actor = this.userActor(u);
    return { token: signToken(actor), user: actor };
  }

  /** Bắt đầu đăng ký Authenticator: trả về khoá + otpauth URL (hiển thị QR). Chỉ lưu khi xác nhận mã đúng. */
  @Post('totp/setup')
  async totpSetup(@CurrentActor() actor: Actor) {
    if (actor.kind !== 'user') throw new ForbiddenException();
    const [u] = await this.db.select().from(users).where(eq(users.id, actor.id));
    const secret = newTotpSecret();
    return { secret, url: otpauthUrl(secret, u.email) };
  }

  @Post('totp/enable')
  async totpEnable(@CurrentActor() actor: Actor, @Body() b: { secret: string; code: string }) {
    if (actor.kind !== 'user' || !b?.secret) throw new BadRequestException('Thiếu khoá');
    if (!verifyTotp(b.secret, String(b.code ?? ''))) throw new BadRequestException('Mã không đúng — kiểm tra giờ trên điện thoại rồi thử lại');
    await this.db.update(users).set({ totpSecret: b.secret, twoFA: true }).where(eq(users.id, actor.id));
    await this.audit.log(actor, 'Bật xác thực Authenticator', actor.id);
    return { ok: true };
  }

  @Post('totp/disable')
  async totpDisable(@CurrentActor() actor: Actor, @Body() b: { code: string }) {
    const [u] = await this.db.select().from(users).where(eq(users.id, actor.id));
    if (!u?.totpSecret || !verifyTotp(u.totpSecret, String(b?.code ?? ''))) throw new BadRequestException('Mã không đúng');
    await this.db.update(users).set({ totpSecret: null }).where(eq(users.id, actor.id));
    await this.audit.log(actor, 'Tắt xác thực Authenticator', actor.id);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentActor() actor: Actor) {
    if (actor.kind === 'agent') {
      const [a] = await this.db.select({ name: agents.name }).from(agents).where(eq(agents.id, actor.agentId!));
      return { ...actor, agentName: a?.name, demo: demoMode() };
    }
    const [u] = await this.db.select({ totp: users.totpSecret, email: users.email }).from(users).where(eq(users.id, actor.id));
    return { ...actor, email: u?.email, totpEnabled: !!u?.totp, demo: demoMode() };
  }

  @Public()
  @Get('config')
  config(@Req() _req: unknown) {
    return { demo: demoMode() };
  }
}
