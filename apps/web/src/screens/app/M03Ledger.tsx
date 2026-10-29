import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FUND_LABEL, type Fund } from '@dmp/shared';
import { Button, EmptyState, Icon, PointBreakdown, PointValue, Tabs } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { InfoGrid } from '../../shell/charts';
import { ErrorNote, Loading, useApi } from '../../lib/hooks';
import { date, num } from '../../lib/fmt';
import type { LedgerRow, Order, PointSummary } from '../../lib/types';
import './M03Ledger.css';

interface HomeLite { points: PointSummary; sale: { name: string; phone: string } }

const STATE_LABEL: Record<LedgerRow['state'], string> = { pending: 'Đang chờ thanh toán', available: 'Khả dụng', expired: 'Hết hạn', revoked: 'Đã thu hồi' };

/** Điểm hiển thị của một dòng sổ cái: ưu tiên quỹ điểm thưởng, dòng chỉ cộng điểm hạng thì hiện điểm hạng. */
function delta(l: LedgerRow) { return l.deltaReward !== 0 ? l.deltaReward : l.deltaRank; }
function unit(l: LedgerRow) { return l.deltaReward === 0 && l.deltaRank !== 0 ? 'điểm hạng' : 'điểm'; }

/** M03 Sổ điểm — số dư 2 quỹ, điểm sắp hết hạn, lịch sử cộng/trừ; bấm một dòng để xem vì sao có số này. */
export default function M03Ledger() {
  const nav = useNavigate();
  const q = useApi<LedgerRow[]>('/app/ledger', { realm: 'app' });
  const home = useApi<HomeLite>('/app/home', { realm: 'app' });
  const [tab, setTab] = useState('all');
  const [sel, setSel] = useState<LedgerRow | null>(null);
  const isOrder = !!sel && sel.type === 'earn' && sel.ref.startsWith('DH');
  const orders = useApi<Order[]>(isOrder ? '/app/orders' : null, { realm: 'app' });
  const order = isOrder ? orders.data?.find((o) => o.id === sel!.ref) : undefined;

  const all = q.data ?? [];
  const rows = all.filter((l) => {
    const d = delta(l);
    if (tab === 'plus') return d > 0 && l.state !== 'pending';
    if (tab === 'minus') return d < 0;
    if (tab === 'pending') return l.state === 'pending';
    return true;
  });
  const p = home.data?.points;
  const phone = home.data?.sale.phone.replace(/\s/g, '');

  const sheet = sel && (
    <div className="demo-sheet" onClick={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
      <div className="demo-sheet__panel" role="dialog" aria-label={sel.item}>
        <span className="demo-sheet__grab" />
        <div className="m03-sheethead"><b>{sel.item}</b><PointValue value={delta(sel)} state={sel.state} unit={unit(sel)} size="lg" /></div>
        {isOrder && (orders.isLoading ? <Loading /> : order?.calc ? (
          <PointBreakdown steps={order.calc.steps} total={order.points} state={sel.state}
            footnote={sel.state === 'pending' ? 'Điểm sẽ được cộng khi đơn được thanh toán đủ' : `Quy tắc ${sel.rule}`} />
        ) : null)}
        <InfoGrid cols={2} items={[
          ['Ngày', date(sel.createdAt)], ['Chứng từ', sel.ref || '—'],
          ['Quỹ điểm', FUND_LABEL[sel.fund as Fund] ?? sel.fund], ['Người duyệt', sel.byUser || '—'],
          ['Quy tắc', sel.rule || '—'], ['Trạng thái', STATE_LABEL[sel.state]],
          sel.deltaRank !== sel.deltaReward && ['Điểm hạng', (sel.deltaRank > 0 ? '+' : '') + num(sel.deltaRank)],
          sel.deltaRank !== sel.deltaReward && ['Điểm thưởng', (sel.deltaReward > 0 ? '+' : '') + num(sel.deltaReward)],
          !!sel.expiresAt && delta(sel) > 0 && ['Hết hạn', date(sel.expiresAt)],
        ]} />
        {sel.ref.startsWith('DH') && <Button size="lg" block icon="box" onClick={() => nav('/app/orders')}>Xem đơn hàng</Button>}
        {sel.ref.startsWith('DQ') && <Button size="lg" block icon="gift" onClick={() => nav('/app/redemptions')}>Xem yêu cầu đổi quà</Button>}
        <Button size="lg" block onClick={() => setSel(null)}>Đóng</Button>
        <button type="button" className="demo-link m03-complain" onClick={() => nav('/app/complaints?ledgerId=' + encodeURIComponent(String(sel.id)))}>Thấy sai? Gửi khiếu nại về dòng điểm này</button>
      </div>
    </div>
  );

  return (
    <PhoneFrame tab="points" title="Sổ điểm" flush overlay={sheet}>
      <div className="m03-sum">
        <div><span>Điểm thưởng khả dụng</span><b>{p ? num(p.reward) : '—'}</b></div>
        <button type="button" onClick={() => nav('/app/tiers')}><span>Điểm hạng</span><b>{p ? num(p.rank) : '—'}</b><small>Hạng & quyền lợi <Icon name="chevronRight" size={14} /></small></button>
      </div>
      {p && p.pending > 0 && <div className="m03-pending"><Icon name="clock" size={16} />+{num(p.pending)} điểm đang chờ — cộng khi đơn được thanh toán đủ</div>}
      {p && p.expiring.length > 0 && (
        <div className="m03-pad">
          <span className="demo-strong m03-h">Sắp hết hạn</span>
          <div className="m03-exp">{p.expiring.slice(0, 3).map((x) => <div key={x.date}><b>{num(x.points)}</b><span>hết hạn</span><span>{date(x.date)}</span></div>)}</div>
        </div>
      )}
      <button type="button" className="m03-ev" onClick={() => nav('/app/evidence')}>
        <Icon name="upload" size={20} /><span className="m03-ev__m"><b>Nộp bằng chứng hoạt động</b><small>Trưng bày, tham gia chương trình → được cộng điểm sau khi duyệt</small></span><Icon name="chevronRight" size={18} />
      </button>
      <div className="m03-tabs">
        <Tabs value={tab} onChange={setTab} items={[
          { key: 'all', label: 'Tất cả' }, { key: 'plus', label: 'Cộng' }, { key: 'minus', label: 'Trừ' },
          { key: 'pending', label: 'Đang chờ', count: all.filter((l) => l.state === 'pending').length },
        ]} />
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : rows.length ? rows.map((l) => (
        <button type="button" key={l.id} className="m03-row" onClick={() => setSel(l)}>
          <span className="m03-row__m"><span className="m03-row__t">{l.item}</span><span className="m03-row__s">{date(l.createdAt)} · {l.ref || '—'} · {l.byUser}</span></span>
          <PointValue value={delta(l)} state={l.state} unit={unit(l)} />
        </button>
      )) : all.length ? (
        <EmptyState icon="star" title="Không có giao dịch nào ở mục này" body="Chọn “Tất cả” để xem toàn bộ lịch sử điểm." />
      ) : (
        <EmptyState icon="star" title="Chưa có giao dịch điểm" body="Đơn hàng đầu tiên sẽ giúp Quý đại lý bắt đầu tích điểm."
          action={phone ? <a href={'tel:' + phone} className="m03-call"><Button variant="primary" size="lg" icon="phone">Gọi sale phụ trách</Button></a> : undefined} />
      )}
    </PhoneFrame>
  );
}
