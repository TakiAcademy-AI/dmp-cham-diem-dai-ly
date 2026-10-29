import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApprovalStepper, Button, EmptyState, PointValue, StatusBadge } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { appApi } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime, num } from '../../lib/fmt';
import type { Redemption } from '../../lib/types';
import './M06MyRedemptions.css';

const STAGES: Array<[string, string]> = [['new', 'Đã gửi'], ['confirmed', 'Sale xác nhận'], ['approved', 'Kế toán duyệt'], ['shipping', 'Đang giao'], ['done', 'Hoàn tất']];
const IDX: Record<string, number> = { new: 1, confirmed: 2, approved: 3, shipping: 4, done: 5 };

/** M06 Yêu cầu đổi quà của tôi — tiến trình từng yêu cầu, huỷ khi Sale chưa xác nhận (điểm được hoàn). */
export default function M06MyRedemptions() {
  const nav = useNavigate();
  const { user } = useSession('app');
  const owner = user?.role === 'DLC';
  const q = useApi<Redemption[]>('/app/redemptions', { realm: 'app' });
  const [confirm, setConfirm] = useState<Redemption | null>(null);
  const cancel = useAction((id: string) => appApi.post<{ refunded: number }>(`/app/redemptions/${id}/cancel`), {
    realm: 'app',
    success: (r, id) => ({ tone: 'success', title: `Đã huỷ yêu cầu ${id}`, body: `Đã hoàn ${num(r.refunded)} điểm vào điểm thưởng khả dụng.` }),
    onDone: () => setConfirm(null),
  });

  const list = q.data ?? [];
  const overlay = confirm && (
    <div className="demo-sheet" onClick={(e) => { if (e.target === e.currentTarget) setConfirm(null); }}>
      <div className="demo-sheet__panel" role="dialog" aria-label={`Huỷ yêu cầu ${confirm.id}`}>
        <span className="demo-sheet__grab" />
        <b className="m06-title">Huỷ yêu cầu {confirm.id}?</b>
        <div>{confirm.giftName}{confirm.qty > 1 ? ` ×${confirm.qty}` : ''} · {num(confirm.points)} điểm. Số điểm đã trừ sẽ được hoàn lại ngay.</div>
        <Button variant="danger" size="lg" block disabled={cancel.isPending} onClick={() => cancel.mutate(confirm.id)}>{cancel.isPending ? 'Đang huỷ…' : 'Huỷ yêu cầu'}</Button>
        <Button size="lg" block onClick={() => setConfirm(null)}>Giữ lại</Button>
      </div>
    </div>
  );

  return (
    <PhoneFrame tab="gifts" title="Yêu cầu của tôi" back overlay={overlay}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : !list.length ? (
        <EmptyState icon="gift" title="Chưa có yêu cầu đổi quà" body="Chọn quà trong Cửa hàng quà để gửi yêu cầu đầu tiên."
          action={<Button variant="primary" size="lg" icon="gift" onClick={() => nav('/app/gifts')}>Xem cửa hàng quà</Button>} />
      ) : list.map((x) => {
        const i = IDX[x.stage] ?? 0;
        const ended = x.stage === 'cancelled' || x.stage === 'rejected';
        const hist = (stage: string) => x.history.find((h) => h.stage === stage);
        return (
          <div key={x.id} className="m06-rq">
            <div className="m06-rq__h">
              <div><b>{x.giftName}{x.qty > 1 ? ` ×${x.qty}` : ''}</b><div className="demo-muted m06-meta">{x.id} · {dateTime(x.createdAt)}</div></div>
              <PointValue value={-x.points} state={ended ? 'revoked' : 'available'} showState={false} />
            </div>
            {ended ? (
              <>
                <div><StatusBadge tone={x.stage === 'rejected' ? 'danger' : 'neutral'}>{x.stage === 'rejected' ? 'Bị từ chối' : 'Đã huỷ'}</StatusBadge></div>
                <div className="m06-note">{x.note ? x.note + ' — ' : ''}đã hoàn {num(x.points)} điểm.</div>
              </>
            ) : (
              <ApprovalStepper orientation="vertical" steps={STAGES.map(([key, label], k) => {
                const h = hist(key);
                return { label, status: k < i ? 'done' : k === i ? 'current' : 'todo', actor: k < i && h ? h.by : undefined, time: k < i && h ? h.at : undefined, note: h?.note };
              })} />
            )}
            {owner && x.stage === 'new' && <Button size="lg" block onClick={() => setConfirm(x)}>Huỷ yêu cầu</Button>}
            {x.stage === 'confirmed' && <div className="demo-sub m06-hint">Sale đã xác nhận nên không tự huỷ được. Cần huỷ, vui lòng liên hệ sale phụ trách.</div>}
          </div>
        );
      })}
    </PhoneFrame>
  );
}
