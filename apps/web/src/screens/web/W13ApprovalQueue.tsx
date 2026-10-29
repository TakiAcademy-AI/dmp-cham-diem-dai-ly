import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { APPROVAL_KIND_LABEL, APPROVER, can, canApprove, FUND_LABEL, ROLE_LABEL, type ApprovalKind, type Fund, type Role } from '@dmp/shared';
import { ApprovalStepper, Button, Card, DataTable, EmptyState, Field, Icon, PointValue, QuickView, StatusBadge, Tabs, TierBadge, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { InfoGrid } from '../../shell/charts';
import { api, fileUrl } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, dateTime, mil, num, tierName, vnd } from '../../lib/fmt';
import type { Approval, Gift } from '../../lib/types';
import './W13ApprovalQueue.css';

const KINDS = Object.keys(APPROVAL_KIND_LABEL) as ApprovalKind[];
const POINT_KINDS: ApprovalKind[] = ['manual', 'bulk', 'adjust', 'evidence'];
/** Tab luôn hiện (kể cả khi trống); loại khác chỉ hiện khi có yêu cầu chờ. */
const ALWAYS: ApprovalKind[] = ['manual', 'bulk', 'adjust', 'campaign', 'gift', 'product'];
const EFFECT: Record<ApprovalKind, string> = {
  manual: 'Ghi sổ cái điểm cho đại lý và gửi ZNS báo cộng điểm.',
  bulk: 'Ghi sổ cái cho từng đại lý trong lô và gửi ZNS.',
  adjust: 'Ghi bút toán điều chỉnh vào kỳ đang mở (không sửa dòng cũ) và gửi ZNS.',
  evidence: 'Ghi sổ cái điểm hoạt động cho đại lý.',
  tier: 'Đổi hạng đại lý, bảo vệ hạng theo số tháng đề xuất, gửi ZNS.',
  credit: 'Gắn cờ ngoại lệ công nợ để đơn được duyệt dù đang nợ quá hạn.',
  rules: 'Phiên bản quy tắc điểm/bảng hạng mới thành Hiệu lực ngay, bản cũ hết hiệu lực. Không hồi tố.',
  reopen: 'Mở lại kỳ đã khoá sổ để ghi bổ sung.',
  campaign: 'Campaign được duyệt và tự chạy trong khoảng ngày đã đặt; điểm campaign tính vào đơn mới.',
  gift: 'Quà giá trị lớn được mở đổi (hoặc áp dụng điểm/giá trị mới).',
  product: 'Áp dụng "không tính điểm" / hệ số điểm mới cho SKU từ đơn tiếp theo (không hồi tố).',
};

function waited(iso: string) {
  const h = Math.max(0, (Date.now() - +new Date(iso)) / 3600e3);
  return h < 1 ? 'dưới 1 giờ' : h < 24 ? Math.floor(h) + ' giờ' : Math.floor(h / 24) + ' ngày';
}
const overdue = (a: Approval) => !!a.dueAt && +new Date(a.dueAt) < Date.now();

/** W13 Hàng chờ duyệt — maker-checker: người tạo không tự duyệt, từ chối bắt buộc ghi lý do, duyệt hàng loạt. */
export default function W13ApprovalQueue() {
  const { user } = useSession();
  const role = user!.role as Role;
  const nav = useNavigate();
  const q = useApi<Approval[]>('/approvals');
  const [tab, setTab] = useState<ApprovalKind | null>(null);
  const [rejecting, setRejecting] = useState<Approval[] | null>(null);
  const [reason, setReason] = useState('');
  const [view, setView] = useState<Approval | null>(null);
  const [tableKey, setTableKey] = useState(0);

  const all = q.data ?? [];
  const queue = all.filter((a) => a.status === 'pending');
  const done = all.filter((a) => a.status !== 'pending' && a.decidedAt).sort((a, b) => +new Date(b.decidedAt!) - +new Date(a.decidedAt!)).slice(0, 8);
  const isSelf = (a: Approval) => a.payload?.requesterId === user!.id;
  const mayDecide = (a: Approval) => canApprove(role, a.kind as ApprovalKind) && !isSelf(a);

  const count = (k: ApprovalKind) => queue.filter((x) => x.kind === k).length;
  const visible = KINDS.filter((k) => count(k) > 0 || ALWAYS.includes(k));
  const cur: ApprovalKind = tab ?? visible.find((k) => count(k) > 0 && canApprove(role, k)) ?? visible.find((k) => count(k) > 0) ?? 'manual';
  const rows = queue.filter((x) => x.kind === cur);
  const approver = canApprove(role, cur);

  const decide = useAction(async (v: { list: Approval[]; ok: boolean; note: string }) => {
    const res = { ok: 0, fail: [] as string[] };
    for (const a of v.list.filter(mayDecide)) {
      try { await api.post(`/approvals/${a.id}/${v.ok ? 'approve' : 'reject'}`, { note: v.note }); res.ok++; } catch (e) { res.fail.push(`${a.id}: ${(e as Error).message}`); }
    }
    return res;
  }, {
    success: (r, v) => ({
      tone: r.fail.length ? 'warning' : v.ok ? 'success' : 'warning',
      title: (v.ok ? 'Đã duyệt ' : 'Đã từ chối ') + r.ok + ' yêu cầu' + (r.fail.length ? ` · ${r.fail.length} lỗi` : ''),
      body: r.fail.length ? r.fail.join(' · ') : v.ok ? 'Đã thực thi theo loại yêu cầu (ghi sổ cái, gửi ZNS…).' : 'Người đề xuất nhận thông báo kèm lý do.',
    }),
    onDone: () => { setRejecting(null); setReason(''); setView(null); setTableKey((k) => k + 1); },
  });

  const who = (a: Approval) => (
    <div className="w13-who">{a.requestedBy}{isSelf(a) && <span className="w13-self">Anh/chị là người đề xuất — không thể tự duyệt</span>}</div>
  );
  const agentCell = (a: Approval) => (a.kind === 'bulk'
    ? <div><div className="demo-strong">{num(a.payload?.count ?? a.payload?.agentIds?.length ?? 0)} đại lý</div><div className="demo-sub">Lô · {a.id}</div></div>
    : a.agentId ? <div><div className="demo-strong">{a.agentName}</div><div className="demo-sub">{a.agentId} · {a.id}</div></div>
      : <div><div className="demo-strong">Toàn hệ thống</div><div className="demo-sub">{a.id}</div></div>);

  const columns = [
    { key: 'agentName', label: 'Đại lý', primary: true, render: agentCell },
    { key: 'title', label: 'Hạng mục', render: (a: Approval) => <div className="w13-wrap"><div>{a.title}</div>{(a.payload?.batch || a.payload?.rule) && <div className="demo-sub">{[a.payload?.rule, a.payload?.batch].filter(Boolean).join(' · ')}</div>}</div> },
    { key: 'points', label: 'Điểm', align: 'right' as const, render: (a: Approval) => (a.points == null ? '—' : <PointValue value={a.points} signed />) },
    { key: 'by', label: 'Người đề xuất', render: who },
    { key: 'reason', label: 'Lý do', render: (a: Approval) => <div className="w13-reason">{a.reason}</div> },
    { key: 'files', label: 'Đính kèm', render: (a: Approval) => (a.files ? <span className="w13-att"><Icon name="image" size={14} />{a.files} tệp</span> : <span className="demo-muted">—</span>) },
    { key: 'waited', label: 'Đã chờ', render: (a: Approval) => (overdue(a) ? <StatusBadge tone="danger">{waited(a.requestedAt)} · quá SLA</StatusBadge> : waited(a.requestedAt)) },
    ...(approver ? [{
      key: 'act', label: '', render: (a: Approval) => (isSelf(a) ? null : (
        <span className="demo-row w13-act">
          <Button variant="primary" disabled={decide.isPending} onClick={(e) => { e.stopPropagation(); decide.mutate({ list: [a], ok: true, note: '' }); }}>Duyệt</Button>
          <Button variant="danger" disabled={decide.isPending} onClick={(e) => { e.stopPropagation(); setReason(''); setRejecting([a]); }}>Từ chối</Button>
        </span>
      )),
    }] : []),
  ];

  return (
    <AdminShell screen="W13" sub="Người tạo yêu cầu không được tự duyệt. Từ chối bắt buộc ghi lý do.">
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="demo-grid">
          <div className="demo-grid">
            <div className="w13-tabs">
              <Tabs value={cur} onChange={(k) => setTab(k as ApprovalKind)}
                items={visible.map((k) => ({ key: k, label: APPROVAL_KIND_LABEL[k], count: count(k), alert: count(k) > 0 && canApprove(role, k), tag: k === 'evidence' ? 'GĐ2' : undefined }))} />
            </div>
            {!approver && <div className="demo-note demo-note--muted"><Icon name="info" size={16} />{APPROVAL_KIND_LABEL[cur]}: người duyệt là {APPROVER[cur].map((r) => ROLE_LABEL[r]).join(', ')}. Vai trò {ROLE_LABEL[role]} chỉ xem.</div>}
            <div className="w13-table">
              <DataTable key={cur + role + tableKey} rows={rows} rowKey="id" selectable={approver} itemLabel="yêu cầu" columns={columns} onRowClick={(a) => setView(a)}
                rowTone={(a) => (overdue(a) ? 'overdue' : null)}
                bulkActions={(sel) => [
                  <Button key="a" variant="primary" icon="check" disabled={decide.isPending} onClick={() => decide.mutate({ list: sel, ok: true, note: '' })}>Duyệt {sel.filter(mayDecide).length}</Button>,
                  <Button key="r" variant="danger" icon="x" onClick={() => { setReason(''); setRejecting(sel.filter(mayDecide)); }}>Từ chối</Button>,
                ]}
                empty={<EmptyState icon="check" title="Không còn yêu cầu chờ duyệt" body="Yêu cầu mới sẽ hiện ở đây và trên số đỏ của menu Điểm thưởng." />} />
            </div>
          </div>
          <Card title="Vừa xử lý">
            {done.length ? (
              <ul className="w13-done">{done.map((a) => (
                <li key={a.id}>
                  <button type="button" className="w13-donebtn" onClick={() => setView(a)}>
                    <span><b>{a.id}</b> · {APPROVAL_KIND_LABEL[a.kind as ApprovalKind]}</span>
                    <span className="demo-sub">{a.agentName ?? a.title} · {a.decidedBy} · {dateTime(a.decidedAt)}{a.decisionNote ? ' · ' + a.decisionNote : ''}</span>
                  </button>
                  <StatusBadge tone={a.status === 'approved' ? 'success' : 'danger'}>{a.status === 'approved' ? 'Đã duyệt' : 'Từ chối'}</StatusBadge>
                </li>
              ))}</ul>
            ) : <div className="demo-muted">Chưa có. Tick nhiều dòng rồi bấm "Duyệt" trên thanh xanh để duyệt hàng loạt.</div>}
            <div className="demo-sub" style={{ marginTop: 12 }}>SLA: mọi yêu cầu có hạn duyệt 48 giờ kể từ lúc gửi; quá hạn hiện nhãn đỏ "quá SLA".</div>
          </Card>
        </div>
      )}

      {view && !rejecting && (
        <QuickView title={`${view.id} · ${APPROVAL_KIND_LABEL[view.kind as ApprovalKind]}`} onClose={() => setView(null)}
          footer={<>
            <Button onClick={() => setView(null)}>Đóng</Button>
            {view.kind === 'rules' && <Button icon="sliders" onClick={() => nav('/points/rules')}>Xem bản nháp ở W11</Button>}
            {view.status === 'pending' && mayDecide(view) && <>
              <Button variant="danger" onClick={() => { setReason(''); setRejecting([view]); }}>Từ chối</Button>
              <Button variant="primary" icon="check" disabled={decide.isPending} onClick={() => decide.mutate({ list: [view], ok: true, note: '' })}>Duyệt</Button>
            </>}
          </>}>
          <div className="demo-grid">
            <div className="w13-vhead">
              {view.agentTier && <TierBadge tier={view.agentTier as Tier} />}
              <b>{view.title}</b>
              {view.points != null && <PointValue value={view.points} signed size="lg" />}
            </div>
            <InfoGrid cols={2} items={[
              ['Đại lý', view.kind === 'bulk' ? `${num(view.payload?.count ?? 0)} đại lý` : view.agentId ? <button type="button" className="demo-link" onClick={() => nav('/agents/' + view.agentId)}>{view.agentName} · {view.agentId}</button> : '—'],
              ['Người đề xuất', `${view.requestedBy}`],
              ['Gửi lúc', dateTime(view.requestedAt)],
              ['Hạn duyệt', <>{dateTime(view.dueAt)}{view.status === 'pending' && overdue(view) && <> <StatusBadge tone="danger">quá SLA</StatusBadge></>}</>],
              POINT_KINDS.includes(view.kind as ApprovalKind) && ['Quỹ điểm', FUND_LABEL[(view.payload?.fund as Fund) ?? 'reward']],
              view.payload?.rule && ['Hạng mục quy tắc', view.payload.rule],
              view.kind === 'bulk' && view.points != null && ['Tổng điểm lô', `${num(view.points * (view.payload?.count ?? 0))} điểm`],
              view.payload?.amount && ['Giá trị đơn', mil(view.payload.amount)],
              view.payload?.version && ['Phiên bản', 'v' + view.payload.version],
              view.payload?.period && ['Kỳ', view.payload.period],
              ['Đính kèm', view.files ? `${view.files} tệp` : 'Không có'],
            ]} />
            <div><div className="dmp-field__label">Lý do</div><div>{view.reason}</div></div>
            <KindDetail ap={view} role={role} onNav={(to) => { setView(null); nav(to); }} />
            {view.kind === 'bulk' && Array.isArray(view.payload?.agentIds) && <div className="demo-sub">Mã đại lý: {view.payload.agentIds.join(', ')}</div>}
            <ApprovalStepper orientation="vertical" steps={[
              { label: 'Đề xuất', actor: view.requestedBy, time: dateTime(view.requestedAt), status: 'done' },
              view.status === 'pending'
                ? { label: `${APPROVER[view.kind as ApprovalKind].map((r) => ROLE_LABEL[r]).join(', ')} duyệt`, status: 'current', note: isSelf(view) ? 'Anh/chị là người đề xuất — không thể tự duyệt' : undefined }
                : { label: view.status === 'approved' ? 'Đã duyệt' : 'Từ chối', actor: view.decidedBy ?? undefined, time: dateTime(view.decidedAt), note: view.decisionNote ?? undefined, status: view.status === 'approved' ? 'done' : 'rejected' },
              { label: 'Thực thi', note: EFFECT[view.kind as ApprovalKind], status: view.status === 'approved' ? 'done' : 'todo' },
            ]} />
          </div>
        </QuickView>
      )}

      {rejecting && (
        <QuickView title={`Từ chối ${rejecting.length} yêu cầu`} onClose={() => setRejecting(null)}
          footer={<><Button onClick={() => setRejecting(null)}>Huỷ</Button>
            <Button variant="danger" disabled={!reason.trim() || !rejecting.length || decide.isPending} onClick={() => decide.mutate({ list: rejecting, ok: false, note: reason })}>Xác nhận từ chối</Button></>}>
          <div className="demo-grid">
            <div className="demo-muted">{rejecting.map((x) => `${x.id} · ${x.agentName ?? x.title}`).join(', ') || 'Không có yêu cầu nào anh/chị được phép từ chối.'}</div>
            <Field as="textarea" label="Lý do từ chối" required value={reason} onChange={(e) => setReason(e.target.value)} error={reason.trim() ? undefined : 'Bắt buộc ghi lý do'}
              placeholder="Ví dụ: Ảnh trưng bày chưa thấy rõ sản phẩm NOREVA" />
          </div>
        </QuickView>
      )}
    </AdminShell>
  );
}

/* ---------- Chi tiết theo loại yêu cầu ---------- */
interface CampaignRow { id: string; name: string; kind: 'multiplier' | 'bonus'; value: number; scope: { brands?: string[]; lines?: string[]; skus?: string[]; types?: string[]; minTier?: string; minOrderVND?: number }; fromDate: string; toDate: string; budget: number; used: number; status: string; note: string }
interface EvidenceRow { id: string; agentId: string; category: string; categoryName: string; points: number; link: string; fileIds: string[]; note: string; stage: string; createdAt: string }

const GIFT_FIELD: Record<string, [string, (v: any) => string]> = {
  name: ['Tên quà', String], type: ['Loại', String], points: ['Điểm đổi', (v) => num(Number(v)) + ' điểm'], value: ['Giá trị', (v) => vnd(Number(v))],
  minTier: ['Hạng tối thiểu', (v) => (v ? tierName(v) : 'Mọi hạng')], stock: ['Tồn kho', (v) => (v == null || v === '' ? 'Không giới hạn' : num(Number(v)))],
  window: ['Thời gian mở đổi', (v) => v || '—'], status: ['Trạng thái', String], tag: ['Nhãn', (v) => v || '—'], imageFileId: ['Ảnh quà', (v) => (v ? 'Ảnh mới' : '—')],
};
const PRODUCT_FIELD: Record<string, [string, (v: any) => string]> = {
  noPoint: ['Tính điểm', (v) => (v ? 'Không tính điểm' : 'Có tính điểm')],
  multiplier: ['Hệ số điểm', (v) => '×' + String(v ?? 1).replace('.', ',')],
  multiplierUntil: ['Hệ số áp dụng tới', (v) => (v ? date(v) : 'Không thời hạn')],
};

/** Bảng "trước → sau" cho các thay đổi cấu hình. */
function Diff({ rows }: { rows: Array<[string, string | null, string]> }) {
  return (
    <table className="w13-diff">
      <thead><tr><th>Trường</th><th>Hiện tại</th><th>Đề xuất</th></tr></thead>
      <tbody>{rows.map(([l, b, a]) => (
        <tr key={l}><td>{l}</td><td className={b != null && b !== a ? 'is-old' : ''}>{b ?? '—'}</td><td className={b !== a ? 'is-new' : ''}>{a}</td></tr>
      ))}</tbody>
    </table>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="w13-sec"><div className="dmp-field__label">{title}</div>{children}</div>;
}

function KindDetail({ ap, role, onNav }: { ap: Approval; role: Role; onNav: (to: string) => void }) {
  const p = ap.payload ?? {};
  const camps = useApi<CampaignRow[]>(ap.kind === 'campaign' && p.campaignId && can(role, 'campaigns.view') ? '/campaigns' : null);
  const gifts = useApi<Gift[]>(ap.kind === 'gift' && p.giftId && can(role, 'gifts.view') ? '/gifts' : null);
  const evid = useApi<EvidenceRow[]>(ap.kind === 'evidence' && p.evidenceId && can(role, 'approvals.view') ? '/evidence' : null);

  if (ap.kind === 'campaign' && p.campaignId) {
    if (!can(role, 'campaigns.view')) return <Section title={`Campaign ${p.campaignId}`}><div className="demo-muted">Vai trò này không xem được chi tiết campaign.</div></Section>;
    if (camps.isLoading) return <Loading label="Đang tải campaign…" />;
    if (camps.error) return <ErrorNote error={camps.error} />;
    const c = camps.data?.find((x) => x.id === p.campaignId);
    if (!c) return <Section title={`Campaign ${p.campaignId}`}><div className="demo-muted">Không tìm thấy campaign (có thể đã bị xoá).</div></Section>;
    const sc = c.scope ?? {};
    const scope = [
      sc.brands?.length ? 'Nhãn: ' + sc.brands.join(', ') : '', sc.lines?.length ? 'Dòng: ' + sc.lines.join(', ') : '', sc.skus?.length ? 'SKU: ' + sc.skus.join(', ') : '',
      sc.types?.length ? 'Loại hình: ' + sc.types.join(', ') : '', sc.minTier ? 'Từ hạng ' + tierName(sc.minTier) : '', sc.minOrderVND ? 'Đơn từ ' + mil(sc.minOrderVND) : '',
    ].filter(Boolean);
    return (
      <Section title={`Campaign ${c.id}`}>
        <InfoGrid cols={2} items={[
          ['Tên', c.name],
          ['Ưu đãi', c.kind === 'multiplier' ? `Nhân ×${String(c.value).replace('.', ',')} điểm` : `Thưởng +${num(c.value)} điểm / đơn`],
          ['Phạm vi', scope.length ? scope.join(' · ') : 'Toàn bộ sản phẩm, mọi đại lý'],
          ['Thời gian', `${date(c.fromDate)} – ${date(c.toDate)}`],
          ['Ngân sách', c.budget ? `${num(c.budget)} điểm ≈ ${mil(c.budget * 1000)}` : 'Không giới hạn'],
          ['Trạng thái hiện tại', c.status],
          !!c.note && ['Ghi chú', c.note],
        ]} />
        <button type="button" className="demo-link w13-mt" onClick={() => onNav('/campaigns')}>Mở màn Campaign điểm</button>
      </Section>
    );
  }

  if (ap.kind === 'gift' && p.giftId) {
    const g = gifts.data?.find((x) => x.id === p.giftId) as (Gift & Record<string, unknown>) | undefined;
    const ch: Record<string, unknown> = p.changes ?? {};
    const isNew = /^Thêm quà/.test(ap.title);
    const keys = Object.keys(ch).filter((k) => GIFT_FIELD[k]);
    const rows: Array<[string, string | null, string]> = keys.map((k) => {
      const [label, f] = GIFT_FIELD[k];
      // Khi đã duyệt, quà đã mang giá trị mới → không còn "hiện tại" để so.
      const before = ap.status !== 'pending' ? null : k === 'status' ? (p.prevStatus != null ? String(p.prevStatus) : null) : g && !isNew ? f(g[k]) : null;
      return [label, before, f(ch[k])];
    });
    return (
      <Section title={`Quà ${p.giftId}${g ? ' · ' + g.name : ''}`}>
        {gifts.isLoading ? <Loading label="Đang tải quà…" /> : (<>
          {rows.length ? <Diff rows={rows} /> : <div className="demo-muted">Không có trường thay đổi.</div>}
          {isNew && <div className="demo-sub w13-mt">Quà mới — đang ẩn với đại lý cho tới khi BOD duyệt.</div>}
        </>)}
        {can(role, 'gifts.view') && <button type="button" className="demo-link w13-mt" onClick={() => onNav('/gifts')}>Mở Danh mục quà</button>}
      </Section>
    );
  }

  if (ap.kind === 'product' && p.sku) {
    const ch: Record<string, unknown> = p.changes ?? {};
    const before: Record<string, unknown> = p.before ?? {};
    const rows: Array<[string, string | null, string]> = Object.keys(PRODUCT_FIELD).filter((k) => k in ch).map((k) => {
      const [label, f] = PRODUCT_FIELD[k];
      return [label, k in before ? f(before[k]) : null, f(ch[k])];
    });
    return (
      <Section title={`SKU ${p.sku}`}>
        {rows.length ? <Diff rows={rows} /> : <div className="demo-muted">Không có trường thay đổi.</div>}
        <div className="demo-sub w13-mt">Áp dụng từ đơn tiếp theo sau khi duyệt, không tính lại đơn cũ.</div>
        <button type="button" className="demo-link w13-mt" onClick={() => onNav('/products')}>Mở Sản phẩm & bảng giá</button>
      </Section>
    );
  }

  if (ap.kind === 'evidence' && p.evidenceId) {
    const e = evid.data?.find((x) => x.id === p.evidenceId);
    return (
      <Section title={`Bằng chứng ${p.evidenceId}`}>
        {evid.isLoading ? <Loading label="Đang tải bằng chứng…" /> : evid.error ? <ErrorNote error={evid.error} /> : !e ? <div className="demo-muted">Không tìm thấy bằng chứng.</div> : (<>
          <InfoGrid cols={2} items={[
            ['Hạng mục', e.categoryName], ['Nộp lúc', dateTime(e.createdAt)], ['Bước', e.stage],
            !!e.link && ['Liên kết', <a key="l" className="demo-link w13-break" href={e.link} target="_blank" rel="noreferrer">{e.link}</a>],
            !!e.note && ['Ghi chú của đại lý', e.note],
          ]} />
          {e.fileIds.length > 0 && <div className="w13-photos">{e.fileIds.map((f) => (
            <a key={f} href={fileUrl(f)} target="_blank" rel="noreferrer" className="w13-photo" title="Mở ảnh/tệp"><EvThumb id={f} /></a>
          ))}</div>}
        </>)}
      </Section>
    );
  }

  if (ap.kind === 'adjust' && p.complaintId) {
    return (
      <Section title="Nguồn yêu cầu">
        <div>Điều chỉnh theo khiếu nại <button type="button" className="demo-link" onClick={() => onNav('/complaints')}>{p.complaintId}</button>. Khi duyệt/từ chối, khiếu nại được cập nhật kết quả và đại lý nhận thông báo.</div>
      </Section>
    );
  }
  return null;
}

function EvThumb({ id }: { id: string }) {
  const [bad, setBad] = useState(false);
  return bad ? <Icon name="file" size={24} /> : <img src={fileUrl(id)} alt="" onError={() => setBad(true)} />;
}
