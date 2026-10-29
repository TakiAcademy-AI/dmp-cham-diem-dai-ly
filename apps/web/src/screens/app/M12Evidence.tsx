import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApprovalStepper, Button, EmptyState, Field, Icon, PointValue, StatusBadge, Tabs, type ApprovalStep, type IconName } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { appApi, fileUrl, uploadFile } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi, useToast } from '../../lib/hooks';
import { date, num } from '../../lib/fmt';
import './M12Evidence.css';

interface Cat { key: string; name: string; points: number; cap: string; needSale: boolean; usedThisMonth: number; countThisMonth: number; monthlyCap: number | null; perMonth: number | null }
interface HistoryStep { stage: string; by: string; at: string; note?: string }
interface Item { id: string; category: string; points: number; link: string; fileIds: string[]; note: string; stage: string; history: HistoryStep[]; createdAt: string }
interface EvidenceRes { categories: Cat[]; items: Item[] }

const ICON: Record<string, IconName> = { post: 'link', display: 'image', shop: 'home' };
const MAX_PHOTOS = 6;

/** Hạng mục đã chạm trần trong tháng (server vẫn chặn lần nữa). */
function isFull(c: Cat) {
  if (c.monthlyCap != null && c.usedThisMonth + c.points > c.monthlyCap) return true;
  if (c.perMonth != null && c.countThisMonth >= c.perMonth) return true;
  return false;
}
function capText(c: Cat) {
  if (c.monthlyCap != null) return `Tối đa ${num(c.monthlyCap)} điểm/tháng · đã dùng ${num(c.usedThisMonth)}`;
  if (c.perMonth != null) return `${c.perMonth} lần/tháng${c.needSale ? ' · Sale xác nhận trước' : ''}`;
  return c.key === 'shop' ? 'Mỗi điểm bán · cần địa chỉ + ảnh mặt tiền' : c.needSale ? 'Sale xác nhận trước' : '';
}
function stageTone(s: string) {
  return s === 'Đã duyệt' ? 'success' : s === 'Từ chối' ? 'danger' : 'pending';
}
function stageLabel(s: string) { return s === 'Đã duyệt' ? 'Đã duyệt' : s === 'Từ chối' ? 'Từ chối' : 'Chờ duyệt'; }

/** Lịch sử thực tế + các bước còn lại theo trạng thái hiện tại. */
function steps(it: Item): ApprovalStep[] {
  const done: ApprovalStep[] = it.history.map((h) => ({
    label: h.stage, actor: h.by, time: h.at, note: h.note,
    status: /không|từ chối/i.test(h.stage) ? 'rejected' : 'done',
  }));
  const pts = `Cộng +${num(it.points)} điểm`;
  if (it.stage === 'Chờ Sale xác nhận') return [...done, { label: 'Sale xác nhận tại điểm bán', status: 'current' }, { label: 'Marketing duyệt', status: 'todo' }, { label: pts, status: 'todo' }];
  if (it.stage === 'Chờ Marketing duyệt') return [...done, { label: 'Marketing duyệt', status: 'current' }, { label: pts, status: 'todo' }];
  if (it.stage === 'Đã duyệt') return [...done, { label: `Đã cộng +${num(it.points)} điểm thưởng`, status: 'done' }];
  return done;
}

/** M12 Nộp bằng chứng hoạt động — chọn hạng mục, dán link / chụp ảnh, theo dõi trạng thái duyệt. */
export default function M12Evidence() {
  const nav = useNavigate();
  const toast = useToast();
  const q = useApi<EvidenceRes>('/app/evidence', { realm: 'app' });
  const [tab, setTab] = useState('form');
  const [catKey, setCatKey] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<Array<{ id: string; name: string }>>([]);
  const [uploading, setUploading] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const cats = q.data?.categories ?? [];
  const items = q.data?.items ?? [];
  const firstOpen = cats.find((c) => !isFull(c))?.key ?? cats[0]?.key ?? null;
  const cur = cats.find((c) => c.key === (catKey ?? firstOpen));
  const needLink = cur?.key === 'post';
  const linkOk = /^https?:\/\//.test(link.trim());

  const submit = useAction(() => appApi.post<{ id: string; stage: string; points: number }>('/app/evidence', {
    category: cur!.key, link: needLink ? link.trim() : undefined, fileIds: photos.map((p) => p.id), note: note.trim() || undefined,
  }), {
    realm: 'app',
    success: (r) => ({ tone: 'success', title: `Đã nộp ${r.id}`, body: `${r.stage}. Điểm +${num(r.points)} được cộng sau khi Marketing duyệt.` }),
    onDone: (r) => { setLink(''); setNote(''); setPhotos([]); setOpen(r.id); setTab('sent'); },
  });

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list).slice(0, MAX_PHOTOS - photos.length);
    setUploading((n) => n + files.length);
    for (const f of files) {
      try {
        const up = await uploadFile(f, 'app');
        setPhotos((p) => [...p, { id: up.id, name: up.name }]);
      } catch (e) {
        toast({ tone: 'danger', title: 'Không tải được ảnh', body: (e as Error).message });
      } finally { setUploading((n) => n - 1); }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  const full = cur ? isFull(cur) : false;
  const canSend = !!cur && !full && !uploading && !submit.isPending && (needLink ? linkOk : photos.length > 0);
  const pendingCount = items.filter((i) => i.stage.startsWith('Chờ')).length;

  let body;
  if (q.isLoading) body = <Loading />;
  else if (q.error) body = <ErrorNote error={q.error} />;
  else if (tab === 'form') body = (
    <>
      <b className="m12-h">1. Chọn hạng mục</b>
      <div className="m12-cats">
        {cats.map((c) => {
          const on = cur?.key === c.key;
          const f = isFull(c);
          return (
            <button type="button" key={c.key} className={'m12-cat' + (on ? ' is-on' : '') + (f ? ' is-full' : '')} aria-pressed={on} onClick={() => setCatKey(c.key)}>
              <span className="m12-cat__ic"><Icon name={ICON[c.key] ?? 'file'} size={22} /></span>
              <span className="m12-cat__m"><b>{c.name}</b><span>{capText(c)}</span>{f && <em>Đã đủ trong tháng này</em>}</span>
              <PointValue value={c.points} />
            </button>
          );
        })}
      </div>
      {cur && full ? (
        <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Hạng mục “{cur.name}” đã đạt giới hạn tháng này. Chọn hạng mục khác hoặc nộp lại vào tháng sau.</div>
      ) : cur && (
        <>
          <b className="m12-h">2. {needLink ? 'Dán link bài đăng' : 'Chụp hoặc chọn ảnh'}</b>
          {needLink ? (
            <Field size="lg" label="Link bài viết Facebook / Zalo / TikTok" inputMode="url" placeholder="https://facebook.com/…" value={link} onChange={(e) => setLink(e.target.value)}
              error={link && !linkOk ? 'Link phải bắt đầu bằng http:// hoặc https://' : undefined}
              hint="Bài phải để chế độ công khai và có hình sản phẩm DMP" />
          ) : (
            <>
              <div className="m12-photos">
                {photos.map((p) => (
                  <div key={p.id} className="m12-ph">
                    <img src={fileUrl(p.id, 'app')} alt={p.name} />
                    <button type="button" className="m12-ph__x" aria-label={'Bỏ ảnh ' + p.name} onClick={() => setPhotos((l) => l.filter((x) => x.id !== p.id))}><Icon name="x" size={18} /></button>
                  </div>
                ))}
                {Array.from({ length: uploading }).map((_, i) => <div key={'u' + i} className="m12-ph m12-ph--wait">Đang tải…</div>)}
                {photos.length + uploading < MAX_PHOTOS && (
                  <button type="button" className="m12-ph m12-ph--add" onClick={() => fileRef.current?.click()}>
                    <Icon name="plus" size={26} /><span>Thêm ảnh</span>
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addFiles(e.target.files)} />
              <span className="m12-cap">{cur.key === 'shop' ? 'Chụp rõ mặt tiền điểm bán, ghi địa chỉ ở phần ghi chú' : 'Chụp rõ quầy, thấy nhãn sản phẩm'} · tối đa {MAX_PHOTOS} ảnh</span>
            </>
          )}
          <Field as="textarea" size="lg" label={cur.key === 'shop' ? 'Địa chỉ điểm bán & ghi chú' : 'Ghi chú (không bắt buộc)'} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={cur.key === 'shop' ? 'Ví dụ: 12 Lê Lợi, P. Bến Nghé, Q.1' : 'Ví dụ: quầy mới bố trí cạnh cửa ra vào'} />
          {cur.needSale && <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Sale phụ trách sẽ xác nhận tại điểm bán trước, sau đó Marketing duyệt và cộng điểm.</div>}
          <Button variant="primary" size="lg" block icon="send" disabled={!canSend} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Đang nộp…' : uploading ? 'Đang tải ảnh…' : 'Nộp để duyệt'}
          </Button>
        </>
      )}
    </>
  );
  else body = items.length ? items.map((it) => {
    const cat = cats.find((c) => c.key === it.category);
    const isOpen = open === it.id;
    return (
      <div key={it.id} className="demo-acard m12-item">
        <button type="button" className="m12-item__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.id)}>
          <span className="m12-cat__ic"><Icon name={ICON[it.category] ?? 'file'} size={20} /></span>
          <span className="m12-item__m"><b>{cat?.name ?? it.category}</b><span>{it.id} · {date(it.createdAt)}</span></span>
          <span className="m12-item__r">
            <StatusBadge tone={stageTone(it.stage)}>{stageLabel(it.stage)}</StatusBadge>
            {it.stage !== 'Từ chối' && <PointValue value={it.points} state={it.stage === 'Đã duyệt' ? 'available' : 'pending'} />}
          </span>
        </button>
        {isOpen && (
          <div className="m12-item__body">
            {it.link && <a className="demo-link m12-linkout" href={it.link} target="_blank" rel="noreferrer"><Icon name="link" size={16} />{it.link}</a>}
            {it.note && <div className="m12-note">{it.note}</div>}
            {it.fileIds.length > 0 && (
              <div className="m12-photos">{it.fileIds.map((id) => <a key={id} className="m12-ph" href={fileUrl(id, 'app')} target="_blank" rel="noreferrer"><img src={fileUrl(id, 'app')} alt="Ảnh bằng chứng" /></a>)}</div>
            )}
            <ApprovalStepper orientation="vertical" steps={steps(it)} />
          </div>
        )}
      </div>
    );
  }) : (
    <EmptyState icon="upload" title="Chưa nộp bằng chứng nào" body="Đăng bài, trưng bày đạt chuẩn hay mở điểm bán mới đều được cộng điểm thưởng."
      action={<Button variant="primary" size="lg" icon="plus" onClick={() => setTab('form')}>Nộp bằng chứng</Button>} />
  );

  return (
    <PhoneFrame title="Nộp bằng chứng" back
      headRight={<button type="button" className="m12-kit" onClick={() => nav('/app/saleskit')}><Icon name="book" size={20} />Mẫu bài</button>}>
      <Tabs value={tab} onChange={setTab} items={[{ key: 'form', label: 'Nộp mới', icon: 'plus' }, { key: 'sent', label: 'Đã nộp', icon: 'history', count: pendingCount || undefined }]} />
      {body}
    </PhoneFrame>
  );
}
