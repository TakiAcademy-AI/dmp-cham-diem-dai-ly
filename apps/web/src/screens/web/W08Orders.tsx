import { useState } from 'react';
import { can } from '@dmp/shared';
import { Button, DataTable, FilterChip, Icon, PointBreakdown, PointValue, QuickView, StatusBadge, TierBadge, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime, num, vnd } from '../../lib/fmt';
import type { Order } from '../../lib/types';
import './W08Orders.css';

const SRC: Record<string, 'box' | 'smartphone'> = { KiotViet: 'box', App: 'smartphone' };
const ST: Record<string, 'success' | 'pending' | 'info' | 'neutral' | 'warning'> = { 'Hoàn tất': 'success', 'Chờ duyệt': 'pending', 'Đang giao': 'info', 'Huỷ': 'neutral', 'Trả hàng một phần': 'warning' };
const PAY: Record<string, 'success' | 'pending' | 'danger' | 'neutral'> = { 'Đã thanh toán': 'success', 'Chưa thanh toán': 'pending', 'Thanh toán một phần': 'pending', 'Quá hạn': 'danger', '—': 'neutral' };

/** W08 Đơn hàng — đồng bộ KiotViet, điểm Treo → Khả dụng khi KT ghi nhận thanh toán (kịch bản 4), popup cách tính điểm. */
export default function W08Orders() {
  const { user } = useSession();
  const role = user!.role;
  const q = useApi<Order[]>('/orders');
  const [selId, setSelId] = useState<string | null>(null);
  const [flt, setFlt] = useState<'all' | 'pending' | 'wait' | 'return'>('all');
  const sel = useApi<Order>(selId ? '/orders/' + selId : null);

  const pay = useAction((id: string) => api.post(`/orders/${id}/payment`), {
    success: (r) => ({ tone: 'success', title: `+${num(r.activated)} điểm đã chuyển sang Khả dụng`, body: `Đã gửi ZNS báo cộng điểm cho đại lý. Đơn ${r.id} đã thanh toán đủ.` }),
  });
  const sync = useAction(() => api.post('/orders/sync', { count: 2 }), {
    success: (r) => ({ tone: 'info', title: `Đã đồng bộ ${r.created.length} đơn mới từ KiotViet`, body: r.created.map((c: { id: string; points: number }) => `${c.id}: +${num(c.points)} điểm treo`).join(' · ') }),
  });
  const approve = useAction((id: string) => api.post(`/orders/${id}/approve`), { success: 'Đã duyệt đơn — điểm ở trạng thái Treo chờ thanh toán' });

  const orders = q.data ?? [];
  const rows = orders.filter((x) => {
    if (flt === 'pending') return x.pointState === 'pending';
    if (flt === 'wait') return x.status === 'Chờ duyệt';
    if (flt === 'return') return x.status === 'Huỷ' || x.status === 'Trả hàng một phần';
    return true;
  });
  const cur = sel.data;

  return (
    <AdminShell screen="W08" sub={role === 'SALE' ? 'Đơn của đại lý bạn phụ trách' : `${orders.length} đơn`}
      actions={<>
        <span className="w08-sync"><Icon name="refresh" size={16} />Đồng bộ KiotViet mỗi 15 phút</span>
        {can(role, 'orders.sync') && <Button icon="refresh" onClick={() => sync.mutate()} disabled={sync.isPending}>Đồng bộ ngay</Button>}
        {can(role, 'payments.record') && <Button icon="upload" disabled title="Import file công nợ MISA — GĐ1.5">Import file MISA</Button>}
      </>}>
      <div className="demo-row">
        <FilterChip selected={flt === 'all'} onClick={() => setFlt('all')}>Tất cả</FilterChip>
        <FilterChip selected={flt === 'pending'} onClick={() => setFlt('pending')} count={orders.filter((x) => x.pointState === 'pending').length}>Điểm đang treo</FilterChip>
        <FilterChip selected={flt === 'wait'} onClick={() => setFlt('wait')} count={orders.filter((x) => x.status === 'Chờ duyệt').length}>Chờ duyệt</FilterChip>
        <FilterChip selected={flt === 'return'} onClick={() => setFlt('return')}>Trả hàng / huỷ</FilterChip>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <DataTable rows={rows} rowKey="id" onRowClick={(x) => setSelId(x.id)} rowTone={(x) => (x.pay === 'Quá hạn' ? 'overdue' : null)} itemLabel="đơn"
          columns={[
            { key: 'id', label: 'Mã đơn', primary: true, render: (x) => <div><button type="button" className="demo-link" onClick={(e) => { e.stopPropagation(); setSelId(x.id); }}>{x.id}</button><div className="demo-sub">{dateTime(x.orderedAt)}</div></div> },
            { key: 'src', label: 'Nguồn', render: (x) => <span className="w08-src"><Icon name={SRC[x.source] ?? 'box'} size={12} />{x.source}</span> },
            { key: 'agentName', label: 'Đại lý', render: (x) => <div><div>{x.agentName}</div><div className="demo-sub">{x.agentId} · {x.saleName}</div></div> },
            { key: 'value', label: 'Giá trị', align: 'right', render: (x) => vnd(x.value) },
            { key: 'status', label: 'Trạng thái đơn', render: (x) => <StatusBadge tone={ST[x.status]}>{x.status}</StatusBadge> },
            { key: 'pay', label: 'Thanh toán', render: (x) => <StatusBadge tone={PAY[x.pay]}>{x.pay}</StatusBadge> },
            { key: 'points', label: 'Điểm', align: 'right', render: (x) => (x.pointState === 'none' ? <span className="demo-muted">Chưa tính</span> : <PointValue value={Math.round(x.points * (1 - x.returnedPct))} state={x.pointState as 'pending'} />) },
          ]} />
      )}
      {selId && (
        <QuickView title={cur ? `Đơn ${cur.id} · ${cur.agentName}` : 'Đang tải…'} onClose={() => setSelId(null)}
          footer={<>
            <Button onClick={() => setSelId(null)}>Đóng</Button>
            {cur && can(role, 'payments.record') && cur.status === 'Chờ duyệt' && <Button variant="primary" icon="check" disabled={approve.isPending} onClick={() => approve.mutate(cur.id)}>Duyệt đơn</Button>}
            {cur && can(role, 'payments.record') && cur.pay !== 'Đã thanh toán' && cur.status !== 'Huỷ' && cur.status !== 'Chờ duyệt' && (
              <Button variant="primary" icon="check" disabled={pay.isPending} onClick={() => pay.mutate(cur.id)}>Ghi nhận đã thanh toán đủ</Button>
            )}
          </>}>
          {!cur ? <Loading /> : (
            <div className="w08-od">
              <div>
                <div className="demo-row" style={{ marginBottom: 12 }}>
                  <TierBadge tier={cur.tierAtOrder as Tier} /><StatusBadge tone={ST[cur.status]}>{cur.status}</StatusBadge><StatusBadge tone={PAY[cur.pay]}>{cur.pay}</StatusBadge>
                  <span className="w08-src"><Icon name={SRC[cur.source] ?? 'box'} size={12} />{cur.source}</span>
                </div>
                <table className="w08-lines">
                  <thead><tr><th>Sản phẩm</th><th className="r">SL</th><th className="r">CK</th><th className="r">Thành tiền</th></tr></thead>
                  <tbody>{cur.lines.map((l, i) => (
                    <tr key={i}><td>{l.name}{l.noPoint && <> <StatusBadge tone="neutral">Không tính điểm</StatusBadge></>}{(l.multiplier ?? 1) > 1 && <> <StatusBadge tone="info">×{l.multiplier} điểm</StatusBadge></>}</td>
                      <td className="r">{l.qty}</td><td className="r">{l.discount ? Math.round(l.discount * 100) + '%' : '—'}</td><td className="r">{vnd(l.price * l.qty * (1 - (l.discount || 0)))}</td></tr>
                  ))}</tbody>
                </table>
                <div className="demo-sub" style={{ marginTop: 8 }}>Giá chưa VAT · VAT 10% · phí ship {vnd(cur.ship)} · {dateTime(cur.orderedAt)}</div>
                {cur.returns?.length > 0 && <div className="demo-note demo-note--warn" style={{ marginTop: 12 }}><Icon name="alert" size={16} />{cur.returns.map((r) => `${r.id}: trả ${Math.round(r.pct * 100)}% → −${num(r.points)} điểm`).join(' · ')}</div>}
              </div>
              <div>
                <div className="demo-strong" style={{ marginBottom: 4 }}>Cách tính điểm</div>
                {cur.calc ? <PointBreakdown steps={cur.calc.steps} total={cur.points} state={cur.pointState === 'available' ? 'available' : 'pending'} footnote={`Quy tắc v${cur.ruleVersion} · tham số [CHỜ CHỐT]`} /> : <span className="demo-muted">Chưa tính điểm</span>}
              </div>
            </div>
          )}
        </QuickView>
      )}
    </AdminShell>
  );
}
