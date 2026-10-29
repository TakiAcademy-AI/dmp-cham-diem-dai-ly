import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DEFAULT_PARAMS, computeOrderPoints, endOfMonth, addMonths, periodOf, type OrderLineInput, type Tier } from '@dmp/shared';
import type { DB } from './db';
import * as s from './schema';

/**
 * Dữ liệu demo (mục 7.4 DMP_01), chuyển từ DMP_VietPhap_DesignSystem/assets/data.js.
 * Mọi số dư điểm được ghi qua sổ cái (dòng "Số dư chuyển đổi" + giao dịch mẫu) để luôn khớp.
 */
export const DEMO_PASSWORD = 'Dmp@2026';
export const SEED_TODAY = new Date(2026, 9, 28, 9, 0, 0);

let seed = 20261028;
function rnd() { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const d = (y: number, m: number, day: number) => `${pad(day, 2)}/${pad(m, 2)}/${y}`;
const rep = <T,>(v: T, n: number) => Array.from({ length: n }, () => v);
function shuffle<T>(a: T[]) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function parseVN(date: string, time = '09:00'): Date {
  const [dd, mm, yy] = date.split('/').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(yy, mm - 1, dd, h, mi);
}

const USERS = [
  { id: 'u-sa', name: 'Đinh Công Sơn', role: 'SA', email: 'son.dc@dmpvietphap.com', twoFA: true, scope: 'Cấu hình' },
  { id: 'u-bod', name: 'Nguyễn Văn An', role: 'BOD', email: 'an.nv@dmpvietphap.com', twoFA: true, scope: 'Toàn bộ' },
  { id: 'u-ktt', name: 'Hoàng Thị Mai', role: 'KTT', email: 'mai.ht@dmpvietphap.com', twoFA: true, scope: 'Toàn bộ' },
  { id: 'u-kt', name: 'Phạm Thị Lan', role: 'KT', email: 'lan.pt@dmpvietphap.com', twoFA: true, scope: 'Toàn bộ' },
  { id: 'u-tpkd', name: 'Vũ Đức Long', role: 'TPKD', email: 'long.vd@dmpvietphap.com', twoFA: false, scope: 'Toàn bộ khối sale' },
  { id: 'u-s1', name: 'Trần Văn Nam', role: 'SALE', email: 'nam.tv@dmpvietphap.com', twoFA: false, scope: 'Đại lý phụ trách' },
  { id: 'u-s2', name: 'Lê Thu Hà', role: 'SALE', email: 'ha.lt@dmpvietphap.com', twoFA: false, scope: 'Đại lý phụ trách' },
  { id: 'u-s3', name: 'Ngô Quang Huy', role: 'SALE', email: 'huy.nq@dmpvietphap.com', twoFA: false, scope: 'Đại lý phụ trách', status: 'Nghỉ việc 31/10' },
  { id: 'u-mkt', name: 'Đỗ Minh Thư', role: 'MKT', email: 'thu.dm@dmpvietphap.com', twoFA: false, scope: 'Toàn bộ (đã che)' },
  { id: 'u-kho', name: 'Bùi Văn Tùng', role: 'KHO', email: 'tung.bv@dmpvietphap.com', twoFA: false, scope: 'Quà cần giao' },
];
const SALES = ['u-s1', 'u-s2', 'u-s3'];
const userName = (id: string) => USERS.find((u) => u.id === id)?.name ?? '';

const NAMES = ['Minh Châu', 'Hồng Nhung', 'Hà Đông', 'Bảo An', 'Phúc Khang', 'Bảo Ngọc', 'Thiên Kim', 'Hồng Phát', 'Trường Xuân', 'Ngọc Lan', 'Hạnh Phúc', 'Khánh Linh', 'Thanh Bình', 'Mỹ Anh', 'Đức Thịnh', 'Gia Hân', 'Phương Nam', 'Hải Đăng', 'Kim Ngân', 'Lộc Phát', 'Việt Đức', 'Sao Mai', 'Bình Minh', 'Hà Thành', 'Quỳnh Anh', 'Tuệ Lâm', 'Vạn An', 'Thu Trang', 'Hưng Thịnh', 'Ánh Dương', 'Diệu Linh', 'Song An', 'Tân Phú', 'Mai Hương', 'Hoàng Gia', 'Như Ý', 'Phú Quý', 'Cát Tường', 'Thảo Nguyên', 'Lam Hồng', 'Đông Á', 'Hữu Nghị', 'Thái Hà', 'Kim Liên', 'Yên Hoà', 'Trúc Lâm', 'Hồng Ân', 'Tường Vy', 'Phước Lộc', 'Nam Việt', 'Thuỷ Tiên', 'Bích Ngọc', 'Quang Minh', 'Hoà Bình', 'Đại Phát', 'Thanh Xuân', 'Tâm An', 'Hương Giang', 'Mộc Lan', 'Ngọc Hà'];
const PREFIX: Record<string, string> = { 'Nhà thuốc': 'Nhà thuốc', Spa: 'Spa', 'Phòng khám': 'Phòng khám Da liễu' };
const CITY = ['Hà Nội', 'Hà Nội', 'Hà Nội', 'TP.HCM', 'TP.HCM', 'Hải Phòng', 'Đà Nẵng', 'Cần Thơ', 'Bắc Ninh', 'Nghệ An'];
const STREET = ['Nguyễn Trãi', 'Lê Lợi', 'Trần Hưng Đạo', 'Hai Bà Trưng', 'Lý Thường Kiệt', 'Hoàng Quốc Việt', 'Cầu Giấy', 'Nguyễn Văn Linh', 'Phạm Văn Đồng', 'Võ Văn Tần'];
const RANK_RANGE: Record<Tier, [number, number]> = { member: [800, 4800], bronze: [5100, 9800], silver: [10200, 19500], gold: [20500, 46000], diamond: [52000, 88000], strategic: [96000, 96000] };
const OWNERS = ['Nguyễn Thị', 'Trần Văn', 'Lê Thị', 'Phạm Văn', 'Hoàng Thị', 'Vũ Văn', 'Đặng Thị', 'Bùi Văn'];
const GIVEN = ['Hoa', 'Hùng', 'Lan', 'Minh', 'Thu', 'Dũng', 'Hạnh', 'Tuấn', 'Ngọc', 'Bình'];

interface SeedAgent {
  id: string; name: string; type: string; tier: Tier; rank: number; reward: number; salesMonth: number; salesLastMonth: number; commitMonth: number;
  debt: number; overdueDays: number; sale: string; lastOrder: string; status: string; flags: string[]; city: string; phone: string; idCard: string; dob: string;
  address: string; taxCode: string; bank: string; bankName: string; start: string; contractNo: string; contractEnd: string; creditLimit: number; creditDays: number;
  push: string; appActivated: boolean; referrer: string; owner: string; protectedUntil?: string;
}

function buildAgents(): SeedAgent[] {
  const tierPlan = shuffle([...rep<Tier>('member', 14), ...rep<Tier>('bronze', 18), ...rep<Tier>('silver', 13), ...rep<Tier>('gold', 9), ...rep<Tier>('diamond', 5), ...rep<Tier>('strategic', 1)]);
  const typePlan = shuffle([...rep('Nhà thuốc', 36), ...rep('Spa', 15), ...rep('Phòng khám', 9)]);
  const agents: SeedAgent[] = [];
  for (let i = 0; i < 60; i++) {
    const tier = tierPlan[i], type = typePlan[i];
    const rank = Math.round(between(...RANK_RANGE[tier]) / 10) * 10;
    const monthly = Math.round((rank * 100000 / 3) * (0.8 + rnd() * 0.35) / 100000) * 100000;
    let commit = Math.round(monthly * (0.9 + rnd() * 0.5) / 1e6) * 1e6;
    if (commit < 10e6) commit = 10e6;
    const a: SeedAgent = {
      id: 'DL' + pad(i === 0 ? 125 : 40 + i * 6, 5), name: PREFIX[type] + ' ' + NAMES[i], type, tier, rank,
      reward: Math.round(rank * (0.45 + rnd() * 0.35) / 10) * 10,
      salesMonth: monthly, salesLastMonth: Math.round(monthly * (0.8 + rnd() * 0.4) / 100000) * 100000, commitMonth: commit,
      debt: 0, overdueDays: 0, sale: SALES[i % 3], lastOrder: d(2026, 10, between(1, 27)), status: 'ok', flags: [], city: pick(CITY),
      phone: '09' + pad(between(10000000, 99999999), 8), idCard: '0' + pad(between(1000000000, 99999999999), 11),
      dob: d(between(1962, 1990), between(1, 12), between(1, 28)), address: between(2, 280) + ' ' + pick(STREET),
      taxCode: '01' + pad(between(10000000, 99999999), 8), bank: pad(between(1e9, 9e9), 10) + pad(between(10, 99), 2),
      bankName: pick(['Vietcombank', 'Techcombank', 'BIDV', 'VPBank', 'MB']),
      start: d(pick([2019, 2020, 2021, 2022, 2023, 2024, 2025]), between(1, 12), between(1, 28)),
      contractNo: 'HĐ-2026/' + pad(100 + i, 3), contractEnd: d(2026, 12, 31), creditLimit: Math.max(30e6, Math.round(commit * 2 / 1e7) * 1e7),
      creditDays: pick([15, 30, 30, 45]), push: pick(['Push T10: NOREVA x2', 'Push T10: chiết khấu thêm 2%', '—']),
      appActivated: rnd() < 0.42, referrer: rnd() < 0.2 ? 'DL00125' : '', owner: pick(OWNERS) + ' ' + pick(GIVEN),
    };
    if (rnd() < 0.18) a.debt = between(8, 60) * 1e6;
    agents.push(a);
  }
  const hero = agents[0];
  Object.assign(hero, {
    name: 'Nhà thuốc Minh Châu', type: 'Nhà thuốc', tier: 'gold', rank: 18400, reward: 12500, salesMonth: 86.5e6, salesLastMonth: 79e6, commitMonth: 94e6,
    sale: 'u-s1', city: 'Hà Nội', phone: '0912345789', idCard: '001234567845', dob: '15/08/1975', bank: '190345678967', bankName: 'Techcombank',
    address: '45 Nguyễn Trãi, Thanh Xuân', taxCode: '0108765432', start: '12/03/2021', owner: 'Nguyễn Thị Châu', debt: 25.3e6, appActivated: true,
    lastOrder: '26/10/2026', creditLimit: 150e6, creditDays: 30, protectedUntil: '31/12/2026', referrer: '',
  });
  agents.forEach((a, k) => { if (k > 0 && a.tier === 'strategic') a.tier = 'diamond'; });
  agents[50].tier = 'strategic'; agents[50].rank = 96000;

  const tiers = DEFAULT_PARAMS.tiers;
  const dormantDates = ['21/08/2026', '02/08/2026', '25/07/2026', '14/08/2026', '28/06/2026'];
  [7, 19, 28, 41, 53].forEach((k, j) => { const a = agents[k]; a.status = 'dormant'; a.flags.push('dormant'); a.salesMonth = 0; a.lastOrder = dormantDates[j]; });
  [4, 12, 33, 46].forEach((k) => {
    const a = agents[k];
    if (a.tier === 'member') { a.tier = 'silver'; a.rank = 9200; } else { const t = tiers.find((x) => x.key === a.tier)!; a.rank = Math.round(((t.keep || 4000) * 0.82) / 10) * 10; }
    a.status = 'atrisk'; a.flags.push('atrisk'); a.salesMonth = Math.round((a.commitMonth * between(35, 60)) / 100 / 100000) * 100000;
    a.protectedUntil = '31/12/2026';
  });
  [9, 22, 37].forEach((k, j) => { agents[k].contractEnd = ['12/11/2026', '20/11/2026', '25/11/2026'][j]; agents[k].flags.push('expiring'); });
  [15, 31].forEach((k, j) => { agents[k].dob = ['30/10/1978', '02/11/1985'][j]; agents[k].flags.push('birthday'); });
  [3, 11, 24, 36, 48, 57].forEach((k) => { const a = agents[k]; a.debt = between(18, 75) * 1e6; a.overdueDays = between(32, 70); if (a.status === 'ok') a.status = 'overdue'; a.flags.push('overdue'); });
  Object.assign(agents[11], { name: 'Spa Hoa Sen', type: 'Spa', tier: 'silver' });
  Object.assign(agents[4], { name: 'Phòng khám Da liễu An Bình', type: 'Phòng khám', tier: 'diamond', rank: 32800 });
  Object.assign(agents[7], { name: 'Nhà thuốc Tâm Đức', tier: 'bronze' });
  Object.assign(agents[9], { name: 'Nhà thuốc Phúc An', tier: 'gold' });
  agents.forEach((a) => {
    if (a.tier === 'strategic') Object.assign(a, { name: 'Hệ thống Nhà thuốc Việt Đức', type: 'Nhà thuốc', salesMonth: 1.25e9, commitMonth: 1.1e9, status: 'ok', flags: [], debt: 320e6, overdueDays: 0 });
  });
  // Điểm hạng phải khớp hạng (trừ đại lý sắp rớt hạng / đang bảo vệ hạng và hạng đặc biệt)
  for (const a of agents) {
    if (a.tier === 'strategic' || a.protectedUntil) continue;
    const [lo, hi] = RANK_RANGE[a.tier];
    if (a.rank < lo || a.rank > hi) { a.rank = Math.round((lo + (hi - lo) * 0.4) / 10) * 10; a.reward = Math.min(a.reward, Math.round(a.rank * 0.6 / 10) * 10); }
  }
  // Co doanh số các đại lý còn lại để tổng tháng 10 khớp chuỗi doanh thu 12 tháng (4,82 tỷ)
  const fixed = agents.filter((a, k) => k === 0 || a.tier === 'strategic');
  const rest = agents.filter((a) => !fixed.includes(a));
  const target = 4.82e9 - fixed.reduce((t, a) => t + a.salesMonth, 0);
  const f = target / rest.reduce((t, a) => t + a.salesMonth, 0);
  const r100k = (v: number) => Math.round(v / 100000) * 100000;
  for (const a of rest) {
    a.salesMonth = r100k(a.salesMonth * f);
    a.salesLastMonth = r100k(a.salesLastMonth * f);
    a.commitMonth = Math.max(10e6, Math.round((a.commitMonth * f) / 1e6) * 1e6);
    a.creditLimit = Math.max(30e6, Math.round((a.commitMonth * 2) / 1e7) * 1e7);
  }
  return agents;
}

const BRANDS = ['NOREVA', 'TRANACIX', 'VITILSI', 'BIOTOPIX', 'ALPHASCIENCE'];
const LINES: Record<string, Array<[string, string[]]>> = {
  NOREVA: [['Làm sạch', ['Gel rửa mặt 200ml', 'Gel rửa mặt 400ml', 'Nước tẩy trang 250ml']], ['Dưỡng ẩm', ['Kem dưỡng 40ml', 'Kem dưỡng 75ml', 'Serum 30ml']], ['Chống nắng', ['Kem chống nắng SPF50 40ml', 'Xịt chống nắng 100ml']]],
  TRANACIX: [['Nám & sạm', ['Kem dưỡng 30ml', 'Serum 30ml', 'Viên uống 60 viên', 'Kem chống nắng 40ml']]],
  VITILSI: [['Chăm sóc da', ['Kem 50ml', 'Kem 100ml', 'Gel 30ml']], ['Bổ sung', ['Viên uống 30 viên', 'Viên uống 60 viên']]],
  BIOTOPIX: [['Da nhạy cảm', ['Kem làm dịu 40ml', 'Sữa tắm 400ml', 'Dầu gội 200ml']], ['Phục hồi', ['Kem phục hồi 50ml', 'Kem dưỡng thể 200ml', 'Xịt khoáng 150ml']]],
  ALPHASCIENCE: [['Chống lão hoá', ['Serum Tannic 30ml', 'Kem đêm 50ml', 'Kem mắt 15ml']], ['Tái tạo', ['Tinh chất 30ml', 'Peel 50ml', 'Mặt nạ 75ml', 'Kem chống nắng 50ml']]],
};

function buildProducts() {
  const out: Array<typeof s.products.$inferInsert> = [];
  let pi = 0;
  for (const b of BRANDS) for (const [line, names] of LINES[b]) for (const n of names) {
    pi++;
    const price = between(18, 95) * 10000;
    const sun = b === 'NOREVA' && line === 'Chống nắng';
    out.push({ sku: b.slice(0, 3) + '-' + pad(pi, 3), brand: b, line, name: b + ' ' + n, price, cost: Math.round(price * 0.52 / 1000) * 1000, noPoint: pi === 9, multiplier: sun ? 2 : 1, multiplierUntil: sun ? '31/12/2026' : '', reg: 'Số CB ' + pad(between(100, 999), 3) + '/23/CBMP-QLD', stock: between(40, 900) });
  }
  return out;
}

const GIFTS: Array<typeof s.gifts.$inferInsert> = [
  { id: 'Q01', name: 'Voucher trừ tiền hàng 1.000.000đ', type: 'Trừ tiền hàng', points: 1000, value: 1e6, stock: null, status: 'Đang mở' },
  { id: 'Q02', name: 'Voucher trừ tiền hàng 3.000.000đ', type: 'Trừ tiền hàng', points: 3000, value: 3e6, stock: null, status: 'Đang mở' },
  { id: 'Q03', name: 'Voucher mua sắm 2.000.000đ', type: 'Voucher', points: 2000, value: 2e6, stock: 48, status: 'Đang mở' },
  { id: 'Q04', name: 'Bộ quà Tết DMP 2027', type: 'Hàng hoá', points: 1800, value: 1.8e6, stock: 120, window: 'Mở đổi 01/12/2026 – 25/01/2027', status: 'Sắp mở', tag: 'Mới' },
  { id: 'Q05', name: 'Máy đo huyết áp điện tử', type: 'Hàng hoá', points: 1200, value: 1.2e6, stock: 35, status: 'Đang mở' },
  { id: 'Q06', name: 'Tủ trưng bày mỹ phẩm', type: 'Hàng hoá', points: 6500, value: 6.5e6, minTier: 'silver', stock: 10, status: 'Đang mở' },
  { id: 'Q07', name: 'Nồi chiên không dầu 6L', type: 'Hàng hoá', points: 2500, value: 2.5e6, stock: 22, status: 'Đang mở' },
  { id: 'Q08', name: 'Bộ ấm chén sứ cao cấp', type: 'Hàng hoá', points: 1500, value: 1.5e6, stock: 0, status: 'Hết hàng' },
  { id: 'Q09', name: 'Điện thoại thông minh', type: 'Hàng hoá', points: 15000, value: 15e6, minTier: 'gold', stock: 5, status: 'Đang mở' },
  { id: 'Q10', name: 'Voucher trừ tiền hàng 10.000.000đ', type: 'Trừ tiền hàng', points: 10000, value: 10e6, minTier: 'gold', stock: null, status: 'Đang mở' },
  { id: 'Q11', name: 'Du lịch Đà Nẵng 3N2Đ', type: 'Du lịch', points: 30000, value: 30e6, minTier: 'diamond', stock: 6, window: 'Khởi hành 04/2027', status: 'Đang mở' },
  { id: 'Q12', name: 'Du lịch Thái Lan 5N4Đ', type: 'Du lịch', points: 45000, value: 45e6, minTier: 'diamond', stock: 4, window: 'Khởi hành 06/2027', status: 'Đang mở' },
];

const TABLES = ['payments', 'files', 'campaigns', 'courses', 'course_attempts', 'evidence', 'complaints', 'sales_docs', 'scheduled_broadcasts', 'agent_monthly', 'tier_history', 'job_runs', 'audit_log', 'notifications', 'applications', 'approvals', 'redemptions', 'gifts', 'periods', 'point_lots', 'point_ledger', 'returns', 'orders', 'products', 'contracts', 'otp_codes', 'agent_accounts', 'agents', 'users', 'rule_sets', 'monthly_stats', 'counters'];

export async function resetAndSeed(db: DB) {
  seed = 20261028;
  // TRUNCATE không kích hoạt trigger chặn DELETE của sổ cái — chỉ dùng khi reset dữ liệu demo.
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
  await seedAll(db);
}

async function seedAll(db: DB) {
  const P = DEFAULT_PARAMS;
  const hash = await bcrypt.hash(DEMO_PASSWORD, 8);
  const PHONES: Record<string, string> = { 'u-s1': '0901 234 567', 'u-s2': '0902 345 678', 'u-s3': '0903 456 789', 'u-tpkd': '0904 567 890' };
  await db.insert(s.users).values(USERS.map((u) => ({ ...u, passwordHash: hash, status: (u as any).status ?? 'Đang hoạt động', phone: PHONES[u.id] ?? '' })));
  await db.insert(s.ruleSets).values({ status: 'Hiệu lực', params: P, note: 'Bộ v1 theo khảo sát — tham số [CHỜ CHỐT]', createdBy: 'Hoàng Thị Mai (KTT)', approvedBy: 'Nguyễn Văn An (BOD)', effectiveFrom: new Date(2026, 9, 1) });

  const agents = buildAgents();
  const products = buildProducts();
  await db.insert(s.products).values(products);

  // Đơn hàng (tháng 10/2026)
  const ORDER_STATUS = ['Hoàn tất', 'Hoàn tất', 'Hoàn tất', 'Hoàn tất', 'Chờ duyệt', 'Đang giao', 'Huỷ', 'Trả hàng một phần'];
  const orders: Array<typeof s.orders.$inferInsert & { _paid: boolean }> = [];
  for (let o = 0; o < 42; o++) {
    let ag = o < 6 ? agents[0] : agents[1 + Math.floor(rnd() * 59)];
    if (ag.status === 'dormant') ag = agents[2];
    const n = between(2, 5);
    const ls: OrderLineInput[] = [];
    for (let q = 0; q < n; q++) { const p = products[Math.floor(rnd() * products.length)]; ls.push({ sku: p.sku, name: p.name, price: p.price, qty: between(3, 40), discount: pick([0, 0.05, 0.1]), noPoint: p.noPoint ?? false, multiplier: p.multiplier ?? 1 }); }
    const st = o === 0 ? 'Hoàn tất' : pick(ORDER_STATUS);
    const paid = st === 'Hoàn tất' && (o === 0 ? false : rnd() < 0.6);
    const day = Math.max(1, 27 - Math.floor(o / 2));
    const ship = pick([0, 0, 30000, 50000]);
    const time = pad(between(8, 17), 2) + ':' + pad(between(0, 59), 2);
    const pay = st === 'Huỷ' ? '—' : paid ? 'Đã thanh toán' : ag.overdueDays ? 'Quá hạn' : pick(['Chưa thanh toán', 'Thanh toán một phần']);
    const cp = computeOrderPoints(ls, ag.tier, P, { ship, paid });
    let pointState = st === 'Huỷ' ? 'revoked' : st === 'Hoàn tất' ? (paid ? 'available' : 'pending') : 'none';
    let returnedPct = 0;
    if (st === 'Trả hàng một phần') { pointState = 'available'; returnedPct = 0.3; }
    orders.push({ id: 'DH' + pad(o === 0 ? 123 : 1100 - o * 7, 4), agentId: ag.id, orderedAt: parseVN(d(2026, 10, day), time), source: o % 5 === 3 ? 'App' : 'KiotViet', status: st, pay, ship, value: cp.value + ship, lines: ls, points: cp.total, pointState, tierAtOrder: ag.tier, ruleVersion: 1, calc: { steps: cp.steps, total: cp.total }, returnedPct, paidAt: paid ? parseVN(d(2026, 10, Math.min(28, day + 1))) : null, _paid: paid });
  }
  // Đơn DH0123 cố định cho kịch bản 4
  {
    const o0 = orders[0];
    o0.lines = [
      { sku: 'NOR-005', name: 'NOREVA Kem chống nắng SPF50 40ml', price: 365000, qty: 24, discount: 0.05, multiplier: 1 },
      { sku: 'ALP-022', name: 'ALPHASCIENCE Serum Tannic 30ml', price: 890000, qty: 12, discount: 0.05, multiplier: 1 },
      { sku: 'TRA-008', name: 'TRANACIX Viên uống 60 viên', price: 520000, qty: 10, discount: 0, multiplier: 1 },
      { sku: 'BIO-016', name: 'BIOTOPIX Kem làm dịu 40ml (hàng tặng)', price: 240000, qty: 2, discount: 0, noPoint: true, multiplier: 1 },
    ];
    const cp = computeOrderPoints(o0.lines, 'gold', P, { paid: false });
    Object.assign(o0, { ship: 0, calc: { steps: cp.steps, total: cp.total }, points: cp.total, value: cp.value + cp.excluded, pay: 'Chưa thanh toán', orderedAt: parseVN('26/10/2026', '09:42'), pointState: 'pending' });
  }

  // Ghi đại lý (số dư điểm sẽ được tính lại từ sổ cái ở cuối)
  await db.insert(s.agents).values(agents.map((a) => ({
    id: a.id, name: a.name, type: a.type, owner: a.owner, phone: a.phone, idCard: a.idCard, dob: a.dob, address: a.address, city: a.city, taxCode: a.taxCode,
    bank: a.bank, bankName: a.bankName, saleId: a.sale, tier: a.tier, tierProtectedUntil: a.protectedUntil ? parseVN(a.protectedUntil, '23:59') : null,
    status: a.status, flags: a.flags, startDate: a.start, creditLimit: a.creditLimit, creditDays: a.creditDays, referrerId: a.referrer || null,
    appActivated: a.appActivated, push: a.push, salesMonth: a.salesMonth, salesLastMonth: a.salesLastMonth, debt: a.debt, overdueDays: a.overdueDays, lastOrder: a.lastOrder,
  })));
  await db.insert(s.agentAccounts).values([
    { agentId: agents[0].id, phone: agents[0].phone, name: agents[0].owner, role: 'DLC' },
    { agentId: agents[0].id, phone: '0987000125', name: 'Lê Văn Phúc (nhân viên)', role: 'DLNV' },
    ...agents.slice(1).filter((a) => a.appActivated).map((a) => ({ agentId: a.id, phone: a.phone, name: a.owner, role: 'DLC' })),
  ]);
  await db.insert(s.contracts).values(agents.map((a, i) => ({
    id: a.contractNo, agentId: a.id, startDate: '01/01/2026', endDate: a.contractEnd, commitMonth: a.commitMonth,
    policy: `Chiết khấu kênh ${a.type.toLowerCase()} · cam kết ${Math.round(a.commitMonth / 1e6)} triệu/tháng · nợ ${a.creditDays} ngày`,
    status: a.flags.includes('expiring') ? 'Sắp hết hạn' : 'Hiệu lực',
  })));
  await db.insert(s.orders).values(orders.map(({ _paid, ...o }) => o));
  // Công nợ = tổng đơn chưa thanh toán (đại lý không có đơn tháng này giữ nợ chuyển sang từ MISA)
  for (const a of agents) {
    const unpaid = orders.filter((o) => o.agentId === a.id && o.pay !== 'Đã thanh toán' && o.status !== 'Huỷ').reduce((t, o) => t + Math.round((o.value as number) * (1 - (o.returnedPct ?? 0))), 0);
    if (unpaid) await db.update(s.agents).set({ debt: Math.round(unpaid), creditLimit: Math.max(a.creditLimit, Math.ceil(unpaid * 1.3 / 1e7) * 1e7) }).where(sql`id = ${a.id}`);
  }

  // ---- Sổ cái ----
  type L = typeof s.ledger.$inferInsert;
  const entries: L[] = [];
  const lots: Array<{ idx: number; agentId: string; amount: number; remaining: number; expiresAt: Date }> = [];
  const push = (e: L, lot?: { remaining?: number; expiresAt: Date }) => {
    entries.push(e);
    if (lot && (e.deltaReward ?? 0) > 0) lots.push({ idx: entries.length - 1, agentId: e.agentId, amount: e.deltaReward!, remaining: lot.remaining ?? e.deltaReward!, expiresAt: lot.expiresAt });
  };
  const at = (dt: string, t = '09:00') => parseVN(dt, t);
  const hero = agents[0];
  // Đơn hàng → điểm
  for (const o of orders) {
    if (o.pointState === 'none' || !o.points) continue;
    const when = o.orderedAt as Date;
    const ag = agents.find((a) => a.id === o.agentId)!;
    const state = o.pointState === 'revoked' ? 'revoked' : o.pointState === 'pending' ? 'pending' : 'available';
    push({ agentId: o.agentId, createdAt: when, period: periodOf(when), type: 'earn', fund: 'both', deltaRank: o.points!, deltaReward: o.points!, state, item: `Lên đơn ${o.id}` + ((o.calc as any)?.steps?.[3]?.value !== '0' ? ' + thưởng mốc đơn' : ''), ref: o.id!, rule: 'R01, R02 v1', ruleVersion: 1, byUser: 'Tự động', expiresAt: endOfMonth(addMonths(when, P.expiryMonths)) },
      state === 'available' ? { expiresAt: endOfMonth(addMonths(when, P.expiryMonths)) } : undefined);
    if (o.returnedPct) {
      const back = Math.round(o.points! * o.returnedPct);
      push({ agentId: o.agentId, createdAt: new Date(+when + 86400000), period: periodOf(when), type: 'reverse', fund: 'both', deltaRank: -back, deltaReward: -back, state: 'available', item: `Trả hàng một phần ${o.id} (${Math.round(o.returnedPct * 100)}%)`, ref: o.id!, rule: 'R01 v1', ruleVersion: 1, byUser: 'Tự động (bút toán đảo)' });
    }
  }
  // Lịch sử mẫu của Nhà thuốc Minh Châu (khớp màn M03)
  const heroHist: Array<[string, string, string, number, string, string, string, string, string?]> = [
    ['12/03/2026', 'Thâm niên 5 năm hợp tác', 'TN-0312', 500, 'reward', 'activity', 'Tự động', 'R15 v1'],
    ['15/08/2026', 'Chúc mừng sinh nhật', 'BD-0815', 200, 'reward', 'activity', 'Tự động', 'R15 v1'],
    ['22/09/2026', 'Lên đơn DH0988', 'DH0988', 286, 'both', 'earn', 'Tự động', 'R01 v1'],
    ['30/09/2026', 'Hết hạn lô điểm 09/2025', 'LOT-2509', -240, 'reward', 'expire', 'Tự động', '—'],
    ['01/10/2026', 'Thưởng doanh số tháng 9 (đạt 100 triệu)', 'JOB-0110', 1000, 'both', 'bonus', 'Job ngày 01', 'R03 v1'],
    ['05/10/2026', 'Lên đơn DH1031', 'DH1031', 320, 'both', 'earn', 'Tự động', 'R01 v1'],
    ['12/10/2026', 'Trả hàng một phần DH1031 (30%)', 'TH0019', -96, 'both', 'reverse', 'Tự động (bút toán đảo)', 'R01 v1'],
    ['15/10/2026', 'Đào tạo offline: Sản phẩm NOREVA mới', 'ĐT-1015', 150, 'reward', 'activity', 'Nguyễn Văn An (BOD)', 'R07 v1'],
    ['20/10/2026', 'Lên đơn DH1072 + thưởng mốc đơn', 'DH1072', 512, 'both', 'earn', 'Tự động', 'R01, R02 v1'],
    ['24/10/2026', 'Đổi quà: Voucher trừ tiền hàng 1.000.000đ', 'DQ0045', -1000, 'reward', 'redeem', 'Phạm Thị Lan (KT)', '—'],
  ];
  // Dòng số dư chuyển đổi: phần còn lại để số dư khớp hồ sơ (18.400 điểm hạng, 12.500 điểm thưởng)
  const heroOrd = entries.filter((e) => e.agentId === hero.id && e.state === 'available');
  const histRank = heroHist.filter((h) => h[4] === 'both').reduce((t, h) => t + h[3], 0) + heroOrd.reduce((t, e) => t + (e.deltaRank ?? 0), 0);
  const histReward = heroHist.reduce((t, h) => t + h[3], 0) + heroOrd.reduce((t, e) => t + (e.deltaReward ?? 0), 0);
  const openRank = hero.rank - histRank, openReward = hero.reward - histReward;
  push({ agentId: hero.id, createdAt: at('31/12/2025', '23:59'), period: '2025-12', type: 'adjust', fund: 'both', deltaRank: openRank, deltaReward: openReward, state: 'available', item: 'Số dư chuyển đổi từ file Excel cũ', ref: 'MIG-2025', rule: '—', byUser: 'Hoàng Thị Mai (KTT)' });
  // Lô điểm của Minh Châu: 380 hết hạn 30/11/2026, 640 hết hạn 31/12/2026, 1.200 hết hạn 31/03/2027, phần còn lại về sau
  const heroLots: Array<[number, string]> = [[380, '30/11/2026'], [640, '31/12/2026'], [1200, '31/03/2027']];
  let lotLeft = hero.reward - lots.filter((l) => l.agentId === hero.id).reduce((t, l) => t + l.remaining, 0);
  for (const [amt, exp] of heroLots) { lots.push({ idx: entries.length - 1, agentId: hero.id, amount: amt, remaining: amt, expiresAt: at(exp, '23:59') }); lotLeft -= amt; }
  for (const h of heroHist) {
    const [dt, item, ref, pts, fund, type, by, rule] = h;
    push({ agentId: hero.id, createdAt: at(dt, '10:00'), period: periodOf(at(dt)), type, fund, deltaRank: fund === 'both' ? pts : 0, deltaReward: pts, state: type === 'expire' ? 'expired' : 'available', item, ref, rule, ruleVersion: rule === '—' ? null : 1, byUser: by });
  }
  lots.push({ idx: entries.length - 1, agentId: hero.id, amount: lotLeft, remaining: lotLeft, expiresAt: at('31/10/2027', '23:59') });

  // Các đại lý còn lại: dòng số dư chuyển đổi bù cho khớp số dư hồ sơ
  for (const a of agents.slice(1)) {
    const fromOrders = entries.filter((e) => e.agentId === a.id && e.state === 'available');
    const r = fromOrders.reduce((t, e) => t + (e.deltaRank ?? 0), 0);
    const w = fromOrders.reduce((t, e) => t + (e.deltaReward ?? 0), 0);
    const openR = a.rank - r, openW = Math.max(0, a.reward - w);
    push({ agentId: a.id, createdAt: at('31/12/2025', '23:59'), period: '2025-12', type: 'adjust', fund: 'both', deltaRank: openR, deltaReward: openW, state: 'available', item: 'Số dư chuyển đổi từ file Excel cũ', ref: 'MIG-2025', rule: '—', byUser: 'Hoàng Thị Mai (KTT)' },
      openW > 0 ? { expiresAt: at(pick(['30/11/2026', '31/12/2026', '31/03/2027', '30/06/2027']), '23:59') } : undefined);
  }
  // Ghi theo lô 200 dòng
  const ids: number[] = [];
  for (let i = 0; i < entries.length; i += 200) {
    const res = await db.insert(s.ledger).values(entries.slice(i, i + 200)).returning({ id: s.ledger.id });
    ids.push(...res.map((r) => r.id));
  }
  if (lots.length) await db.insert(s.pointLots).values(lots.map((l) => ({ agentId: l.agentId, ledgerId: ids[l.idx], amount: l.amount, remaining: l.remaining, expiresAt: l.expiresAt })));
  // Lô hết hạn đã tiêu thụ trước (đổi quà 1.000 của Minh Châu đã trừ vào lô cũ, đã phản ánh trong số dư chuyển đổi)

  // Cập nhật số dư đệm từ sổ cái
  await db.execute(sql`
    UPDATE agents a SET
      rank_points = COALESCE((SELECT SUM(delta_rank) FROM point_ledger l WHERE l.agent_id = a.id AND l.state IN ('available','expired')), 0),
      reward_points = COALESCE((SELECT SUM(delta_reward) FROM point_ledger l WHERE l.agent_id = a.id AND l.state IN ('available','expired')), 0),
      pending_points = COALESCE((SELECT SUM(delta_reward) FROM point_ledger l WHERE l.agent_id = a.id AND l.state = 'pending'), 0)`);

  await db.insert(s.periods).values([
    { period: '2026-07', locked: true, lockedBy: 'Hoàng Thị Mai (KTT)', lockedAt: at('05/08/2026', '17:00') },
    { period: '2026-08', locked: true, lockedBy: 'Hoàng Thị Mai (KTT)', lockedAt: at('05/09/2026', '17:00') },
    { period: '2026-09', locked: true, lockedBy: 'Hoàng Thị Mai (KTT)', lockedAt: at('05/10/2026', '16:30') },
    { period: '2026-10', locked: false },
  ]);

  await db.insert(s.gifts).values(GIFTS);
  const gname = (id: string) => GIFTS.find((g) => g.id === id)!;
  const R: Array<[string, number, string, string, string, string?]> = [
    ['DQ0052', 17, 'Q01', 'new', '28/10/2026 08:05'], ['DQ0051', 26, 'Q07', 'new', '27/10/2026 16:20'], ['DQ0050', 5, 'Q05', 'confirmed', '27/10/2026 10:11'],
    ['DQ0045', 0, 'Q01', 'confirmed', '26/10/2026 08:12'], ['DQ0044', 13, 'Q06', 'approved', '25/10/2026 14:02'], ['DQ0042', 20, 'Q03', 'shipping', '23/10/2026 09:30'],
    ['DQ0041', 8, 'Q07', 'shipping', '22/10/2026 11:47'], ['DQ0038', 30, 'Q05', 'done', '18/10/2026 15:10'], ['DQ0036', 2, 'Q02', 'done', '15/10/2026 08:55'],
    ['DQ0035', 40, 'Q08', 'cancelled', '14/10/2026 13:22', 'Hết hàng — đã hoàn 1.500 điểm'],
  ];
  await db.insert(s.redemptions).values(R.map(([id, ai, gid, stage, dt, note]) => {
    const [dd, tt] = dt.split(' ');
    return { id, agentId: agents[ai].id, giftId: gid, giftName: gname(gid).name, points: gname(gid).points, stage, note: note ?? '', createdAt: parseVN(dd, tt), history: [{ stage: 'new', by: agents[ai].owner + ' (ĐL-C)', at: dt }] };
  }));

  const ap = (id: string, kind: string, ai: number, title: string, points: number | null, by: string, role: string, reason: string, files: number, hoursAgo: number, extra: Partial<typeof s.approvals.$inferInsert> = {}) => ({
    id, kind, agentId: agents[ai].id, title, points, requestedBy: by, requestedRole: role, reason, files, requestedAt: new Date(+SEED_TODAY - hoursAgo * 3600e3), dueAt: new Date(+SEED_TODAY - hoursAgo * 3600e3 + 48 * 3600e3), ...extra,
  });
  await db.insert(s.approvals).values([
    ap('YC0231', 'manual', 14, 'Sự kiện: Hội nghị khách hàng 2026', 300, 'Đỗ Minh Thư (MKT)', 'MKT', 'Tham dự hội nghị 24/10, có điểm danh QR', 2, 4, { payload: { rule: 'R08', batch: 'Lô HN-2410' } }),
    ap('YC0230', 'manual', 21, 'Đào tạo offline: Sản phẩm NOREVA mới', 150, 'Trần Văn Nam (Sale)', 'SALE', 'Đạt bài test 9/10', 1, 24, { payload: { rule: 'R07' } }),
    ap('YC0229', 'evidence', 6, 'Trưng bày đạt chuẩn tháng 10', 200, 'Đại lý nộp · Sale đã xác nhận', 'DLC', '4 ảnh quầy trưng bày NOREVA', 4, 48, { phase: 'GĐ2', payload: { rule: 'R10' } }),
    ap('YC0228', 'adjust', 35, 'Điều chỉnh: cộng thiếu điểm đơn DH0971', 180, 'Hoàng Thị Mai (KTT)', 'KTT', 'Đơn đồng bộ lỗi từ KiotViet ngày 03/10, thiếu 2 dòng SP', 1, 26),
    ap('YC0227', 'tier', 4, 'Nâng hạng tay: giữ hạng Kim Cương', null, 'Vũ Đức Long (TPKD)', 'TPKD', 'Phòng khám mở chi nhánh 2, cam kết doanh số quý I/2027', 1, 72, { payload: { tier: 'diamond' } }),
    ap('YC0226', 'credit', 11, 'Ngoại lệ đặt hàng khi nợ quá hạn (đơn 32.000.000đ)', null, 'Lê Thu Hà (Sale)', 'SALE', 'Đại lý cam kết thanh toán 48 triệu trước 05/11', 1, 6, { payload: { amount: 32e6 } }),
  ]);

  await db.insert(s.applications).values([
    { id: 'HS0018', name: 'Nhà thuốc Thiện Tâm', type: 'Nhà thuốc', owner: 'Phạm Thị Tâm', phone: '0987654321', city: 'Hà Nội', address: '12 Kim Mã, Ba Đình', saleId: 'u-s1', createdAt: at('27/10/2026', '15:20'), stage: 'BOD duyệt', docs: ['CCCD mặt trước', 'CCCD mặt sau', 'GPKD', 'Hợp đồng ký'], commitMonth: 20e6, creditDays: 15, policy: 'Chiết khấu kênh nhà thuốc · cam kết 20 triệu/tháng · nợ 15 ngày', referrerId: 'DL00125', history: [{ stage: 'Sale đề xuất', by: 'Trần Văn Nam (Sale)', at: '27/10/2026 15:20' }] },
    { id: 'HS0017', name: 'Spa Lily Beauty', type: 'Spa', owner: 'Trần Ngọc Lily', phone: '0903111222', city: 'TP.HCM', address: '88 Võ Văn Tần, Q.3', saleId: 'u-s2', createdAt: at('26/10/2026', '10:05'), stage: 'KT cấp mã', docs: ['CCCD mặt trước', 'CCCD mặt sau', 'GPKD', 'Hợp đồng ký'], commitMonth: 15e6, creditDays: 0, policy: 'Chiết khấu kênh spa · cam kết 15 triệu/tháng · nợ 0 ngày', history: [{ stage: 'Sale đề xuất', by: 'Lê Thu Hà (Sale)', at: '26/10/2026 10:05' }, { stage: 'BOD đã duyệt', by: 'Nguyễn Văn An (BOD)', at: '27/10/2026 08:40' }] },
    { id: 'HS0016', name: 'Phòng khám Da liễu Sài Gòn Xanh', type: 'Phòng khám', owner: 'Võ Minh Khoa', phone: '0938222333', city: 'TP.HCM', saleId: 'u-s2', createdAt: at('22/10/2026', '14:00'), stage: 'Từ chối', reason: 'Thiếu GPKD bản chứng thực', docs: ['CCCD mặt trước', 'CCCD mặt sau'], policy: '—', history: [{ stage: 'Sale đề xuất', by: 'Lê Thu Hà (Sale)', at: '22/10/2026 14:00' }, { stage: 'Từ chối', by: 'Nguyễn Văn An (BOD)', at: '23/10/2026 09:10', note: 'Thiếu GPKD bản chứng thực' }] },
  ]);

  const MONTHS = ['T11/25', 'T12/25', 'T1/26', 'T2/26', 'T3/26', 'T4/26', 'T5/26', 'T6/26', 'T7/26', 'T8/26', 'T9/26', 'T10/26'];
  const revenue = [3.62, 4.95, 5.4, 2.88, 3.71, 3.95, 4.1, 3.86, 3.92, 4.18, 4.4, 4.82];
  const revenueLY = [3.2, 4.3, 4.85, 2.6, 3.35, 3.4, 3.62, 3.5, 3.55, 3.7, 3.95, 4.29];
  const issued = [36100, 49800, 54600, 28900, 37400, 39800, 41300, 38900, 39500, 42200, 44600, 48200];
  const redeemed = [12100, 18400, 31200, 9800, 11900, 13100, 14600, 12800, 13900, 15100, 17800, 21400];
  const activeRate = [61, 66, 72, 54, 60, 62, 63, 61, 64, 66, 70, 68];
  const commitActual = [71, 92, 101, 58, 77, 80, 84, 79, 83, 88, 98, 86.5];
  await db.insert(s.monthlyStats).values(MONTHS.map((m, i) => ({ month: m, ord: i, revenue: revenue[i] * 1e9, revenueLY: revenueLY[i] * 1e9, issued: issued[i], redeemed: redeemed[i], activeRate: activeRate[i], commitActual: commitActual[i] * 1e6 })));

  await db.insert(s.notifications).values([
    { agentId: hero.id, phone: hero.phone, template: 'order_approved', title: 'Đơn được duyệt', body: 'Đơn DH0123 trị giá 26.562.800đ đã được duyệt. Dự kiến +512 điểm.', createdAt: at('26/10/2026', '09:45') },
    { agentId: hero.id, phone: hero.phone, template: 'expiring', title: 'Điểm sắp hết hạn', body: '380 điểm của Quý đại lý sẽ hết hạn ngày 30/11/2026.', createdAt: at('25/10/2026', '08:00'), read: true },
    { agentId: hero.id, phone: hero.phone, template: 'redeem', title: 'Yêu cầu đổi quà', body: 'Yêu cầu đổi Voucher trừ tiền hàng 1.000.000đ (DQ0045) đã được Sale xác nhận.', createdAt: at('24/10/2026', '10:20'), read: true },
    { agentId: hero.id, phone: hero.phone, channel: 'App', template: 'campaign', title: 'Hàng mới NOREVA — ×2 điểm', body: 'Kem chống nắng SPF50 nhân đôi điểm tới 31/12/2026.', createdAt: at('20/10/2026', '08:00'), read: true },
  ]);

  await db.insert(s.auditLog).values([
    { at: at('26/10/2026', '08:30'), userName: 'Đinh Công Sơn', role: 'SA', action: 'Đồng bộ lại KiotViet', target: 'Tích hợp', oldValue: 'Lỗi 03/10', newValue: 'OK', ip: '113.190.12.40' },
    { at: at('27/10/2026', '11:03'), userName: 'Vũ Đức Long', role: 'TPKD', action: 'Xuất Excel danh sách đại lý', target: 'W03', newValue: '60 dòng', ip: '27.72.101.9' },
    { at: at('27/10/2026', '15:10'), userName: 'Hoàng Thị Mai', role: 'KTT', action: 'Đề xuất điều chỉnh điểm', target: 'YC0228', newValue: '+180', ip: '113.190.12.47' },
    { at: at('27/10/2026', '17:45'), userName: 'Phạm Thị Lan', role: 'KT', action: 'Sửa số tài khoản ngân hàng', target: 'DL00342', oldValue: '**21', newValue: '**67', ip: '113.190.12.51' },
  ]);

  await db.insert(s.counters).values([
    { key: 'DH', value: 1101 }, { key: 'DQ', value: 52 }, { key: 'YC', value: 231 }, { key: 'HS', value: 18 }, { key: 'TH', value: 21 }, { key: 'DL', value: 400 }, { key: 'HD', value: 160 },
  ]);
  // TH0021 — phiếu trả hàng chờ xử lý cho kịch bản 7 tạo ở bước demo (W09), không seed sẵn.
  await seedExtras(db, agents, orders);
}

/** Tạo file PDF một trang (tài liệu mẫu) trong thư mục upload. */
function samplePdf(title: string): { id: string; path: string; size: number } {
  const dir = process.env.UPLOAD_DIR ?? path.resolve(__dirname, '../../.data/uploads');
  fs.mkdirSync(dir, { recursive: true });
  const ascii = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[()\\]/g, '');
  const stream = `BT /F1 20 Tf 60 760 Td (${ascii}) Tj 0 -30 Td /F1 12 Tf (Tai lieu mau - DMP Viet Phap) Tj ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const id = crypto.createHash('md5').update(title).digest('hex').slice(0, 24);
  const p = path.join(dir, id);
  fs.writeFileSync(p, pdf);
  return { id, path: p, size: pdf.length };
}

async function seedExtras(db: DB, agents: SeedAgent[], orders: Array<typeof s.orders.$inferInsert>) {
  const hero = agents[0];
  const at = (dt: string, t = '09:00') => parseVN(dt, t);
  const MONTHS = ['T11/25', 'T12/25', 'T1/26', 'T2/26', 'T3/26', 'T4/26', 'T5/26', 'T6/26', 'T7/26', 'T8/26', 'T9/26', 'T10/26'];
  const SEASON = [0.78, 1.05, 1.14, 0.62, 0.79, 0.84, 0.87, 0.82, 0.83, 0.88, 0.94, 1];

  // Doanh số 12 tháng theo đại lý: T10 = tháng hiện tại, T9 = tháng trước, các tháng khác theo mùa vụ
  const am: Array<typeof s.agentMonthly.$inferInsert> = [];
  for (const a of agents) for (let i = 0; i < 12; i++) {
    const sales = i === 11 ? a.salesMonth : i === 10 ? a.salesLastMonth : Math.round(Math.max(a.salesMonth, a.salesLastMonth) * SEASON[i] * (0.85 + rnd() * 0.3) / 100000) * 100000;
    am.push({ agentId: a.id, month: MONTHS[i], sales: a.status === 'dormant' && i >= 9 ? 0 : sales, commit: a.commitMonth });
  }
  // Co từng tháng để tổng các đại lý khớp chuỗi doanh thu công ty (biểu đồ W02/W22)
  const REV = [3.62, 4.95, 5.4, 2.88, 3.71, 3.95, 4.1, 3.86, 3.92, 4.18, 4.4, 4.82];
  for (let i = 0; i < 11; i++) {
    const rows = am.filter((r) => r.month === MONTHS[i]);
    const f = (REV[i] * 1e9) / rows.reduce((t, r) => t + (r.sales as number), 0);
    rows.forEach((r) => { r.sales = Math.round(((r.sales as number) * f) / 100000) * 100000; });
  }
  for (let i = 0; i < am.length; i += 300) await db.insert(s.agentMonthly).values(am.slice(i, i + 300));

  // Phân bổ hạng 12 tháng (tháng cuối = hiện tại)
  const cur = Object.fromEntries((['member', 'bronze', 'silver', 'gold', 'diamond', 'strategic'] as Tier[]).map((t) => [t, agents.filter((a) => a.tier === t).length]));
  await db.insert(s.tierHistory).values(MONTHS.map((m, i) => {
    const back = 11 - i;
    return { month: m, counts: { member: cur.member + Math.round(back * 0.7), bronze: Math.max(0, cur.bronze - Math.round(back * 0.25)), silver: Math.max(0, cur.silver - Math.round(back * 0.2)), gold: Math.max(0, cur.gold - Math.round(back * 0.15)), diamond: Math.max(0, cur.diamond - Math.round(back * 0.1)), strategic: cur.strategic } };
  }));

  // Lịch sử thanh toán cho đơn đã thanh toán; một số đơn thanh toán một phần
  const pays: Array<typeof s.payments.$inferInsert> = [];
  for (const o of orders) {
    if (o.pay === 'Đã thanh toán') pays.push({ orderId: o.id!, agentId: o.agentId, amount: o.value as number, method: 'Chuyển khoản', source: rnd() < 0.5 ? 'MISA' : 'Thủ công', byUser: 'Phạm Thị Lan (KT)', at: (o.paidAt as Date) ?? new Date() });
    if (o.pay === 'Thanh toán một phần') {
      const part = Math.round((o.value as number) * 0.4 / 1000) * 1000;
      pays.push({ orderId: o.id!, agentId: o.agentId, amount: part, method: 'Chuyển khoản', source: 'Thủ công', byUser: 'Phạm Thị Lan (KT)', at: new Date(+(o.orderedAt as Date) + 2 * 86400e3) });
      await db.update(s.orders).set({ paidAmount: part }).where(sql`id = ${o.id}`);
      await db.update(s.agents).set({ debt: sql`greatest(0, debt - ${part})` }).where(sql`id = ${o.agentId}`);
    }
  }
  if (pays.length) await db.insert(s.payments).values(pays);
  await db.update(s.agentAccounts).set({ consentAt: at('12/03/2026', '10:20'), consentDevice: 'iPhone · Safari' }).where(sql`phone = ${hero.phone}`);

  // Campaign (W18)
  await db.insert(s.campaigns).values([
    { id: 'CP00', name: 'Ra mắt TRANACIX viên uống ×2', kind: 'multiplier', value: 2, scope: { brands: ['TRANACIX'], skus: [] }, fromDate: at('01/07/2026', '00:00'), toDate: at('31/08/2026', '23:59'), budget: 15000, used: 15200, status: 'Đã duyệt', createdBy: 'Đỗ Minh Thư (MKT)' },
    { id: 'CP01', name: 'NOREVA chống nắng ×2 điểm', kind: 'multiplier', value: 2, scope: { brands: ['NOREVA'], lines: ['Chống nắng'] }, fromDate: at('01/10/2026', '00:00'), toDate: at('31/12/2026', '23:59'), budget: 20000, used: 8400, status: 'Đã duyệt', createdBy: 'Đỗ Minh Thư (MKT)' },
    { id: 'CP02', name: 'Tết 2027: thưởng +300 khi đơn ≥ 30 triệu', kind: 'bonus', value: 300, scope: { minTier: 'silver', minOrderVND: 30e6 }, fromDate: at('01/12/2026', '00:00'), toDate: at('25/01/2027', '23:59'), budget: 36000, used: 0, status: 'Chờ BOD duyệt', note: 'Kích cầu nhập hàng Tết', createdBy: 'Đỗ Minh Thư (MKT)' },
    { id: 'CP03', name: 'Spa: ALPHASCIENCE ×1,5', kind: 'multiplier', value: 1.5, scope: { brands: ['ALPHASCIENCE'], types: ['Spa'] }, fromDate: at('15/01/2027', '00:00'), toDate: at('15/03/2027', '23:59'), budget: 12000, used: 0, status: 'Nháp', createdBy: 'Đỗ Minh Thư (MKT)' },
  ]);
  await db.insert(s.approvals).values({ id: 'YC0225', kind: 'campaign', title: 'Campaign CP02: Tết 2027: thưởng +300 khi đơn ≥ 30 triệu', points: 36000, requestedBy: 'Đỗ Minh Thư (MKT)', requestedRole: 'MKT', reason: 'Kích cầu nhập hàng Tết, ngân sách 36.000 điểm', payload: { campaignId: 'CP02', requesterId: 'u-mkt' }, requestedAt: new Date(+SEED_TODAY - 30 * 3600e3), dueAt: new Date(+SEED_TODAY + 18 * 3600e3) });

  // Đào tạo & sự kiện (W19, M13)
  const QUIZ1 = [
    { q: 'SPF50 phù hợp nhất cho trường hợp nào?', options: ['Da ở trong nhà cả ngày', 'Hoạt động ngoài trời trên 2 giờ', 'Chỉ dùng buổi tối'], answer: 1 },
    { q: 'Bảo quản kem chống nắng ở đâu?', options: ['Nơi khô ráo dưới 30°C', 'Trong xe ô tô', 'Ngoài nắng'], answer: 0 },
    { q: 'Khi khách có da nhạy cảm, nên gợi ý dòng nào?', options: ['ALPHASCIENCE Peel', 'BIOTOPIX làm dịu', 'TRANACIX viên uống'], answer: 1 },
    { q: 'Thoa lại kem chống nắng sau bao lâu khi ở ngoài trời?', options: ['2 giờ', '6 giờ', 'Không cần thoa lại'], answer: 0 },
    { q: 'NOREVA chống nắng hiện nhân mấy lần điểm?', options: ['×1', '×2', '×3'], answer: 1 },
  ];
  const QUIZ2 = [
    { q: 'Nám da thường nặng hơn khi nào?', options: ['Tiếp xúc nắng nhiều', 'Ngủ đủ giấc', 'Uống nhiều nước'], answer: 0 },
    { q: 'TRANACIX viên uống nên dùng tối thiểu bao lâu để thấy hiệu quả?', options: ['3 ngày', '1 tuần', '8–12 tuần'], answer: 2 },
    { q: 'Kết hợp nào đúng khi tư vấn khách bị nám?', options: ['Chỉ dùng serum', 'Serum + chống nắng hằng ngày', 'Không cần chống nắng'], answer: 1 },
  ];
  const QUIZ3 = [
    { q: 'Nhiệt độ bảo quản kho chuẩn?', options: ['Dưới 30°C, tránh ánh nắng', 'Trên 40°C', 'Bất kỳ'], answer: 0 },
    { q: 'Hàng cận date dưới 6 tháng xử lý thế nào?', options: ['Bán bình thường', 'Báo sale để đổi/trả theo chính sách', 'Huỷ ngay'], answer: 1 },
  ];
  const pdf = samplePdf('Quy trinh bao quan my pham 2026');
  await db.insert(s.files).values({ id: pdf.id, name: 'Quy trình bảo quản mỹ phẩm 2026.pdf', mime: 'application/pdf', size: pdf.size, path: pdf.path, owner: 'u-mkt' });
  await db.insert(s.courses).values([
    { id: 'KH01', name: 'Sản phẩm NOREVA mới 2026', type: 'offline', date: '15/10/2026', points: 150, rule: 'R07', content: 'Đào tạo tại văn phòng Hà Nội, 2 giờ, có bài test cuối buổi.', quiz: QUIZ1, status: 'Đã diễn ra' },
    { id: 'KH02', name: 'Tư vấn da nám với TRANACIX', type: 'online', date: 'Luôn mở', points: 50, rule: 'R07', content: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', quiz: QUIZ2, status: 'Đang mở' },
    { id: 'SK01', name: 'Hội nghị khách hàng 2026', type: 'event', date: '24/10/2026', points: 300, rule: 'R08', content: 'Check-in bằng mã QR tại cửa hội trường.', status: 'Đã diễn ra' },
    { id: 'KH03', name: 'Đào tạo lại hằng năm: quy trình bảo quản', type: 'online', date: 'Hạn 31/12/2026', points: 50, rule: 'R07', content: 'Đọc tài liệu PDF rồi làm bài kiểm tra.', fileId: pdf.id, quiz: QUIZ3, status: 'Đang mở' },
  ]);
  const att: Array<typeof s.courseAttempts.$inferInsert> = [];
  agents.slice(0, 41).forEach((a, i) => att.push({ courseId: 'KH01', agentId: a.id, score: i < 35 ? 4 + (i % 2) : 2, total: 5, passed: i < 35, method: 'quiz', createdAt: at('15/10/2026', '16:00') }));
  agents.slice(3, 25).forEach((a, i) => att.push({ courseId: 'KH02', agentId: a.id, score: i < 19 ? 3 : 1, total: 3, passed: i < 19, method: 'quiz', createdAt: at(`${String(1 + (i % 27)).padStart(2, '0')}/10/2026`, '20:10') }));
  agents.slice(10, 48).forEach((a) => att.push({ courseId: 'SK01', agentId: a.id, score: 0, total: 0, passed: true, method: 'qr', approvalId: 'YC0231', createdAt: at('24/10/2026', '08:30') }));
  agents.slice(20, 29).forEach((a, i) => att.push({ courseId: 'KH03', agentId: a.id, score: i < 7 ? 2 : 1, total: 2, passed: i < 7, method: 'quiz', createdAt: at('20/10/2026', '21:00') }));
  await db.insert(s.courseAttempts).values(att);

  // Bằng chứng hoạt động (M12)
  await db.insert(s.evidence).values([
    { id: 'BC0001', agentId: agents[6].id, category: 'display', points: 200, note: '4 ảnh quầy trưng bày NOREVA', stage: 'Chờ Marketing duyệt', approvalId: 'YC0229', createdAt: at('26/10/2026', '10:00'), history: [{ stage: 'Đã nộp', by: agents[6].owner + ' (ĐL-C)', at: '26/10/2026 10:00' }, { stage: 'Sale đã xác nhận', by: 'Trần Văn Nam (Sale)', at: '26/10/2026 15:30' }] },
    { id: 'BC0002', agentId: hero.id, category: 'post', points: 30, link: 'https://facebook.com/nhathuocminhchau/posts/2026102001', stage: 'Đã duyệt', createdAt: at('20/10/2026', '19:00'), history: [{ stage: 'Đã nộp', by: hero.owner + ' (ĐL-C)', at: '20/10/2026 19:00' }, { stage: 'Marketing đã duyệt', by: 'Đỗ Minh Thư (MKT)', at: '21/10/2026 09:00' }] },
    { id: 'BC0003', agentId: hero.id, category: 'display', points: 200, note: 'Quầy NOREVA mới sắp xếp lại', stage: 'Chờ Sale xác nhận', createdAt: at('27/10/2026', '17:40'), history: [{ stage: 'Đã nộp', by: hero.owner + ' (ĐL-C)', at: '27/10/2026 17:40' }] },
  ]);
  await db.update(s.approvals).set({ payload: { rule: 'R10', evidenceId: 'BC0001', fund: 'reward' } }).where(sql`id = 'YC0229'`);

  // Khiếu nại điểm (W21, M15)
  const due = (h: number) => new Date(+SEED_TODAY + h * 3600e3);
  await db.insert(s.complaints).values([
    { id: 'KN0012', agentId: hero.id, ref: 'DH1086', txLabel: 'Lên đơn DH1086', claim: 'Đơn DH1086 có 2 dòng NOREVA chống nắng nhưng không thấy nhân ×2 điểm', wantPoints: 323, status: 'Đang xử lý', assignee: 'Phạm Thị Lan (KT)', dueAt: due(48), createdAt: at('27/10/2026', '15:20'), history: [{ stage: 'Mới', by: hero.owner + ' (ĐL-C)', at: '27/10/2026 15:20' }, { stage: 'Đang xử lý', by: 'Phạm Thị Lan (KT)', at: '28/10/2026 08:10' }] },
    { id: 'KN0011', agentId: agents[8].id, ref: 'LOT-2510', txLabel: 'Hết hạn lô 10/2025', claim: 'Chưa nhận được nhắc trước khi điểm hết hạn', wantPoints: 240, status: 'Mới', dueAt: due(24), createdAt: at('26/10/2026', '09:05'), history: [{ stage: 'Mới', by: agents[8].owner + ' (ĐL-C)', at: '26/10/2026 09:05' }] },
    { id: 'KN0010', agentId: agents[19].id, ref: 'KH02', txLabel: 'Đào tạo online', claim: 'Đã đạt 9/10 nhưng chưa được cộng 50 điểm', wantPoints: 50, status: 'Mới', dueAt: due(-24), createdAt: at('22/10/2026', '11:40'), history: [{ stage: 'Mới', by: agents[19].owner + ' (ĐL-C)', at: '22/10/2026 11:40' }] },
    { id: 'KN0009', agentId: agents[30].id, ref: 'TH0015', txLabel: 'Trả hàng TH0015', claim: 'Thu hồi điểm sai tỷ lệ', wantPoints: 40, status: 'Đã giải quyết', resolution: 'Đã điều chỉnh +40 (YC0219)', assignee: 'Phạm Thị Lan (KT)', dueAt: at('21/10/2026', '08:30'), createdAt: at('18/10/2026', '08:30'), history: [{ stage: 'Mới', by: agents[30].owner + ' (ĐL-C)', at: '18/10/2026 08:30' }, { stage: 'Đã giải quyết', by: 'Nguyễn Văn An (BOD)', at: '19/10/2026 16:00' }] },
    { id: 'KN0008', agentId: agents[12].id, ref: 'DH0944', txLabel: 'Lên đơn DH0944', claim: 'Đơn dưới 3 triệu không có điểm — tôi nghĩ phải có', wantPoints: 25, status: 'Từ chối', resolution: 'Đơn dưới mức tối thiểu 3.000.000đ không tích điểm theo quy tắc R01', assignee: 'Hoàng Thị Mai (KTT)', dueAt: at('15/10/2026', '10:00'), createdAt: at('12/10/2026', '10:00'), history: [{ stage: 'Mới', by: agents[12].owner + ' (ĐL-C)', at: '12/10/2026 10:00' }, { stage: 'Từ chối', by: 'Hoàng Thị Mai (KTT)', at: '13/10/2026 09:20' }] },
  ]);

  // Tài liệu bán hàng (M16)
  const DOCS: Array<[string, string, string, string, string | null]> = [
    ['Bảng giá kênh Nhà thuốc T11/2026', 'file', 'PDF · 2 trang', 'Bảng giá', null], ['Bộ ảnh NOREVA chống nắng', 'image', '12 ảnh · 18 MB', 'Ảnh SP', null],
    ['Video 30s: TRANACIX trị nám', 'video', 'MP4 · 30 giây', 'Video', null], ['Bộ ảnh ALPHASCIENCE', 'image', '9 ảnh · 14 MB', 'Ảnh SP', null],
    ['Catalog 5 nhãn hàng 2026', 'file', 'PDF · 24 trang', 'Catalog', null], ['Mẫu bài đăng Facebook tháng 11', 'link', '4 mẫu + caption', 'Mẫu bài', null],
    ['Video hướng dẫn trưng bày quầy', 'video', 'MP4 · 2 phút', 'Video', 'silver'], ['Bảng giá kênh Spa T11/2026', 'file', 'PDF · 2 trang', 'Bảng giá', null],
  ];
  for (let i = 0; i < DOCS.length; i++) {
    const [title, kind, size, cat, minTier] = DOCS[i];
    const f = samplePdf(title);
    await db.insert(s.files).values({ id: f.id, name: title + '.pdf', mime: 'application/pdf', size: f.size, path: f.path, owner: 'u-mkt' }).onConflictDoNothing();
    await db.insert(s.salesDocs).values({ id: 'TL' + String(i + 1).padStart(3, '0'), title, kind, sizeLabel: size, category: cat, fileId: f.id, minTier, downloads: Math.floor(rnd() * 80), createdAt: at(`${String(28 - i * 2).padStart(2, '0')}/10/2026`) });
  }

  await db.insert(s.counters).values([{ key: 'CP', value: 3 }, { key: 'KH', value: 3 }, { key: 'SK', value: 1 }, { key: 'BC', value: 3 }, { key: 'KN', value: 12 }, { key: 'TL', value: 8 }]).onConflictDoNothing();
}
