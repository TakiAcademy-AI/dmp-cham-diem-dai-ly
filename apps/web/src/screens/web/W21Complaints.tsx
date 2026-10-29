import { useEffect, useRef, useState } from 'react';
import { can, ROLE_LABEL, type Role } from '@dmp/shared';
import { ApprovalStepper, Button, Card, DataTable, EmptyState, Field, FilterChip, Icon, KpiCard, PointValue, StatusBadge, TierBadge, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { fileUrl, api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime, num, signed } from '../../lib/fmt';
import type { LedgerRow } from '../../lib/types';
import './W21Complaints.css';

interface Hist { stage: string; by: string; at: string; note?: string }
interface Complaint {
  id: string; agentId: string; agentName: string; tier: string; ledgerId: number | null; ref: string; txLabel: string; claim: string; wantPoints: number; fileIds: string[];
  status: string; assignee: string | null; resolution: string | null; approvalId: string | null; dueAt: string; history: Hist[]; createdAt: string; overdue: boolean;
}

const TONE: Record<string, 'pending' | 'info' | 'success' | 'neutral' | 'warning'> = { 'Mới': 'pending', 'Đang xử lý': 'info', 'Chờ duyệt điều chỉnh': 'warning', 'Đã giải quyết': 'success', 'Từ chối': 'neutral' };
const OPEN = ['Mới', 'Đang xử lý'];
const STATE: Record<string, string> = { pending: 'Treo', available: 'Khả dụng', expired: 'Hết hạn', revoked: 'Thu hồi' };

/** "27/10/2026 15:20" hoặc "18:56:09 28/10/2026" → Date. */
function parseVN(s: string): Date | null {
  const d = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!d) return null;
  const t = s.match(/(\d{1,2}):(\d{2})/);
  return new Date(+d[3], +d[2] - 1, +d[1], t ? +t[1] : 0, t ? +t[2] : 0);
}
function sla(c: Complaint, now: number) {
  if (!OPEN.includes(c.status)) return { label: '—', tone: null as null | 'danger' | 'warning' };
  const ms = +new Date(c.dueAt) - now;
  const abs = Math.abs(ms), h = Math.floor(abs / 3600e3), dd = Math.floor(h / 24);
  const span = dd >= 1 ? `${dd} ngày${h % 24 ? ' ' + (h % 24) + ' giờ' : ''}` : h >= 1 ? `${h} giờ` : `${Math.max(1, Math.floor(abs / 60e3))} phút`;
  if (ms < 0) return { label: `Quá hạn ${span}`, tone: 'danger' as const };
  return { label: `Còn ${span}`, tone: ms < 24 * 3600e3 ? ('warning' as const) : null };
}

/** W21 Khiếu nại điểm — đại lý gửi trên app (M15), Kế toán xử lý trong 3 ngày; chấp nhận → yêu cầu điều chỉnh chờ BOD duyệt. */
export default function W21Complaints() {
  const { user } = useSession();
  const role = user!.role as Role;
  const canAct = can(role, 'complaints.resolve');
  const q = useApi<Complaint[]>('/complaints');
  const [selId, setSelId] = useState<string | null>(null);
  const [flt, setFlt] = useState<'all' | 'open' | 'over' | 'wait' | 'closed'>('all');
  const [reply, setReply] = useState('');
  const [pts, setPts] = useState('');
  const [now, setNow] = useState(Date.now());
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60e3); return () => clearInterval(t); }, []);

  const list = q.data ?? [];
  const cur = list.find((c) => c.id === selId) ?? list.find((c) => c.overdue) ?? list.find((c) => OPEN.includes(c.status)) ?? list[0] ?? null;
  const ledQ = useApi<LedgerRow[]>(cur && can(role, 'ledger.view') ? `/ledger?agentId=${cur.agentId}` : null);
  const linked = cur ? (ledQ.data ?? []).filter((l) => (cur.ledgerId ? l.id === cur.ledgerId : !!cur.ref && l.ref === cur.ref)) : [];

  const select = (c: Complaint) => {
    setSelId(c.id); setReply(''); setPts(String(c.wantPoints || ''));
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const curPts = pts === '' && cur && selId !== cur.id ? String(cur.wantPoints || '') : pts;

  const take = useAction((id: string) => api.post(`/complaints/${id}/take`), { success: (r) => `Đã nhận xử lý ${r.id}` });
  const resolve = useAction((v: { accept: boolean }) => api.post<{ id: string; status: string; approvalId?: string }>(`/complaints/${cur!.id}/resolve`, { accept: v.accept, points: v.accept ? Number(curPts) : undefined, note: reply.trim() }), {
    success: (r, v) => (v.accept
      ? { tone: 'success', title: `Đã tạo yêu cầu điều chỉnh ${signed(Number(curPts))} điểm`, body: `${r.approvalId} chờ BOD duyệt ở W13. Đại lý nhận thông báo khi có kết quả.` }
      : { tone: 'warning', title: 'Đã từ chối khiếu nại', body: 'Đại lý nhận lý do trên app.' }),
    onDone: () => setReply(''),
  });

  /* ---------- KPI ---------- */
  const open = list.filter((c) => OPEN.includes(c.status));
  const over = list.filter((c) => c.overdue);
  const closed = list.filter((c) => ['Đã giải quyết', 'Từ chối', 'Chờ duyệt điều chỉnh'].includes(c.status));
  const accepted = closed.filter((c) => c.status !== 'Từ chối').length;
  const durations = list.filter((c) => !OPEN.includes(c.status)).map((c) => {
    const decided = [...c.history].reverse().find((h) => h.stage !== 'Mới' && h.stage !== 'Đang xử lý');
    const at = decided ? parseVN(decided.at) : null;
    return at ? (+at - +new Date(c.createdAt)) / 86400e3 : null;
  }).filter((x): x is number => x != null && x >= 0);
  const avg = durations.length ? (durations.reduce((t, x) => t + x, 0) / durations.length).toFixed(1).replace('.', ',') + ' ngày' : '—';

  const rows = list.filter((c) => (flt === 'open' ? OPEN.includes(c.status) : flt === 'over' ? c.overdue : flt === 'wait' ? c.status === 'Chờ duyệt điều chỉnh' : flt === 'closed' ? ['Đã giải quyết', 'Từ chối'].includes(c.status) : true));
  const ptsNum = Number(curPts);
  const ptsOk = Number.isInteger(ptsNum) && ptsNum !== 0;

  const stepStatus = (h: Hist): 'done' | 'rejected' => (/Từ chối|không duyệt/i.test(h.stage) ? 'rejected' : 'done');

  return (
    <AdminShell screen="W21"
      sub={role === 'SALE' ? 'Sale xem khiếu nại của đại lý mình để hỗ trợ giải thích' : 'Đại lý gửi trên app (M15) → Kế toán xử lý trong 3 ngày → nếu cần điều chỉnh thì tạo yêu cầu, BOD duyệt'}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="demo-grid">
          <div className="demo-grid demo-grid--4">
            <KpiCard label="Đang mở" value={open.length} onClick={() => setFlt('open')} />
            <KpiCard label="Quá SLA 3 ngày" value={over.length} tone={over.length ? 'danger' : undefined} onClick={() => setFlt('over')} />
            <KpiCard label="Thời gian xử lý TB" value={avg} hint={durations.length ? `${durations.length} khiếu nại đã đóng` : undefined} />
            <KpiCard label="Tỷ lệ chấp nhận" value={closed.length ? Math.round((accepted / closed.length) * 100) + '%' : '—'} hint="Khiếu nại dẫn tới điều chỉnh" />
          </div>
          <div className="demo-row">
            <FilterChip selected={flt === 'all'} onClick={() => setFlt('all')}>Tất cả</FilterChip>
            <FilterChip selected={flt === 'open'} onClick={() => setFlt('open')} count={open.length}>Đang mở</FilterChip>
            <FilterChip selected={flt === 'over'} onClick={() => setFlt('over')} count={over.length}>Quá SLA</FilterChip>
            <FilterChip selected={flt === 'wait'} onClick={() => setFlt('wait')} count={list.filter((c) => c.status === 'Chờ duyệt điều chỉnh').length}>Chờ BOD duyệt</FilterChip>
            <FilterChip selected={flt === 'closed'} onClick={() => setFlt('closed')}>Đã đóng</FilterChip>
          </div>
          <DataTable rows={rows} rowKey="id" onRowClick={select} itemLabel="khiếu nại" rowTone={(c) => (c.overdue ? 'overdue' : null)}
            empty={<EmptyState icon="chat" title="Không có khiếu nại" body={flt === 'all' ? 'Khiếu nại đại lý gửi từ app (M15) sẽ hiện ở đây.' : 'Không có khiếu nại nào theo bộ lọc này.'} />}
            columns={[
              { key: 'id', label: 'Khiếu nại', primary: true, render: (c) => <div><b className={c.id === cur?.id ? 'w21-sel' : ''}>{c.id}</b><div className="demo-sub">{dateTime(c.createdAt)}</div></div> },
              { key: 'agent', label: 'Đại lý', render: (c) => <div>{c.agentName}<div className="demo-sub">{c.agentId}</div></div> },
              { key: 'tx', label: 'Giao dịch', render: (c) => <div className="w21-tx">{c.txLabel || c.ref || <span className="demo-muted">Không gắn giao dịch</span>}</div> },
              { key: 'want', label: 'Đề nghị', align: 'right', render: (c) => (c.wantPoints ? <PointValue value={c.wantPoints} signed /> : '—') },
              { key: 'sla', label: 'SLA', render: (c) => { const s = sla(c, now); return s.tone ? <StatusBadge tone={s.tone}>{s.label}</StatusBadge> : s.label; } },
              { key: 'status', label: 'Trạng thái', render: (c) => <StatusBadge tone={TONE[c.status] ?? 'neutral'}>{c.status}</StatusBadge> },
            ]} />

          <div ref={detailRef} className="w21-detail">
            {cur && (
              <Card title={`${cur.id} · ${cur.agentName}`} subtitle={cur.txLabel || cur.ref || 'Không gắn giao dịch'}
                actions={<span className="demo-row"><TierBadge tier={cur.tier as Tier} /><StatusBadge tone={TONE[cur.status] ?? 'neutral'}>{cur.status}</StatusBadge></span>}>
                <div className="demo-grid">
                  <div className="w21-meta">
                    <span><Icon name="clock" size={14} />Hạn xử lý {dateTime(cur.dueAt)}{(() => { const s = sla(cur, now); return s.label !== '—' ? <> · {s.tone ? <StatusBadge tone={s.tone}>{s.label}</StatusBadge> : s.label}</> : null; })()}</span>
                    {cur.assignee && <span><Icon name="user" size={14} />Người xử lý: {cur.assignee}</span>}
                    {cur.wantPoints ? <span>Đại lý đề nghị <PointValue value={cur.wantPoints} signed /></span> : null}
                  </div>

                  <div className="w21-thread">
                    <div className="w21-msg w21-msg--in">{cur.claim}
                      <span>{cur.agentName} · {dateTime(cur.createdAt)}{cur.fileIds.length ? ` · kèm ${cur.fileIds.length} ảnh` : ''}</span>
                      {cur.fileIds.length > 0 && <span className="w21-files">{cur.fileIds.map((f, i) => <a key={f} className="demo-link" href={fileUrl(f)} target="_blank" rel="noreferrer"><Icon name="image" size={14} />Ảnh {i + 1}</a>)}</span>}
                    </div>
                    {cur.resolution && <div className="w21-msg w21-msg--out">{cur.resolution}<span>{cur.assignee ?? 'Kế toán'}{cur.approvalId ? ` · ${cur.approvalId}` : ''}</span></div>}
                  </div>

                  <div>
                    <div className="dmp-field__label w21-lbl">Giao dịch liên quan trong sổ cái</div>
                    {!can(role, 'ledger.view') ? <div className="demo-sub">Vai trò {ROLE_LABEL[role]} không xem sổ cái điểm. Mã tham chiếu: {cur.ref || '—'}.</div>
                      : ledQ.isLoading ? <Loading /> : ledQ.error ? <ErrorNote error={ledQ.error} />
                        : linked.length ? (
                          <div className="w21-ledger">
                            <table className="dmp-table">
                              <thead><tr><th>GD</th><th>Thời gian</th><th>Nội dung</th><th className="is-num">Điểm hạng</th><th className="is-num">Điểm thưởng</th><th>Trạng thái</th></tr></thead>
                              <tbody>{linked.map((l) => (
                                <tr key={l.id}><td>GD{l.id}</td><td>{dateTime(l.createdAt)}</td><td className="w21-item">{l.item}<div className="demo-sub">{l.rule} · {l.byUser}</div></td>
                                  <td className="is-num">{signed(l.deltaRank)}</td><td className="is-num">{signed(l.deltaReward)}</td><td>{STATE[l.state] ?? l.state}</td></tr>
                              ))}</tbody>
                            </table>
                          </div>
                        ) : <div className="demo-sub">Không tìm thấy bút toán khớp mã {cur.ref || '—'} trong sổ cái của đại lý.</div>}
                  </div>

                  <div>
                    <div className="dmp-field__label w21-lbl">Lịch sử xử lý</div>
                    <ApprovalStepper orientation="vertical" steps={[
                      ...cur.history.map((h) => ({ label: h.stage, actor: h.by, time: h.at, note: h.note, status: stepStatus(h) })),
                      ...(OPEN.includes(cur.status) ? [{ label: 'Kế toán phản hồi', note: 'SLA 3 ngày kể từ khi đại lý gửi', status: 'current' as const }]
                        : cur.status === 'Chờ duyệt điều chỉnh' ? [{ label: 'BOD duyệt điều chỉnh', actor: cur.approvalId ?? undefined, status: 'current' as const }] : []),
                    ]} />
                  </div>

                  {canAct && OPEN.includes(cur.status) && (
                    <div className="demo-grid w21-act">
                      {cur.status === 'Mới' && <div className="demo-between"><span className="demo-muted">Chưa có người nhận xử lý.</span><Button icon="user" disabled={take.isPending} onClick={() => take.mutate(cur.id)}>Nhận xử lý</Button></div>}
                      <Field as="textarea" label="Trả lời đại lý" required value={reply} onChange={(e) => setReply(e.target.value)}
                        placeholder="Ví dụ: Đã kiểm tra, đơn DH1086 đồng bộ trước khi campaign CP01 được gắn cho SKU NOR-007. Sẽ điều chỉnh +323 điểm." hint="Bắt buộc — đại lý đọc nội dung này trên app" />
                      <Field label="Số điểm điều chỉnh (khi chấp nhận)" value={curPts} onChange={(e) => setPts(e.target.value.replace(/[^\d-]/g, ''))} inputMode="numeric" suffix="điểm"
                        hint="Số âm để trừ điểm. Ghi bút toán điều chỉnh vào kỳ đang mở sau khi BOD duyệt — không sửa dòng cũ." error={curPts && !ptsOk ? 'Số nguyên khác 0' : undefined} />
                      <div className="demo-row w21-btns">
                        <Button variant="primary" icon="edit" disabled={!reply.trim() || !ptsOk || resolve.isPending} onClick={() => resolve.mutate({ accept: true })}>Tạo yêu cầu điều chỉnh{ptsOk ? ` ${signed(ptsNum)}` : ''}</Button>
                        <Button variant="danger" disabled={!reply.trim() || resolve.isPending} onClick={() => resolve.mutate({ accept: false })}>Từ chối kèm lý do</Button>
                      </div>
                    </div>
                  )}
                  {canAct && cur.status === 'Chờ duyệt điều chỉnh' && <div className="demo-note demo-note--muted"><Icon name="clock" size={16} />Đã tạo yêu cầu {cur.approvalId} — chờ BOD duyệt ở W13. Duyệt xong khiếu nại tự chuyển "Đã giải quyết" và đại lý nhận thông báo.</div>}
                  {!canAct && <div className="demo-sub">Kế toán xử lý khiếu nại; vai trò {ROLE_LABEL[role]} chỉ xem.</div>}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
