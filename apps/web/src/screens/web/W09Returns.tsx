import { useMemo, useState } from 'react';
import { can } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, Field, FilterChip, Icon, PointValue, QuickView, StatusBadge } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, dateTime, num, vnd } from '../../lib/fmt';
import type { Agent, Order, PointSummary, ReturnSlip } from '../../lib/types';
import './W09Returns.css';

/** Dòng hiển thị: phiếu trả hàng (GET /returns) hoặc đơn đã huỷ (GET /orders, trạng thái Huỷ). */
interface Row { key: string; slipId: string | null; orderId: string; agentId: string; agentName: string; kind: 'return' | 'cancel'; pct: number; value: number; points: number; at: string; reason: string; by: string }

const pctLabel = (p: number) => Math.round(p * 100) + '%';
const dec = (p: number) => String(Math.round(p * 100) / 100).replace('.', ',');

/** W09 Trả hàng / huỷ đơn — bút toán đảo theo tỷ lệ giá trị trả (kịch bản 7), có thể làm điểm khả dụng âm. */
export default function W09Returns() {
  const { user } = useSession();
  const role = user!.role;
  const canCreate = can(role, 'returns.create');
  const rq = useApi<ReturnSlip[]>('/returns');
  const oq = useApi<Order[]>('/orders');
  const aq = useApi<Agent[]>('/agents');
  const [sel, setSel] = useState<string | null>(null);
  const [flt, setFlt] = useState<'all' | 'return' | 'cancel' | 'neg'>('all');
  const [form, setForm] = useState(false);

  const orders = oq.data ?? [];
  const balance = useMemo(() => new Map((aq.data ?? []).map((a) => [a.id, a.rewardPoints])), [aq.data]);
  const all: Row[] = useMemo(() => {
    const om = new Map(orders.map((o) => [o.id, o]));
    const rets: Row[] = (rq.data ?? []).map((r) => ({ key: r.id, slipId: r.id, orderId: r.orderId, agentId: r.agentId, agentName: r.agentName ?? om.get(r.orderId)?.agentName ?? r.agentId, kind: 'return', pct: r.pct, value: r.value, points: r.points, at: r.createdAt, reason: r.reason, by: r.createdBy }));
    const cancels: Row[] = orders.filter((o) => o.status === 'Huỷ' && o.returnedPct < 1 - 1e-9).map((o) => ({
      key: 'H-' + o.id, slipId: null, orderId: o.id, agentId: o.agentId, agentName: o.agentName, kind: 'cancel', pct: 1 - o.returnedPct, value: Math.round(o.value * (1 - o.returnedPct)),
      points: o.pointState === 'none' ? 0 : Math.round(o.points * (1 - o.returnedPct)), at: o.orderedAt, reason: '', by: '',
    }));
    return [...rets, ...cancels].sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [rq.data, orders]);
  const neg = (r: Row) => (balance.get(r.agentId) ?? 0) < 0;
  const rows = all.filter((r) => (flt === 'all' ? true : flt === 'neg' ? neg(r) : r.kind === flt));
  const cur = all.find((r) => r.key === sel) ?? rows[0] ?? null;
  const curOrder = useApi<Order>(cur ? '/orders/' + cur.orderId : null);
  const curPts = useApi<PointSummary>(cur ? `/agents/${cur.agentId}/points` : null);

  const loading = rq.isLoading || oq.isLoading;
  const err = rq.error || oq.error;

  return (
    <AdminShell screen="W09" crumb="Đơn hàng"
      sub="Đồng bộ từ KiotViet. Hệ thống tự ghi bút toán đảo theo tỷ lệ giá trị hàng trả — không sửa, không xoá giao dịch cũ."
      actions={canCreate ? <Button variant="primary" icon="plus" onClick={() => setForm(true)}>Tạo phiếu trả hàng</Button> : null}>
      <div className="demo-row">
        <FilterChip selected={flt === 'all'} onClick={() => setFlt('all')} count={all.length}>Tất cả</FilterChip>
        <FilterChip selected={flt === 'return'} onClick={() => setFlt('return')} count={all.filter((r) => r.kind === 'return').length}>Trả hàng một phần</FilterChip>
        <FilterChip selected={flt === 'cancel'} onClick={() => setFlt('cancel')} count={all.filter((r) => r.kind === 'cancel').length}>Huỷ đơn</FilterChip>
        <FilterChip selected={flt === 'neg'} onClick={() => setFlt('neg')} count={all.filter(neg).length}>Điểm âm</FilterChip>
      </div>
      {loading ? <Loading /> : err ? <ErrorNote error={err} /> : !all.length ? (
        <Card><EmptyState icon="refresh" title="Chưa có phiếu trả hàng hay đơn huỷ" body="Khi đại lý trả hàng, kế toán tạo phiếu để hệ thống tự thu hồi điểm theo tỷ lệ." action={canCreate ? <Button variant="primary" icon="plus" onClick={() => setForm(true)}>Tạo phiếu trả hàng</Button> : undefined} /></Card>
      ) : (
        <div className="w09-layout">
          <div className="w09-table">
            <DataTable rows={rows} rowKey="key" itemLabel="phiếu" onRowClick={(r) => setSel(r.key)} rowTone={(r) => (neg(r) ? 'overdue' : null)}
              empty={<EmptyState icon="filter" title="Không có phiếu khớp bộ lọc" />}
              columns={[
                { key: 'id', label: 'Phiếu', primary: true, render: (r) => <div><b className={r.key === cur?.key ? 'w09-on' : ''}>{r.slipId ?? 'Huỷ ' + r.orderId}</b><div className="demo-sub">{date(r.at)} · đơn {r.orderId}</div></div> },
                { key: 'agent', label: 'Đại lý', render: (r) => <div>{r.agentName}<div className="demo-sub">{r.agentId}</div></div> },
                { key: 'type', label: 'Loại', render: (r) => <StatusBadge tone={r.kind === 'cancel' ? 'neutral' : 'warning'}>{r.kind === 'cancel' ? 'Huỷ đơn' : 'Trả hàng một phần ' + pctLabel(r.pct)}</StatusBadge> },
                { key: 'v', label: 'Giá trị trả', align: 'right', render: (r) => vnd(r.value) },
                { key: 'p', label: 'Điểm thu hồi', align: 'right', render: (r) => (r.points ? <PointValue value={-r.points} /> : '—') },
                { key: 'w', label: 'Cảnh báo', render: (r) => (neg(r) ? <StatusBadge tone="danger">Điểm âm</StatusBadge> : null) },
              ]} />
          </div>
          {cur && (
            <Card title={cur.slipId ? 'Bút toán ' + cur.slipId : 'Huỷ đơn ' + cur.orderId} subtitle={cur.agentName + (cur.reason ? ' · ' + cur.reason : '')}>
              {!curOrder.data ? <Loading /> : (
                <>
                  <div className="w09-entry"><span className="demo-muted">Điểm gốc</span><span>Đơn {cur.orderId} đã cộng</span><PointValue value={curOrder.data.points} /></div>
                  <div className="w09-entry"><span className="demo-muted">Tỷ lệ trả</span><span>{pctLabel(cur.pct)} giá trị đơn</span><span>× {dec(cur.pct)}</span></div>
                  <div className="w09-entry"><span className="demo-muted">Bút toán đảo</span><span>Thu hồi cả 2 quỹ{cur.slipId ? ' · ref ' + cur.slipId : ''}</span>{cur.points ? <PointValue value={-cur.points} /> : '0'}</div>
                  <div style={{ height: 12 }} />
                  {curPts.data && (
                    <div className="w09-bal"><span className="demo-muted">Điểm thưởng khả dụng hiện tại</span><PointValue value={curPts.data.reward} signed={false} size="lg" /></div>
                  )}
                  {curPts.data && curPts.data.reward < 0 && (
                    <div className="demo-note demo-note--danger" style={{ marginTop: 12 }}><Icon name="alert" size={16} />Điểm khả dụng âm {num(curPts.data.reward)} vì đại lý đã đổi quà trước khi trả hàng. Theo quy tắc: cho phép âm, trừ dần vào điểm phát sinh tiếp theo. Đại lý không đổi quà được cho tới khi điểm dương.</div>
                  )}
                  <div className="demo-sub" style={{ marginTop: 12 }}>{cur.by ? `Lập bởi ${cur.by} · ${dateTime(cur.at)}. ` : ''}Nếu phiếu rơi vào kỳ đã khoá sổ (trước ngày 05 tháng sau), bút toán ghi vào kỳ hiện tại.</div>
                </>
              )}
            </Card>
          )}
        </div>
      )}
      {form && <NewSlip orders={orders} onClose={() => setForm(false)} onCreated={(id) => { setFlt('all'); setSel(id); }} />}
    </AdminShell>
  );
}

/** Popup KT tạo phiếu: chọn đơn hoàn tất, chọn % trả, xem trước bút toán đảo và số dư sau khi trừ. */
function NewSlip({ orders, onClose, onCreated }: { orders: Order[]; onClose: () => void; onCreated: (key: string) => void }) {
  const eligible = orders.filter((o) => (o.status === 'Hoàn tất' || o.status === 'Trả hàng một phần') && o.returnedPct < 1 - 1e-9);
  const [kind, setKind] = useState<'return' | 'cancel'>('return');
  const [orderId, setOrderId] = useState(eligible[0]?.id ?? '');
  const [pct, setPct] = useState(30);
  const [reason, setReason] = useState('');
  const o = eligible.find((x) => x.id === orderId);
  const pts = useApi<PointSummary>(o ? `/agents/${o.agentId}/points` : null);
  const maxPct = o ? Math.round((1 - o.returnedPct) * 100) : 100;
  const p = kind === 'cancel' ? (1 - (o?.returnedPct ?? 0)) : Math.min(pct, maxPct) / 100;
  const rev = o ? Math.round(o.points * p) : 0;
  const isPending = o?.pointState === 'pending';
  const before = pts.data ? (isPending ? pts.data.pending : pts.data.reward) : null;
  const after = before == null ? null : before - rev;

  const ret = useAction(() => api.post<{ id: string; points: number }>(`/orders/${orderId}/returns`, { pct: p, reason: reason.trim() }), {
    success: (r) => ({ tone: 'success', title: `Đã tạo phiếu ${r.id}`, body: `Bút toán đảo ${num(r.points)} điểm cho đơn ${orderId}.` }),
    onDone: (r) => { onCreated(r.id); onClose(); },
  });
  const cancel = useAction(() => api.post(`/orders/${orderId}/cancel`, { reason: reason.trim() }), {
    success: () => ({ tone: 'success', title: `Đã huỷ đơn ${orderId}`, body: rev ? `Đã thu hồi ${num(rev)} điểm.` : 'Đơn chưa có điểm khả dụng — đã thu hồi điểm treo.' }),
    onDone: () => { onCreated('H-' + orderId); onClose(); },
  });
  const busy = ret.isPending || cancel.isPending;
  const valid = !!o && reason.trim().length > 0 && (kind === 'cancel' || (pct >= 1 && pct <= maxPct));

  return (
    <QuickView title="Tạo phiếu trả hàng / huỷ đơn" onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Đóng</Button>
        <Button variant={kind === 'cancel' ? 'danger' : 'primary'} icon="check" disabled={!valid || busy} onClick={() => (kind === 'cancel' ? cancel.mutate() : ret.mutate())}>
          {kind === 'cancel' ? 'Huỷ đơn & thu hồi điểm' : 'Tạo phiếu & ghi bút toán đảo'}
        </Button>
      </>}>
      {!eligible.length ? <EmptyState icon="box" title="Không có đơn hoàn tất để trả hàng" body="Chỉ đơn ở trạng thái Hoàn tất hoặc Trả hàng một phần mới tạo được phiếu." /> : (
        <div className="w09-form">
          <div className="demo-row">
            <FilterChip selected={kind === 'return'} onClick={() => setKind('return')}>Trả hàng một phần</FilterChip>
            <FilterChip selected={kind === 'cancel'} onClick={() => setKind('cancel')}>Huỷ đơn</FilterChip>
          </div>
          <Field label="Đơn hàng" as="select" required value={orderId} onChange={(e) => setOrderId(e.target.value)}
            options={eligible.map((x) => ({ value: x.id, label: `${x.id} · ${x.agentName} · ${vnd(x.value)}${x.returnedPct ? ` · đã trả ${pctLabel(x.returnedPct)}` : ''}` }))} />
          {o && kind === 'return' && (
            <div className="w09-pct">
              <label className="dmp-field__label" htmlFor="w09-range">Tỷ lệ giá trị hàng trả</label>
              <div className="w09-pct__row">
                <input id="w09-range" type="range" min={1} max={maxPct} value={Math.min(pct, maxPct)} onChange={(e) => setPct(+e.target.value)} />
                <Field aria-label="Tỷ lệ trả (%)" type="number" min={1} max={maxPct} value={Math.min(pct, maxPct)} suffix="%" onChange={(e) => setPct(Math.max(1, Math.min(maxPct, +e.target.value || 1)))} />
              </div>
              <div className="demo-sub">Tối đa {maxPct}% · giá trị trả {vnd(Math.round(o.value * p))}</div>
            </div>
          )}
          <Field label="Lý do" as="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Hàng cận date, đại lý trả 60%" />
          {o && (
            <div className="w09-preview">
              <div className="demo-strong" style={{ marginBottom: 4 }}>Xem trước bút toán</div>
              <div className="w09-entry"><span className="demo-muted">Điểm gốc</span><span>Đơn {o.id} · {o.pointState === 'pending' ? 'đang treo' : o.pointState === 'available' ? 'đã khả dụng' : 'chưa tính điểm'}</span><PointValue value={o.points} state={isPending ? 'pending' : 'available'} /></div>
              <div className="w09-entry"><span className="demo-muted">Tỷ lệ trả</span><span>{pctLabel(p)} giá trị đơn</span><span>× {dec(p)}</span></div>
              <div className="w09-entry"><span className="demo-muted">Bút toán đảo</span><span>Thu hồi cả 2 quỹ</span>{rev ? <PointValue value={-rev} /> : '0'}</div>
              <div className="w09-bal" style={{ marginTop: 12 }}>
                <span className="demo-muted">{isPending ? 'Điểm treo' : 'Điểm thưởng khả dụng'}</span>
                {before == null ? <span className="demo-muted">Đang tải…</span> : <><b>{num(before)}</b><span className="w09-arrow">→</span><PointValue value={after!} state={isPending ? 'pending' : 'available'} signed={false} size="lg" /></>}
              </div>
              {after != null && after < 0 && !isPending && (
                <div className="demo-note demo-note--danger" style={{ marginTop: 12 }}><Icon name="alert" size={16} />Điểm khả dụng sẽ âm {num(after)} vì đại lý đã đổi quà trước khi trả hàng. Cho phép âm, trừ dần vào điểm phát sinh tiếp theo; đại lý không đổi quà được cho tới khi điểm dương.</div>
              )}
            </div>
          )}
        </div>
      )}
    </QuickView>
  );
}
