import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, Icon, StatusBadge } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { ErrorNote, Loading, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, dateTime, mil, vnd } from '../../lib/fmt';
import './M08Debt.css';

interface Invoice { id: string; value: number; paidAmount: number; remaining: number; pay: string; orderedAt: string; dueAt: string }
interface Payment { id: number; orderId: string | null; amount: number; method: string; source: string; at: string }
interface Debt { debt: number | null; overdueDays: number; creditLimit: number | null; creditDays: number; invoices: Invoice[]; history: Payment[] }
interface HomeLite { sale: { name: string; phone: string } }

/** M08 Công nợ — chỉ chủ ĐL-C: tổng nợ, quá hạn, hạn mức, hoá đơn chưa thanh toán (còn phải trả) và lịch sử thanh toán (kế toán ghi nhận từ MISA). */
export default function M08Debt() {
  const nav = useNavigate();
  const { user } = useSession('app');
  const owner = user?.role === 'DLC';
  const q = useApi<Debt>(owner ? '/app/debt' : null, { realm: 'app' });
  const home = useApi<HomeLite>('/app/home', { realm: 'app' });
  const phone = home.data?.sale.phone.replace(/\s/g, '');
  const call = phone && <a href={'tel:' + phone} className="m08-call"><Button variant="primary" size="lg" block icon="phone">Gọi sale hỗ trợ</Button></a>;

  if (!owner) return (
    <PhoneFrame tab="account" title="Công nợ" back>
      <EmptyState icon="lock" title="Chỉ chủ tài khoản xem được công nợ" body="Tài khoản nhân viên không xem được công nợ. Vui lòng liên hệ chủ đại lý."
        action={<Button size="lg" onClick={() => nav('/app/account')}>Về Tài khoản</Button>} />
    </PhoneFrame>
  );
  if (q.isLoading) return <PhoneFrame tab="account" title="Công nợ" back><Loading /></PhoneFrame>;
  if (q.error || !q.data) return <PhoneFrame tab="account" title="Công nợ" back><ErrorNote error={q.error} /></PhoneFrame>;

  const d = q.data;
  const now = Date.now();
  const isOd = (x: Invoice) => x.pay === 'Quá hạn' || +new Date(x.dueAt) < now;
  const odList = d.invoices.filter(isOd);
  const total = d.debt ?? d.invoices.reduce((s, x) => s + x.remaining, 0);
  const overdue = odList.reduce((s, x) => s + x.remaining, 0);
  const od = d.overdueDays > 0 || odList.length > 0;
  const pct = d.creditLimit ? Math.min(100, Math.round((total / d.creditLimit) * 100)) : 0;

  return (
    <PhoneFrame tab="account" title="Công nợ" back>
      {od && <div className="demo-note demo-note--danger m08-alert"><Icon name="alert" size={18} />Quý đại lý có {odList.length || ''} hoá đơn quá hạn{d.overdueDays ? ` ${d.overdueDays} ngày` : ''}. Vui lòng thanh toán hoặc liên hệ sale để được hỗ trợ. Đặt hàng mới đang tạm chặn.</div>}
      <div className="m08-tot">
        <div>Tổng nợ<b>{mil(total)}</b></div>
        <div>Chưa đến hạn<b>{mil(Math.max(0, total - overdue))}</b></div>
        <div className={od ? 'is-od' : ''}>Quá hạn<b>{mil(overdue)}</b></div>
      </div>
      <div className="demo-acard">
        <div className="demo-between"><span className="demo-muted m08-l">Hạn mức công nợ</span><b>{d.creditLimit ? `${mil(total)} / ${mil(d.creditLimit)}` : 'Chưa cấp hạn mức'}</b></div>
        {d.creditLimit ? <div className="m08-lim" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: pct + '%' }} /></div> : null}
        <span className="demo-sub m08-s">Thời hạn nợ {d.creditDays} ngày theo hợp đồng</span>
      </div>
      <div className="demo-acard">
        <b>Hoá đơn chưa thanh toán</b>
        {d.invoices.length ? d.invoices.map((x) => (
          <div key={x.id} className="m08-inv">
            <div><div className="demo-strong">Đơn {x.id}</div><div className="demo-muted m08-l">Ngày {date(x.orderedAt)} · hạn {date(x.dueAt)}</div></div>
            <div className="m08-r"><b>{vnd(x.remaining)}</b>{x.remaining !== x.value && <span className="demo-sub m08-s">HĐ {vnd(x.value)}{x.paidAmount > 0 ? ` · đã trả ${vnd(x.paidAmount)}` : ' · đã trừ hàng trả'}</span>}<div>{isOd(x) ? <StatusBadge tone="danger">Quá hạn</StatusBadge> : <StatusBadge tone="pending">{x.pay === 'Thanh toán một phần' ? 'Đã trả một phần' : 'Chưa đến hạn'}</StatusBadge>}</div></div>
          </div>
        )) : <div className="demo-muted m08-l">Không có hoá đơn chưa thanh toán.</div>}
      </div>
      <div className="demo-acard">
        <b>Lịch sử thanh toán</b>
        {d.history.length ? d.history.map((h) => (
          <div key={h.id} className="m08-inv">
            <div><div className="demo-strong">{h.orderId ? `Đơn ${h.orderId}` : 'Thanh toán'}</div><div className="demo-muted m08-l">{dateTime(h.at)} · {h.method}{h.source ? ` · ${h.source}` : ''}</div></div>
            <div className="m08-r"><b className="m08-paid">−{vnd(h.amount)}</b></div>
          </div>
        )) : <div className="demo-muted m08-l">Chưa có khoản thanh toán nào được ghi nhận.</div>}
      </div>
      <div className="demo-sub m08-s">Số liệu do Kế toán DMP ghi nhận từ MISA, có thể chậm tới 1 ngày làm việc.</div>
      {call}
    </PhoneFrame>
  );
}
