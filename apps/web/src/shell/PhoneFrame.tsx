import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNav, Icon, Tabs } from '../ds';
import { useSession } from '../lib/session';
import { useApi } from '../lib/hooks';

export interface PhoneFrameProps {
  /** Mục đang chọn trên thanh dưới: home | orders | points | gifts | account. Bỏ trống = màn con, không có thanh dưới. */
  tab?: 'home' | 'orders' | 'points' | 'gifts' | 'account';
  title?: string;
  /** Hiện nút quay lại (mặc định quay về trang trước). */
  back?: boolean | string;
  headRight?: ReactNode;
  flush?: boolean;
  footer?: ReactNode;
  overlay?: ReactNode;
  /** Thay bảng trình diễn bên trái (chỉ hiện trên máy tính). */
  side?: ReactNode;
  children?: ReactNode;
}

const TABS: Record<string, string> = { home: '/app', orders: '/app/orders', points: '/app/ledger', gifts: '/app/gifts', account: '/app/account' };

/** Khung app đại lý (PWA). Máy tính: khung 390px + bảng đổi tài khoản demo; điện thoại: toàn màn hình. */
export function PhoneFrame(p: PhoneFrameProps) {
  const nav = useNavigate();
  const { user, switchRole } = useSession('app');
  const unread = useApi<Array<{ read: boolean }>>(user ? '/app/notifications' : null, { realm: 'app' }).data?.filter((n) => !n.read).length ?? 0;
  return (
    <div className="demo-phonewrap">
      {p.side ? <div className="demo-phoneside">{p.side}</div> : user?.demo !== false && (
        <div className="demo-phoneside">
          <b>Xem với tài khoản</b>
          <Tabs variant="pill" value={user?.role === 'DLNV' ? 'DLNV' : 'DLC'} onChange={(k) => switchRole(k)}
            items={[{ key: 'DLC', label: 'Chủ (ĐL-C)' }, { key: 'DLNV', label: 'Nhân viên (ĐL-NV)' }]} />
          <div className="demo-sub">Tài khoản nhân viên: không đổi quà, không thấy công nợ.</div>
          <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Trên điện thoại thật, app chạy toàn màn hình (PWA, cài từ trình duyệt). Khung này chỉ để trình diễn trên máy tính.</div>
          <a className="demo-link" href="/" target="_blank" rel="noreferrer">Mở web quản trị ↗</a>
        </div>
      )}
      <div className="demo-phone">
        <div className="demo-status"><span>9:41</span><span className="demo-status__r">4G · 86%</span></div>
        {p.title && (
          <div className="demo-apphead">
            {p.back ? <button type="button" className="dmp-iconbtn" aria-label="Quay lại" onClick={() => (typeof p.back === 'string' ? nav(p.back) : nav(-1))}><Icon name="arrowLeft" size={22} /></button> : <span style={{ width: 8 }} />}
            <h1>{p.title}</h1>
            {p.headRight ?? <span style={{ width: 36 }} />}
          </div>
        )}
        <div className={'demo-appbody' + (p.flush ? ' is-flush' : '')}>{p.children}</div>
        {p.footer}
        {p.tab && (
          <BottomNav active={p.tab} onSelect={(k) => nav(TABS[k])} items={[
            { key: 'home', label: 'Trang chủ', icon: 'home' }, { key: 'orders', label: 'Đơn hàng', icon: 'box' }, { key: 'points', label: 'Điểm', icon: 'star' },
            { key: 'gifts', label: 'Quà', icon: 'gift' }, { key: 'account', label: 'Tài khoản', icon: 'user', badge: unread || undefined },
          ]} />
        )}
        {p.overlay}
      </div>
    </div>
  );
}
