import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { computeOrderPoints, type OrderLineInput, type RuleParams, type TierDef } from '@dmp/shared';
import { Button, Celebration, EmptyState, FilterChip, Icon, PointBreakdown, StatusBadge, type Tier } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { appApi } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { mil, num, vnd } from '../../lib/fmt';
import type { PointSummary } from '../../lib/types';
import './M11Cart.css';

interface AppProduct { sku: string; brand: string; line: string; name: string; price: number; noPoint: boolean; multiplier: number; multiplierUntil: string; inStock: boolean }
/** /app/tiers: hạng + tham số tính điểm đang hiệu lực (không kèm danh sách quy tắc nội bộ). */
interface TiersRes { tiers: TierDef[]; tierBasis: RuleParams['tierBasis']; current: PointSummary; params: Omit<RuleParams, 'tiers' | 'rules'> }
interface HomeLite { debt: { overdueDays: number } | null }
interface OrderRes { id: string; status: string; estimatedPoints: number }

const KEY = 'dmp.app.cart';
function loadCart(): Record<string, number> {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

/** M11 Đặt hàng (mockup GĐ2) — chọn sản phẩm, giỏ hàng, điểm dự kiến theo engine B1→B5, gửi đơn → Chờ duyệt. Chặn khi nợ quá hạn. */
export default function M11Cart() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const viewCart = sp.get('view') === 'cart';
  const q = useApi<AppProduct[]>('/app/products', { realm: 'app' });
  const tq = useApi<TiersRes>('/app/tiers', { realm: 'app' });
  const home = useApi<HomeLite>('/app/home', { realm: 'app' });
  const [brand, setBrand] = useState('Tất cả');
  const [cart, setCart] = useState<Record<string, number>>(loadCart);
  const [sent, setSent] = useState<OrderRes | null>(null);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* riêng tư */ } }, [cart]);

  const prods = q.data ?? [];
  const brands = useMemo(() => Array.from(new Set(prods.map((p) => p.brand))), [prods]);
  // Tham số engine (VAT, đơn tối thiểu, mốc đơn, tỷ lệ điểm, hạng & hệ số) lấy từ bộ quy tắc đang hiệu lực (/app/tiers) — không viết cứng.
  const params: RuleParams | null = useMemo(() => (tq.data ? { ...tq.data.params, tiers: tq.data.tiers, tierBasis: tq.data.tierBasis, rules: [] } : null), [tq.data]);
  const tier = (tq.data?.current.tier ?? 'member') as Tier;

  const lines: OrderLineInput[] = Object.keys(cart).flatMap((sku) => {
    const p = prods.find((x) => x.sku === sku);
    return p ? [{ sku, name: p.name, price: p.price, qty: cart[sku], discount: 0, noPoint: p.noPoint, multiplier: p.multiplier }] : [];
  });
  const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const vat = params ? sub * params.vatRate : 0;
  const total = sub + vat;
  const res = params ? computeOrderPoints(lines, tier, params) : null;
  const below = !!params && total < params.minOrderVND;
  const toMilestone = params && res ? params.milestoneOrderVND - res.value : 0;
  const overdue = (home.data?.debt?.overdueDays ?? 0) > 0;

  function set(sku: string, n: number) { setCart((c) => { const x = { ...c }; if (n <= 0) delete x[sku]; else x[sku] = n; return x; }); }
  function openCart(on: boolean) { setSp(on ? { view: "cart" } : {}); }

  const send = useAction(() => appApi.post<OrderRes>('/app/orders', { lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })) }), {
    realm: 'app',
    onDone: (r) => { setSent(r); setCart({}); },
  });

  const footer = !sent && (
    <div className="m11-bar">
      {overdue ? (
        <div className="m11-block" role="alert"><Icon name="alert" size={18} />Quý đại lý có hoá đơn quá hạn. Vui lòng thanh toán hoặc liên hệ sale để được hỗ trợ</div>
      ) : !params || !res ? (
        <div className="m11-hint">{tq.error ? 'Chưa tải được quy tắc tính điểm — vui lòng thử lại sau' : 'Đang tải quy tắc tính điểm…'}</div>
      ) : !lines.length ? (
        <div className="m11-hint">Chọn sản phẩm để bắt đầu đặt hàng</div>
      ) : (
        <>
          {below ? <div className="m11-warn">Đơn tối thiểu {mil(params.minOrderVND)} — thêm {vnd(params.minOrderVND - total)} để đặt hàng</div>
            : toMilestone > 0 ? <div className="m11-hint">Thêm {mil(Math.ceil(toMilestone / 100000) * 100000)} để nhận +{num(params.milestoneBonus)} điểm thưởng mốc</div>
              : <div className="m11-hint">Đơn đã đạt mốc ≥ {mil(params.milestoneOrderVND)}: +{num(params.milestoneBonus)} điểm thưởng</div>}
          <div className="m11-bar__r">
            <div><div className="m11-total">{vnd(total)}</div><div className="m11-pts">Đơn này được +{num(res.total)} điểm</div></div>
            {viewCart
              ? <Button variant="primary" size="lg" icon="send" disabled={below || send.isPending} onClick={() => send.mutate()}>{send.isPending ? 'Đang gửi…' : 'Gửi đơn'}</Button>
              : <Button variant="primary" size="lg" icon="cart" onClick={() => openCart(true)}>Xem giỏ ({lines.length})</Button>}
          </div>
        </>
      )}
    </div>
  );

  let body;
  if (q.isLoading || tq.isLoading) body = <Loading />;
  else if (q.error || tq.error || !params || !res) body = <ErrorNote error={q.error ?? tq.error} />;
  else if (sent) body = (
    <>
      <Celebration icon="send" tier={tier} title="Đã gửi đơn hàng!" body={`Đơn ${sent.id} đang chờ duyệt. Sale sẽ xác nhận và đơn được chuyển sang KiotViet. Dự kiến +${num(sent.estimatedPoints)} điểm, cộng khi đơn hoàn tất và thanh toán đủ.`} />
      <Button variant="primary" size="lg" block icon="box" onClick={() => nav('/app/orders', { replace: true })}>Xem đơn hàng</Button>
      <Button size="lg" block onClick={() => { setSent(null); setSp({}, { replace: true }); }}>Đặt đơn khác</Button>
    </>
  );
  else if (viewCart) body = !lines.length ? (
    <EmptyState icon="cart" title="Giỏ hàng trống" body="Chọn sản phẩm để bắt đầu đặt hàng." action={<Button variant="primary" size="lg" onClick={() => openCart(false)}>Chọn sản phẩm</Button>} />
  ) : (
    <>
      <div className="demo-acard">
        {lines.map((l) => (
          <div key={l.sku} className="m11-line">
            <span className="m11-grow">{l.name}<br /><span className="demo-sub m11-small">{vnd(l.price)} × {l.qty}{(l.multiplier ?? 1) > 1 ? ` · ×${l.multiplier} điểm` : ''}{l.noPoint ? ' · không tính điểm' : ''}</span></span>
            <span className="m11-lr"><b className="demo-num">{vnd(l.price * l.qty)}</b>
              <span className="m11-qty m11-qty--sm"><button type="button" className="m11-step" aria-label={'Bớt ' + l.name} onClick={() => set(l.sku!, l.qty - 1)}>−</button><b>{l.qty}</b><button type="button" className="m11-step add" aria-label={'Thêm ' + l.name} onClick={() => set(l.sku!, l.qty + 1)}>+</button></span>
            </span>
          </div>
        ))}
        <div className="m11-line"><span>Tạm tính (chưa VAT)</span><span className="demo-num">{vnd(sub)}</span></div>
        <div className="m11-line"><span>VAT {Math.round(params.vatRate * 100)}%</span><span className="demo-num">{vnd(vat)}</span></div>
        <div className="m11-line m11-line--last"><b>Tổng</b><b className="demo-num">{vnd(total)}</b></div>
      </div>
      <div className="demo-acard">
        <b>Điểm dự kiến</b>
        <PointBreakdown steps={res.steps} total={res.total} state="pending" footnote="Điểm chính thức tính khi đơn hoàn tất, theo quy tắc đang hiệu lực" />
      </div>
      <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Đơn gửi lên ở trạng thái Chờ duyệt. Giá theo kênh nhà thuốc, chiết khấu (nếu có) do sale áp khi duyệt.</div>
    </>
  );
  else body = (
    <>
      <div className="m11-brands">
        {['Tất cả', ...brands].map((x) => <FilterChip key={x} selected={brand === x} onClick={() => setBrand(x)}>{x}</FilterChip>)}
      </div>
      <div className="m11-grid">
        {prods.filter((p) => brand === 'Tất cả' || p.brand === brand).map((p) => {
          const n = cart[p.sku] || 0;
          return (
            <div key={p.sku} className="m11-p">
              <div className="m11-p__img"><Icon name="box" size={36} strokeWidth={1.3} />{p.multiplier > 1 && <span className="m11-p__tag"><StatusBadge tone="new">×{p.multiplier} điểm</StatusBadge></span>}</div>
              <div className="m11-p__b">
                <span className="m11-p__n">{p.name}</span>
                <span className="m11-p__pr">{vnd(p.price)}</span>
                {p.noPoint && <span className="demo-sub m11-small">Không tính điểm</span>}
                {!p.inStock && <span className="demo-sub m11-small">Tạm hết hàng</span>}
                <div className="m11-qty">
                  {n ? (
                    <><button type="button" className="m11-step" aria-label={'Bớt ' + p.name} onClick={() => set(p.sku, n - 1)}>−</button><b>{n}</b><button type="button" className="m11-step add" aria-label={'Thêm ' + p.name} onClick={() => set(p.sku, n + 1)}>+</button></>
                  ) : (
                    <Button block icon="plus" size="lg" disabled={!p.inStock} aria-label={'Thêm ' + p.name + ' vào giỏ'} onClick={() => set(p.sku, 1)}>Thêm</Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <PhoneFrame tab="orders" title={sent ? 'Đã gửi đơn' : viewCart ? 'Giỏ hàng' : 'Đặt hàng'} back footer={footer || undefined}>
      {body}
    </PhoneFrame>
  );
}
