import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, Icon, PointBreakdown, PointValue, StatusBadge } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { ErrorNote, Loading, useApi } from '../../lib/hooks';
import { date, dateTime, mil, num, vnd } from '../../lib/fmt';
import type { Order } from '../../lib/types';
import './M07Orders.css';

const ST: Record<string, 'success' | 'pending' | 'info' | 'neutral' | 'warning'> = { 'Hoàn tất': 'success', 'Chờ duyệt': 'pending', 'Đang giao': 'info', 'Huỷ': 'neutral', 'Trả hàng một phần': 'warning' };
const PAY: Record<string, 'success' | 'pending' | 'danger' | 'neutral'> = { 'Đã thanh toán': 'success', 'Chưa thanh toán': 'pending', 'Thanh toán một phần': 'pending', 'Quá hạn': 'danger' };
const pts = (o: Order) => Math.round(o.points * (1 - (o.returnedPct || 0)));

/** M07 Đơn hàng — đơn đồng bộ KiotViet (GĐ1 chỉ xem) và đơn đặt trên app; chi tiết + cách tính điểm. */
export default function M07Orders() {
  const nav = useNavigate();
  const q = useApi<Order[]>('/app/orders', { realm: 'app' });
  const [sel, setSel] = useState<Order | null>(null);
  const list = q.data ?? [];

  const sheet = sel && (
    <div className="demo-sheet" onClick={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
      <div className="demo-sheet__panel" role="dialog" aria-label={`Đơn ${sel.id}`}>
        <span className="demo-sheet__grab" />
        <div className="m07-r"><b className="m07-title">Đơn {sel.id}</b><StatusBadge tone={ST[sel.status] ?? 'neutral'}>{sel.status}</StatusBadge></div>
        <div className="demo-muted m07-meta">{dateTime(sel.orderedAt)}{sel.pay && sel.pay !== '—' ? ` · ${sel.pay}` : ''} · {sel.source === 'App' ? 'Đặt trên app' : 'KiotViet'}</div>
        <div>{sel.lines.map((l, i) => (
          <div key={i} className="m07-line"><span>{l.name} × {l.qty}{l.noPoint ? ' · không tính điểm' : ''}{(l.multiplier ?? 1) > 1 ? ` · ×${l.multiplier} điểm` : ''}</span><span className="demo-num">{vnd(l.price * l.qty * (1 - (l.discount || 0)))}</span></div>
        ))}</div>
        <div className="m07-r"><b>Tổng (gồm VAT)</b><b className="demo-num">{vnd(sel.value)}</b></div>
        {sel.returns?.length > 0 && <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />{sel.returns.map((r) => `${r.id}: trả ${Math.round(r.pct * 100)}% hàng → trừ ${num(r.points)} điểm`).join(' · ')}</div>}
        {sel.status !== 'Huỷ' && (
          <div className="demo-acard">
            <div className="m07-r">
              <span>{sel.pointState === 'none' ? 'Điểm dự kiến' : 'Điểm của đơn'}</span>
              {sel.pointState === 'none' ? <PointValue value={sel.points} state="pending" showState={false} size="lg" /> : <PointValue value={pts(sel)} state={sel.pointState} size="lg" />}
            </div>
            {sel.pointState === 'pending' && <div className="m07-pend">Sẽ được cộng khi đơn được thanh toán đủ.</div>}
            {sel.pointState === 'none' && <div className="demo-sub m07-small">Điểm chính thức được tính khi đơn hoàn tất.</div>}
            {sel.calc && <PointBreakdown steps={sel.calc.steps} total={sel.points} state={sel.pointState === 'available' ? 'available' : sel.pointState === 'revoked' ? 'revoked' : 'pending'} footnote={`Quy tắc v${sel.ruleVersion}`} />}
          </div>
        )}
        <Button size="lg" block onClick={() => setSel(null)}>Đóng</Button>
      </div>
    </div>
  );

  return (
    <PhoneFrame tab="orders" title="Đơn hàng" flush overlay={sheet}>
      <div className="m07-pad">
        <span className="demo-muted m07-meta">{list.length} đơn · bấm để xem chi tiết</span>
        <Button variant="primary" size="lg" icon="cart" onClick={() => nav('/app/cart')}>Đặt hàng</Button>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : !list.length ? (
        <EmptyState icon="box" title="Chưa có đơn hàng" body="Đơn đặt qua sale (KiotViet) hoặc trên app sẽ hiện ở đây."
          action={<Button variant="primary" size="lg" icon="cart" onClick={() => nav('/app/cart')}>Đặt hàng</Button>} />
      ) : list.map((o) => (
        <button type="button" key={o.id} className="m07-o" onClick={() => setSel(o)}>
          <span className="m07-r"><span className="m07-id">{o.id}</span><StatusBadge tone={ST[o.status] ?? 'neutral'}>{o.status}</StatusBadge></span>
          <span className="m07-r"><span className="demo-muted m07-meta">{date(o.orderedAt)} · {o.lines.length} sản phẩm</span><span className="m07-v">{mil(o.value)}</span></span>
          <span className="m07-r">
            {o.pay && o.pay !== '—' ? <StatusBadge tone={PAY[o.pay] ?? 'neutral'} icon={null}>{o.pay}</StatusBadge> : <span />}
            {o.status === 'Huỷ' ? <span className="demo-sub m07-small">Không tính điểm</span> : o.pointState === 'none' ? <span className="demo-sub m07-small">Điểm tính khi hoàn tất</span> : <PointValue value={pts(o)} state={o.pointState} />}
          </span>
        </button>
      ))}
    </PhoneFrame>
  );
}
