import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApprovalStepper, Button, EmptyState, Field, Icon, PointValue, StatusBadge, Tabs, type ApprovalStep, type StatusBadgeProps } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { appApi, fileUrl, uploadFile } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi, useToast } from '../../lib/hooks';
import { date, num } from '../../lib/fmt';
import type { LedgerRow } from '../../lib/types';
import './M15Complaint.css';

interface HistoryStep { stage: string; by: string; at: string; note?: string }
interface Complaint {
  id: string; ledgerId: number | null; ref: string; txLabel: string; claim: string; wantPoints: number; fileIds: string[];
  status: string; assignee: string | null; resolution: string | null; dueAt: string; history: HistoryStep[]; createdAt: string;
}

const OPEN = ['Mới', 'Đang xử lý', 'Chờ duyệt điều chỉnh'];
const TONE: Record<string, StatusBadgeProps['tone']> = { 'Mới': 'new', 'Đang xử lý': 'info', 'Chờ duyệt điều chỉnh': 'pending', 'Đã giải quyết': 'success', 'Từ chối': 'danger' };
const ISSUES = ['Thiếu điểm', 'Sai hệ số / campaign', 'Điểm hết hạn không được nhắc', 'Thu hồi điểm sai', 'Khác'];
const STAGE_LABEL: Record<string, string> = { 'Mới': 'Đã gửi khiếu nại', 'Đang xử lý': 'Kế toán tiếp nhận' };
const MAX_PHOTOS = 3;
const delta = (l: LedgerRow) => (l.deltaReward !== 0 ? l.deltaReward : l.deltaRank);

function steps(c: Complaint): ApprovalStep[] {
  const done: ApprovalStep[] = c.history.map((h) => ({
    label: STAGE_LABEL[h.stage] ?? h.stage, actor: h.by, time: h.at, note: h.note,
    status: /từ chối|không duyệt/i.test(h.stage) ? 'rejected' : 'done',
  }));
  const adjust: ApprovalStep = { label: 'Điều chỉnh điểm (nếu đúng)', actor: 'BOD duyệt', status: 'todo' };
  const finish: ApprovalStep = { label: 'Hoàn tất', status: 'todo' };
  if (c.status === 'Mới') return [...done, { label: 'Kế toán kiểm tra', status: 'current' }, adjust, finish];
  if (c.status === 'Đang xử lý') return [...done, { label: 'Kế toán kiểm tra', actor: c.assignee ?? undefined, status: 'current' }, adjust, finish];
  if (c.status === 'Chờ duyệt điều chỉnh') return [...done, { label: 'BOD duyệt điều chỉnh', status: 'current' }, finish];
  if (c.status === 'Đã giải quyết') return [...done, { label: 'Hoàn tất', status: 'done' }];
  return done;
}

/** M15 Khiếu nại điểm — chọn giao dịch, mô tả, đính kèm ảnh; theo dõi tiến độ xử lý (SLA 3 ngày). Mở từ sổ điểm với ?ledgerId=. */
export default function M15Complaint() {
  const toast = useToast();
  const [sp] = useSearchParams();
  const preset = Number(sp.get('ledgerId')) || null;
  const q = useApi<Complaint[]>('/app/complaints', { realm: 'app' });
  const led = useApi<LedgerRow[]>('/app/ledger', { realm: 'app' });

  const [tabSel, setTab] = useState<string | null>(null);
  const [txSel, setTx] = useState<number>(preset ?? 0);
  const [showAll, setShowAll] = useState(false);
  const [issue, setIssue] = useState(ISSUES[0]);
  const [claim, setClaim] = useState('');
  const [want, setWant] = useState('');
  const [photos, setPhotos] = useState<Array<{ id: string; name: string }>>([]);
  const [uploading, setUploading] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = q.data ?? [];
  const openCount = list.filter((c) => OPEN.includes(c.status)).length;
  const tab = tabSel ?? (preset || !openCount ? 'form' : 'track');
  const busy = new Map(list.filter((c) => OPEN.includes(c.status) && c.ledgerId).map((c) => [c.ledgerId!, c.id]));
  const rows = led.data ?? [];
  const shown = showAll ? rows : rows.slice(0, 5);
  const presetRow = preset ? rows.find((r) => r.id === preset) : undefined;
  const visible = presetRow && !shown.includes(presetRow) ? [presetRow, ...shown] : shown;
  const selRow = rows.find((r) => r.id === txSel);
  /** Giao dịch không còn trong sổ (link cũ) → coi như không gắn giao dịch. */
  const tx = selRow ? txSel : 0;

  const send = useAction(() => appApi.post<{ id: string; status: string }>('/app/complaints', {
    ledgerId: tx || undefined, claim: `[${issue}] ${claim.trim()}`, wantPoints: Number(want) || undefined, fileIds: photos.map((p) => p.id),
  }), {
    realm: 'app',
    success: (r) => ({ tone: 'success', title: `Đã gửi khiếu nại ${r.id}`, body: 'Kế toán sẽ phản hồi trong 3 ngày làm việc.' }),
    onDone: (r) => { setClaim(''); setWant(''); setPhotos([]); setTx(0); setOpen(r.id); setTab('track'); },
  });

  async function addFiles(fl: FileList | null) {
    if (!fl?.length) return;
    const files = Array.from(fl).slice(0, MAX_PHOTOS - photos.length);
    setUploading((n) => n + files.length);
    for (const f of files) {
      try { const up = await uploadFile(f, 'app'); setPhotos((p) => [...p, { id: up.id, name: up.name }]); }
      catch (e) { toast({ tone: 'danger', title: 'Không tải được ảnh', body: (e as Error).message }); }
      finally { setUploading((n) => n - 1); }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  const claimShort = claim.trim().length < 10;
  const txBusy = tx ? busy.get(tx) : undefined;
  const canSend = !claimShort && !txBusy && !uploading && !send.isPending;

  let body;
  if (q.isLoading) body = <Loading />;
  else if (q.error) body = <ErrorNote error={q.error} />;
  else if (tab === 'form') body = (
    <>
      <b className="m15-h">1. Chọn giao dịch bị sai</b>
      {led.isLoading ? <Loading /> : led.error ? <ErrorNote error={led.error} /> : (
        <div className="m15-txs" role="radiogroup" aria-label="Giao dịch">
          {visible.map((l) => {
            const on = tx === l.id;
            const b = busy.get(l.id);
            return (
              <button type="button" role="radio" aria-checked={on} key={l.id} className={'m15-tx' + (on ? ' is-on' : '')} onClick={() => setTx(l.id)}>
                <span className="m15-tx__m"><span className="m15-tx__t">{l.item}</span><small>{date(l.createdAt)} · {l.ref || 'GD' + l.id}</small>{b && <em>Đang có khiếu nại {b}</em>}</span>
                <PointValue value={delta(l)} state={l.state} />
              </button>
            );
          })}
          {rows.length > 5 && !showAll && <Button size="lg" block onClick={() => setShowAll(true)}>Xem thêm {rows.length - 5} giao dịch</Button>}
          <button type="button" role="radio" aria-checked={tx === 0} className={'m15-tx' + (tx === 0 ? ' is-on' : '')} onClick={() => setTx(0)}>
            <span className="m15-tx__m"><span className="m15-tx__t">Không gắn giao dịch cụ thể</span><small>Ví dụ: thiếu hẳn một đơn hàng, không thấy điểm sự kiện</small></span>
          </button>
        </div>
      )}
      {txBusy && <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Giao dịch này đang có khiếu nại {txBusy}. Xem tiến độ ở tab “Theo dõi”.</div>}
      <b className="m15-h">2. Mô tả vấn đề</b>
      <Field as="select" size="lg" label="Loại vấn đề" value={issue} onChange={(e) => setIssue(e.target.value)} options={ISSUES} />
      <Field as="textarea" size="lg" label="Nội dung" required value={claim} onChange={(e) => setClaim(e.target.value)}
        placeholder={selRow ? `Ví dụ: ${selRow.ref || 'Giao dịch'} có sản phẩm đang chạy campaign nhưng không thấy nhân điểm` : 'Mô tả rõ điểm bị sai ở đâu'}
        hint={claim && claimShort ? 'Vui lòng mô tả ít nhất 10 ký tự' : 'Càng cụ thể (mã đơn, sản phẩm, số lượng) càng xử lý nhanh'} />
      <Field size="lg" label="Số điểm đề nghị điều chỉnh (không bắt buộc)" inputMode="numeric" value={want} onChange={(e) => setWant(e.target.value.replace(/[^\d-]/g, ''))} suffix="điểm" />
      {photos.length > 0 && (
        <div className="m15-photos">
          {photos.map((p) => (
            <div key={p.id} className="m15-ph">
              <img src={fileUrl(p.id, 'app')} alt={p.name} />
              <button type="button" className="m15-ph__x" aria-label={'Bỏ ảnh ' + p.name} onClick={() => setPhotos((l) => l.filter((x) => x.id !== p.id))}><Icon name="x" size={18} /></button>
            </div>
          ))}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
      {photos.length < MAX_PHOTOS && (
        <Button size="lg" block icon="image" disabled={!!uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? 'Đang tải ảnh…' : photos.length ? `Thêm ảnh (${photos.length}/${MAX_PHOTOS})` : 'Đính kèm ảnh (không bắt buộc)'}
        </Button>
      )}
      <div className="demo-note demo-note--muted"><Icon name="clock" size={16} />Kế toán phản hồi trong 3 ngày. Nếu đúng, DMP tạo yêu cầu điều chỉnh điểm để BOD duyệt.</div>
      <Button variant="primary" size="lg" block icon="send" disabled={!canSend} onClick={() => send.mutate()}>{send.isPending ? 'Đang gửi…' : 'Gửi khiếu nại'}</Button>
    </>
  );
  else body = list.length ? list.map((c) => {
    const isOpen = open === c.id || (open == null && c === list[0]);
    const late = OPEN.includes(c.status) && new Date(c.dueAt).getTime() < Date.now();
    return (
      <div key={c.id} className="demo-acard m15-item">
        <button type="button" className="m15-item__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : c.id)}>
          <span className="m15-item__m"><b>{c.id}{c.txLabel ? ' · ' + c.txLabel : ''}</b><span>Gửi {date(c.createdAt)}</span></span>
          <StatusBadge tone={TONE[c.status] ?? 'neutral'}>{c.status}</StatusBadge>
        </button>
        {OPEN.includes(c.status) && (
          <span className={'m15-due' + (late ? ' is-late' : '')}><Icon name={late ? 'alert' : 'clock'} size={16} />{late ? `Quá hạn phản hồi (${date(c.dueAt)}) — DMP đang ưu tiên xử lý` : `Dự kiến phản hồi trước ${date(c.dueAt)}`}</span>
        )}
        {isOpen && (
          <div className="m15-item__body">
            <div className="m15-claim">{c.claim}</div>
            {c.wantPoints !== 0 && <span className="m15-sub">Đề nghị điều chỉnh: <b>{c.wantPoints > 0 ? '+' : ''}{num(c.wantPoints)} điểm</b></span>}
            {c.fileIds.length > 0 && <div className="m15-photos">{c.fileIds.map((id) => <a key={id} className="m15-ph" href={fileUrl(id, 'app')} target="_blank" rel="noreferrer"><img src={fileUrl(id, 'app')} alt="Ảnh đính kèm" /></a>)}</div>}
            {c.resolution && <div className={'demo-note ' + (c.status === 'Từ chối' ? 'demo-note--danger' : 'demo-note--muted')}><Icon name="chat" size={16} /><span><b>Phản hồi của DMP:</b> {c.resolution}</span></div>}
            <ApprovalStepper orientation="vertical" steps={steps(c)} />
          </div>
        )}
      </div>
    );
  }) : (
    <EmptyState icon="chat" title="Chưa có khiếu nại nào" body="Thấy điểm bị sai? Gửi khiếu nại, Kế toán sẽ kiểm tra trong 3 ngày."
      action={<Button variant="primary" size="lg" icon="plus" onClick={() => setTab('form')}>Gửi khiếu nại</Button>} />
  );

  return (
    <PhoneFrame title="Khiếu nại điểm" back>
      <Tabs value={tab} onChange={setTab} items={[{ key: 'form', label: 'Gửi mới', icon: 'plus' }, { key: 'track', label: 'Theo dõi', icon: 'history', count: openCount || undefined }]} />
      {body}
    </PhoneFrame>
  );
}
