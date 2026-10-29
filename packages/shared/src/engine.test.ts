import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS as P } from './defaults';
import { allocateFifo, computeOrderPoints, evaluateTier, simulate, tierForScore, tierProgress } from './engine';
import { canSeeField, can } from './permissions';

describe('computeOrderPoints', () => {
  // Đơn DH0123 của kịch bản 4 (Nhà thuốc Minh Châu, hạng Vàng)
  const lines = [
    { sku: 'NOR-005', name: 'Kem chống nắng', price: 365000, qty: 24, discount: 0.05 },
    { sku: 'ALP-022', name: 'Serum Tannic', price: 890000, qty: 12, discount: 0.05 },
    { sku: 'TRA-008', name: 'Viên uống', price: 520000, qty: 10 },
    { sku: 'BIO-016', name: 'Hàng tặng', price: 240000, qty: 2, noPoint: true },
  ];

  it('tính B1→B5 và loại hàng không tính điểm', () => {
    const r = computeOrderPoints(lines, 'gold', P);
    // (365000*24*0.95 + 890000*12*0.95 + 520000*10) * 1.1 = 26.034.800
    expect(r.value).toBe(26034800);
    expect(r.base).toBe(260);
    expect(r.multiplied).toBe(312); // ×1,2 hạng Vàng
    expect(r.bonus).toBe(200);
    expect(r.total).toBe(512);
    expect(r.excluded).toBe(528000);
    expect(r.steps.map((s) => s.code)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5']);
  });

  it('dùng hệ số SP cao nhất, không cộng dồn', () => {
    const r = computeOrderPoints([{ sku: 'a', name: 'a', price: 1e6, qty: 5, multiplier: 2 }, { sku: 'b', name: 'b', price: 1e6, qty: 5 }], 'member', P);
    expect(r.productMult).toBe(2);
    expect(r.multiplied).toBe(220);
  });

  it('đơn dưới mức tối thiểu không có điểm cơ bản', () => {
    const r = computeOrderPoints([{ sku: 'a', name: 'a', price: 1e6, qty: 2 }], 'gold', P);
    expect(r.belowMinimum).toBe(true);
    expect(r.total).toBe(0);
  });

  it('trừ phí ship khỏi giá trị tính điểm', () => {
    const r = computeOrderPoints([{ sku: 'a', name: 'a', price: 1e6, qty: 10 }], 'member', P, { ship: 1_000_000 });
    expect(r.value).toBe(10_000_000);
  });
});

describe('campaign', () => {
  const at = new Date('2026-11-15');
  const camps = [
    { id: 'CP01', name: 'NOREVA ×2', kind: 'multiplier' as const, value: 2, brands: ['NOREVA'], from: '2026-10-01', to: '2026-12-31' },
    { id: 'CP02', name: 'Đơn ≥ 30 triệu +300', kind: 'bonus' as const, value: 300, minOrderVND: 30e6, minTier: 'silver' as const, from: '2026-11-01', to: '2027-01-25' },
  ];
  it('nhân hệ số theo nhãn và thưởng khi đạt ngưỡng', () => {
    const r = computeOrderPoints([{ sku: 'NOR-1', name: 'a', price: 1e6, qty: 30, brand: 'NOREVA' }], 'gold', P, { campaigns: camps, at });
    expect(r.productMult).toBe(2);
    expect(r.campaignIds).toEqual(['CP01', 'CP02']);
    expect(r.total).toBe(Math.floor(330 * 2 * 1.2) + 200 + 300);
  });
  it('bỏ qua campaign hết hạn hoặc không đủ hạng', () => {
    const r = computeOrderPoints([{ sku: 'NOR-1', name: 'a', price: 1e6, qty: 30, brand: 'NOREVA' }], 'member', P, { campaigns: camps, at: new Date('2027-02-01') });
    expect(r.campaignIds).toEqual([]);
  });
});

describe('xét hạng', () => {
  it('tierForScore bỏ qua hạng đặc biệt', () => {
    expect(tierForScore(4999, P)).toBe('member');
    expect(tierForScore(5000, P)).toBe('bronze');
    expect(tierForScore(999999, P)).toBe('diamond');
  });
  it('lên hạng ngay, rớt 1 bậc khi dưới ngưỡng giữ, giữ khi đang bảo vệ', () => {
    const today = new Date('2026-11-01');
    expect(evaluateTier('silver', 21000, P, null, today).change).toBe('up');
    expect(evaluateTier('gold', 17000, P, null, today).change).toBe('keep');
    expect(evaluateTier('gold', 15000, P, null, today)).toMatchObject({ tier: 'silver', change: 'down' });
    expect(evaluateTier('gold', 15000, P, new Date('2026-12-31'), today).change).toBe('protected');
    expect(evaluateTier('strategic', 0, P, null, today).change).toBe('manual');
  });
  it('tierProgress tính số còn thiếu', () => {
    expect(tierProgress('gold', 18400, P)).toMatchObject({ next: 'diamond', target: 50000, remaining: 31600 });
    expect(tierProgress('diamond', 60000, P).next).toBeNull();
  });
});

describe('FIFO', () => {
  const now = new Date('2026-10-28');
  const lots = [
    { id: 1, remaining: 300, expiresAt: new Date('2027-03-31') },
    { id: 2, remaining: 380, expiresAt: new Date('2026-11-30') },
    { id: 3, remaining: 500, expiresAt: new Date('2026-09-30') }, // đã hết hạn
  ];
  it('trừ lô sắp hết hạn trước, bỏ lô đã hết hạn', () => {
    expect(allocateFifo(lots, 500, now)).toEqual([{ id: 2, take: 380 }, { id: 1, take: 120 }]);
  });
  it('báo lỗi khi không đủ điểm', () => {
    expect(() => allocateFifo(lots, 1000, now)).toThrow(/thiếu 320/);
  });
});

describe('mô phỏng & phân quyền', () => {
  it('simulate đếm phân bổ và chi phí điểm', () => {
    const r = simulate(P, [{ tier: 'member', score: 6000, monthlyRevenue: 50e6 }, { tier: 'gold', score: 25000, monthlyRevenue: 100e6 }]);
    expect(r.moves.up).toBe(1);
    expect(r.distribution.find((d) => d.tier === 'bronze')?.simulated).toBe(1);
    expect(r.costPct).toBeGreaterThan(1);
  });
  it('Sale chỉ thấy SĐT đại lý mình', () => {
    expect(canSeeField('SALE', 'phone', true)).toBe(true);
    expect(canSeeField('SALE', 'phone', false)).toBe(false);
    expect(canSeeField('MKT', 'idCard')).toBe(false);
    expect(can('KT', 'payments.record')).toBe(true);
    expect(can('SALE', 'payments.record')).toBe(false);
  });
});
