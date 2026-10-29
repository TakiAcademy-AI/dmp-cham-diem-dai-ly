import { useMemo, useRef, useState } from 'react';
import { can, DEFAULT_PARAMS, ROLE_LABEL, TIER_NAME, TIER_ORDER, type Role, type Tier } from '@dmp/shared';
import { ApprovalStepper, Button, Card, DataTable, EmptyState, Field, Icon, QuickView, StatusBadge, TierBadge } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { HBars, InfoGrid } from '../../shell/charts';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, dateTime, mil, num } from '../../lib/fmt';
import type { Agent, Approval, Product, RuleSet } from '../../lib/types';
import './W18Campaigns.css';

interface Scope { brands?: string[]; lines?: string[]; skus?: string[]; types?: string[]; minTier?: Tier; minOrderVND?: number }
interface Camp {
  id: string; name: string; kind: 'multiplier' | 'bonus'; value: number; scope: Scope; fromDate: string; toDate: string;
  budget: number; used: number; status: string; note: string; createdBy: string; createdAt: string;
}
interface Draft { name: string; kind: 'multiplier' | 'bonus'; value: string; brands: string[]; lines: string[]; skus: string[]; types: string[]; minTier: Tier | ''; minOrder: string; from: string; to: string; budget: string; note: string }

const TONE: Record<string, 'success' | 'pending' | 'neutral' | 'info' | 'danger'> = { 'Đang chạy': 'success', 'Chờ BOD duyệt': 'pending', 'Nháp': 'neutral', 'Đã duyệt': 'info', 'Đã kết thúc': 'neutral', 'Từ chối': 'danger' };
const TYPES = ['Nhà thuốc', 'Spa', 'Phòng khám'];
const LIVE = ['Chờ BOD duyệt', 'Đã duyệt', 'Đang chạy'];
const EDITABLE = ['Nháp', 'Từ chối'];

/** ISO → yyyy-mm-dd theo giờ Việt Nam (cho ô chọn ngày). */
const ymd = (iso: string | Date) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const dec = (n: number) => String(n).replace('.', ',');
const offer = (c: { kind: string; value: number }) => (c.kind === 'multiplier' ? '×' + dec(c.value) : '+' + num(c.value));
const toNum = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

function scopeLabel(s: Scope) {
  const prod = [s.brands?.join(', '), s.lines?.join(', '), s.skus?.length ? `${s.skus.length} SKU` : ''].filter(Boolean).join(' · ') || 'Mọi SP';
  const parts = [prod, s.types?.length ? 'kênh ' + s.types.join(', ') : '', s.minTier ? 'từ hạng ' + TIER_NAME[s.minTier] : 'mọi hạng'];
  if (s.minOrderVND) parts.push('đơn ≥ ' + mil(s.minOrderVND));
  return parts.filter(Boolean).join(' · ');
}
const emptyDraft = (): Draft => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  return { name: '', kind: 'multiplier', value: '2', brands: [], lines: [], skus: [], types: [], minTier: '', minOrder: '', from: ymd(from), to: ymd(to), budget: '10000', note: '' };
};
const toDraft = (c: Camp): Draft => ({
  name: c.name, kind: c.kind, value: dec(c.value), brands: c.scope.brands ?? [], lines: c.scope.lines ?? [], skus: c.scope.skus ?? [], types: c.scope.types ?? [],
  minTier: c.scope.minTier ?? '', minOrder: c.scope.minOrderVND ? String(c.scope.minOrderVND) : '', from: ymd(c.fromDate), to: ymd(c.toDate), budget: String(c.budget || ''), note: c.note ?? '',
});
const draftBody = (d: Draft) => ({
  name: d.name.trim(), kind: d.kind, value: toNum(d.value), budget: toNum(d.budget) || 0, note: d.note.trim(),
  from: `${d.from}T00:00:00+07:00`, to: `${d.to}T23:59:00+07:00`,
  scope: {
    ...(d.brands.length ? { brands: d.brands } : {}), ...(d.lines.length ? { lines: d.lines } : {}), ...(d.skus.length ? { skus: d.skus } : {}),
    ...(d.types.length ? { types: d.types } : {}), ...(d.minTier ? { minTier: d.minTier } : {}), ...(toNum(d.minOrder) > 0 ? { minOrderVND: toNum(d.minOrder) } : {}),
  } as Scope,
});
const matches = (s: Scope, p: Product) => (!s.skus?.length || s.skus.includes(p.sku)) && (!s.brands?.length || s.brands.includes(p.brand)) && (!s.lines?.length || s.lines.includes(p.line));

/** W18 Campaign điểm — MKT tạo/sửa nháp, gửi BOD duyệt; lịch campaign; ngân sách đã phát; BOD duyệt/dừng. */
export default function W18Campaigns() {
  const { user } = useSession();
  const role = user!.role as Role;
  const isMkt = can(role, 'campaigns.manage');
  const isBod = role === 'BOD';
  const q = useApi<Camp[]>('/campaigns');
  const prodQ = useApi<Product[]>(can(role, 'products.view') ? '/products' : null);
  const agentsQ = useApi<Agent[]>(can(role, 'agents.view') ? '/agents' : null);
  const rulesQ = useApi<{ active: RuleSet | null }>(can(role, 'rules.view') ? '/rules' : null, { retry: false });
  const pendQ = useApi<Approval[]>(can(role, 'approvals.view') ? '/approvals?status=pending' : null);
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [skuPick, setSkuPick] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [stopping, setStopping] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const camps = q.data ?? [];
  const products = prodQ.data ?? [];
  const pointVND = rulesQ.data?.active?.params?.pointValueVND ?? DEFAULT_PARAMS.pointValueVND;
  const cur = selId && selId !== 'new' ? camps.find((c) => c.id === selId) ?? null : selId === 'new' ? null : camps.find((c) => c.status === 'Chờ BOD duyệt') ?? camps[0] ?? null;
  const creating = selId === 'new';
  const editing = isMkt && (creating || (!!cur && EDITABLE.includes(cur.status)));
  const pendingAp = cur ? (pendQ.data ?? []).find((a) => a.kind === 'campaign' && a.payload?.campaignId === cur.id) : undefined;
  const mayDecide = isBod && !!pendingAp && pendingAp.payload?.requesterId !== user!.id;

  const select = (id: string | null, c?: Camp | null) => {
    setSelId(id); setRejecting(false); setRejectNote('');
    const edit = id === 'new' ? emptyDraft() : c && isMkt && EDITABLE.includes(c.status) ? toDraft(c) : null;
    setDraft(edit);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  // Khởi tạo bản nháp khi MKT mở màn và campaign mặc định đang sửa được.
  const d: Draft | null = editing ? draft ?? (cur ? toDraft(cur) : emptyDraft()) : null;
  const setD = (patch: Partial<Draft>) => setDraft({ ...(d ?? emptyDraft()), ...patch });

  /* ---------- Thao tác ---------- */
  const save = useAction(async (v: { submit: boolean }) => {
    const body = draftBody(d!);
    let id = cur?.id;
    if (creating || !id) id = (await api.post<{ id: string }>('/campaigns', body)).id;
    else await api.put(`/campaigns/${id}`, body);
    let ap: Approval | null = null;
    if (v.submit) ap = await api.post<Approval>(`/campaigns/${id}/submit`, { reason: body.note || undefined });
    return { id: id!, ap };
  }, {
    success: (r, v) => (v.submit
      ? { tone: 'success', title: `Đã gửi BOD duyệt ${r.id}`, body: r.ap ? `${r.ap.id} đã vào W13 Hàng chờ duyệt · hạn duyệt 48 giờ.` : undefined }
      : `Đã lưu nháp ${r.id}`),
    onDone: (r) => { setSelId(r.id); setDraft(null); },
  });
  const decide = useAction((v: { ok: boolean; note: string }) => api.post(`/approvals/${pendingAp!.id}/${v.ok ? 'approve' : 'reject'}`, { note: v.note }), {
    success: (_r, v) => (v.ok
      ? { tone: 'success', title: `Đã duyệt — chạy từ ${date(cur!.fromDate)}`, body: 'Banner tự hiện trên app đại lý (M02). Điểm campaign tính vào đơn mới, không hồi tố.' }
      : { tone: 'warning', title: 'Đã trả lại campaign', body: 'Marketing nhận lý do và có thể sửa rồi gửi lại.' }),
    onDone: () => { setRejecting(false); setRejectNote(''); },
  });
  const stop = useAction((id: string) => api.post(`/campaigns/${id}/stop`), {
    success: () => ({ tone: 'warning', title: 'Đã dừng campaign sớm', body: 'Hệ số hết hiệu lực từ đơn tiếp theo; điểm đã phát giữ nguyên.' }),
    onDone: () => setStopping(false),
  });

  /* ---------- Ước tính & cảnh báo trùng ---------- */
  const scopeNow: Scope | null = d ? draftBody(d).scope : cur?.scope ?? null;
  const eligible = useMemo(() => {
    if (!scopeNow || !agentsQ.data) return null;
    return agentsQ.data.filter((a) => a.status !== 'locked' && (!scopeNow.types?.length || scopeNow.types.includes(a.type)) && (!scopeNow.minTier || TIER_ORDER.indexOf(a.tier as Tier) >= TIER_ORDER.indexOf(scopeNow.minTier))).length;
  }, [agentsQ.data, scopeNow]);
  const skuCount = scopeNow && products.length ? products.filter((p) => matches(scopeNow, p)).length : null;

  const conflictWith = (self: { id?: string; kind: string; scope: Scope; from: string; to: string }) => {
    if (self.kind !== 'multiplier' || !products.length) return [];
    const mine = new Set(products.filter((p) => matches(self.scope, p)).map((p) => p.sku));
    return camps.filter((c) => c.id !== self.id && c.kind === 'multiplier' && LIVE.includes(c.status)
      && new Date(c.fromDate) <= new Date(self.to) && new Date(c.toDate) >= new Date(self.from)
      && products.some((p) => mine.has(p.sku) && matches(c.scope, p)));
  };
  const conflicts = d
    ? conflictWith({ id: cur?.id, kind: d.kind, scope: draftBody(d).scope, from: draftBody(d).from, to: draftBody(d).to })
    : cur ? conflictWith({ id: cur.id, kind: cur.kind, scope: cur.scope, from: cur.fromDate, to: cur.toDate }) : [];

  /* ---------- Lịch campaign ---------- */
  const tl = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const shown = camps.filter((c) => c.status !== 'Từ chối' && new Date(c.toDate) >= start);
    const lastEnd = Math.max(...shown.map((c) => +new Date(c.toDate)), 0);
    let months = 6;
    while (months < 12 && +new Date(start.getFullYear(), start.getMonth() + months, 1) < lastEnd) months++;
    const end = new Date(start.getFullYear(), start.getMonth() + months, 1);
    const span = +end - +start;
    const pos = (t: Date) => Math.min(1, Math.max(0, (+t - +start) / span));
    const ticks = Array.from({ length: months }, (_, i) => {
      const m = new Date(start.getFullYear(), start.getMonth() + i, 1);
      return i === 0 || m.getMonth() === 0 ? `T${m.getMonth() + 1}/${String(m.getFullYear()).slice(2)}` : `T${m.getMonth() + 1}`;
    });
    const label = `${String(start.getMonth() + 1).padStart(2, '0')}/${start.getFullYear()} – ${String(new Date(+end - 1).getMonth() + 1).padStart(2, '0')}/${new Date(+end - 1).getFullYear()}`;
    return { rows: shown.map((c) => ({ c, s: pos(new Date(c.fromDate)), e: pos(new Date(c.toDate)) })), ticks, today: pos(now), label };
  }, [camps]);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const brands = [...new Set(products.map((p) => p.brand))].sort();
  const lines = [...new Set(products.filter((p) => !d?.brands.length || d.brands.includes(p.brand)).map((p) => p.line))].sort();
  const skuOptions = products.filter((p) => (!d?.brands.length || d.brands.includes(p.brand)) && !d?.skus.includes(p.sku));

  const valErr = d ? (d.kind === 'multiplier' ? (toNum(d.value) > 1 && toNum(d.value) <= 5 ? undefined : 'Hệ số lớn hơn 1 và tối đa ×5') : Number.isInteger(toNum(d.value)) && toNum(d.value) > 0 ? undefined : 'Số nguyên dương') : undefined;
  const dateErr = d && !(d.to > d.from) ? 'Ngày kết thúc phải sau ngày bắt đầu' : undefined;
  const formOk = !!d && !!d.name.trim() && !valErr && !dateErr;

  /* ---------- Khung chi tiết ---------- */
  const budgetBlock = (c: Camp) => {
    const pct = c.budget ? Math.round((c.used / c.budget) * 100) : 0;
    return (
      <div className="w18-budget">
        <div className="demo-between"><span className="dmp-field__label">Ngân sách điểm</span><span className={'demo-strong' + (c.used > c.budget && c.budget ? ' w18-over' : '')}>{c.budget ? `${pct}% đã phát` : 'Không đặt trần'}</span></div>
        <HBars rows={[
          { label: 'Ngân sách (trần)', value: c.budget, valueLabel: num(c.budget) },
          { label: 'Đã phát', value: c.used, valueLabel: num(c.used), tip: `≈ ${mil(c.used * pointVND)} chi phí` },
          { label: 'Còn lại', value: Math.max(0, c.budget - c.used), valueLabel: num(Math.max(0, c.budget - c.used)) },
        ]} />
        {c.used > c.budget && c.budget > 0 && <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Đã vượt ngân sách {Math.round((c.used / c.budget - 1) * 100)}% — campaign tự dừng khi hết ngân sách, phần vượt do đơn đồng bộ trễ.</div>}
      </div>
    );
  };

  const steps = (c: Camp) => {
    const rejected = c.status === 'Từ chối';
    const approved = ['Đã duyệt', 'Đang chạy', 'Đã kết thúc'].includes(c.status);
    return [
      { label: 'Marketing tạo', actor: c.createdBy, time: dateTime(c.createdAt), status: 'done' as const },
      rejected ? { label: 'BOD trả lại', note: c.note, status: 'rejected' as const }
        : c.status === 'Chờ BOD duyệt' ? { label: 'BOD duyệt', actor: pendingAp ? `${pendingAp.id} · hạn ${dateTime(pendingAp.dueAt)}` : undefined, status: 'current' as const }
          : { label: 'BOD duyệt', status: (approved ? 'done' : 'todo') as 'done' | 'todo' },
      { label: c.status === 'Đã kết thúc' ? 'Đã kết thúc' : 'Chạy tự động', actor: `${date(c.fromDate)} – ${date(c.toDate)}`, status: (c.status === 'Đã kết thúc' ? 'done' : c.status === 'Đang chạy' ? 'current' : 'todo') as 'done' | 'current' | 'todo' },
    ];
  };

  const editor = d && (
    <div className="demo-grid">
      {cur?.status === 'Từ chối' && cur.note && <div className="demo-note demo-note--danger"><Icon name="alert" size={16} />{cur.note}. Sửa rồi gửi lại BOD.</div>}
      <Field label="Tên campaign" required value={d.name} onChange={(e) => setD({ name: e.target.value })} placeholder="Ví dụ: NOREVA chống nắng ×2 điểm" error={d.name.trim() ? undefined : 'Cần tên campaign'} />
      <div className="w18-two">
        <Field label="Loại ưu đãi" as="select" value={d.kind} onChange={(e) => setD({ kind: e.target.value as Draft['kind'], value: e.target.value === 'multiplier' ? '2' : '300' })}
          options={[{ value: 'multiplier', label: 'Nhân hệ số điểm' }, { value: 'bonus', label: 'Thưởng điểm cố định theo đơn' }]} />
        <Field label={d.kind === 'multiplier' ? 'Hệ số' : 'Số điểm thưởng / đơn'} required value={d.value} onChange={(e) => setD({ value: e.target.value })} inputMode="decimal"
          prefix={d.kind === 'multiplier' ? '×' : '+'} suffix={d.kind === 'bonus' ? 'điểm' : undefined} error={valErr} />
      </div>
      <div>
        <div className="dmp-field__label w18-lbl">Nhãn hàng <span className="demo-sub">· bỏ trống = mọi nhãn</span></div>
        {prodQ.isLoading ? <Loading /> : <div className="w18-chk">{brands.map((b) => <label key={b}><input type="checkbox" className="dmp-check" checked={d.brands.includes(b)} onChange={() => setD({ brands: toggle(d.brands, b), lines: [], skus: [] })} />{b}</label>)}</div>}
      </div>
      <div>
        <div className="dmp-field__label w18-lbl">Dòng sản phẩm <span className="demo-sub">· bỏ trống = mọi dòng</span></div>
        <div className="w18-chk">{lines.map((l) => <label key={l}><input type="checkbox" className="dmp-check" checked={d.lines.includes(l)} onChange={() => setD({ lines: toggle(d.lines, l) })} />{l}</label>)}</div>
      </div>
      <div>
        <div className="w18-skurow">
          <Field label="SKU cụ thể (tuỳ chọn)" as="select" value={skuPick} onChange={(e) => setSkuPick(e.target.value)}
            options={[{ value: '', label: '— Chọn SKU —' }, ...skuOptions.map((p) => ({ value: p.sku, label: `${p.sku} · ${p.name}` }))]} />
          <Button icon="plus" disabled={!skuPick} onClick={() => { setD({ skus: [...d.skus, skuPick] }); setSkuPick(''); }}>Thêm</Button>
        </div>
        {d.skus.length > 0 && <div className="w18-tags">{d.skus.map((s) => (
          <button type="button" key={s} className="w18-tag" onClick={() => setD({ skus: d.skus.filter((x) => x !== s) })} aria-label={`Bỏ ${s}`}>{s}<Icon name="x" size={12} /></button>
        ))}</div>}
      </div>
      <div>
        <div className="dmp-field__label w18-lbl">Loại đại lý <span className="demo-sub">· bỏ trống = mọi kênh</span></div>
        <div className="w18-chk">{TYPES.map((t) => <label key={t}><input type="checkbox" className="dmp-check" checked={d.types.includes(t)} onChange={() => setD({ types: toggle(d.types, t) })} />{t}</label>)}</div>
      </div>
      <div>
        <div className="dmp-field__label w18-lbl">Hạng áp dụng <span className="demo-sub">· chọn hạng thấp nhất, các hạng cao hơn tự áp dụng</span></div>
        <div className="w18-chk">{TIER_ORDER.map((k, i) => {
          const on = !d.minTier || i >= TIER_ORDER.indexOf(d.minTier);
          return <label key={k}><input type="checkbox" className="dmp-check" checked={on} onChange={() => setD({ minTier: i === 0 ? '' : on && d.minTier === k ? (TIER_ORDER[i + 1] ?? k) : k })} /><TierBadge tier={k as Tier} /></label>;
        })}</div>
      </div>
      <div className="w18-two">
        <Field label="Từ ngày" type="date" required value={d.from} onChange={(e) => setD({ from: e.target.value })} />
        <Field label="Đến ngày" type="date" required value={d.to} onChange={(e) => setD({ to: e.target.value })} error={dateErr} />
      </div>
      <div className="w18-two">
        <Field label="Ngân sách điểm (trần)" value={d.budget} onChange={(e) => setD({ budget: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" suffix="điểm" hint="Hết ngân sách thì campaign tự dừng, đại lý thấy thông báo" />
        <Field label="Đơn tối thiểu (tuỳ chọn)" value={d.minOrder} onChange={(e) => setD({ minOrder: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" suffix="đ" hint={toNum(d.minOrder) > 0 ? mil(toNum(d.minOrder)) : 'Bỏ trống = mọi giá trị đơn'} />
      </div>
      <Field as="textarea" label="Ghi chú / lý do cho BOD" value={d.note} onChange={(e) => setD({ note: e.target.value })} placeholder="Ví dụ: Kích cầu nhập hàng Tết, đẩy tồn kho dòng chống nắng" />
    </div>
  );

  const readView = cur && (
    <div className="demo-grid">
      <InfoGrid cols={2} items={[
        ['Loại ưu đãi', cur.kind === 'multiplier' ? `Nhân hệ số điểm ${offer(cur)}` : `Thưởng ${offer(cur)} điểm / đơn`],
        ['Phạm vi', scopeLabel(cur.scope)],
        ['Thời gian', `${date(cur.fromDate)} – ${date(cur.toDate)}`],
        ['Người tạo', cur.createdBy],
        cur.note && cur.status !== 'Từ chối' ? ['Ghi chú', cur.note] : null,
      ]} />
      {cur.status === 'Từ chối' && cur.note && <div className="demo-note demo-note--danger"><Icon name="alert" size={16} />{cur.note}</div>}
      {budgetBlock(cur)}
    </div>
  );

  const est = scopeNow && (
    <div className="demo-note"><Icon name="chart" size={16} />
      Ước tính: {eligible != null ? `${num(eligible)} đại lý đủ điều kiện` : 'chưa đọc được danh sách đại lý'}
      {skuCount != null ? ` · ${num(skuCount)} SKU áp dụng` : ''}
      {(() => { const b = d ? toNum(d.budget) : cur?.budget ?? 0; return b ? ` · tối đa ${num(b)} điểm phát thêm ≈ ${mil(b * pointVND)} chi phí` : ''; })()}.
    </div>
  );

  const actionsRow = (
    <div className="demo-row w18-acts">
      {editing && <>
        <Button icon="check" disabled={!formOk || save.isPending} onClick={() => save.mutate({ submit: false })}>Lưu nháp</Button>
        <Button variant="primary" icon="send" disabled={!formOk || save.isPending} onClick={() => save.mutate({ submit: true })}>Gửi BOD duyệt</Button>
        {creating && <Button variant="ghost" onClick={() => select(null)}>Huỷ</Button>}
      </>}
      {cur && mayDecide && cur.status === 'Chờ BOD duyệt' && !rejecting && <>
        <Button variant="primary" icon="check" disabled={decide.isPending} onClick={() => decide.mutate({ ok: true, note: '' })}>Duyệt</Button>
        <Button variant="danger" onClick={() => setRejecting(true)}>Trả lại</Button>
      </>}
      {cur && (isMkt || isBod) && ['Đang chạy', 'Đã duyệt'].includes(cur.status) && <Button variant="danger" icon="x" onClick={() => setStopping(true)}>Dừng sớm</Button>}
    </div>
  );

  return (
    <AdminShell screen="W18" crumb="Campaign"
      sub="Marketing tạo, BOD duyệt. Campaign là quy tắc có thời hạn — hệ số tự hết hiệu lực khi kết thúc, không hồi tố."
      actions={isMkt ? <Button variant="primary" icon="plus" onClick={() => select('new')}>Tạo campaign</Button> : undefined}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="demo-grid">
          <Card title="Lịch campaign" subtitle={`${tl.label} · không để 2 campaign nhân điểm chồng lên cùng một SP`}>
            {tl.rows.length ? (
              <div className="w18-tlwrap">
                {tl.rows.map(({ c, s, e }) => (
                  <button type="button" key={c.id} className={'w18-tlrow' + (cur?.id === c.id ? ' is-on' : '')} onClick={() => select(c.id, c)}>
                    <span className="demo-between"><span className="demo-strong w18-tlname">{c.name}</span><span className="demo-sub">{date(c.fromDate)} – {date(c.toDate)}</span></span>
                    <span className="w18-tl">
                      <i className={'w18-tlbar w18-tlbar--' + (c.status === 'Nháp' || c.status === 'Từ chối' ? 'draft' : c.status === 'Chờ BOD duyệt' ? 'wait' : c.status === 'Đã kết thúc' ? 'end' : 'run')}
                        style={{ left: s * 100 + '%', width: Math.max(0.8, (e - s) * 100) + '%' }} title={`${c.id} · ${c.status}`} />
                      <i className="w18-today" style={{ left: tl.today * 100 + '%' }} />
                    </span>
                  </button>
                ))}
                <div className="w18-tlm">{tl.ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
                <div className="w18-legend demo-sub">
                  <span><i className="w18-tlbar--run" />Đang chạy / đã duyệt</span><span><i className="w18-tlbar--wait" />Chờ BOD duyệt</span><span><i className="w18-tlbar--draft" />Nháp</span><span><i className="w18-today-k" />Hôm nay</span>
                </div>
              </div>
            ) : <div className="demo-muted">Chưa có campaign nào trong 6 tháng tới.</div>}
          </Card>

          <DataTable rows={camps} rowKey="id" onRowClick={(c) => select(c.id, c)} itemLabel="campaign"
            empty={<EmptyState icon="star" title="Chưa có campaign" body={isMkt ? 'Bấm "Tạo campaign" để tạo bản nháp đầu tiên, sau đó gửi BOD duyệt.' : 'Marketing tạo campaign, BOD duyệt.'} action={isMkt ? <Button variant="primary" icon="plus" onClick={() => select('new')}>Tạo campaign</Button> : undefined} />}
            columns={[
              { key: 'name', label: 'Campaign', primary: true, render: (c) => <div className="w18-namecell"><div className={'demo-strong' + (cur?.id === c.id ? ' w18-sel' : '')}>{c.name}</div><div className="demo-sub">{c.id} · {scopeLabel(c.scope)}</div></div> },
              { key: 'offer', label: 'Ưu đãi', render: (c) => offer(c) },
              { key: 'time', label: 'Thời gian', render: (c) => `${date(c.fromDate)} – ${date(c.toDate)}` },
              { key: 'used', label: 'Đã phát / ngân sách', align: 'right', render: (c) => <div>{num(c.used)} / {c.budget ? num(c.budget) : '—'}{c.budget > 0 && c.used > c.budget && <div className="demo-sub w18-over">vượt {Math.round((c.used / c.budget - 1) * 100)}%</div>}</div> },
              { key: 'status', label: 'Trạng thái', render: (c) => <StatusBadge tone={TONE[c.status] ?? 'neutral'}>{c.status}</StatusBadge> },
            ]} />

          <div ref={detailRef} className="w18-detail">
            {(cur || creating) && (
              <Card title={creating ? 'Campaign mới' : cur!.name} subtitle={creating ? 'Bản nháp · chưa lưu' : `${cur!.id} · ${cur!.status}`}
                actions={cur && !creating ? <StatusBadge tone={TONE[cur.status] ?? 'neutral'}>{cur.status}</StatusBadge> : undefined}>
                <div className="demo-grid">
                  {cur && !creating && <ApprovalStepper steps={steps(cur)} />}
                  {editing ? editor : readView}
                  {est}
                  {conflicts.length > 0 && <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Trùng thời gian và sản phẩm với campaign nhân điểm {conflicts.map((c) => `${c.id} (${c.name})`).join(', ')}. Không để 2 campaign nhân điểm chồng lên cùng một SP — hệ thống chỉ lấy hệ số cao nhất.</div>}
                  {cur && cur.status === 'Chờ BOD duyệt' && !isBod && <div className="demo-note demo-note--muted"><Icon name="clock" size={16} />Đang chờ BOD duyệt{pendingAp ? ` (${pendingAp.id}, hạn ${dateTime(pendingAp.dueAt)})` : ''}. {isMkt ? 'Không sửa được khi đang chờ duyệt.' : `Vai trò ${ROLE_LABEL[role]} chỉ xem.`}</div>}
                  {cur && cur.status === 'Chờ BOD duyệt' && isBod && !pendingAp && !pendQ.isLoading && <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Không tìm thấy yêu cầu duyệt tương ứng trong W13.</div>}
                  {rejecting && (
                    <div className="demo-grid w18-reject">
                      <Field as="textarea" label="Lý do trả lại" required value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} error={rejectNote.trim() ? undefined : 'Bắt buộc ghi lý do'} placeholder="Ví dụ: Ngân sách vượt kế hoạch quý, giảm còn 25.000 điểm" />
                      <div className="demo-row"><Button onClick={() => setRejecting(false)}>Huỷ</Button><Button variant="danger" disabled={!rejectNote.trim() || decide.isPending} onClick={() => decide.mutate({ ok: false, note: rejectNote.trim() })}>Xác nhận trả lại</Button></div>
                    </div>
                  )}
                  {!isMkt && !isBod && <div className="demo-sub">Marketing tạo và sửa campaign; BOD duyệt. Vai trò {ROLE_LABEL[role]} chỉ xem.</div>}
                  {actionsRow}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {stopping && cur && (
        <QuickView title={`Dừng sớm ${cur.id}?`} onClose={() => setStopping(false)}
          footer={<><Button onClick={() => setStopping(false)}>Huỷ</Button><Button variant="danger" disabled={stop.isPending} onClick={() => stop.mutate(cur.id)}>Xác nhận dừng</Button></>}>
          <div className="demo-grid">
            <b>{cur.name}</b>
            <div className="demo-muted">Campaign kết thúc ngay hôm nay. Hệ số/điểm thưởng không áp dụng cho đơn mới; điểm đã phát ({num(cur.used)} điểm) giữ nguyên, không hồi tố.</div>
          </div>
        </QuickView>
      )}
    </AdminShell>
  );
}
