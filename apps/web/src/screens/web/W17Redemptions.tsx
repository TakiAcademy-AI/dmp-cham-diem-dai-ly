import { useState } from 'react';
import { can, REDEMPTION_STAGE_LABEL, type RedemptionStage } from '@dmp/shared';
import { ApprovalStepper, Button, Card, DataTable, EmptyState, Field, PointValue, QuickView, StatusBadge, Tabs, TierBadge, type ApprovalStep, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { api, downloadExport } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, num } from '../../lib/fmt';
import type { AgentDetail, Redemption } from '../../lib/types';
import './W17Redemptions.css';

interface Col { key: string; label: string; hint: string; stages: string[]; act?: string }
const COLS: Col[] = [
  { key: 'new', label: 'Mới', hint: 'Sale phụ trách xác nhận', stages: ['new'], act: 'Xác nhận' },
  { key: 'confirmed', label: 'Sale đã xác nhận', hint: 'KT/KTT duyệt giá trị quà', stages: ['confirmed'], act: 'Duyệt' },
  { key: 'approved', label: 'Đã duyệt', hint: 'Kho chuẩn bị, in phiếu xuất', stages: ['approved'], act: 'Bắt đầu giao' },
  { key: 'shipping', label: 'Đang giao', hint: 'Đại lý ký nhận', stages: ['shipping'], act: 'Đã ký nhận' },
  { key: 'done', label: 'Hoàn tất / Huỷ', hint: 'Từ chối hoặc huỷ thì hoàn điểm', stages: ['done', 'cancelled', 'rejected'] },
];
const FLOW: RedemptionStage[] = ['new', 'confirmed', 'approved', 'shipping', 'done'];
const STAGE_TONE: Record<string, 'success' | 'neutral' | 'danger' | 'pending' | 'info'> = { done: 'success', cancelled: 'neutral', rejected: 'danger', shipping: 'info' };
const ACT_MSG: Record<string, (r: Redemption) => string> = {
  confirmed: () => 'Đã xác nhận, chuyển Kế toán duyệt',
  approved: (r) => `Đã duyệt yêu cầu ${r.id} — chuyển Kho xuất quà`,
  shipping: () => 'Đã chuyển Đang giao',
  done: () => 'Hoàn tất — đại lý đã ký nhận',
};
const terminal = (s: string) => ['done', 'cancelled', 'rejected'].includes(s);

/** W17 Yêu cầu đổi quà — Kanban theo bước (Sale xác nhận → KT/KTT duyệt → Kho giao), chế độ bảng, từ chối hoàn điểm, in phiếu xuất. */
export default function W17Redemptions() {
  const { user } = useSession();
  const role = user!.role;
  const q = useApi<Redemption[]>('/redemptions');
  const [view, setView] = useState('kanban');
  const [detail, setDetail] = useState<string | null>(null);
  const [printing, setPrint] = useState<Redemption | null>(null);
  const [rejecting, setRejecting] = useState<Redemption | null>(null);

  const advance = useAction((r: Redemption) => api.post<{ id: string; stage: string }>(`/redemptions/${r.id}/advance`, {}), {
    success: (res, r) => ({ tone: 'success', title: ACT_MSG[res.stage]?.(r) ?? 'Đã cập nhật', body: res.stage === 'approved' ? `ZNS: "Yêu cầu đổi ${r.giftName} (${r.id}) đã được duyệt."` : undefined }),
  });

  const list = q.data ?? [];
  const mayAct = (r: Redemption) => !!r.next && r.next.roles.includes(role);
  /** Từ chối: KT/KTT ở mọi bước trước khi giao; Sale ở bước Mới (API: redemptions.confirm/approve, chặn từ Đang giao). */
  const mayReject = (r: Redemption) => !['done', 'cancelled', 'rejected', 'shipping'].includes(r.stage) && (can(role, 'redemptions.approve') || (can(role, 'redemptions.confirm') && r.stage === 'new'));
  const mayPrint = (r: Redemption) => (r.stage === 'approved' || r.stage === 'shipping') && (can(role, 'redemptions.ship') || can(role, 'redemptions.approve'));
  const actLabel = (r: Redemption) => COLS.find((c) => c.stages.includes(r.stage))?.act ?? r.next?.label ?? 'Tiếp tục';
  const cur = list.find((r) => r.id === detail) ?? null;

  const actions = (r: Redemption) => (
    <>
      {mayAct(r) && <Button variant="primary" disabled={advance.isPending} onClick={(e) => { e.stopPropagation(); advance.mutate(r); }}>{actLabel(r)}</Button>}
      {mayPrint(r) && <Button icon="printer" onClick={(e) => { e.stopPropagation(); setPrint(r); }}>In phiếu</Button>}
      {mayReject(r) && <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setRejecting(r); }}>Từ chối</Button>}
    </>
  );

  const card = (r: Redemption) => (
    <div className="w17-rc" key={r.id} role="button" tabIndex={0} onClick={() => setDetail(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setDetail(r.id); }}>
      <div className="w17-rc__g"><b>{r.agentName}</b><span className="demo-sub">{r.id}</span></div>
      <div>{r.giftName}{r.qty > 1 ? ` ×${r.qty}` : ''}</div>
      <div className="w17-rc__g"><PointValue value={-r.points} state={r.stage === 'cancelled' || r.stage === 'rejected' ? 'revoked' : 'available'} /><span className="demo-sub">{date(r.createdAt)}</span></div>
      <div className="demo-sub">{r.agentId}{r.saleName ? ' · Sale: ' + r.saleName : ''}</div>
      {r.note && <div className="demo-sub w17-note">{r.note}</div>}
      {terminal(r.stage) && <div><StatusBadge tone={STAGE_TONE[r.stage]}>{REDEMPTION_STAGE_LABEL[r.stage as RedemptionStage] ?? r.stage}</StatusBadge></div>}
      {!terminal(r.stage) && r.next && !mayAct(r) && <div className="demo-sub">Chờ: {r.next.label}</div>}
      {(mayAct(r) || mayPrint(r) || mayReject(r)) && <div className="demo-row w17-acts">{actions(r)}</div>}
    </div>
  );

  const sub = role === 'SALE' ? 'Bấm "Xác nhận" ở cột Mới · chỉ thấy yêu cầu của đại lý mình'
    : role === 'KHO' ? 'Kho xuất quà và xác nhận đã giao ở cột Đã duyệt / Đang giao'
    : 'Điểm đã trừ khi đại lý gửi yêu cầu; từ chối hoặc huỷ trước khi giao thì hoàn điểm';

  return (
    <AdminShell screen="W17" crumb="Quà tặng" sub={sub}
      actions={<>{can(role, 'redemptions.view') && <Button icon="download" onClick={() => downloadExport('redemptions')}>Xuất Excel</Button>}<Tabs variant="pill" value={view} onChange={setView} items={[{ key: 'kanban', label: 'Kanban' }, { key: 'table', label: 'Bảng' }]} /></>}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : !list.length ? (
        <Card><EmptyState icon="gift" title="Chưa có yêu cầu đổi quà" body="Yêu cầu từ app đại lý sẽ hiện ở cột Mới để Sale xác nhận." /></Card>
      ) : view === 'kanban' ? (
        <div className="w17-kb">
          {COLS.map((col) => {
            const items = list.filter((r) => col.stages.includes(r.stage));
            const mine = items.filter(mayAct).length;
            return (
              <section className="w17-col" key={col.key} aria-label={col.label}>
                <div className="w17-col__h">{col.label}<span>{mine ? <b className="w17-mine">{mine} chờ bạn</b> : null}{items.length}</span></div>
                <div className="w17-col__hint">{col.hint}</div>
                {items.length ? items.map(card) : <div className="w17-col__empty">Không có yêu cầu</div>}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="w17-table">
          <DataTable rows={list} rowKey="id" itemLabel="yêu cầu" onRowClick={(r) => setDetail(r.id)}
            columns={[
              { key: 'id', label: 'Mã', primary: true, render: (r) => <div><b>{r.id}</b><div className="demo-sub">{date(r.createdAt)}</div></div> },
              { key: 'agentName', label: 'Đại lý', render: (r) => <div>{r.agentName}<div className="demo-sub">{r.agentId}{r.saleName ? ' · ' + r.saleName : ''}</div></div> },
              { key: 'giftName', label: 'Quà', render: (r) => <span>{r.giftName}{r.qty > 1 ? ` ×${r.qty}` : ''}</span> },
              { key: 'points', label: 'Điểm', align: 'right', render: (r) => num(r.points) },
              { key: 'stage', label: 'Bước', render: (r) => <StatusBadge tone={STAGE_TONE[r.stage] ?? 'pending'}>{REDEMPTION_STAGE_LABEL[r.stage as RedemptionStage] ?? r.stage}</StatusBadge> },
              { key: 'x', label: '', render: (r) => <div className="demo-row w17-acts">{actions(r)}</div> },
            ]} />
        </div>
      )}

      {cur && (
        <QuickView title={`Yêu cầu ${cur.id} · ${cur.agentName}`} onClose={() => setDetail(null)}
          footer={<><Button onClick={() => setDetail(null)}>Đóng</Button>{actions(cur)}</>}>
          <div className="w17-detail">
            <div className="demo-row">{cur.tier && <TierBadge tier={cur.tier as Tier} />}<StatusBadge tone={STAGE_TONE[cur.stage] ?? 'pending'}>{REDEMPTION_STAGE_LABEL[cur.stage as RedemptionStage] ?? cur.stage}</StatusBadge></div>
            <div className="w17-rc__g"><span>{cur.giftName}{cur.qty > 1 ? ` ×${cur.qty}` : ''}</span><PointValue value={-cur.points} state={terminal(cur.stage) && cur.stage !== 'done' ? 'revoked' : 'available'} /></div>
            {cur.note && <div className="demo-note demo-note--warn">{cur.note}</div>}
            <ApprovalStepper orientation="vertical" steps={stepsOf(cur)} />
          </div>
        </QuickView>
      )}
      {printing && <PrintSlip r={printing} onClose={() => setPrint(null)} canSeeAgent={can(role, 'agents.view')} />}
      {rejecting && <RejectDialog r={rejecting} onClose={() => setRejecting(null)} />}
    </AdminShell>
  );
}

function stepsOf(r: Redemption): ApprovalStep[] {
  const byStage = new Map(r.history.map((h) => [h.stage, h]));
  const end = terminal(r.stage) && r.stage !== 'done' ? (r.stage as RedemptionStage) : null;
  const idx = FLOW.indexOf(r.stage as RedemptionStage);
  const reached = end ? FLOW.filter((s) => byStage.has(s)) : FLOW;
  const steps: ApprovalStep[] = reached.map((s, i) => {
    const h = byStage.get(s);
    return { label: REDEMPTION_STAGE_LABEL[s], actor: h?.by, time: h?.at, note: h?.note, status: end || i <= idx ? 'done' : i === idx + 1 ? 'current' : 'todo' };
  });
  if (end) { const h = byStage.get(end); steps.push({ label: REDEMPTION_STAGE_LABEL[end], actor: h?.by, time: h?.at, note: h?.note, status: 'rejected' }); }
  return steps;
}

function RejectDialog({ r, onClose }: { r: Redemption; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const rej = useAction(() => api.post<{ refunded: number }>(`/redemptions/${r.id}/reject`, { reason: reason.trim() }), {
    success: (res) => ({ tone: 'warning', title: `Đã từ chối ${r.id}`, body: `Đã hoàn ${num(res.refunded)} điểm cho ${r.agentName} và gửi ZNS.` }),
    onDone: onClose,
  });
  return (
    <QuickView title={`Từ chối yêu cầu ${r.id}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Đóng</Button><Button variant="danger" disabled={!reason.trim() || rej.isPending} onClick={() => rej.mutate()}>Từ chối & hoàn điểm</Button></>}>
      <div className="w17-detail">
        <div>{r.agentName} · {r.giftName} · hoàn <b>{num(r.points)} điểm</b></div>
        <Field label="Lý do" as="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Quà tạm hết hàng, đề nghị đại lý chọn quà khác" />
      </div>
    </QuickView>
  );
}

function PrintSlip({ r, onClose, canSeeAgent }: { r: Redemption; onClose: () => void; canSeeAgent: boolean }) {
  const a = useApi<AgentDetail>(canSeeAgent ? '/agents/' + r.agentId : null);
  const addr = a.data ? `${a.data.address}, ${a.data.city}` : canSeeAgent ? 'Đang tải…' : 'theo hồ sơ đại lý';
  return (
    <QuickView title="Phiếu xuất quà tặng" onClose={onClose}
      footer={<><Button onClick={onClose}>Đóng</Button><Button variant="primary" icon="printer" onClick={() => window.print()}>In</Button></>}>
      <div className="w17-print">
        <div className="demo-between"><b>CÔNG TY TNHH THƯƠNG MẠI DMP VIỆT PHÁP</b><span>Số: PXQ-{r.id}</span></div>
        <div className="w17-print__t">PHIẾU XUẤT QUÀ TẶNG</div>
        <div>Đại lý nhận: <b>{r.agentName}</b> ({r.agentId}) · Địa chỉ: {addr}</div>
        <table><thead><tr><th>STT</th><th>Tên quà</th><th>SL</th><th>Điểm đã đổi</th></tr></thead>
          <tbody><tr><td>1</td><td>{r.giftName}</td><td>{r.qty}</td><td>{num(r.points)}</td></tr></tbody></table>
        <div className="w17-sign"><b>Người lập phiếu</b><b>Thủ kho</b><b>Đại lý ký nhận</b><div /><div /><div /></div>
      </div>
    </QuickView>
  );
}
