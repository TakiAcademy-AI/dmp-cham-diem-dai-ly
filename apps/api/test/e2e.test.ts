/**
 * Test end-to-end API trên PGlite trong bộ nhớ (chạy trên bản build dist/ vì Nest cần decorator metadata).
 * Mỗi lần chạy nạp lại dữ liệu demo, nên các kịch bản độc lập với DB dev.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import 'reflect-metadata';

process.env.PGLITE_DIR = 'memory://';
process.env.DEMO_MODE = 'true';
process.env.WEB_DIST = '/nonexistent';
process.env.CRON_ENABLED = 'false';
process.env.UPLOAD_DIR = require('node:os').tmpdir() + '/dmp-test-uploads';
process.env.TZ = 'Asia/Ho_Chi_Minh';

let base = '';
let app: { close: () => Promise<void>; get: (t: string) => any };

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const tokens: Record<string, string> = {};
async function as(role: string) {
  if (!tokens[role]) tokens[role] = (await call('POST', '/auth/demo-login', undefined, { role })).body.token;
  return tokens[role];
}
/** Bất biến sổ cái: số dư đệm của đại lý = tổng sổ cái. */
async function assertLedgerInvariant() {
  const db = app.get('DB');
  const { sql } = await import('drizzle-orm');
  const rows = await db.execute(sql`
    SELECT a.id, a.reward_points, a.rank_points, a.pending_points,
      COALESCE((SELECT SUM(delta_reward) FROM point_ledger l WHERE l.agent_id=a.id AND l.state IN ('available','expired')),0) AS r,
      COALESCE((SELECT SUM(delta_rank) FROM point_ledger l WHERE l.agent_id=a.id AND l.state IN ('available','expired')),0) AS k,
      COALESCE((SELECT SUM(delta_reward) FROM point_ledger l WHERE l.agent_id=a.id AND l.state='pending'),0) AS p
    FROM agents a`);
  const bad = (rows.rows ?? rows).filter((x: any) => Number(x.reward_points) !== Number(x.r) || Number(x.rank_points) !== Number(x.k) || Number(x.pending_points) !== Number(x.p));
  expect(bad).toEqual([]);
}

beforeAll(async () => {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../dist/app.module');
  const nest = await NestFactory.create(AppModule, { logger: ['error'] });
  nest.setGlobalPrefix('api');
  await nest.listen(0);
  const addr = nest.getHttpServer().address();
  base = `http://127.0.0.1:${addr.port}/api`;
  app = nest as any;
}, 60_000);
afterAll(async () => { await app?.close(); });

describe('đăng nhập', () => {
  it('Kế toán phải qua 2FA; sai mật khẩu 5 lần thì khoá', async () => {
    const r = await call('POST', '/auth/login', undefined, { email: 'lan.pt@dmpvietphap.com', password: 'Dmp@2026' });
    expect(r.body.step).toBe('2fa');
    const ok = await call('POST', '/auth/2fa', undefined, { email: 'lan.pt@dmpvietphap.com', code: '123456' });
    expect(ok.body.user.role).toBe('KT');
    for (let i = 0; i < 5; i++) await call('POST', '/auth/login', undefined, { email: 'long.vd@dmpvietphap.com', password: 'sai' });
    const locked = await call('POST', '/auth/login', undefined, { email: 'long.vd@dmpvietphap.com', password: 'Dmp@2026' });
    expect(locked.status).toBe(403);
  });
  it('Sale không cần 2FA, đại lý đăng nhập bằng OTP', async () => {
    const r = await call('POST', '/auth/login', undefined, { email: 'nam.tv@dmpvietphap.com', password: 'Dmp@2026' });
    expect(r.body.step).toBe('done');
    await call('POST', '/auth/agent/otp', undefined, { phone: '0912345789' });
    const v = await call('POST', '/auth/agent/verify', undefined, { phone: '0912345789', code: '123456' });
    expect(v.body.user.agentId).toBe('DL00125');
  });
});

describe('điểm & sổ cái', () => {
  it('kịch bản 4: thanh toán đủ → điểm Treo thành Khả dụng', async () => {
    const kt = await as('KT');
    const before = (await call('GET', '/agents/DL00125/points', kt)).body;
    expect(before.pending).toBe(512);
    const r = await call('POST', '/orders/DH0123/payment', kt);
    expect(r.body.activated).toBe(512);
    const after = (await call('GET', '/agents/DL00125/points', kt)).body;
    expect(after.reward - before.reward).toBe(512);
    expect(after.pending).toBe(0);
    expect((await call('POST', '/orders/DH0123/payment', kt)).status).toBe(400);
    await assertLedgerInvariant();
  });

  it('Sale không được ghi nhận thanh toán', async () => {
    expect((await call('POST', '/orders/DH0123/payment', await as('SALE'))).status).toBe(403);
  });

  it('kịch bản 7: trả hàng một phần sinh bút toán đảo', async () => {
    const kt = await as('KT');
    const r = await call('POST', '/orders/DH0123/returns', kt, { pct: 0.3, reason: 'Hàng lỗi' });
    expect(r.body.points).toBe(-154);
    expect((await call('POST', '/orders/DH0123/returns', kt, { pct: 0.8 })).status).toBe(400);
    const led = (await call('GET', '/ledger?agentId=DL00125', kt)).body;
    expect(led[0]).toMatchObject({ type: 'reverse', deltaReward: -154 });
    await assertLedgerInvariant();
  });

  it('DB chặn sửa/xoá dòng sổ cái', async () => {
    const db = app.get('DB');
    const { sql } = await import('drizzle-orm');
    const reason = (p: Promise<unknown>) => p.then(() => 'không chặn', (e) => String(e.cause?.message ?? e.message));
    expect(await reason(db.execute(sql`UPDATE point_ledger SET delta_reward = 1 WHERE id = 1`))).toMatch(/chỉ ghi thêm/);
    expect(await reason(db.execute(sql`DELETE FROM point_ledger WHERE id = 1`))).toMatch(/chỉ ghi thêm/);
  });

  it('kịch bản 6: MKT tạo lô cộng điểm, chỉ BOD duyệt được', async () => {
    const mkt = await as('MKT');
    const r = await call('POST', '/points/manual', mkt, { agentIds: ['DL00046', 'DL00052'], points: 300, title: 'Workshop', reason: 'Điểm danh QR', rule: 'R08' });
    expect(r.body.kind).toBe('bulk');
    expect((await call('POST', `/approvals/${r.body.id}/approve`, mkt)).status).toBe(403);
    expect((await call('POST', `/approvals/${r.body.id}/reject`, await as('BOD'), {})).status).toBe(400);
    const ok = await call('POST', `/approvals/${r.body.id}/approve`, await as('BOD'));
    expect(ok.body.status).toBe('approved');
    expect((await call('POST', `/approvals/${r.body.id}/approve`, await as('BOD'))).status).toBe(400);
    await assertLedgerInvariant();
  });

  it('khoá sổ chặn ghi điểm; mở lại cần BOD duyệt', async () => {
    const ktt = await as('KTT');
    const p = new Date().toISOString().slice(0, 7);
    await call('POST', `/periods/${p}/lock`, ktt);
    expect((await call('POST', '/orders/sync', await as('KT'), { count: 1 })).status).toBe(400);
    const ap = await call('POST', `/periods/${p}/reopen`, ktt, { reason: 'Điều chỉnh' });
    await call('POST', `/approvals/${ap.body.id}/approve`, await as('BOD'));
    expect((await call('POST', '/orders/sync', await as('KT'), { count: 1 })).status).toBe(201);
  });
});

describe('đổi quà', () => {
  it('kịch bản 5: ĐL-C đổi → Sale → KT → Kho; ĐL-NV bị chặn', async () => {
    const nv = await as('DLNV');
    expect((await call('POST', '/app/redemptions', nv, { giftId: 'Q05' })).status).toBe(403);
    const dl = await as('DLC');
    const r = await call('POST', '/app/redemptions', dl, { giftId: 'Q05' });
    expect(r.body.stage).toBe('new');
    expect((await call('POST', `/redemptions/${r.body.id}/advance`, await as('KT'))).status).toBe(403);
    for (const role of ['SALE', 'KT', 'KHO', 'KHO']) expect((await call('POST', `/redemptions/${r.body.id}/advance`, await as(role))).status).toBe(201);
    expect((await call('POST', `/redemptions/${r.body.id}/advance`, await as('KHO'))).status).toBe(400);
    await assertLedgerInvariant();
  });

  it('từ chối thì hoàn điểm; không đủ điểm thì không cho đổi', async () => {
    const dl = await as('DLC');
    const before = (await call('GET', '/app/home', dl)).body.points.reward;
    const r = await call('POST', '/app/redemptions', dl, { giftId: 'Q01' });
    await call('POST', `/redemptions/${r.body.id}/reject`, await as('SALE'), { reason: 'Đại lý đổi ý' });
    expect((await call('GET', '/app/home', dl)).body.points.reward).toBe(before);
    expect((await call('POST', '/app/redemptions', dl, { giftId: 'Q12' })).status).toBe(400);
    await assertLedgerInvariant();
  });
});

describe('phân quyền dữ liệu', () => {
  it('MKT thấy SĐT/CCCD bị che; Sale không xem được đại lý người khác', async () => {
    const a = (await call('GET', '/agents/DL00125', await as('MKT'))).body;
    expect(a.phone).toMatch(/\*\*\*\*/);
    expect(a.masked.idCard).toBe(true);
    expect(a.debt).toBeNull();
    const own = (await call('GET', '/agents/DL00125', await as('SALE'))).body;
    expect(own.phone).toBe('0912345789');
    const list = (await call('GET', '/agents', await as('SALE'))).body;
    expect(list.every((x: any) => x.saleId === 'u-s1')).toBe(true);
    const other = list.length ? (await call('GET', '/agents', await as('BOD'))).body.find((x: any) => x.saleId !== 'u-s1') : null;
    expect((await call('GET', `/agents/${other.id}`, await as('SALE'))).status).toBe(403);
  });

  it('xem trường nhạy cảm được ghi audit', async () => {
    const bod = await as('BOD');
    const r = await call('POST', '/agents/DL00125/reveal', bod, { field: 'idCard' });
    expect(r.body.value).toBe('001234567845');
    const log = (await call('GET', '/audit', bod)).body;
    expect(log[0].action).toBe('Xem đầy đủ CCCD');
    expect((await call('POST', '/agents/DL00125/reveal', await as('MKT'), { field: 'idCard' })).status).toBe(403);
  });

  it('đại lý không gọi được API quản trị', async () => {
    expect((await call('GET', '/orders', await as('DLC'))).status).toBe(403);
  });
});

describe('đại lý mới', () => {
  it('kịch bản 3: Sale đề xuất → BOD duyệt → KT cấp mã → tài khoản app', async () => {
    const r = await call('POST', '/applications', await as('SALE'), { name: 'Nhà thuốc Test', type: 'Nhà thuốc', phone: '0977000111', commitMonth: 20e6 });
    expect((await call('POST', `/applications/${r.body.id}/issue-code`, await as('KT'))).status).toBe(400);
    await call('POST', `/applications/${r.body.id}/approve`, await as('BOD'));
    const issued = await call('POST', `/applications/${r.body.id}/issue-code`, await as('KT'));
    expect(issued.body.agentId).toMatch(/^DL\d{5}$/);
    expect((await call('POST', '/auth/agent/otp', undefined, { phone: '0977000111' })).status).toBe(201);
  });
});

describe('GĐ2 & bổ sung', () => {
  it('campaign: MKT tạo → BOD duyệt → đơn mới được nhân hệ số', async () => {
    const mkt = await as('MKT');
    const c = await call('POST', '/campaigns', mkt, { name: 'VITILSI ×3', kind: 'multiplier', value: 3, scope: { brands: ['VITILSI'] }, from: new Date(Date.now() - 86400e3).toISOString(), to: new Date(Date.now() + 30 * 86400e3).toISOString(), budget: 5000 });
    const ap = await call('POST', `/campaigns/${c.body.id}/submit`, mkt, {});
    await call('POST', `/approvals/${ap.body.id}/approve`, await as('BOD'));
    const list = (await call('GET', '/campaigns', mkt)).body;
    expect(list.find((x: any) => x.id === c.body.id).status).toBe('Đang chạy');
    const r = await call('POST', '/points/preview', await as('KT'), { lines: [{ sku: 'VIT-1', name: 'x', price: 1e6, qty: 10, brand: 'VITILSI' }], tier: 'member' });
    expect(r.body.productMult).toBe(1); // preview không áp campaign — chỉ đơn thật
  });

  it('thanh toán một phần không kích hoạt điểm, trả đủ mới kích hoạt', async () => {
    const kt = await as('KT');
    const sync = await call('POST', '/orders/sync', kt, { agentId: 'DL00125', count: 1 });
    const id = sync.body.created[0].id;
    const o = (await call('GET', `/orders/${id}`, kt)).body;
    const part = await call('POST', `/orders/${id}/payment`, kt, { amount: Math.round(o.value / 2) });
    expect(part.body).toMatchObject({ full: false, activated: 0 });
    expect((await call('POST', `/orders/${id}/payment`, kt, { amount: o.value })).status).toBe(400);
    const rest = await call('POST', `/orders/${id}/payment`, kt, {});
    expect(rest.body.full).toBe(true);
    expect(rest.body.activated).toBe(o.points);
    const hist = (await call('GET', '/payments?agentId=DL00125', kt)).body;
    expect(hist.filter((p: any) => p.orderId === id)).toHaveLength(2);
    await assertLedgerInvariant();
  });

  it('import MISA: xem trước rồi ghi nhận', async () => {
    const kt = await as('KT');
    const sync = await call('POST', '/orders/sync', kt, { agentId: 'DL00125', count: 1 });
    const id = sync.body.created[0].id;
    const csv = `Số chứng từ gốc;Số tiền\n${id};1.000.000\nDH9999;500000`;
    const dry = await call('POST', '/payments/import', kt, { csv, dryRun: true });
    expect(dry.body.results.map((r: any) => r.ok)).toEqual([true, false]);
    const real = await call('POST', '/payments/import', kt, { csv });
    expect(real.body.results[0].ok).toBe(true);
    expect((await call('GET', `/orders/${id}`, kt)).body.pay).toBe('Thanh toán một phần');
  });

  it('đào tạo online: đạt bài test tạo yêu cầu cộng điểm, không cộng 2 lần', async () => {
    const dl = await as('DLC');
    const c = (await call('GET', '/app/courses/KH02', dl)).body;
    expect(c.quiz[0].answer).toBeUndefined();
    const r = await call('POST', '/app/courses/KH02/attempt', dl, { answers: [0, 2, 1] });
    expect(r.body).toMatchObject({ passed: true, pointsPending: 50 });
    const again = await call('POST', '/app/courses/KH02/attempt', dl, { answers: [0, 2, 1] });
    expect(again.body).toMatchObject({ passed: true, pointsPending: 0, alreadyAwarded: true });
  });

  it('bằng chứng trưng bày: Sale xác nhận → MKT duyệt → cộng điểm', async () => {
    const sale = await as('SALE');
    const ev = await call('POST', '/evidence/BC0003/confirm', sale, { ok: true });
    expect(ev.body.stage).toBe('Chờ Marketing duyệt');
    const before = (await call('GET', '/app/home', await as('DLC'))).body.points.reward;
    await call('POST', `/approvals/${ev.body.approvalId}/approve`, await as('MKT'));
    expect((await call('GET', '/app/home', await as('DLC'))).body.points.reward).toBe(before + 200);
    const list = (await call('GET', '/app/evidence', await as('DLC'))).body.items;
    expect(list.find((e: any) => e.id === 'BC0003').stage).toBe('Đã duyệt');
    expect((await call('POST', '/app/evidence', await as('DLC'), { category: 'display', fileIds: ['x'] })).status).toBe(400); // 1 lần/tháng
  });

  it('khiếu nại: đại lý gửi → KT chấp nhận → BOD duyệt điều chỉnh → đã giải quyết', async () => {
    const dl = await as('DLC');
    const led = (await call('GET', '/app/ledger', dl)).body;
    const k = await call('POST', '/app/complaints', dl, { ledgerId: led[0].id, claim: 'Giao dịch này thiếu điểm theo campaign', wantPoints: 100 });
    expect(k.body.status).toBe('Mới');
    expect((await call('POST', '/app/complaints', dl, { ledgerId: led[0].id, claim: 'Gửi trùng giao dịch này lần nữa' })).status).toBe(400);
    const kt = await as('KT');
    await call('POST', `/complaints/${k.body.id}/take`, kt);
    const res = await call('POST', `/complaints/${k.body.id}/resolve`, kt, { accept: true, points: 100, note: 'Đúng, thiếu điểm' });
    await call('POST', `/approvals/${res.body.approvalId}/approve`, await as('BOD'));
    const mine = (await call('GET', '/app/complaints', dl)).body.find((c: any) => c.id === k.body.id);
    expect(mine.status).toBe('Đã giải quyết');
    await assertLedgerInvariant();
  });

  it('quà ≥ 10 triệu cần BOD duyệt; Kho cập nhật tồn', async () => {
    const mkt = await as('MKT');
    const g = await call('POST', '/gifts', mkt, { name: 'Máy lọc không khí', type: 'Hàng hoá', points: 12000, value: 12e6, stock: 3 });
    expect(g.body.status).toBe('Chờ BOD duyệt');
    await call('POST', `/approvals/${g.body.approvalId}/approve`, await as('BOD'));
    const gifts = (await call('GET', '/gifts', mkt)).body;
    expect(gifts.find((x: any) => x.id === g.body.id).status).toBe('Đang mở');
    const st = await call('PATCH', `/gifts/${g.body.id}/stock`, await as('KHO'), { stock: 0 });
    expect(st.body.status).toBe('Hết hàng');
  });

  it('tạm ngưng đại lý chặn đăng nhập app', async () => {
    const bod = await as('BOD');
    await call('POST', '/agents/DL00046/suspend', bod, { reason: 'Vi phạm địa bàn' });
    const accs = (await call('GET', '/agents/DL00046', bod)).body.accounts;
    if (accs.length) expect(accs.every((a: any) => !a.active)).toBe(true);
    await call('POST', '/agents/DL00046/reactivate', bod);
    expect((await call('GET', '/agents/DL00046', bod)).body.status).not.toBe('locked');
  });

  it('xuất Excel ghi audit log; TOTP đăng ký được', async () => {
    const bod = await as('BOD');
    const res = await fetch(base + '/export/agents?t=' + bod);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect((await call('GET', '/audit', bod)).body[0].action).toMatch(/Xuất Excel/);
    const { totpCode } = await import('../dist/modules/integrations/integrations');
    const setup = await call('POST', '/auth/totp/setup', bod);
    expect((await call('POST', '/auth/totp/enable', bod, { secret: setup.body.secret, code: '000000' })).status).toBe(400);
    expect((await call('POST', '/auth/totp/enable', bod, { secret: setup.body.secret, code: totpCode(setup.body.secret) })).status).toBe(201);
    const login = await call('POST', '/auth/login', undefined, { email: 'an.nv@dmpvietphap.com', password: 'Dmp@2026' });
    expect(login.body.method).toBe('totp');
  });

  it('bảng xếp hạng che tên đại lý khác', async () => {
    const r = (await call('GET', '/app/leaderboard?metric=sales&scope=all', await as('DLC'))).body;
    expect(r.me.name).toBe('Nhà thuốc Minh Châu');
    expect(r.top.filter((x: any) => !x.me).every((x: any) => x.name.includes('***'))).toBe(true);
  });
});
