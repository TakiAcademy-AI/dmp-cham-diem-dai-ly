import { useMemo, useRef, useState } from 'react';
import { can } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, Field, Icon, KpiCard, PointValue, QuickView, StatusBadge, Tabs } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { HBars } from '../../shell/charts';
import { api, downloadExport } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi, useToast } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime, mil, num, vnd } from '../../lib/fmt';
import type { Order as BaseOrder } from '../../lib/types';
import './W10Debt.css';

/** Hàng trả về từ GET /debt. */
interface DebtRow {
  id: string; name: string; saleName: string; tier: string; debt: number; overdueDays: number; creditLimit: number | null; creditDays: number; flags: string[];
  invoices: Array<{ id: string; value: number; pay: string; orderedAt: string }>;
}
/** GET /payments — mỗi lần thu (thủ công hoặc import MISA). */
interface Payment { id: number; orderId: string; agentId: string; agentName: string; amount: number; method: string; source: string; byUser: string; at: string }
interface PayRes { id: string; amount: number; full: boolean; activated: number; remaining: number }
interface ImportRes { dryRun: boolean; errors: string[]; results: Array<{ orderId: string; amount: number; date?: string; method?: string; ok: boolean; message: string }> }
type Order = BaseOrder & { paidAmount?: number };

const PAY: Record<string, 'success' | 'pending' | 'danger' | 'neutral' | 'warning'> = { 'Đã thanh toán': 'success', 'Chưa thanh toán': 'pending', 'Thanh toán một phần': 'warning', 'Quá hạn': 'danger' };
const METHODS = ['Chuyển khoản', 'Tiền mặt', 'Bù trừ công nợ'];
const MISA_SAMPLE = 'Mã đơn;Số tiền;Ngày;Hình thức\nDH0834;5.000.000;28/10/2026;Chuyển khoản';
const blocked = (a: DebtRow) => a.overdueDays > 0 && !a.flags.includes('creditException');
const due = (o: Order) => Math.round(o.value * (1 - o.returnedPct));
const remainingOf = (o: Order) => Math.max(0, due(o) - (o.paidAmount ?? 0));
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** W10 Thanh toán & công nợ — KPI, danh sách quá hạn/tất cả, KT ghi nhận thanh toán (một phần/đủ), import MISA, lịch sử thanh toán, tuổi nợ. */
export default function W10Debt() {
  const { user } = useSession();
  const role = user!.role;
  const isKT = can(role, 'payments.record');
  const canImport = can(role, 'payments.import');
  const canExc = can(role, 'credit.exceptionPropose');
  const q = useApi<DebtRow[]>('/debt');
  const oq = useApi<Order[]>('/orders');
  const pq = useApi<Payment[]>('/payments');
  const [tab, setTab] = useState('overdue');
  const [exc, setExc] = useState<DebtRow | null>(null);
  const [payAgent, setPayAgent] = useState('');
  const [paying, setPaying] = useState<Order | null>(null);
  const [histAgent, setHistAgent] = useState('');

  const A = q.data ?? [];
  const orders = oq.data ?? [];
  const pays = pq.data ?? [];
  const overdue = A.filter((a) => a.overdueDays > 0);
  const total = A.reduce((s, a) => s + a.debt, 0);
  const od = overdue.reduce((s, a) => s + a.debt, 0);
  const b2 = overdue.filter((a) => a.overdueDays <= 60).reduce((s, a) => s + a.debt, 0);
  const aging: Array<[string, number]> = [['0–30 ngày', total - od], ['31–60 ngày', b2], ['Trên 60 ngày', od - b2]];
  const unpaid = orders.filter((o) => o.pay !== 'Đã thanh toán' && o.status !== 'Huỷ' && o.status !== 'Chờ duyệt' && o.pay !== '—');
  const pendingPts = orders.filter((o) => o.pointState === 'pending').reduce((s, o) => s + Math.round(o.points * (1 - o.returnedPct)), 0);
  const payable = payAgent ? unpaid.filter((o) => o.agentId === payAgent) : unpaid;
  const agentsWithUnpaid = [...new Map(unpaid.map((o) => [o.agentId, o.agentName])).entries()];
  const today = pays.filter((p) => isToday(p.at));
  const histAgents = useMemo(() => [...new Map(pays.map((p) => [p.agentId, p.agentName])).entries()], [pays]);
  const seeSale = role !== 'SALE';

  const tabs = [
    { key: 'overdue', label: 'Quá hạn', count: overdue.length, alert: overdue.length > 0 },
    { key: 'all', label: 'Tất cả công nợ', count: A.length },
    ...(isKT ? [{ key: 'manual', label: 'Ghi nhận thanh toán', count: unpaid.length }] : []),
    ...(canImport ? [{ key: 'misa', label: 'Import MISA' }] : []),
    { key: 'history', label: 'Lịch sử thanh toán', count: pays.length || undefined },
  ];
  const wide = tab === 'manual' || tab === 'misa' || tab === 'history';

  return (
    <AdminShell screen="W10" crumb="Công nợ"
      sub={role === 'SALE' ? 'Chỉ đại lý bạn phụ trách · chỉ xem' : 'Kế toán nhập tay hoặc import file thanh toán từ MISA. Hệ thống chỉ hiển thị, không tính lãi phạt.'}
      actions={<>
        {can(role, 'export.excel') && <Button icon="download" onClick={() => downloadExport('debt')}>Xuất Excel</Button>}
        {canImport && <Button icon="upload" onClick={() => setTab('misa')}>Import file MISA</Button>}
        {isKT && <Button variant="primary" icon="plus" onClick={() => setTab('manual')}>Ghi nhận thanh toán</Button>}
      </>}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <>
          <div className="demo-grid demo-grid--4">
            <KpiCard label="Tổng công nợ" value={mil(total)} hint={A.length + ' đại lý'} />
            <KpiCard label="Quá hạn" value={mil(od)} tone="danger" hint={overdue.filter(blocked).length + ' đại lý bị chặn đặt hàng'} />
            <KpiCard label="Đơn chưa thanh toán" value={num(unpaid.length)} hint={`${mil(unpaid.reduce((s, o) => s + remainingOf(o), 0))} · ${num(pendingPts)} điểm treo`} />
            <KpiCard label="Thanh toán hôm nay" value={pq.isLoading ? '…' : mil(today.reduce((s, p) => s + p.amount, 0))} hint={pq.error ? 'Không tải được' : `${today.length} lần thu`} onClick={() => setTab('history')} />
          </div>
          <div className={'w10-side' + (wide ? ' is-wide' : '')}>
            <div className="demo-grid w10-main">
              <Tabs value={tab} onChange={setTab} items={tabs} />
              {(tab === 'overdue' || tab === 'all') && (
                <DataTable key={tab} rows={tab === 'overdue' ? overdue : A} rowKey="id" itemLabel="đại lý" rowTone={(a) => (a.overdueDays ? 'overdue' : null)}
                  empty={<EmptyState icon="check" title={tab === 'overdue' ? 'Không có đại lý quá hạn' : 'Không có công nợ'} body="Tốt — không đại lý nào bị chặn đặt hàng." />}
                  columns={[
                    { key: 'name', label: 'Đại lý', primary: true, render: (a) => <div><div className="demo-strong">{a.name}</div><div className="demo-sub">{a.id} · hạn {a.creditDays} ngày</div></div> },
                    ...(seeSale ? [{ key: 'sale', label: 'Sale', render: (a: DebtRow) => a.saleName || <span className="demo-muted">—</span> }] : []),
                    { key: 'debt', label: 'Còn nợ', align: 'right', render: (a) => vnd(a.debt) },
                    { key: 'od', label: 'Quá hạn', render: (a) => (a.overdueDays ? <StatusBadge tone="danger">{a.overdueDays} ngày</StatusBadge> : <span className="demo-muted">Chưa đến hạn</span>) },
                    { key: 'lim', label: 'Hạn mức đã dùng', render: (a) => {
                      if (!a.creditLimit) return <span className="demo-muted">Chưa đặt hạn mức</span>;
                      const raw = Math.round((a.debt / a.creditLimit) * 100);
                      return <span><span className="w10-lim"><i className={raw > 90 ? 'hi' : ''} style={{ width: Math.min(100, raw) + '%' }} /></span>{raw}%</span>;
                    } },
                    { key: 'blk', label: 'Đặt hàng', render: (a) => (blocked(a) ? <StatusBadge tone="danger" icon="lock">Đang chặn</StatusBadge> : a.overdueDays ? <StatusBadge tone="warning">Ngoại lệ</StatusBadge> : <StatusBadge tone="success">Cho phép</StatusBadge>) },
                    ...(canExc ? [{ key: 'x', label: '', render: (a: DebtRow) => (blocked(a) ? <Button onClick={() => setExc(a)}>Xin ngoại lệ</Button> : null) }] : []),
                  ]} />
              )}
              {tab === 'manual' && isKT && (
                <Card title="Ghi nhận thanh toán" subtitle="Thu một phần chỉ trừ công nợ. Khi đơn đã trả đủ, điểm treo của đơn tự chuyển khả dụng và gửi ZNS cho đại lý.">
                  <div className="w10-filter">
                    <Field label="Đại lý" as="select" value={payAgent} onChange={(e) => setPayAgent(e.target.value)}
                      options={[{ value: '', label: `Tất cả (${agentsWithUnpaid.length} đại lý)` }, ...agentsWithUnpaid.map(([id, name]) => ({ value: id, label: `${id} — ${name}` }))]} />
                  </div>
                  {oq.isLoading ? <Loading /> : oq.error ? <ErrorNote error={oq.error} /> : (
                    <DataTable rows={payable} rowKey="id" itemLabel="đơn" rowTone={(o) => (o.pay === 'Quá hạn' ? 'overdue' : null)}
                      empty={<EmptyState icon="check" title="Không còn đơn chưa thanh toán" />}
                      columns={[
                        { key: 'id', label: 'Đơn', primary: true, render: (o) => <div><div className="demo-strong">{o.id}</div><div className="demo-sub">{dateTime(o.orderedAt)}</div></div> },
                        { key: 'agent', label: 'Đại lý', render: (o) => <div>{o.agentName}<div className="demo-sub">{o.agentId}</div></div> },
                        { key: 'value', label: 'Giá trị', align: 'right', render: (o) => vnd(due(o)) },
                        { key: 'rem', label: 'Còn nợ', align: 'right', render: (o) => <div><div className="demo-strong">{vnd(remainingOf(o))}</div>{o.paidAmount ? <div className="demo-sub">đã trả {vnd(o.paidAmount)}</div> : null}</div> },
                        { key: 'pay', label: 'Thanh toán', render: (o) => <StatusBadge tone={PAY[o.pay] ?? 'neutral'}>{o.pay}</StatusBadge> },
                        { key: 'pts', label: 'Điểm treo', align: 'right', render: (o) => (o.pointState === 'pending' ? <PointValue value={Math.round(o.points * (1 - o.returnedPct))} state="pending" showState={false} /> : <span className="demo-muted">—</span>) },
                        { key: 'x', label: '', render: (o) => <Button variant="primary" icon="wallet" onClick={() => setPaying(o)}>Ghi nhận</Button> },
                      ]} />
                  )}
                </Card>
              )}
              {tab === 'misa' && canImport && <MisaImport onDone={() => setTab('history')} />}
              {tab === 'history' && (
                <Card title="Lịch sử thanh toán" subtitle="Mỗi lần thu tiền — nhập tay hoặc import MISA · 500 lần gần nhất"
                  actions={<div className="w10-hfilter"><Field label="Đại lý" as="select" value={histAgent} onChange={(e) => setHistAgent(e.target.value)}
                    options={[{ value: '', label: 'Tất cả đại lý' }, ...histAgents.map(([id, name]) => ({ value: id, label: `${id} — ${name}` }))]} /></div>}>
                  <PaymentHistory agentId={histAgent} />
                </Card>
              )}
            </div>
            {!wide && <Card title="Tuổi nợ" subtitle="Toàn bộ công nợ hiện tại">
              {total ? <HBars rows={aging.map(([label, v]) => ({ label, value: v, valueLabel: mil(v), tip: Math.round((v / total) * 100) + '% tổng nợ' }))} /> : <span className="demo-muted">Không có công nợ</span>}
              <div className="demo-sub" style={{ marginTop: 12 }}>Nợ quá hạn trên 30 ngày: chặn đặt hàng và chặn cộng điểm trong tháng [CHỜ CHỐT phạm vi chặn].</div>
            </Card>}
          </div>
        </>
      )}
      {exc && <ExceptionDialog agent={exc} onClose={() => setExc(null)} />}
      {paying && <PayDialog order={paying} onClose={() => setPaying(null)} />}
    </AdminShell>
  );
}

/** Lịch sử thanh toán theo đại lý (GET /payments?agentId=). */
function PaymentHistory({ agentId }: { agentId: string }) {
  const q = useApi<Payment[]>('/payments' + (agentId ? '?agentId=' + encodeURIComponent(agentId) : ''));
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const rows = q.data ?? [];
  return (
    <DataTable rows={rows} rowKey="id" itemLabel="lần thu" maxHeight={520}
      empty={<EmptyState icon="wallet" title="Chưa có thanh toán nào" body="Kế toán ghi nhận ở tab Ghi nhận thanh toán hoặc import file MISA." />}
      columns={[
        { key: 'at', label: 'Thời gian', render: (p) => dateTime(p.at) },
        { key: 'order', label: 'Đơn', primary: true, render: (p) => <div><div className="demo-strong">{p.orderId}</div><div className="demo-sub">{p.agentId} · {p.agentName}</div></div> },
        { key: 'amount', label: 'Số tiền', align: 'right', render: (p) => <span className="demo-strong">{vnd(p.amount)}</span> },
        { key: 'method', label: 'Hình thức' },
        { key: 'source', label: 'Nguồn', render: (p) => <StatusBadge tone={p.source === 'MISA' ? 'info' : 'neutral'}>{p.source}</StatusBadge> },
        { key: 'by', label: 'Người ghi', render: (p) => <span className="demo-sub">{p.byUser}</span> },
      ]} />
  );
}

/** KT ghi nhận thanh toán một đơn: để nguyên số tiền = thu đủ phần còn lại. */
function PayDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const rem = remainingOf(order);
  const [amount, setAmount] = useState(String(rem));
  const [method, setMethod] = useState(METHODS[0]);
  const amt = Number(amount.replace(/\D/g, '')) || 0;
  const full = amt >= rem - 1;
  const err = amt <= 0 ? 'Nhập số tiền lớn hơn 0' : amt > rem + 1 ? `Vượt phần còn nợ (${vnd(rem)})` : undefined;
  const pts = order.pointState === 'pending' ? Math.round(order.points * (1 - order.returnedPct)) : 0;
  const pay = useAction(() => api.post<PayRes>(`/orders/${order.id}/payment`, full ? { method } : { amount: amt, method }), {
    success: (r) => (r.full
      ? { tone: 'success', title: `Đã ghi nhận thanh toán đủ đơn ${r.id}`, body: r.activated ? `+${num(r.activated)} điểm chuyển sang Khả dụng, đã gửi ZNS cho đại lý.` : 'Đơn không có điểm treo.' }
      : { tone: 'success', title: `Đã ghi nhận ${vnd(r.amount)} cho đơn ${r.id}`, body: `Còn nợ ${vnd(r.remaining)} · điểm treo chỉ khả dụng khi trả đủ.` }),
    onDone: onClose,
  });
  return (
    <QuickView title={'Ghi nhận thanh toán · ' + order.id} onClose={onClose}
      footer={<><Button onClick={onClose}>Đóng</Button><Button variant="primary" icon="check" disabled={!!err || pay.isPending} onClick={() => pay.mutate()}>{full ? 'Ghi nhận thu đủ' : 'Ghi nhận một phần'}</Button></>}>
      <div className="w10-form">
        <div className="demo-sub">{order.agentName} · giá trị {vnd(due(order))}{order.paidAmount ? ` · đã trả ${vnd(order.paidAmount)}` : ''}</div>
        <div className="w10-rem"><span>Còn nợ</span><b>{vnd(rem)}</b></div>
        <Field label="Số tiền thu" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="đ" inputMode="numeric" error={err}
          hint={!err ? (full ? 'Thu đủ — đơn chuyển Đã thanh toán' : `Thu một phần — còn lại ${vnd(rem - amt)}`) : undefined} />
        <div className="demo-row">
          <Button onClick={() => setAmount(String(rem))}>Thu đủ</Button>
          <Button onClick={() => setAmount(String(Math.round(rem / 2)))}>Một nửa</Button>
        </div>
        <Field label="Hình thức" as="select" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} />
        {pts > 0 && <div className={'demo-note' + (full ? '' : ' demo-note--muted')}><Icon name="star" size={16} />{full ? `${num(pts)} điểm treo sẽ chuyển Khả dụng và gửi ZNS cho đại lý.` : `${num(pts)} điểm vẫn treo cho tới khi đơn trả đủ.`}</div>}
      </div>
    </QuickView>
  );
}

/** Import CSV thanh toán xuất từ MISA: dán hoặc chọn file → xem trước (dryRun) → xác nhận ghi nhận. */
function MisaImport({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportRes | null>(null);
  const [done, setDone] = useState<ImportRes | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const dry = useAction(() => api.post<ImportRes>('/payments/import', { csv, dryRun: true }), { invalidate: [], onDone: (r) => { setPreview(r); setDone(null); } });
  const run = useAction(() => api.post<ImportRes>('/payments/import', { csv, dryRun: false }), {
    success: (r) => ({ tone: 'success', title: `Đã import ${r.results.filter((x) => x.ok).length}/${r.results.length} dòng thanh toán MISA`, body: 'Đơn trả đủ đã chuyển điểm treo sang Khả dụng.' }),
    onDone: (r) => { setDone(r); setPreview(null); },
  });
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try { setCsv(await f.text()); setFileName(f.name); setPreview(null); setDone(null); }
    catch { toast({ tone: 'danger', title: 'Không đọc được file', body: 'Chọn file CSV (UTF-8) xuất từ MISA.' }); }
    if (ref.current) ref.current.value = '';
  };
  const res = done ?? preview;
  const okN = res?.results.filter((x) => x.ok).length ?? 0;
  const okSum = res?.results.filter((x) => x.ok).reduce((s, x) => s + x.amount, 0) ?? 0;
  return (
    <Card title="Import thanh toán từ MISA" subtitle="CSV có cột Mã đơn và Số tiền (tuỳ chọn Ngày, Hình thức), phân cách bằng ; hoặc ,. Xem trước trước khi ghi nhận.">
      <div className="w10-form">
        <div className="demo-row">
          <Button icon="upload" onClick={() => ref.current?.click()}>Chọn file CSV</Button>
          {fileName && <span className="demo-sub">{fileName}</span>}
          <Button variant="ghost" onClick={() => { setCsv(MISA_SAMPLE); setFileName(''); setPreview(null); setDone(null); }}>Dán mẫu</Button>
          <input ref={ref} type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <Field label="Nội dung CSV" as="textarea" value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); setDone(null); }} placeholder={MISA_SAMPLE} className="w10-csv" />
        <div className="demo-row">
          <Button icon="eye" disabled={!csv.trim() || dry.isPending} onClick={() => dry.mutate()}>{dry.isPending ? 'Đang kiểm tra…' : 'Xem trước'}</Button>
          {preview && <Button variant="primary" icon="check" disabled={!okN || run.isPending} onClick={() => run.mutate()}>Xác nhận ghi nhận {okN} dòng · {vnd(okSum)}</Button>}
          {done && <Button onClick={onDone}>Xem lịch sử thanh toán</Button>}
        </div>
        {res && (
          <>
            <div className={'demo-note' + (done ? '' : ' demo-note--muted')}><Icon name={done ? 'check' : 'info'} size={16} />
              {done ? `Đã ghi nhận ${okN}/${res.results.length} dòng.` : `Xem trước: ${okN}/${res.results.length} dòng hợp lệ · tổng ${vnd(okSum)}. Chưa ghi nhận gì — bấm Xác nhận để thực hiện.`}
            </div>
            {res.errors.length > 0 && <div className="demo-note demo-note--danger"><Icon name="alert" size={16} /><div>{res.errors.map((e) => <div key={e}>{e}</div>)}</div></div>}
            <DataTable rows={res.results.map((r, i) => ({ ...r, k: i }))} rowKey="k" itemLabel="dòng"
              empty={<EmptyState icon="file" title="Không có dòng hợp lệ" body="Kiểm tra lại tiêu đề cột Mã đơn / Số tiền." />}
              columns={[
                { key: 'orderId', label: 'Mã đơn', primary: true, render: (r) => <span className="demo-strong">{r.orderId}</span> },
                { key: 'amount', label: 'Số tiền', align: 'right', render: (r) => vnd(r.amount) },
                { key: 'date', label: 'Ngày', render: (r) => r.date || <span className="demo-muted">—</span> },
                { key: 'method', label: 'Hình thức', render: (r) => r.method || <span className="demo-muted">Chuyển khoản</span> },
                { key: 'ok', label: 'Kết quả', render: (r) => <StatusBadge tone={r.ok ? 'success' : 'danger'}>{r.ok ? 'Hợp lệ' : 'Lỗi'}</StatusBadge> },
                { key: 'msg', label: 'Ghi chú', render: (r) => <span className={r.ok ? 'demo-sub' : 'w10-err'}>{r.message}</span> },
              ]} />
          </>
        )}
      </div>
    </Card>
  );
}

/** Xin ngoại lệ đặt hàng khi nợ quá hạn → hàng chờ BOD (W13). */
function ExceptionDialog({ agent, onClose }: { agent: DebtRow; onClose: () => void }) {
  const [amount, setAmount] = useState('20000000');
  const [reason, setReason] = useState('');
  const send = useAction(() => api.post(`/agents/${agent.id}/requests`, { kind: 'credit', amount: Number(amount.replace(/\D/g, '')) || 0, reason: reason.trim() }), {
    success: () => ({ tone: 'success', title: 'Đã gửi yêu cầu ngoại lệ cho ' + agent.name, body: 'BOD duyệt trong ngày (W13 · Ngoại lệ công nợ).' }),
    onDone: onClose,
  });
  return (
    <QuickView title={'Xin ngoại lệ · ' + agent.name} onClose={onClose}
      footer={<><Button onClick={onClose}>Đóng</Button><Button variant="primary" icon="send" disabled={!reason.trim() || send.isPending} onClick={() => send.mutate()}>Gửi BOD duyệt</Button></>}>
      <div className="w10-form">
        <div className="demo-sub">Còn nợ {vnd(agent.debt)} · quá hạn {agent.overdueDays} ngày</div>
        <Field label="Giá trị đơn cần đặt" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="đ" inputMode="numeric" />
        <Field label="Lý do" as="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Đại lý cam kết thanh toán trước 05/11" />
      </div>
    </QuickView>
  );
}
