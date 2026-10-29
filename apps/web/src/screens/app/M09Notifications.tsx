import { useNavigate } from 'react-router-dom';
import { EmptyState, Icon, TierIcon, type IconName, type Tier } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { appApi } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime } from '../../lib/fmt';
import type { Notification } from '../../lib/types';
import './M09Notifications.css';

type Tone = 'success' | 'warning' | 'info' | 'gold';
/** Mẫu ZNS → biểu tượng + màn liên quan (deep link). */
const TPL: Record<string, { ic: IconName | 'tier'; tone: Tone; go?: [string, string]; owner?: boolean }> = {
  points: { ic: 'star', tone: 'success', go: ['/app/ledger', 'Sổ điểm'] },
  order_approved: { ic: 'box', tone: 'info', go: ['/app/orders', 'Đơn hàng'] },
  redeem: { ic: 'gift', tone: 'info', go: ['/app/redemptions', 'Yêu cầu của tôi'] },
  expiring: { ic: 'clock', tone: 'warning', go: ['/app/gifts', 'Cửa hàng quà'] },
  tier_up: { ic: 'tier', tone: 'gold', go: ['/app/tiers', 'Hạng & quyền lợi'] },
  debt: { ic: 'wallet', tone: 'warning', go: ['/app/debt', 'Công nợ'], owner: true },
  campaign: { ic: 'trend', tone: 'info', go: ['/app/cart', 'Đặt hàng'] },
  welcome: { ic: 'bell', tone: 'info', go: ['/app', 'Trang chủ'] },
  broadcast: { ic: 'bell', tone: 'info' },
};

/** M09 Thông báo — nội dung khớp mẫu ZNS; bấm để đánh dấu đã đọc và mở màn liên quan, đánh dấu đã đọc tất cả. */
export default function M09Notifications() {
  const nav = useNavigate();
  const { user } = useSession('app');
  const owner = user?.role === 'DLC';
  const q = useApi<Notification[]>('/app/notifications', { realm: 'app' });
  const home = useApi<{ agent: { tier: Tier } }>('/app/home', { realm: 'app' });
  const readAll = useAction(() => appApi.post('/app/notifications/read'), { realm: 'app', invalidate: ['/app/notifications'], success: 'Đã đánh dấu đã đọc tất cả' });
  // Bấm một thông báo: đánh dấu đã đọc trên server rồi mới mở màn liên quan (lỗi đánh dấu không chặn điều hướng).
  const readOne = useAction(({ id }: { id: number; go?: string }) => appApi.post(`/app/notifications/${id}/read`), {
    realm: 'app', invalidate: ['/app/notifications'],
    onDone: (_r, v) => { if (v.go) nav(v.go); },
  });
  function tap(x: Notification, go?: string) {
    if (x.read) { if (go) nav(go); return; }
    readOne.mutate({ id: Number(x.id), go }, { onError: () => { if (go) nav(go); } });
  }
  const list = q.data ?? [];
  const unread = list.filter((x) => !x.read).length;

  return (
    <PhoneFrame tab="account" title="Thông báo" back flush>
      <div className="m09-bar">
        <span className="demo-muted m09-count">{unread ? `${unread} chưa đọc` : 'Đã đọc hết'}</span>
        <button type="button" className="demo-link m09-all" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate()}>Đánh dấu đã đọc tất cả</button>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : !list.length ? (
        <EmptyState icon="bell" title="Chưa có thông báo" body="Thông báo cộng điểm, đơn hàng, đổi quà sẽ hiện ở đây và gửi qua Zalo." />
      ) : list.map((x) => {
        const t = TPL[x.template] ?? TPL.broadcast;
        const go = t.go && (!t.owner || owner) ? t.go : undefined;
        const body = (
          <>
            <span className={'m09-ic m09-ic--' + t.tone}>{t.ic === 'tier' ? <TierIcon tier={home.data?.agent.tier ?? 'gold'} size={26} /> : <Icon name={t.ic} size={20} />}</span>
            <span className="m09-m">
              <span className="m09-t">{x.title}</span>
              <span className="m09-b">{x.body}</span>
              <span className="m09-d">{dateTime(x.createdAt)}{x.channel ? ` · ${x.channel}` : ''}</span>
              {go && <span className="m09-go">Mở {go[1]} ›</span>}
            </span>
            {!x.read && <span className="m09-dot" role="img" aria-label="Chưa đọc" />}
          </>
        );
        const cls = 'm09-nt' + (x.read ? '' : ' is-unread');
        return go || !x.read
          ? <button type="button" key={x.id} className={cls} disabled={readOne.isPending} onClick={() => tap(x, go?.[0])}>{body}</button>
          : <div key={x.id} className={cls}>{body}</div>;
      })}
    </PhoneFrame>
  );
}
