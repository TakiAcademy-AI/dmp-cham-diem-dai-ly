import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { can, computeOrderPoints, FUND_LABEL, TIER_NAME, TIER_ORDER, type Fund, type RuleDef, type RuleParams, type Tier } from '@dmp/shared';
import { ApprovalStepper, Button, Card, DataTable, Field, Icon, PointBreakdown, QuickView, StatusBadge, Tabs, type FieldProps } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, num, vnd } from '../../lib/fmt';
import type { Approval, RuleSet } from '../../lib/types';
import './W11PointRules.css';

/* ================= Dùng chung W11 / W12: bản nháp tham số điểm & hạng ================= */

export interface RulesResp { active: RuleSet | null; draft: RuleSet | null; history: RuleSet[] }
export interface SimResp {
  distribution: Array<{ tier: Tier; current: number; simulated: number }>;
  monthlyRevenue: number; monthlyPoints: number; costPct: number; moves: { up: number; down: number };
}

export const SET_TONE: Record<string, 'success' | 'neutral' | 'pending'> = { 'Hiệu lực': 'success', 'Nháp': 'neutral', 'Chờ BOD duyệt': 'pending', 'Hết hiệu lực': 'neutral', 'Bị trả lại': 'neutral' };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function parseNum(s: string, decimals?: boolean): number {
  const t = s.replace(/\s/g, '');
  if (decimals) return parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0;
  const neg = t.trim().startsWith('-') || t.trim().startsWith('−');
  const n = +t.replace(/\D/g, '') || 0;
  return neg ? -n : n;
}
export const dec = (n: number) => String(n).replace('.', ',');

/** Ô số có định dạng: gõ tự do, tính lại ngay; định dạng lại khi rời ô. */
export function NumField({ value, onNum, decimals, ...rest }: Omit<FieldProps, 'value' | 'onChange'> & { value: number; onNum: (n: number) => void; decimals?: boolean }) {
  const show = (n: number) => (decimals ? dec(n) : num(n));
  const [txt, setTxt] = useState(show(value));
  useEffect(() => { if (parseNum(txt, decimals) !== value) setTxt(show(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Field {...rest} inputMode={decimals ? 'decimal' : 'numeric'} value={txt} onBlur={() => setTxt(show(value))}
    onChange={(e) => { setTxt(e.target.value); onNum(parseNum(e.target.value, decimals)); }} />;
}

/** Trì hoãn giá trị (mô phỏng gọi server sau khi ngừng gõ). */
export function useDebounced<T>(v: T, ms = 350): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Mô phỏng phân bổ hạng + chi phí điểm trên dữ liệu đại lý thật (POST /rules/simulate). */
export function useSimulation(params: RuleParams | null) {
  const p = useDebounced(params);
  const key = p ? JSON.stringify(p) : '';
  return useQuery<SimResp>({ queryKey: ['admin', 'sim:' + key], queryFn: () => api.post<SimResp>('/rules/simulate', { params: p }), enabled: !!p, placeholderData: (prev) => prev, staleTime: 60000 });
}

/**
 * Bản nháp tham số: chỉnh trên bản sao phía trình duyệt, "Lưu nháp" = PUT /rules/draft,
 * "Gửi BOD duyệt" = lưu + POST /rules/draft/submit (tạo yêu cầu duyệt loại `rules`).
 */
export function useRuleDraft() {
  const { user } = useSession();
  const role = user!.role;
  const q = useApi<RulesResp>('/rules');
  const active = q.data?.active ?? null;
  const draft = q.data?.draft ?? null;
  const base = draft ?? active;
  const baseKey = base ? `${base.version}:${base.status}:${JSON.stringify(base.params).length}` : '';
  const [params, setParams] = useState<RuleParams | null>(null);
  useEffect(() => { if (base) setParams(clone(base.params)); }, [baseKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!(params && base && JSON.stringify(params) !== JSON.stringify(base.params));
  const canPropose = can(role, 'rules.propose');
  const appr = useApi<Approval[]>(can(role, 'approvals.view') ? '/approvals' : null);
  /** Yêu cầu duyệt gần nhất của bản nháp (danh sách đã sắp mới nhất trước). */
  const lastReq = draft ? appr.data?.find((a) => a.kind === 'rules' && Number(a.payload?.version) === draft.version) : undefined;
  /** API không trả bản nháp về "Nháp" khi BOD từ chối → coi là bị trả lại, cho sửa tiếp (lưu sẽ tạo bản nháp mới). */
  const rejected = draft?.status === 'Chờ BOD duyệt' && lastReq?.status === 'rejected' ? lastReq : null;
  const pendingSubmit = draft?.status === 'Chờ BOD duyệt' && !rejected;
  const locked = !canPropose || pendingSubmit;
  const approval = pendingSubmit && lastReq?.status === 'pending' ? lastReq : null;
  const canDecide = !!approval && role === 'BOD' && approval.payload?.requesterId !== user!.id;

  const save = useAction((v: { params: RuleParams; note: string }) => api.put<{ version: number }>('/rules/draft', v), {
    success: (r) => ({ tone: 'success', title: `Đã lưu bản nháp v${r.version}`, body: 'Bản đang hiệu lực vẫn áp dụng cho tới khi BOD duyệt bản nháp.' }),
  });
  const submit = useAction(async (v: { params: RuleParams; note: string; reason: string; needSave: boolean }) => {
    if (v.needSave) await api.put('/rules/draft', { params: v.params, note: v.note });
    return api.post<Approval>('/rules/draft/submit', { reason: v.reason });
  }, { success: (r) => ({ tone: 'success', title: `Đã gửi BOD duyệt (${r.id})`, body: `${r.title} · hạn duyệt 48 giờ. Theo dõi ở W13 Hàng chờ duyệt.` }) });
  const decide = useAction((v: { ok: boolean; note: string }) => api.post(`/approvals/${approval!.id}/${v.ok ? 'approve' : 'reject'}`, { note: v.note }), {
    success: (_r, v) => (v.ok ? { tone: 'success', title: `Đã duyệt: quy tắc v${draft?.version} hiệu lực từ hôm nay`, body: 'Không hồi tố: đơn trước thời điểm này giữ quy tắc cũ.' } : { tone: 'warning', title: 'Đã trả lại bản nháp', body: 'Người đề xuất nhận thông báo kèm lý do.' }),
  });

  return { q, role, user: user!, active, draft, base, rejected, params, setParams, dirty, canPropose, pendingSubmit, locked, approval, canDecide, save, submit, decide,
    reset: () => base && setParams(clone(base.params)) };
}

/** Nút thao tác bản nháp + popup ghi chú / lý do (dùng cho cả W11 và W12). */
export function DraftActions({ d, what }: { d: ReturnType<typeof useRuleDraft>; what: string }) {
  const [dlg, setDlg] = useState<null | 'save' | 'submit' | 'reject'>(null);
  const [txt, setTxt] = useState('');
  const status = d.dirty ? 'Có thay đổi chưa lưu' : d.rejected ? 'Bị trả lại' : d.base?.status ?? '—';
  const open = (k: 'save' | 'submit' | 'reject') => { setTxt(k === 'reject' ? '' : d.draft?.note && d.draft.status === 'Nháp' ? d.draft.note : ''); setDlg(k); };
  const busy = d.save.isPending || d.submit.isPending || d.decide.isPending;
  const go = () => {
    if (!d.params) return;
    if (dlg === 'save') d.save.mutate({ params: d.params, note: txt }, { onSuccess: () => setDlg(null) });
    if (dlg === 'submit') d.submit.mutate({ params: d.params, note: txt, reason: txt, needSave: d.dirty || d.draft?.status !== 'Nháp' }, { onSuccess: () => setDlg(null) });
    if (dlg === 'reject') d.decide.mutate({ ok: false, note: txt }, { onSuccess: () => setDlg(null) });
  };
  return (
    <>
      <StatusBadge tone={d.dirty ? 'warning' : d.rejected ? 'danger' : SET_TONE[d.base?.status ?? ''] ?? 'neutral'}>{d.base ? `v${d.base.version} · ` : ''}{status}</StatusBadge>
      {d.dirty && <Button onClick={d.reset}>Khôi phục</Button>}
      {!d.locked && <Button icon="file" disabled={!d.dirty || busy} onClick={() => open('save')}>Lưu nháp</Button>}
      {!d.locked && <Button variant="primary" icon="send" disabled={busy || (!d.dirty && d.draft?.status !== 'Nháp')} onClick={() => open('submit')}>Gửi BOD duyệt</Button>}
      {d.canDecide && <Button variant="danger" disabled={busy} onClick={() => open('reject')}>Trả lại</Button>}
      {d.canDecide && <Button variant="primary" icon="check" disabled={busy} onClick={() => d.decide.mutate({ ok: true, note: '' })}>Duyệt áp dụng</Button>}
      {dlg && (
        <QuickView title={dlg === 'save' ? 'Lưu bản nháp' : dlg === 'submit' ? `Gửi BOD duyệt ${what}` : `Trả lại bản nháp v${d.draft?.version}`} onClose={() => setDlg(null)}
          footer={<><Button onClick={() => setDlg(null)}>Huỷ</Button>
            <Button variant={dlg === 'reject' ? 'danger' : 'primary'} disabled={busy || (dlg !== 'save' && !txt.trim())} onClick={go}>{dlg === 'save' ? 'Lưu nháp' : dlg === 'submit' ? 'Gửi BOD duyệt' : 'Xác nhận trả lại'}</Button></>}>
          <div className="demo-grid">
            {dlg === 'submit' && <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Khi BOD duyệt, bản này thành phiên bản hiệu lực ngay. Không hồi tố: đơn trước thời điểm duyệt giữ quy tắc cũ. Người gửi không được tự duyệt.</div>}
            <Field as="textarea" label={dlg === 'reject' ? 'Lý do trả lại' : dlg === 'submit' ? 'Lý do thay đổi (gửi kèm cho BOD)' : 'Ghi chú phiên bản'} required={dlg !== 'save'} value={txt}
              onChange={(e) => setTxt(e.target.value)} placeholder={dlg === 'reject' ? 'Ví dụ: Chi phí điểm vượt 1,5% doanh số' : 'Ví dụ: Hạ ngưỡng hạng Đồng theo góp ý của TP Kinh doanh'}
              error={dlg !== 'save' && !txt.trim() ? 'Bắt buộc nhập' : undefined} />
          </div>
        </QuickView>
      )}
    </>
  );
}

/** Bản nháp bị BOD trả lại: hiện lý do, cho sửa tiếp. */
export function RejectedNote({ d }: { d: ReturnType<typeof useRuleDraft> }) {
  const r = d.rejected!;
  return <div className="demo-note demo-note--danger"><Icon name="alert" size={16} />Bản v{d.draft?.version} bị {r.decidedBy} trả lại ({r.id}{r.decisionNote ? ': ' + r.decisionNote : ''}). {d.canPropose ? 'Chỉnh tiếp rồi lưu — hệ thống tạo bản nháp mới.' : ''} Bản v{d.active?.version} vẫn đang hiệu lực.</div>;
}

/** Lịch sử phiên bản quy tắc. */
export function VersionList({ history, prefix }: { history: RuleSet[]; prefix: string }) {
  return (
    <ul className={prefix + '-ver'}>
      {history.map((h) => (
        <li key={h.version}>
          <span><b>v{h.version}</b> · <StatusBadge tone={SET_TONE[h.status] ?? 'neutral'}>{h.status}</StatusBadge><span className="demo-sub" style={{ display: 'block' }}>{h.note || '—'}</span></span>
          <span className="demo-muted" style={{ textAlign: 'right' }}>{h.createdBy}{h.approvedBy ? <><br />duyệt: {h.approvedBy}</> : null}<br />{h.effectiveFrom ? 'hiệu lực ' + date(h.effectiveFrom) : date(h.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ================= W11 ================= */

const RULE_TONE: Record<string, 'success' | 'neutral' | 'pending'> = { 'Hiệu lực': 'success', 'Nháp': 'neutral', 'Chờ BOD duyệt': 'pending', 'Tắt': 'neutral' };
const GROUPS = ['Đơn hàng', 'Thanh toán', 'Hoạt động', 'Phát triển', 'Chu kỳ', 'Gắn kết', 'Trừ điểm'];
const APPROVALS = ['Tự động', 'Cần duyệt', 'Marketing duyệt', 'KTT đề xuất, BOD duyệt'];
const RULE_STATUS: RuleDef['status'][] = ['Hiệu lực', 'Nháp', 'Chờ BOD duyệt', 'Tắt'];
const SIM_TIERS = TIER_ORDER.filter((t) => t !== 'strategic');

/** W11 Cấu hình quy tắc điểm — tham số có phiên bản, mô phỏng đơn giả B1→B5, sửa trên bản nháp rồi gửi BOD duyệt. */
export default function W11PointRules() {
  const d = useRuleDraft();
  const { params, setParams, locked } = d;
  const [grp, setGrp] = useState('Tất cả');
  const [sel, setSel] = useState('R02');
  const [sim, setSim] = useState({ value: 25300000, tier: 'gold' as Tier, mult: 1, ship: 0 });
  const [explain, setExplain] = useState(false);
  const simQ = useSimulation(params);
  const baseSim = useSimulation(d.active?.params ?? null);

  const res = useMemo(() => params && computeOrderPoints([{ sku: 'SIM', name: 'Đơn giả', price: sim.value / (1 + params.vatRate), qty: 1, multiplier: sim.mult }], sim.tier, params, { ship: sim.ship }), [params, sim]);

  if (d.q.isLoading || (d.q.data && !params)) return <AdminShell screen="W11"><Loading /></AdminShell>;
  if (d.q.error) return <AdminShell screen="W11"><ErrorNote error={d.q.error} /></AdminShell>;
  if (!params) return <AdminShell screen="W11"><Card><Icon name="alert" size={16} /> Chưa có bộ quy tắc điểm nào.</Card></AdminShell>;

  const set = (patch: Partial<RuleParams>) => setParams({ ...params, ...patch });
  const setTierMult = (k: Tier, m: number) => set({ tiers: params.tiers.map((t) => (t.key === k ? { ...t, multiplier: m } : t)) });
  const rules = params.rules;
  const cur = rules.find((r) => r.id === sel) ?? rules[0];
  const baseRule = d.base?.params.rules.find((r) => r.id === cur?.id);
  const setRule = (patch: Partial<RuleDef>) => set({ rules: rules.map((r) => (r.id === cur.id ? { ...r, ...patch } : r)) });
  const shown = rules.filter((r) => grp === 'Tất cả' || r.group === grp);
  const conflicts = rules.filter((r) => r.conflict);
  const gold = params.tiers.find((t) => t.key === 'gold');
  const addRule = () => {
    const n = Math.max(0, ...rules.map((r) => +r.id.replace(/\D/g, '') || 0)) + 1;
    const id = 'R' + String(n).padStart(2, '0');
    set({ rules: [...rules, { id, group: grp === 'Tất cả' ? 'Hoạt động' : grp, name: 'Hạng mục mới', formula: '', when: '', approval: 'Cần duyệt', cap: '—', fund: 'reward', status: 'Nháp', points: 0 }] });
    setSel(id);
  };
  const ver = d.base?.version;
  const setStatus = d.base?.status ?? '';
  const stepIdx = ['Nháp', 'Chờ BOD duyệt', 'Hiệu lực'].indexOf(d.dirty ? 'Nháp' : setStatus);
  const pv = params.pointValueVND;

  return (
    <AdminShell screen="W11"
      sub="Mọi tham số đọc từ đây — không viết cứng trên giao diện. Quy tắc có phiên bản, không hồi tố."
      actions={<>
        <DraftActions d={d} what="quy tắc điểm" />
        {!locked && <Button icon="plus" onClick={addRule}>Thêm hạng mục</Button>}
      </>}>
      <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />
        Tham số theo khảo sát đang ở trạng thái [CHỜ CHỐT].{conflicts.map((c) => ` Hạng mục "${c.name}": ${c.conflict}.`).join('')}
      </div>
      {d.rejected && <RejectedNote d={d} />}
      {d.pendingSubmit && <div className="demo-note"><Icon name="clock" size={16} />Bản nháp v{d.draft?.version} đang chờ BOD duyệt{d.approval ? ` (${d.approval.id}, gửi bởi ${d.approval.requestedBy})` : ''} — tạm khoá chỉnh sửa. Bản v{d.active?.version} vẫn đang hiệu lực.</div>}
      {!d.canPropose && !d.canDecide && <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Vai trò này chỉ xem; ô tham số bên dưới có thể chỉnh để thử, không lưu được. Kế toán trưởng / Marketing đề xuất, BOD duyệt.</div>}

      <Card title="Mô phỏng: nhập một đơn giả để xem điểm" subtitle="Đổi tham số bên trái hoặc đơn bên phải — kết quả tính lại ngay theo thứ tự B1→B5">
        <div className="w11-sim">
          <NumField label={`${num(params.vndPerPoint)}đ = 1 điểm`} value={params.vndPerPoint} suffix="đ" readOnly={locked} onNum={(n) => set({ vndPerPoint: Math.max(1, n) })} />
          <NumField label="Mốc đơn" value={params.milestoneOrderVND} suffix="đ" readOnly={locked} onNum={(n) => set({ milestoneOrderVND: n })} />
          <NumField label="Thưởng mốc" value={params.milestoneBonus} suffix="điểm" readOnly={locked} onNum={(n) => set({ milestoneBonus: n })} />
          <NumField label="Hệ số hạng Vàng" decimals value={gold?.multiplier ?? 1} prefix="×" readOnly={locked} onNum={(n) => setTierMult('gold', n)} />
          {res && (
            <div className="w11-sim__out">
              <span className="demo-muted">Đơn này được</span>
              <span className="w11-sim__big">+{num(res.total)} điểm</span>
              <span className="demo-sub">= {num(res.base)} cơ bản × {dec(Math.round(res.productMult * res.tierMult * 100) / 100)} + {num(res.bonus)} thưởng mốc · giá trị quy đổi {vnd(res.total * pv)} ({sim.value ? ((res.total * pv) / sim.value * 100).toFixed(2).replace('.', ',') : '0'}% doanh số)</span>
              <button type="button" className="demo-link w11-sim__why" onClick={() => setExplain(true)}>Xem cách tính B1→B5</button>
            </div>
          )}
          <NumField label="Giá trị đơn (sau CK, gồm VAT)" value={sim.value} suffix="đ" onNum={(n) => setSim({ ...sim, value: n })} />
          <Field label="Hạng đại lý" as="select" value={sim.tier} options={SIM_TIERS.map((t) => ({ value: t, label: TIER_NAME[t] }))} onChange={(e) => setSim({ ...sim, tier: e.target.value as Tier })} />
          <Field label="Hệ số SP" as="select" value={String(sim.mult)} options={[{ value: '1', label: '×1 (thường)' }, { value: '2', label: '×2 (hàng mới / campaign)' }]} onChange={(e) => setSim({ ...sim, mult: +e.target.value })} />
          <NumField label="Phí ship" value={sim.ship} suffix="đ" onNum={(n) => setSim({ ...sim, ship: n })} />
        </div>
        {simQ.data && (
          <div className="w11-cost">
            <Icon name="chart" size={16} />
            <span>Áp lên doanh số tháng của toàn bộ đại lý: <b>{num(simQ.data.monthlyPoints)} điểm/tháng</b> ≈ {vnd(simQ.data.monthlyPoints * pv)} · chi phí <b>{dec(simQ.data.costPct)}% doanh số</b>
              {baseSim.data && <span className="demo-muted"> (bản v{d.active?.version} đang hiệu lực: {dec(baseSim.data.costPct)}%)</span>}</span>
          </div>
        )}
      </Card>

      <div className="w11-grid">
        <Card title="Hạng mục cộng/trừ điểm" subtitle={`Phiên bản ${ver ?? '—'} · ${rules.length} hạng mục`} flush>
          <div className="w11-tabs"><Tabs variant="pill" value={grp} onChange={setGrp} items={['Tất cả', ...GROUPS].map((x) => ({ key: x, label: x, count: x === 'Tất cả' ? undefined : rules.filter((r) => r.group === x).length }))} /></div>
          <DataTable rows={shown} rowKey="id" onRowClick={(x) => setSel(x.id)} itemLabel="hạng mục"
            columns={[
              { key: 'name', label: 'Hạng mục', primary: true, render: (x) => <div><div className={'demo-strong' + (x.id === cur?.id ? ' w11-on' : '')}>{x.name}{x.phase && <span className="demo-sub"> · {x.phase}</span>}</div><div className="w11-grp">{x.id} · {x.group}</div></div> },
              { key: 'formula', label: 'Công thức', render: (x) => <span className="w11-wrap">{x.formula || '—'}</span> },
              { key: 'status', label: 'Trạng thái', render: (x) => <span className="demo-row">{x.conflict && <StatusBadge tone="danger">Mâu thuẫn</StatusBadge>}<StatusBadge tone={RULE_TONE[x.status]}>{x.status}</StatusBadge></span> },
            ]} />
        </Card>
        {cur && (
          <Card title={cur.name} subtitle={`${cur.id} · phiên bản ${ver ?? '—'}${baseRule && JSON.stringify(baseRule) !== JSON.stringify(cur) ? ' · đã sửa' : !baseRule ? ' · mới' : ''}`}>
            <div className="w11-editor" key={cur.id}>
              <ApprovalStepper steps={['Nháp', 'Chờ BOD duyệt', 'Hiệu lực'].map((st, i) => ({ label: st, status: i < stepIdx ? 'done' : i === stepIdx ? (st === 'Hiệu lực' ? 'done' : 'current') : 'todo' }))} />
              {cur.conflict && <div className="demo-note demo-note--danger"><Icon name="alert" size={16} />{cur.conflict}</div>}
              <div className="w11-two">
                <Field label="Tên hạng mục" value={cur.name} readOnly={locked} onChange={(e) => setRule({ name: e.target.value })} />
                <Field label="Nhóm" as="select" value={cur.group} options={GROUPS} disabled={locked} onChange={(e) => setRule({ group: e.target.value })} />
              </div>
              <Field label="Công thức / mô tả" value={cur.formula} readOnly={locked} onChange={(e) => setRule({ formula: e.target.value })} />
              <div className="w11-two">
                <NumField label="Số điểm mỗi lần" value={cur.points ?? 0} suffix="điểm" readOnly={locked} hint={cur.id === 'R01' ? 'R01 tính theo tỷ lệ đ/điểm ở trên' : cur.id === 'R02' ? 'Đồng bộ với "Thưởng mốc"' : undefined}
                  onNum={(n) => (cur.id === 'R02' ? set({ milestoneBonus: n, rules: rules.map((r) => (r.id === 'R02' ? { ...r, points: n } : r)) }) : setRule({ points: n }))} />
                <Field label="Trần mỗi lần / tháng" value={cur.cap} readOnly={locked} onChange={(e) => setRule({ cap: e.target.value })} />
              </div>
              <Field label="Thời điểm cộng" value={cur.when} readOnly={locked} onChange={(e) => setRule({ when: e.target.value })} />
              <div className="w11-two">
                <Field label="Cách duyệt" as="select" value={cur.approval} options={APPROVALS.includes(cur.approval) ? APPROVALS : [cur.approval, ...APPROVALS]} disabled={locked} onChange={(e) => setRule({ approval: e.target.value })} />
                <Field label="Quỹ điểm" as="select" value={cur.fund} options={(Object.keys(FUND_LABEL) as Fund[]).map((f) => ({ value: f, label: FUND_LABEL[f] }))} disabled={locked} onChange={(e) => setRule({ fund: e.target.value as Fund })} />
              </div>
              <Field label="Trạng thái hạng mục" as="select" value={cur.status} options={RULE_STATUS} disabled={locked} onChange={(e) => setRule({ status: e.target.value as RuleDef['status'] })}
                hint={`Không hồi tố: hiệu lực khi BOD duyệt phiên bản. Bản hiện hành v${d.active?.version ?? '—'} từ ${date(d.active?.effectiveFrom)}.`} />
              {!locked && !baseRule && <Button variant="ghost" icon="x" onClick={() => { set({ rules: rules.filter((r) => r.id !== cur.id) }); setSel(rules[0].id); }}>Bỏ hạng mục mới này</Button>}
              <div>
                <div className="dmp-field__label" style={{ marginBottom: 4 }}>Lịch sử phiên bản</div>
                <VersionList history={d.q.data?.history ?? []} prefix="w11" />
              </div>
            </div>
          </Card>
        )}
      </div>

      {explain && res && (
        <QuickView title="Cách tính điểm đơn giả" onClose={() => setExplain(false)} footer={<Button onClick={() => setExplain(false)}>Đóng</Button>}>
          <PointBreakdown steps={res.steps} total={res.total} state="pending"
            footnote={`Tham số ${d.dirty ? 'đang chỉnh (chưa lưu)' : 'phiên bản v' + ver} · ${num(params.vndPerPoint)}đ = 1 điểm · 1 điểm = ${vnd(pv)} · [CHỜ CHỐT]`} />
        </QuickView>
      )}
    </AdminShell>
  );
}
