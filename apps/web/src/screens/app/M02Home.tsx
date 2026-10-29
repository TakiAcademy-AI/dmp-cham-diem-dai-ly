import { useNavigate } from 'react-router-dom';
import { Icon, PointValue, TierBadge, TierProgress, type Tier } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { ErrorNote, Loading, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, mil, num } from '../../lib/fmt';
import type { PointSummary } from '../../lib/types';
import './M02Home.css';

interface Home {
  agent: { id: string; name: string; tier: Tier; owner: string };
  account: { name: string; role: 'DLC' | 'DLNV' };
  points: PointSummary;
  pendingOrders: Array<{ id: string; points: number }>;
  commit: { month: number; actual: number; pct: number } | null;
  debt: { amount: number; overdueDays: number } | null;
  sale: { name: string; phone: string };
  banner: { title: string; body: string };
}

/** M02 Trang chủ app — điểm khả dụng, điểm treo, tiến độ lên hạng, cam kết tháng, điểm sắp hết hạn, lối tắt. */
export default function M02Home() {
  const nav = useNavigate();
  const { user } = useSession('app');
  const q = useApi<Home>('/app/home', { realm: 'app' });
  if (q.isLoading) return <PhoneFrame tab="home"><Loading /></PhoneFrame>;
  if (q.error || !q.data) return <PhoneFrame tab="home"><ErrorNote error={q.error} /></PhoneFrame>;
  const { agent: a, points: p, pendingOrders, commit, debt, sale, banner } = q.data;
  const owner = user?.role === 'DLC';
  const exp = p.expiring[0];
  const pendingRef = pendingOrders.length === 1 ? `đơn ${pendingOrders[0].id}` : `${pendingOrders.length} đơn`;
  return (
    <PhoneFrame tab="home">
      <div className="m02-head"><div><p className="m02-name">{a.name}</p><div className="demo-muted">Mã {a.id}{!owner ? ' · Nhân viên' : ''}</div></div><TierBadge tier={a.tier} size="lg" /></div>
      <button type="button" className="demo-acard m02-card" onClick={() => nav('/app/ledger')}>
        <span className="m02-label"><Icon name="star" size={16} />Điểm thưởng khả dụng</span>
        <PointValue value={p.reward} signed={false} size="hero" />
        {p.pending > 0 && <span className="m02-pending">+{num(p.pending)} điểm đang chờ – sẽ được cộng khi {pendingRef} được thanh toán đủ</span>}
        <span className="m02-rk">Điểm hạng: <b>{num(p.rank)}</b> · không bị trừ khi đổi quà</span>
      </button>
      <button type="button" className="demo-acard m02-card" onClick={() => nav('/app/tiers')}>
        <TierProgress tier={a.tier} nextTier={p.progress.next as Tier | null} value={p.progress.value} target={p.progress.target}
          footnote={p.protectedUntil ? `Bảo vệ hạng tới ${date(p.protectedUntil)}` : 'Xét hạng ngày 01 hằng tháng'} />
      </button>
      {owner && commit && (
        <div className="demo-acard">
          <span className="m02-label"><Icon name="file" size={16} />Cam kết hợp đồng tháng này</span>
          <div className="m02-bar" role="progressbar" aria-valuenow={commit.pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: Math.min(100, commit.pct) + '%' }} /></div>
          <span><b>{mil(commit.actual)}</b> / {mil(commit.month)} ({commit.pct}%){commit.actual < commit.month ? ` · còn ${mil(commit.month - commit.actual)}` : ' · đã đạt'}</span>
        </div>
      )}
      {owner && debt && debt.overdueDays > 0 && (
        <button type="button" className="m02-warn m02-warn--danger" onClick={() => nav('/app/debt')}><Icon name="alert" size={18} />Quý đại lý có hoá đơn quá hạn {debt.overdueDays} ngày. Vui lòng thanh toán hoặc liên hệ sale để được hỗ trợ</button>
      )}
      {exp && <div className="m02-warn" role="status"><Icon name="clock" size={18} />{num(exp.points)} điểm sẽ hết hạn ngày {date(exp.date)}. Đổi quà ngay để không lãng phí</div>}
      <div className="m02-quick">
        <button type="button" onClick={() => nav('/app/gifts')}><Icon name="gift" size={26} />{owner ? 'Đổi quà' : 'Xem quà'}</button>
        <button type="button" onClick={() => nav('/app/orders')}><Icon name="box" size={26} />Đơn hàng</button>
        <a href={'tel:' + sale.phone.replace(/\s/g, '')}><Icon name="phone" size={26} />Gọi sale</a>
      </div>
      <div className="m02-quick m02-quick--2">
        <button type="button" onClick={() => nav('/app/evidence')}><Icon name="upload" size={24} /><span>Nộp bằng chứng<small>Trưng bày, hoạt động → điểm</small></span></button>
        <button type="button" onClick={() => nav('/app/leaderboard')}><Icon name="trend" size={24} /><span>Bảng xếp hạng<small>Thứ hạng của Quý đại lý</small></span></button>
      </div>
      <div className="m02-banner"><b>{banner.title}</b><span>{banner.body}</span></div>
    </PhoneFrame>
  );
}
