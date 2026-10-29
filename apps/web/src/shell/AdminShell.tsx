import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { canOpenScreen, INTERNAL_ROLES, ROLE_LABEL, type Role } from '@dmp/shared';
import { Card, EmptyState, Icon, Sidebar, Tabs, TopBar } from '../ds';
import { useSession } from '../lib/session';
import { useApi } from '../lib/hooks';
import { MENU, screenByCode, screensInGroup } from './registry';

export interface AdminShellProps {
  /** Mã màn: W02, W08… — quyết định menu đang chọn và kiểm tra quyền. */
  screen: string;
  title?: string;
  sub?: ReactNode;
  crumb?: string;
  actions?: ReactNode;
  topRight?: ReactNode;
  searchPlaceholder?: string;
  onSearch?: (q: string) => void;
  children?: ReactNode;
}

/** Khung web quản trị: sidebar theo vai trò, thanh trên, điều hướng con trong nhóm, khoá màn không có quyền. */
export function AdminShell(p: AdminShellProps) {
  const { user, switchRole, signOut } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);
  const role = (user?.role ?? 'BOD') as Role;
  const badges = useApi<Record<string, number>>('/badges', { refetchInterval: 30000 }).data ?? {};
  const def = screenByCode(p.screen);
  const group = def?.group;
  const items = MENU.filter((m) => screensInGroup(m.key, role).length).map((m) => ({ ...m, badge: badges[m.key] }));
  const allowed = canOpenScreen(role, p.screen);
  const subs = group ? screensInGroup(group, role) : [];
  const badgeTotal = Object.values(badges).reduce((t, n) => t + n, 0);

  const goGroup = (key: string) => {
    setDrawer(false);
    const first = screensInGroup(key, role)[0];
    if (first) nav(first.path);
  };

  const demoSwitch = user?.demo !== false && (
    <label className="app-demo-bar" title="Chỉ có ở bản demo: đổi vai trò để xem phân quyền">
      <span className="demo-muted">Xem với vai trò</span>
      <select value={role} onChange={async (e) => {
        if (e.target.value === 'APP') { window.open('/app', '_blank'); return; }
        await switchRole(e.target.value);
        if (!canOpenScreen(e.target.value as Role, p.screen)) nav('/');
      }}>
        {INTERNAL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        <option value="APP">Đại lý → mở app</option>
      </select>
    </label>
  );

  const sidebar = (
    <Sidebar items={items} active={group} onSelect={goGroup}
      footer={<div className="demo-me"><b>{user?.name}</b><span>{ROLE_LABEL[role]}{['SA', 'BOD', 'KTT', 'KT'].includes(role) ? ' · 2FA' : ''}</span>
        <span className="demo-row" style={{ marginTop: 6, gap: 12 }}>
          <button type="button" className="demo-link" style={{ fontSize: 13 }} onClick={() => nav('/me')}>Bảo mật</button>
          <button type="button" className="demo-link" style={{ fontSize: 13 }} onClick={() => { signOut(); nav('/login'); }}>Đăng xuất</button>
        </span></div>} />
  );

  return (
    <div className="demo-shell">
      {sidebar}
      <div className="demo-main">
        <div className="demo-mhead">
          <button type="button" className="dmp-iconbtn" aria-label="Mở menu" onClick={() => setDrawer(true)}><Icon name="sliders" size={22} /></button>
          <b>DMP Việt Pháp</b>
          <span className="demo-mhead__bell"><Icon name="bell" size={22} />{badgeTotal ? <span className="dmp-bottomnav__badge">{badgeTotal}</span> : null}</span>
        </div>
        <TopBar searchPlaceholder={p.searchPlaceholder ?? 'Tìm đại lý, mã đơn, SĐT…'} onSearch={p.onSearch ?? ((q) => q && nav('/agents?q=' + encodeURIComponent(q)))} right={<>{p.topRight}{demoSwitch}</>} />
        <div className="demo-content">
          <div className="demo-head">
            <div className="demo-head__t">
              <div className="demo-crumb">{MENU.find((m) => m.key === group)?.label}{p.crumb ? ' / ' + p.crumb : ''} · <span className="demo-code">{p.screen}</span></div>
              <h1>{p.title ?? def?.title}</h1>
              {p.sub && <p>{p.sub}</p>}
            </div>
            {allowed && p.actions && <div className="demo-head__a">{p.actions}</div>}
          </div>
          {allowed && subs.length > 1 && (
            <div className="demo-subnav">
              <Tabs variant="pill" value={subs.find((s) => s.path === loc.pathname)?.code ?? p.screen} onChange={(k) => nav(screenByCode(k)!.path)}
                items={subs.map((s) => ({ key: s.code, label: s.title }))} />
            </div>
          )}
          {allowed ? p.children : (
            <Card><EmptyState icon="lock" title={`Vai trò ${ROLE_LABEL[role]} không có quyền vào màn này`} body="Theo ma trận phân quyền, mục này đã bị ẩn khỏi menu của vai trò này." /></Card>
          )}
        </div>
      </div>
      {drawer && <div className="demo-drawer" onClick={(e) => { if (e.target === e.currentTarget) setDrawer(false); }}>{sidebar}</div>}
    </div>
  );
}
