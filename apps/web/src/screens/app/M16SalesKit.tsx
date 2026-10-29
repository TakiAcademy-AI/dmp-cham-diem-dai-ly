import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, Icon, StatusBadge, Tabs, type IconName } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { appApi, fileUrl } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { tierName } from '../../lib/fmt';
import './M16SalesKit.css';

interface Doc { id: string; title: string; category: string; kind: 'file' | 'image' | 'video' | 'link'; sizeLabel: string; minTier: string | null; locked: boolean; createdAt: string }
interface EvidenceLite { categories: Array<{ key: string; points: number }> }

const KIND: Record<Doc['kind'], { icon: IconName; action: string; done: string }> = {
  file: { icon: 'file', action: 'Tải về', done: 'Đã tải' },
  image: { icon: 'image', action: 'Tải ảnh', done: 'Đã tải' },
  video: { icon: 'eye', action: 'Xem video', done: 'Đã mở' },
  link: { icon: 'link', action: 'Mở mẫu bài', done: 'Đã mở' },
};

/** URL file nội bộ cần gắn token (?t=) để mở được ngoài fetch. */
function resolveUrl(url: string) {
  const m = url.match(/^\/api\/files\/([^/?#]+)/);
  return m ? fileUrl(m[1], 'app') : url;
}

/** M16 Tài liệu bán hàng — bảng giá, ảnh, video, mẫu bài đăng; một số tài liệu chỉ mở cho hạng cao hơn. */
export default function M16SalesKit() {
  const nav = useNavigate();
  const q = useApi<Doc[]>('/app/saleskit', { realm: 'app' });
  const ev = useApi<EvidenceLite>('/app/evidence', { realm: 'app' });
  const [flt, setFlt] = useState('all');
  const [got, setGot] = useState<Record<string, boolean>>({});

  const dl = useAction(async (d: Doc) => {
    // Mở tab ngay trong lúc người dùng bấm để trình duyệt không chặn popup, rồi gán URL khi có.
    const w = window.open('', '_blank');
    try {
      const r = await appApi.post<{ url: string }>(`/app/saleskit/${d.id}/download`);
      if (!r.url) throw new Error('Tài liệu chưa có file hoặc đường dẫn');
      const url = resolveUrl(r.url);
      if (w) w.location.href = url; else window.location.href = url;
      return r;
    } catch (e) { w?.close(); throw e; }
  }, { realm: 'app', invalidate: ['/app/saleskit'], onDone: (_r, d) => setGot((g) => ({ ...g, [d.id]: true })) });

  const docs = q.data ?? [];
  const cats = [...new Set(docs.map((d) => d.category))];
  const list = docs.filter((d) => flt === 'all' || d.category === flt);
  const postPts = ev.data?.categories.find((c) => c.key === 'post')?.points;
  const showPostTip = list.some((d) => d.category === 'Mẫu bài');

  return (
    <PhoneFrame title="Tài liệu bán hàng" back>
      <div className="m16-tabs"><Tabs variant="pill" value={flt} onChange={setFlt} items={[{ key: 'all', label: 'Tất cả' }, ...cats.map((c) => ({ key: c, label: c }))]} /></div>
      {showPostTip && (
        <button type="button" className="m16-tip" onClick={() => nav('/app/evidence')}>
          <Icon name="send" size={20} />
          <span>Đăng bài theo mẫu rồi nộp link để nhận {postPts ? <b>+{postPts} điểm</b> : 'điểm thưởng'}</span>
          <Icon name="chevronRight" size={18} />
        </button>
      )}
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : list.length ? (
        <div className="m16-grid">
          {list.map((d) => {
            const k = KIND[d.kind] ?? KIND.file;
            const done = got[d.id];
            return (
              <div key={d.id} className={'m16-doc' + (d.locked ? ' is-locked' : '')}>
                <div className="m16-doc__img">
                  <Icon name={d.locked ? 'lock' : k.icon} size={34} strokeWidth={1.4} />
                  <span className="m16-doc__tag"><StatusBadge tone="neutral" icon={null}>{d.category}</StatusBadge></span>
                </div>
                <div className="m16-doc__b">
                  <b>{d.title}</b>
                  <span className="m16-sub">{d.sizeLabel}</span>
                  {d.locked ? (
                    <Button size="lg" block icon="lock" disabled>Từ hạng {tierName(d.minTier ?? '')}</Button>
                  ) : (
                    <Button size="lg" block icon={done ? 'check' : d.kind === 'file' || d.kind === 'image' ? 'download' : k.icon}
                      disabled={dl.isPending && dl.variables?.id === d.id} onClick={() => dl.mutate(d)}>
                      {dl.isPending && dl.variables?.id === d.id ? 'Đang mở…' : done ? k.done : k.action}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="book" title={flt === 'all' ? 'Chưa có tài liệu' : 'Chưa có tài liệu ở nhóm này'} body="Marketing sẽ cập nhật bảng giá, hình ảnh và mẫu bài đăng mới tại đây."
          action={flt !== 'all' ? <Button size="lg" onClick={() => setFlt('all')}>Xem tất cả</Button> : undefined} />
      )}
    </PhoneFrame>
  );
}
