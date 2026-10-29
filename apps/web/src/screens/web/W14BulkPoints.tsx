import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { can, DEFAULT_PARAMS, FUND_LABEL, type RuleDef } from '@dmp/shared';
import { ApprovalStepper, Button, Card, DataTable, Field, Icon, KpiCard, StatusBadge, Tabs, TierBadge, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime, mil, num } from '../../lib/fmt';
import type { Agent, Approval, RuleSet } from '../../lib/types';
import './W14BulkPoints.css';

interface RulesResp { active: RuleSet | null; draft: RuleSet | null; history: RuleSet[] }
const STEPS = ['Chọn hạng mục', 'Chọn đại lý', 'Bằng chứng', 'Xem trước & gửi'];

/** W14 Cộng điểm hàng loạt — wizard 4 bước; số điểm/trần lấy từ quy tắc hiện hành; lô luôn chờ BOD duyệt (W13). */
export default function W14BulkPoints() {
  const { user } = useSession();
  const role = user!.role;
  const nav = useNavigate();
  const canPropose = can(role, 'points.manualPropose');
  const rulesQ = useApi<RulesResp>(can(role, 'rules.view') ? '/rules' : null, { retry: false });
  const agentsQ = useApi<Agent[]>('/agents');
  const pendQ = useApi<Approval[]>(can(role, 'approvals.view') ? '/approvals?status=pending' : null);

  const [step, setStep] = useState(0);
  const [cat, setCat] = useState<string | null>(null);
  const [method, setMethod] = useState('tick');
  const [sel, setSel] = useState<string[]>([]);
  const [tableKey, setTableKey] = useState(0);
  const [paste, setPaste] = useState('');
  const [invalid, setInvalid] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState<Approval | null>(null);

  const params = rulesQ.data?.active?.params ?? DEFAULT_PARAMS;
  const version = rulesQ.data?.active?.version;
  const cats = params.rules.filter((r) => (r.points ?? 0) > 0 && r.group !== 'Đơn hàng' && r.group !== 'Trừ điểm' && r.status !== 'Tắt');
  const cur: RuleDef | undefined = cats.find((r) => r.id === cat) ?? cats.find((r) => r.status === 'Hiệu lực');
  const agents = agentsQ.data ?? [];

  /** Đại lý đã có yêu cầu cùng hạng mục đang chờ duyệt → loại để tránh cộng trùng. */
  const dup = useMemo(() => {
    const s = new Set<string>();
    for (const a of pendQ.data ?? []) {
      if (!cur || a.payload?.rule !== cur.id) continue;
      (a.payload?.agentIds ?? (a.agentId ? [a.agentId] : [])).forEach((id: string) => s.add(id));
    }
    return s;
  }, [pendQ.data, cur]);
  const over = sel.filter((id) => dup.has(id));
  const okIds = sel.filter((id) => !dup.has(id));
  const pts = cur?.points ?? 0;

  const send = useAction(() => api.post<Approval>('/points/manual', {
    agentIds: okIds, points: pts, title: cur!.name, reason: reason.trim(), rule: cur!.id, fund: cur!.fund, files: files.length,
  }), {
    success: (r) => ({ tone: 'success', title: `Đã gửi BOD duyệt ${okIds.length > 1 ? 'lô ' + okIds.length + ' đại lý' : 'yêu cầu'}`, body: `${r.id} đã vào W13 Hàng chờ duyệt · hạn duyệt 48 giờ.` }),
    onDone: (r) => setSent(r),
  });

  const applyPaste = () => {
    const codes = [...new Set((paste.toUpperCase().match(/[A-Z]{2}\d{3,}/g) ?? []))];
    const known = new Set(agents.map((a) => a.id));
    setSel(codes.filter((c) => known.has(c)));
    setInvalid(codes.filter((c) => !known.has(c)));
    setTableKey((k) => k + 1);
  };
  const reset = () => { setSent(null); setStep(0); setSel([]); setFiles([]); setReason(''); setPaste(''); setInvalid([]); setTableKey((k) => k + 1); };
  const canNext = canPropose && (step === 0 ? !!cur : step === 1 ? okIds.length > 0 : step === 2 ? files.length > 0 && !!reason.trim() : false);

  const stepper = STEPS.map((l, i) => ({ label: l, status: (sent ? 'done' : i < step ? 'done' : i === step ? 'current' : 'todo') as 'done' | 'current' | 'todo' }));

  let body = null;
  if (step === 0) body = (
    <>
      {(rulesQ.error || !can(role, 'rules.view')) && <div className="demo-note demo-note--muted" style={{ marginBottom: 12 }}><Icon name="info" size={16} />Vai trò này không đọc được bộ quy tắc hiện hành — đang hiển thị bộ tham số mặc định; số điểm thực tế do BOD đối chiếu khi duyệt.</div>}
      <div className="w14-cats">
        {cats.map((x) => {
          const off = x.status !== 'Hiệu lực';
          return (
            <button type="button" key={x.id} disabled={off} className={'w14-cat' + (cur?.id === x.id ? ' is-on' : '')} aria-pressed={cur?.id === x.id} onClick={() => setCat(x.id)}>
              <b>{x.name}</b>
              <strong>+{num(x.points ?? 0)} điểm</strong>
              <span>Trần: {x.cap}</span>
              <span>{x.approval} · {FUND_LABEL[x.fund]}</span>
              {(off || x.phase) && <span className="demo-row">{off && <StatusBadge tone="pending">{x.status}</StatusBadge>}{x.phase && <StatusBadge tone="neutral">{x.phase}</StatusBadge>}</span>}
            </button>
          );
        })}
      </div>
      <div className="demo-sub" style={{ marginTop: 8 }}>Số điểm, trần và cách duyệt lấy từ W11{version ? ` (quy tắc v${version})` : ''} — không nhập tay ở đây.</div>
    </>
  );
  if (step === 1) body = (
    <div className="demo-grid">
      <div className="w14-tabs"><Tabs variant="pill" value={method} onChange={setMethod} items={[{ key: 'qr', label: 'Danh sách điểm danh QR', icon: 'qr' }, { key: 'tick', label: 'Tick từ danh sách', icon: 'check' }, { key: 'excel', label: 'Dán / import mã', icon: 'upload' }]} /></div>
      {method === 'qr' && <div className="demo-note demo-note--muted"><Icon name="qr" size={16} />Chưa nối dữ liệu điểm danh QR sự kiện (giai đoạn sau). Dùng "Tick từ danh sách" hoặc dán danh sách mã đại lý xuất từ file điểm danh.</div>}
      {method === 'excel' && (
        <div className="w14-drop">
          <Icon name="upload" size={24} />
          <b>Dán cột "Mã đại lý" từ Excel vào đây</b>
          <Field as="textarea" label="Danh sách mã" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="DL00124&#10;DL00125, DL00166…" />
          <Button icon="check" disabled={!paste.trim()} onClick={applyPaste}>Áp dụng danh sách</Button>
          {invalid.length > 0 && <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />{invalid.length} mã không tồn tại hoặc ngoài phạm vi phụ trách: {invalid.join(', ')}</div>}
        </div>
      )}
      {agentsQ.isLoading ? <Loading /> : agentsQ.error ? <ErrorNote error={agentsQ.error} /> : (
        <DataTable key={tableKey} rows={agents} rowKey="id" selectable defaultSelected={sel} onSelectionChange={(k) => setSel(k as string[])} itemLabel="đại lý" maxHeight={340}
          columns={[
            { key: 'name', label: 'Đại lý', primary: true, render: (a) => <div><b>{a.name}</b><div className="demo-sub">{a.id} · {a.city}</div></div> },
            { key: 'tier', label: 'Hạng', render: (a) => <TierBadge tier={a.tier as Tier} /> },
            { key: 'saleName', label: 'Sale' },
            { key: 'w', label: 'Cảnh báo', render: (a) => (dup.has(a.id) ? <StatusBadge tone="warning">Đang có yêu cầu cùng hạng mục chờ duyệt</StatusBadge> : '') },
          ]} />
      )}
    </div>
  );
  if (step === 2) body = (
    <div className="demo-grid demo-grid--2">
      <label className={'w14-drop w14-file' + (files.length ? ' is-done' : '')}>
        <Icon name={files.length ? 'check' : 'upload'} size={28} />
        <b>{files.length ? `Đã đính kèm ${files.length} tệp` : 'Tải ảnh / file bằng chứng'}</b>
        <span>{files.length ? files.join(' · ') : 'Bắt buộc khi cộng điểm thủ công'}</span>
        <input type="file" multiple className="w14-hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []).map((f) => f.name))} />
      </label>
      <Field as="textarea" label="Lý do / ghi chú cho BOD" required value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder={`Ví dụ: Đại lý tham dự ${cur?.name ?? 'sự kiện'} ngày 24/10, có điểm danh QR.`} error={reason.trim() ? undefined : 'Bắt buộc nhập lý do'} />
    </div>
  );
  if (step === 3 && cur) body = (
    <div className="demo-grid">
      <div className="w14-sum">
        <KpiCard label="Hạng mục" value={'+' + num(pts)} hint={`${cur.id} · ${cur.name}`} />
        <KpiCard label="Đại lý được cộng" value={okIds.length} hint={over.length ? `${over.length} bị loại do trùng yêu cầu chờ duyệt` : 'Không ai bị loại'} />
        <KpiCard label="Tổng điểm" value={num(okIds.length * pts)} hint={FUND_LABEL[cur.fund]} />
        <KpiCard label="Giá trị quy đổi" value={mil(okIds.length * pts * params.pointValueVND)} hint={`1 điểm = ${num(params.pointValueVND)}đ`} />
      </div>
      {over.length > 0 && <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />{over.length} đại lý đang có yêu cầu "{cur.name}" chờ duyệt và sẽ không được đưa vào lô này: {over.join(', ')}.</div>}
      <div className="demo-sub">Đính kèm: {files.join(', ')} · Lý do: {reason}</div>
      {sent && (
        <>
          <ApprovalStepper steps={[
            { label: 'Đề xuất', actor: sent.requestedBy, time: dateTime(sent.requestedAt), status: 'done' },
            { label: 'BOD duyệt', actor: `${sent.id} · hạn ${dateTime(sent.dueAt)}`, status: 'current' },
            { label: 'Ghi sổ & gửi ZNS', status: 'todo' },
          ]} />
          {can(role, 'approvals.view') && <div><Button icon="chevronRight" onClick={() => nav('/approvals')}>Xem ở Hàng chờ duyệt</Button></div>}
        </>
      )}
    </div>
  );

  return (
    <AdminShell screen="W14" sub={role === 'SALE' ? 'Sale chỉ chọn được đại lý mình phụ trách' : 'Kiểm soát 2 lớp: không ai tự cộng điểm — mọi lô đều chờ BOD duyệt'}>
      <Card>
        <ApprovalStepper steps={stepper} />
        <div style={{ height: 20 }} />
        {!canPropose && <div className="demo-note" style={{ marginBottom: 12 }}><Icon name="info" size={16} />{role === 'BOD' ? 'BOD không tạo lô cộng điểm — BOD duyệt ở W13 Hàng chờ duyệt.' : 'Vai trò này không được đề xuất cộng điểm.'}</div>}
        {rulesQ.isLoading && can(role, 'rules.view') ? <Loading /> : body}
        <div className="w14-foot">
          <span className="demo-muted">{step === 1 ? `${sel.length} đại lý đã chọn${over.length ? ` · ${over.length} sẽ bị loại` : ''}` : ''}</span>
          <div className="demo-row">
            {step > 0 && !sent && <Button onClick={() => setStep(step - 1)}>Quay lại</Button>}
            {step < 3 && <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Tiếp tục</Button>}
            {step === 3 && !sent && <Button variant="primary" icon="send" disabled={!canPropose || !okIds.length || send.isPending} onClick={() => send.mutate()}>Gửi BOD duyệt</Button>}
            {sent && <Button onClick={reset}>Tạo lô mới</Button>}
          </div>
        </div>
      </Card>
    </AdminShell>
  );
}
