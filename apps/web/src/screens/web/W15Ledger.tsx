import { useMemo, useState } from 'react';
import { can, FUND_LABEL, type Fund, type LedgerType } from '@dmp/shared';
import { Button, DataTable, EmptyState, Field, Icon, PointBreakdown, PointValue, QuickView, StatusBadge } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { InfoGrid } from '../../shell/charts';
import { api, downloadExport } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, dateTime, num, signed } from '../../lib/fmt';
import type { Approval, LedgerRow, Order } from '../../lib/types';
import { NumField } from './W11PointRules';
import './W15Ledger.css';

interface Period { period: string; locked: boolean; lockedBy: string | null; lockedAt: string | null }

const TYPE_LABEL: Record<LedgerType, string> = { earn: 'Cộng', bonus: 'Thưởng', activity: 'Hoạt động', manual: 'Thủ công', adjust: 'Điều chỉnh', redeem: 'Đổi quà', refund: 'Hoàn điểm', reverse: 'Đảo', expire: 'Hết hạn' };
const TYPE_TONE: Record<string, 'success' | 'info' | 'neutral' | 'warning'> = { earn: 'success', bonus: 'success', activity: 'success', manual: 'success', refund: 'success', adjust: 'info', expire: 'neutral', redeem: 'warning', reverse: 'warning' };
const STATE_LABEL: Record<string, string> = { available: 'Khả dụng', pending: 'Treo', expired: 'Hết hạn', revoked: 'Thu hồi' };
const pLabel = (p: string) => `Kỳ ${p.slice(5)}/${p.slice(0, 4)}`;
const pShort = (p: string) => +p.slice(5);
const delta = (x: LedgerRow) => (x.fund === 'rank' ? x.deltaRank : x.deltaReward);
const curPeriod = () => new Date().toISOString().slice(0, 7);

/** W15 Sổ cái điểm — chỉ ghi thêm (không sửa/xoá); sai sót xử lý bằng bút toán điều chỉnh có duyệt; khoá sổ theo kỳ. */
export default function W15Ledger() {
  const { user } = useSession();
  const role = user!.role;
  const periodsQ = useApi<Period[]>('/periods');
  const q = useApi<LedgerRow[]>('/ledger?limit=5000');
  const apprQ = useApi<Approval[]>(can(role, 'approvals.view') ? '/approvals?status=pending' : null);
  const [period, setPeriod] = useState<string | null>(null);
  const [flt, setFlt] = useState({ type: 'all', fund: 'all', state: 'all', q: '' });
  const [view, setView] = useState<LedgerRow | null>(null);
  const [adj, setAdj] = useState<{ row: LedgerRow; points: number; fund: Fund; reason: string; title: string } | null>(null);
  const [dlg, setDlg] = useState<null | 'lock' | 'reopen' | 'expire'>(null);
  const [why, setWhy] = useState('');
  const orderQ = useApi<Order>(view && /^DH\d+/.test(view.ref) ? '/orders/' + view.ref : null, { retry: false });

  const periods = useMemo(() => {
    const m = new Map<string, Period>();
    (periodsQ.data ?? []).forEach((p) => m.set(p.period, p));
    (q.data ?? []).forEach((r) => { if (!m.has(r.period)) m.set(r.period, { period: r.period, locked: false, lockedBy: null, lockedAt: null }); });
    return [...m.values()].sort((a, b) => a.period.localeCompare(b.period));
  }, [periodsQ.data, q.data]);
  const now = curPeriod();
  const sel = period ?? (periods.find((p) => p.period === now) ?? periods[periods.length - 1])?.period ?? now;
  const selP = periods.find((p) => p.period === sel);
  const isLocked = !!selP?.locked;
  const openPeriod = periods.filter((p) => !p.locked).map((p) => p.period).sort().pop() ?? now;
  const reopenReq = (apprQ.data ?? []).find((a) => a.kind === 'reopen' && a.payload?.period === sel);

  const set = (k: keyof typeof flt, v: string) => setFlt({ ...flt, [k]: v });
  const rows = (q.data ?? []).filter((x) => x.period === sel
    && (flt.type === 'all' || x.type === flt.type)
    && (flt.fund === 'all' || x.fund === flt.fund || x.fund === 'both')
    && (flt.state === 'all' || x.state === flt.state)
    && (!flt.q || `${x.agentName} ${x.agentId} ${x.ref} GD${x.id} ${x.item}`.toLowerCase().includes(flt.q.toLowerCase())));
  const sum = rows.reduce((s, x) => s + delta(x), 0);
  const canAdjust = can(role, 'points.adjustPropose');

  const lock = useAction((p: string) => api.post(`/periods/${p}/lock`), {
    success: (_r, p) => ({ tone: 'success', title: `Đã khoá sổ ${pLabel(p).toLowerCase()}`, body: 'Mọi điều chỉnh sau thời điểm này rơi vào kỳ đang mở.' }), onDone: () => setDlg(null),
  });
  const reopen = useAction((v: { p: string; reason: string }) => api.post<Approval>(`/periods/${v.p}/reopen`, { reason: v.reason }), {
    success: (r, v) => ({ tone: 'info', title: `Đã gửi BOD yêu cầu mở lại ${pLabel(v.p).toLowerCase()}`, body: `${r.id} · theo dõi ở W13 Hàng chờ duyệt.` }), onDone: () => setDlg(null),
  });
  const expire = useAction(() => api.post<{ expiredLots: number; points: number }>('/jobs/expire'), {
    success: (r) => ({ tone: 'success', title: `Đã chạy hết hạn: ${num(r.expiredLots)} lô`, body: `Trừ ${num(r.points)} điểm thưởng quá hạn, ghi bút toán "Hết hạn" vào sổ cái.` }), onDone: () => setDlg(null),
  });
  const adjust = useAction((a: NonNullable<typeof adj>) => api.post<Approval>('/points/manual', {
    agentIds: [a.row.agentId], points: a.points, fund: a.fund, kind: 'adjust', title: a.title.trim(), reason: a.reason.trim(),
  }), {
    success: (r) => ({ tone: 'success', title: `Đã gửi BOD duyệt điều chỉnh (${r.id})`, body: 'Sau khi duyệt, bút toán điều chỉnh được ghi vào kỳ đang mở — dòng gốc giữ nguyên.' }),
    onDone: () => { setAdj(null); setView(null); },
  });

  const exportXlsx = () => downloadExport('ledger');
  const startAdjust = (row: LedgerRow) => setAdj({ row, points: -delta(row) || 0, fund: row.fund, reason: '', title: `Điều chỉnh GD${row.id}: ${row.item}` });

  return (
    <AdminShell screen="W15"
      sub="Sổ cái chỉ ghi thêm: không có nút sửa hay xoá. Sai sót xử lý bằng bút toán điều chỉnh/đảo có lý do."
      actions={<>
        {can(role, 'ledger.view') && <Button icon="download" onClick={exportXlsx} title="Xuất toàn bộ sổ cái (xlsx) — có ghi nhật ký">Xuất Excel</Button>}
        {role === 'KTT' && <Button icon="clock" onClick={() => setDlg('expire')}>Chạy hết hạn điểm</Button>}
        {can(role, 'periods.lock') && selP && !isLocked && <Button variant="primary" icon="lock" onClick={() => setDlg('lock')}>Khoá sổ kỳ {pShort(sel)}</Button>}
        {can(role, 'periods.lock') && isLocked && !reopenReq && <Button icon="send" onClick={() => { setWhy(''); setDlg('reopen'); }}>Đề nghị mở lại kỳ</Button>}
      </>}>
      <div className="demo-between w15-bar">
        <div className="w15-periods">
          {periods.map((p) => (
            <button type="button" key={p.period} className={'w15-per' + (sel === p.period ? ' is-on' : '') + (p.locked ? ' is-locked' : '')} aria-pressed={sel === p.period} onClick={() => setPeriod(p.period)}>
              {p.locked && <Icon name="lock" size={14} />}{pLabel(p.period)}
            </button>
          ))}
        </div>
        <span className="w15-pstate">
          {isLocked
            ? <><StatusBadge tone="neutral" icon="lock">Đã khoá sổ</StatusBadge><span className="demo-muted">ngày {date(selP?.lockedAt)}{selP?.lockedBy ? ' · ' + selP.lockedBy : ''}</span></>
            : <span className="demo-muted">Kỳ đang mở · khoá sổ đề xuất ngày 05 tháng sau</span>}
        </span>
      </div>
      {isLocked && reopenReq && <div className="demo-note"><Icon name="clock" size={16} />Đã gửi yêu cầu mở lại kỳ ({reopenReq.id}, {reopenReq.requestedBy}) — chờ BOD duyệt ở W13.</div>}
      {isLocked && role === 'BOD' && !reopenReq && <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Kỳ đã khoá. Kế toán trưởng gửi đề nghị mở lại; BOD duyệt ở W13 Hàng chờ duyệt.</div>}

      <div className="demo-filters">
        <Field label="Tìm" placeholder="Đại lý, mã, chứng từ" value={flt.q} onChange={(e) => set('q', e.target.value)} />
        <Field label="Loại" as="select" value={flt.type} onChange={(e) => set('type', e.target.value)} options={[{ value: 'all', label: 'Tất cả' }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))]} />
        <Field label="Quỹ" as="select" value={flt.fund} onChange={(e) => set('fund', e.target.value)} options={[{ value: 'all', label: 'Tất cả' }, { value: 'rank', label: 'Điểm hạng' }, { value: 'reward', label: 'Điểm thưởng' }]} />
        <Field label="Trạng thái" as="select" value={flt.state} onChange={(e) => set('state', e.target.value)} options={[{ value: 'all', label: 'Tất cả' }, ...Object.entries(STATE_LABEL).map(([value, label]) => ({ value, label }))]} />
        <span className="demo-muted w15-total">{rows.length} giao dịch · tổng {signed(sum)} điểm</span>
      </div>

      {q.isLoading || periodsQ.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="w15-table"><DataTable rows={rows} rowKey="id" onRowClick={setView} itemLabel="giao dịch"
          columns={[
            { key: 'id', label: 'Mã GD', primary: true, render: (x) => <div><b>GD{x.id}</b><div className="demo-sub">{dateTime(x.createdAt)}</div></div> },
            { key: 'agent', label: 'Đại lý', render: (x) => <div>{x.agentName}<div className="demo-sub">{x.agentId}</div></div> },
            { key: 'type', label: 'Loại', render: (x) => <StatusBadge tone={TYPE_TONE[x.type] ?? 'neutral'}>{TYPE_LABEL[x.type as LedgerType] ?? x.type}</StatusBadge> },
            { key: 'item', label: 'Hạng mục', render: (x) => <span className="w15-wrap">{x.item}{x.reversalOf ? <span className="demo-sub"> · đảo GD{x.reversalOf}</span> : null}</span> },
            { key: 'delta', label: '+/−', align: 'right', render: (x) => <div><PointValue value={delta(x)} state={x.state} signed /><div className="demo-sub">{FUND_LABEL[x.fund]}</div></div> },
            { key: 'ref', label: 'Chứng từ · Rule', render: (x) => <div>{x.ref || '—'}<div className="demo-sub">{x.rule}</div></div> },
            { key: 'by', label: 'Người duyệt', render: (x) => <span className="w15-wrap w15-by">{x.byUser}</span> },
            { key: 'lk', label: '', render: (x) => (isLocked ? <Icon name="lock" size={14} label="Kỳ đã khoá" />
              : canAdjust && x.type !== 'adjust' ? <Button variant="ghost" icon="edit" onClick={(e) => { e.stopPropagation(); startAdjust(x); }}>Điều chỉnh</Button> : null) },
          ]}
          empty={<EmptyState icon="search" title="Không có giao dịch khớp bộ lọc" body="Đổi kỳ hoặc bỏ bớt điều kiện lọc." />} /></div>
      )}

      {view && !adj && (
        <QuickView title={`GD${view.id} · ${view.agentName}`} onClose={() => setView(null)}
          footer={<>
            <Button onClick={() => setView(null)}>Đóng</Button>
            {canAdjust && <Button variant="primary" icon="edit" onClick={() => startAdjust(view)}>Điều chỉnh</Button>}
          </>}>
          <div className="demo-grid">
            <div className="demo-row">
              <StatusBadge tone={TYPE_TONE[view.type] ?? 'neutral'}>{TYPE_LABEL[view.type as LedgerType] ?? view.type}</StatusBadge>
              <PointValue value={delta(view)} state={view.state} signed size="lg" showState />
              {view.period && periods.find((p) => p.period === view.period)?.locked && <StatusBadge tone="neutral" icon="lock">{pLabel(view.period)} đã khoá</StatusBadge>}
            </div>
            <InfoGrid cols={2} items={[
              ['Hạng mục', view.item],
              ['Thời điểm', dateTime(view.createdAt)],
              ['Điểm hạng', signed(view.deltaRank)],
              ['Điểm thưởng', signed(view.deltaReward)],
              ['Quỹ', FUND_LABEL[view.fund]],
              ['Trạng thái', STATE_LABEL[view.state]],
              ['Chứng từ', view.ref || '—'],
              ['Rule', view.rule],
              ['Người tạo / duyệt', view.byUser],
              ['Yêu cầu duyệt', view.approvalId ?? '—'],
              !!view.expiresAt && ['Lô hết hạn', date(view.expiresAt)],
              !!view.reversalOf && ['Đảo của', 'GD' + view.reversalOf],
            ]} />
            {orderQ.data?.calc && (
              <div>
                <div className="demo-strong" style={{ marginBottom: 4 }}>Cách tính điểm đơn {orderQ.data.id}</div>
                <PointBreakdown steps={orderQ.data.calc.steps} total={orderQ.data.points} state={orderQ.data.pointState === 'available' ? 'available' : 'pending'}
                  footnote={`Quy tắc v${orderQ.data.ruleVersion}${orderQ.data.returns?.length ? ' · ' + orderQ.data.returns.map((r) => `${r.id}: trả ${Math.round(r.pct * 100)}% → −${num(r.points)} điểm`).join(' · ') : ''}`} />
              </div>
            )}
            <div className="demo-sub">Sổ cái chỉ ghi thêm. Nếu dòng này sai, tạo bút toán điều chỉnh (Kế toán trưởng đề xuất, BOD duyệt) — dòng gốc giữ nguyên.</div>
          </div>
        </QuickView>
      )}

      {adj && (
        <QuickView title={`Điều chỉnh GD${adj.row.id} · ${adj.row.agentName}`} onClose={() => setAdj(null)}
          footer={<><Button onClick={() => setAdj(null)}>Huỷ</Button>
            <Button variant="primary" icon="send" disabled={!adj.points || !adj.reason.trim() || !adj.title.trim() || adjust.isPending} onClick={() => adjust.mutate(adj)}>Gửi BOD duyệt</Button></>}>
          <div className="demo-grid">
            <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Dòng gốc: {adj.row.item} · {signed(delta(adj.row))} điểm ({FUND_LABEL[adj.row.fund]}). Bút toán điều chỉnh sẽ ghi vào {pLabel(openPeriod).toLowerCase()} sau khi BOD duyệt.</div>
            <Field label="Nội dung bút toán" required value={adj.title} onChange={(e) => setAdj({ ...adj, title: e.target.value })} />
            <div className="w15-two">
              <NumField label="Số điểm (+ cộng / − trừ)" required value={adj.points} suffix="điểm" onNum={(n) => setAdj({ ...adj, points: n })} error={adj.points ? undefined : 'Nhập số khác 0'} />
              <Field label="Quỹ" as="select" value={adj.fund} options={(Object.keys(FUND_LABEL) as Fund[]).map((f) => ({ value: f, label: FUND_LABEL[f] }))} onChange={(e) => setAdj({ ...adj, fund: e.target.value as Fund })} />
            </div>
            <Field as="textarea" label="Lý do" required value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="Ví dụ: Trả hàng sau khoá sổ kỳ 09 — thu hồi điểm đơn DH0874" error={adj.reason.trim() ? undefined : 'Bắt buộc nhập lý do'} />
          </div>
        </QuickView>
      )}

      {dlg && (
        <QuickView title={dlg === 'lock' ? `Khoá sổ ${pLabel(sel).toLowerCase()}?` : dlg === 'reopen' ? `Đề nghị mở lại ${pLabel(sel).toLowerCase()}` : 'Chạy hết hạn điểm?'} onClose={() => setDlg(null)}
          footer={<><Button onClick={() => setDlg(null)}>Huỷ</Button>
            {dlg === 'lock' && <Button variant="primary" icon="lock" disabled={lock.isPending} onClick={() => lock.mutate(sel)}>Khoá sổ</Button>}
            {dlg === 'reopen' && <Button variant="primary" icon="send" disabled={!why.trim() || reopen.isPending} onClick={() => reopen.mutate({ p: sel, reason: why })}>Gửi BOD duyệt</Button>}
            {dlg === 'expire' && <Button variant="primary" icon="clock" disabled={expire.isPending} onClick={() => expire.mutate()}>Chạy ngay</Button>}
          </>}>
          {dlg === 'lock' && <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Sau khi khoá, không ghi thêm giao dịch vào {pLabel(sel).toLowerCase()} ({num(rows.length)} giao dịch đang hiển thị). Mở lại cần BOD duyệt.</div>}
          {dlg === 'reopen' && <Field as="textarea" label="Lý do mở lại" required value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Ví dụ: Cần ghi bổ sung đơn trả hàng DH0874 vào kỳ 09" error={why.trim() ? undefined : 'Bắt buộc nhập lý do'} />}
          {dlg === 'expire' && <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Job thường chạy tự động. Mọi lô điểm thưởng quá hạn sẽ bị trừ và ghi bút toán "Hết hạn" vào kỳ đang mở. Không hoàn tác được.</div>}
        </QuickView>
      )}
    </AdminShell>
  );
}
