import { useRef, useState } from 'react';
import { can, TIER_NAME, TIER_ORDER, type Tier } from '@dmp/shared';
import { Button, Card, EmptyState, Field, Icon, QuickView, StatusBadge, Tabs, TierBadge, type IconName } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { api, fileUrl, uploadFile } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi, useToast } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { mil, num } from '../../lib/fmt';
import type { Gift as BaseGift, RuleSet } from '../../lib/types';
import './W16GiftCatalog.css';

const TYPES = ['Hàng hoá', 'Voucher', 'Trừ tiền hàng', 'Du lịch'];
const TYPE_ICON: Record<string, IconName> = { 'Hàng hoá': 'gift', Voucher: 'wallet', 'Trừ tiền hàng': 'wallet', 'Du lịch': 'send' };
const STATUSES = ['Đang mở', 'Sắp mở', 'Hết hàng', 'Tạm ẩn'];
const STT: Record<string, 'success' | 'info' | 'danger' | 'neutral' | 'pending'> = { 'Đang mở': 'success', 'Sắp mở': 'info', 'Hết hàng': 'danger', 'Tạm ẩn': 'neutral', 'Chờ BOD duyệt': 'pending' };
/** Quà có giá trị từ ngưỡng này: thêm mới hoặc đổi điểm/giá trị phải chờ BOD duyệt (server quyết định). */
const BIG = 10_000_000;
const PENDING = 'Chờ BOD duyệt';
type Gift = BaseGift & { imageFileId?: string | null };
type SaveRes = { id: string; status: string; approvalId?: string };
const tierLabel = (t: string | null) => (!t ? 'Tất cả hạng' : 'Từ ' + TIER_NAME[t as Tier]);

interface Draft { name: string; type: string; minTier: string; points: string; value: string; stock: string; window: string; status: string; tag: string; imageFileId: string | null }
const toDraft = (g: Gift | null): Draft => ({
  name: g?.name ?? '', type: g?.type ?? 'Hàng hoá', minTier: g?.minTier ?? '', points: g ? String(g.points) : '', value: g ? String(g.value) : '',
  stock: g?.stock == null ? '' : String(g.stock), window: g?.window ?? '', status: g?.status ?? 'Đang mở', tag: g?.tag ?? '', imageFileId: g?.imageFileId ?? null,
});
const digits = (s: string) => Number(s.replace(/\D/g, ''));

/** W16 Danh mục quà — lưới quà theo loại, Marketing thêm/sửa quà (điểm, hạng, tồn, thời gian mở đổi). */
export default function W16GiftCatalog() {
  const { user } = useSession();
  const role = user!.role;
  const edit = can(role, 'gifts.manage');
  const canStock = can(role, 'gifts.stock');
  const [stockOf, setStockOf] = useState<Gift | null>(null);
  const q = useApi<Gift[]>('/gifts');
  const rules = useApi<{ active: RuleSet }>(can(role, 'rules.view') ? '/rules' : null);
  const [type, setType] = useState('Tất cả');
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const gifts = q.data ?? [];
  const shown = gifts.filter((g) => type === 'Tất cả' || g.type === type);
  const cur = adding ? null : gifts.find((g) => g.id === sel) ?? shown[0] ?? null;
  const params = rules.data?.active?.params;

  return (
    <AdminShell screen="W16" crumb="Quà tặng"
      sub={`Marketing quản lý danh mục, điểm đổi, hạng được đổi · quà ≥ 10 triệu cần BOD duyệt${canStock ? ' · Kho/Marketing cập nhật tồn' : ' · các vai trò khác chỉ xem'}`}
      actions={edit ? <Button variant="primary" icon="plus" onClick={() => { setAdding(true); setSel(null); }}>Thêm quà</Button> : null}>
      <div className="demo-between">
        <Tabs variant="pill" value={type} onChange={setType} items={['Tất cả', ...TYPES].map((x) => ({ key: x, label: x, count: x === 'Tất cả' ? undefined : gifts.filter((g) => g.type === x).length }))} />
        <span className="demo-muted">{shown.length} quà{params ? ` · đổi tối thiểu ${num(params.minRedeem)} điểm · 1 điểm = ${num(params.pointValueVND)}đ` : ''}</span>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="w16-layout">
          {!shown.length ? (
            <Card><EmptyState icon="gift" title="Chưa có quà trong nhóm này" body={edit ? 'Bấm Thêm quà để tạo quà đầu tiên.' : 'Marketing sẽ cập nhật danh mục.'} action={edit ? <Button icon="plus" onClick={() => setAdding(true)}>Thêm quà</Button> : undefined} /></Card>
          ) : (
            <div className="w16-grid">
              {shown.map((g) => (
                <button type="button" key={g.id} className={'w16-gc' + (cur?.id === g.id ? ' is-on' : '')} onClick={() => { setSel(g.id); setAdding(false); }}>
                  <div className="w16-gc__img">
                    {g.imageFileId ? <img src={fileUrl(g.imageFileId)} alt="" className="w16-gc__pic" /> : <Icon name={TYPE_ICON[g.type] ?? 'gift'} size={36} strokeWidth={1.4} />}
                    <span className="w16-gc__tag">{g.tag && <StatusBadge tone="new">{g.tag}</StatusBadge>}<StatusBadge tone={STT[g.status] ?? 'neutral'}>{g.status}</StatusBadge></span>
                  </div>
                  <div className="w16-gc__b">
                    <span className="w16-gc__n">{g.name}</span>
                    <span className="w16-gc__p">{num(g.points)} điểm <span className="demo-sub">· {mil(g.value)}</span></span>
                    <span className="w16-gc__m">
                      <span>{g.minTier ? <TierBadge tier={g.minTier as Tier} label={tierLabel(g.minTier)} /> : 'Tất cả hạng'}</span>
                      <span>{g.stock == null ? 'Không giới hạn' : 'Còn ' + num(g.stock)}</span>
                    </span>
                    <span className="w16-gc__m"><span>{g.window || 'Luôn mở'}</span><span>Đã đổi {num(g.redeemed ?? 0)}</span></span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <GiftForm key={(cur?.id ?? 'new') + ':' + (cur?.status ?? '') + ':' + (cur?.stock ?? '')} gift={cur} edit={edit} canStock={canStock} onStock={setStockOf} onSaved={(id) => { setAdding(false); setSel(id); }} />
        </div>
      )}
      {stockOf && <StockDialog gift={stockOf} onClose={() => setStockOf(null)} />}
    </AdminShell>
  );
}

function GiftForm({ gift, edit, canStock, onStock, onSaved }: { gift: Gift | null; edit: boolean; canStock: boolean; onStock: (g: Gift) => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => toDraft(gift));
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const value = digits(d.value) || digits(d.points) * 1000;
  const body = () => ({
    name: d.name.trim(), type: d.type, minTier: d.minTier || null, points: digits(d.points), value,
    ...(gift ? {} : { stock: d.stock.trim() === '' ? null : digits(d.stock) }),
    window: d.window.trim(), status: d.status, tag: d.tag.trim() || null, imageFileId: d.imageFileId,
  });
  const save = useAction(() => (gift ? api.put<SaveRes>(`/gifts/${gift.id}`, body()) : api.post<SaveRes>('/gifts', body())), {
    success: (r) => (r.status === PENDING
      ? { tone: 'pending', title: `Quà ${r.id} đang chờ BOD duyệt${r.approvalId ? ` (${r.approvalId})` : ''}`, body: 'Quà ≥ 10 triệu cần BOD duyệt — thay đổi điểm/giá trị áp dụng sau khi duyệt ở W13.' }
      : { tone: 'success', title: gift ? `Đã lưu quà ${r.id}` : `Đã thêm quà ${r.id}`, body: d.name }),
    onDone: (r) => onSaved(r.id),
  });
  const pending = gift?.status === PENDING;
  const ro = !edit || pending;
  const valid = d.name.trim() && digits(d.points) > 0 && d.type;
  const big = value >= BIG;
  const moneyChanged = !gift || digits(d.points) !== gift.points || value !== gift.value;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try { const up = await uploadFile(f); setD((x) => ({ ...x, imageFileId: up.id })); }
    catch (e) { toast({ tone: 'danger', title: 'Không tải được ảnh', body: (e as Error).message }); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <Card title={gift ? (edit && !pending ? 'Sửa quà ' : 'Quà ') + gift.id : 'Thêm quà mới'}
      subtitle={pending ? 'Đang chờ BOD duyệt — chưa sửa được' : edit ? 'Lưu xong áp dụng ngay trên app đại lý (trừ quà ≥ 10 triệu)' : canStock ? 'Kho cập nhật tồn · thông tin khác do Marketing quản lý' : 'Vai trò này chỉ xem'}
      actions={gift && canStock ? <Button icon="box" onClick={() => onStock(gift)}>Cập nhật tồn</Button> : undefined}>
      <div className="w16-drawer">
        {pending && <div className="demo-note"><Icon name="clock" size={16} />Quà ≥ 10 triệu cần BOD duyệt. Yêu cầu đang ở Hàng chờ duyệt (W13); sau khi BOD duyệt quà mới mở đổi.</div>}
        {edit && !ro ? (
          <button type="button" className="w16-photo" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {d.imageFileId ? <img src={fileUrl(d.imageFileId)} alt="Ảnh quà" className="w16-photo__img" /> : <><Icon name="image" size={26} />{uploading ? 'Đang tải ảnh…' : 'Tải ảnh quà (PNG, JPG, WEBP ≤ 15MB)'}</>}
            {d.imageFileId && <span className="w16-photo__chg">{uploading ? 'Đang tải…' : 'Đổi ảnh'}</span>}
          </button>
        ) : (
          <div className="w16-photo">{d.imageFileId ? <img src={fileUrl(d.imageFileId)} alt="Ảnh quà" className="w16-photo__img" /> : <><Icon name="image" size={26} />Chưa có ảnh quà</>}</div>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <Field label="Tên quà" required value={d.name} onChange={set('name')} readOnly={ro} />
        <div className="w16-two">
          <Field label="Loại" as="select" value={d.type} onChange={set('type')} options={TYPES} disabled={ro} />
          <Field label="Hạng được đổi" as="select" value={d.minTier} onChange={set('minTier')} disabled={ro}
            options={[{ value: '', label: 'Tất cả' }, ...TIER_ORDER.filter((t) => t !== 'member').map((t) => ({ value: t, label: 'Từ ' + TIER_NAME[t] }))]} />
        </div>
        <div className="w16-two">
          <Field label="Số điểm" required value={d.points} onChange={set('points')} suffix="điểm" inputMode="numeric" readOnly={ro} />
          <Field label="Giá trị" value={d.value} onChange={set('value')} suffix="đ" inputMode="numeric" readOnly={ro} hint={big ? 'Quà ≥ 10 triệu cần BOD duyệt' : 'Hàng hoá quy theo giá bán'} />
        </div>
        <div className="w16-two">
          {gift
            ? <Field label="Tồn kho" value={gift.stock == null ? 'Không giới hạn' : num(gift.stock)} readOnly hint={canStock ? 'Sửa bằng nút Cập nhật tồn' : undefined} />
            : <Field label="Số lượng giới hạn" value={d.stock} onChange={set('stock')} placeholder="Không giới hạn" inputMode="numeric" readOnly={ro} />}
          <Field label="Thời gian mở đổi" value={d.window} onChange={set('window')} placeholder="Luôn mở" readOnly={ro} />
        </div>
        <div className="w16-two">
          {pending
            ? <Field label="Trạng thái" value={PENDING} readOnly />
            : <Field label="Trạng thái" as="select" value={d.status} onChange={set('status')} options={STATUSES} disabled={ro} />}
          <Field label="Nhãn" value={d.tag} onChange={set('tag')} placeholder="VD: Mới" readOnly={ro} />
        </div>
        {edit && !ro && big && moneyChanged && <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Quà ≥ 10 triệu cần BOD duyệt: sau khi lưu, quà chuyển "Chờ BOD duyệt" cho tới khi BOD duyệt.</div>}
        {edit && !ro && <Button variant="primary" icon={big && moneyChanged ? 'send' : 'check'} disabled={!valid || save.isPending || uploading} onClick={() => save.mutate()}>{big && moneyChanged ? 'Lưu và gửi BOD duyệt' : gift ? 'Lưu thay đổi' : 'Thêm quà'}</Button>}
      </div>
    </Card>
  );
}

/** Kho/Marketing cập nhật tồn (nhập thêm, kiểm kê) — ghi nhật ký kèm ghi chú. */
function StockDialog({ gift, onClose }: { gift: Gift; onClose: () => void }) {
  const [stock, setStock] = useState(gift.stock == null ? '' : String(gift.stock));
  const [note, setNote] = useState('');
  const save = useAction(() => api.patch<{ id: string; stock: number | null; status: string }>(`/gifts/${gift.id}/stock`, { stock: stock.trim() === '' ? null : digits(stock), note: note.trim() || undefined }), {
    success: (r) => ({ tone: 'success', title: `Đã cập nhật tồn ${r.id}: ${r.stock == null ? 'không giới hạn' : num(r.stock)}`, body: r.status === 'Hết hàng' ? 'Quà chuyển Hết hàng — app đại lý tạm khoá đổi.' : undefined }),
    onDone: onClose,
  });
  return (
    <QuickView title={'Cập nhật tồn · ' + gift.name} onClose={onClose}
      footer={<><Button onClick={onClose}>Đóng</Button><Button variant="primary" icon="check" disabled={save.isPending} onClick={() => save.mutate()}>Lưu tồn kho</Button></>}>
      <div className="w16-drawer">
        <div className="demo-sub">Hiện tại: {gift.stock == null ? 'không giới hạn' : num(gift.stock)} · đã đổi {num(gift.redeemed ?? 0)}</div>
        <Field label="Tồn kho mới" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Để trống = không giới hạn" inputMode="numeric" hint="Nhập 0 thì quà chuyển Hết hàng" />
        <Field label="Ghi chú" as="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Nhập thêm 20 cái theo phiếu NK-1102" />
      </div>
    </QuickView>
  );
}
