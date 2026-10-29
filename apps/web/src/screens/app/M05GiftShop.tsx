import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApprovalStepper, Button, Celebration, EmptyState, GiftCard, Icon, Tabs, type Tier } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { InfoGrid } from '../../shell/charts';
import { appApi, fileUrl } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime, num, tierName } from '../../lib/fmt';
import type { AppGift, PointSummary } from '../../lib/types';
import './M05GiftShop.css';

interface HomeLite { agent: { tier: Tier }; points: PointSummary; sale: { name: string; phone: string } }
/** Quà có thể kèm ảnh (W11 tải lên). */
type Gift = AppGift & { imageFileId?: string | null };
interface ProfileLite { address: string; city: string }
interface RedeemRes { id: string; stage: string; points: number; balance: number }

/** M05 Cửa hàng quà — số dư, lọc quà, chi tiết → xác nhận → gửi yêu cầu (chỉ chủ ĐL-C), chúc mừng. */
export default function M05GiftShop() {
  const nav = useNavigate();
  const { user } = useSession('app');
  const owner = user?.role === 'DLC';
  const q = useApi<Gift[]>('/app/gifts', { realm: 'app' });
  const home = useApi<HomeLite>('/app/home', { realm: 'app' });
  const [flt, setFlt] = useState('all');
  const [sel, setSel] = useState<Gift | null>(null);
  const profile = useApi<ProfileLite>(sel && owner ? '/app/profile' : null, { realm: 'app' });
  const shipTo = profile.data ? [profile.data.address, profile.data.city].filter(Boolean).join(', ') : '';
  const [stage, setStage] = useState<'detail' | 'confirm' | 'done'>('detail');
  const [done, setDone] = useState<(RedeemRes & { at: Date }) | null>(null);

  const redeem = useAction((g: Gift) => appApi.post<RedeemRes>('/app/redemptions', { giftId: g.id, qty: 1 }), {
    realm: 'app',
    onDone: (r) => { setDone({ ...r, at: new Date() }); setStage('done'); },
  });

  const bal = home.data?.points.reward ?? 0;
  const vndPerPoint = home.data?.points.vndPerPoint;
  const gifts = (q.data ?? []).filter((g) => g.status !== 'Hết hàng').filter((g) => {
    if (flt === 'can') return g.tierOk && g.shortfall === 0 && g.status === 'Đang mở';
    if (flt === 'voucher') return g.type !== 'Hàng hoá' && g.type !== 'Du lịch';
    return true;
  });

  function open(g: Gift) { if (!g.tierOk) return; setSel(g); setStage('detail'); }
  function close() { setSel(null); setStage('detail'); setDone(null); }

  let sheet = null;
  if (sel) {
    const miss = Math.max(0, sel.points - bal);
    const notOpen = sel.status !== 'Đang mở';
    if (stage === 'detail') sheet = (
      <div className="demo-sheet__panel" role="dialog" aria-label={sel.name}>
        <span className="demo-sheet__grab" />
        <div className="m05-img">{sel.imageFileId ? <img src={fileUrl(sel.imageFileId, 'app')} alt={sel.name} /> : <Icon name="gift" size={48} strokeWidth={1.3} />}</div>
        <b className="m05-title">{sel.name}</b>
        <div className="demo-between"><span className="m05-cost">{num(sel.points)} điểm</span><span className="demo-muted m05-stock">{sel.stock == null ? 'Không giới hạn' : 'Còn ' + num(sel.stock) + ' suất'}</span></div>
        {sel.window && <div className="demo-muted m05-stock">{sel.window}</div>}
        <InfoGrid cols={2} items={[['Điểm hiện có', num(bal)], ['Sau khi đổi', miss ? '—' : num(bal - sel.points)]]} />
        <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Điểm được trừ ngay khi gửi yêu cầu. Nếu yêu cầu bị huỷ hoặc bị từ chối, điểm được hoàn lại đầy đủ.</div>
        {!owner ? (
          <div className="demo-note demo-note--warn"><Icon name="lock" size={16} />Chỉ chủ tài khoản được đổi quà. Tài khoản nhân viên chỉ xem được danh sách quà — vui lòng báo chủ đại lý nếu muốn đổi.</div>
        ) : notOpen ? (
          <Button size="lg" block disabled>{sel.status === 'Sắp mở' ? 'Chưa mở đổi' : sel.status}</Button>
        ) : miss ? (
          <Button size="lg" block disabled>Còn thiếu {num(miss)} điểm</Button>
        ) : (
          <Button variant="primary" size="lg" block icon="gift" onClick={() => setStage('confirm')}>Đổi quà</Button>
        )}
        <Button size="lg" block onClick={close}>Đóng</Button>
      </div>
    );
    if (stage === 'confirm') sheet = (
      <div className="demo-sheet__panel" role="dialog" aria-label="Xác nhận đổi quà">
        <span className="demo-sheet__grab" />
        <b className="m05-title">Xác nhận đổi quà</b>
        <div>Đổi <b>{sel.name}</b> với <b>{num(sel.points)} điểm</b>?</div>
        <InfoGrid cols={2} items={[['Điểm hiện có', num(bal)], ['Còn lại sau khi đổi', num(bal - sel.points)]]} />
        <div className="m05-ship"><Icon name="box" size={18} /><span><b>Giao tới: </b>{profile.isLoading ? 'Đang tải địa chỉ…' : shipTo || 'địa chỉ kho đã đăng ký với DMP'}</span></div>
        <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Cần đổi địa chỉ nhận quà, vui lòng báo sale phụ trách trước khi xác nhận.</div>
        <Button variant="primary" size="lg" block icon="check" disabled={redeem.isPending} onClick={() => redeem.mutate(sel)}>{redeem.isPending ? 'Đang gửi…' : 'Xác nhận đổi'}</Button>
        <Button size="lg" block onClick={() => setStage('detail')}>Quay lại</Button>
      </div>
    );
    if (stage === 'done' && done) sheet = (
      <div className="demo-sheet__panel m05-done" role="dialog" aria-label="Đã gửi yêu cầu đổi quà">
        <Celebration icon="gift" tier={(home.data?.agent.tier ?? 'gold') as Tier} title="Đã gửi yêu cầu đổi quà!"
          body={`Sale phụ trách sẽ xác nhận, Kế toán duyệt rồi kho giao quà. Đã trừ ${num(Math.abs(done.points))} điểm — điểm còn lại ${num(done.balance)}.`} />
        <ApprovalStepper orientation="vertical" steps={[
          { label: `Đã gửi yêu cầu ${done.id}`, time: dateTime(done.at), status: 'done' },
          { label: 'Sale xác nhận', actor: home.data?.sale.name, status: 'current' },
          { label: 'Kế toán duyệt', status: 'todo' },
          { label: 'Kho giao quà', status: 'todo' },
        ]} />
        <Button variant="primary" size="lg" block onClick={() => nav('/app/redemptions')}>Xem yêu cầu của tôi</Button>
        <Button size="lg" block onClick={close}>Tiếp tục xem quà</Button>
      </div>
    );
  }

  return (
    <PhoneFrame tab="gifts" title="Cửa hàng quà"
      headRight={<button type="button" className="m05-mine" onClick={() => nav('/app/redemptions')}><Icon name="history" size={20} />Đã đổi</button>}
      overlay={sheet && <div className="demo-sheet" onClick={(e) => { if (e.target === e.currentTarget && stage !== 'done') close(); }}>{sheet}</div>}>
      <div className="m05-bal"><span className="demo-muted">Điểm thưởng khả dụng</span><b>{home.data ? num(bal) : '—'}</b></div>
      {!owner && <div className="demo-note demo-note--warn"><Icon name="lock" size={16} />Tài khoản nhân viên: xem quà và điểm, không đổi được quà. Chỉ chủ tài khoản được đổi quà.</div>}
      <Tabs variant="pill" value={flt} onChange={setFlt} items={[{ key: 'all', label: 'Tất cả' }, { key: 'can', label: 'Đổi được ngay' }, { key: 'voucher', label: 'Voucher' }]} />
      {q.isLoading || home.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : gifts.length ? (
        <div className="m05-grid">
          {gifts.map((g) => (
            <div key={g.id} className={'m05-cell' + (g.tierOk ? ' is-open' : '')} onClick={() => open(g)}>
              <GiftCard name={g.name} image={g.imageFileId ? fileUrl(g.imageFileId, 'app') : undefined} points={g.points} balance={bal} vndPerPoint={vndPerPoint}
                lockedForTier={!g.tierOk && g.minTier ? (g.minTier as Tier) : undefined}
                tag={g.tag ?? (g.status === 'Sắp mở' ? 'Sắp mở' : undefined)} canRedeem={owner}
                meta={g.window || (g.stock != null ? 'Còn ' + num(g.stock) + ' suất' : '')}
                onRedeem={() => open(g)} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon="gift" title={flt === 'can' ? 'Chưa có quà đổi được ngay' : 'Chưa có quà'}
          body={flt === 'can' ? `Tích thêm điểm để đổi quà. Hạng hiện tại: ${tierName(home.data?.agent.tier ?? '')}.` : 'Danh mục quà đang được cập nhật.'}
          action={flt !== 'all' ? <Button size="lg" onClick={() => setFlt('all')}>Xem tất cả quà</Button> : undefined} />
      )}
    </PhoneFrame>
  );
}
