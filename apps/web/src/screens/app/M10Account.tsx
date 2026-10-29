import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Icon, StatusBadge, TierBadge, type IconName, type Tier } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { InfoGrid } from '../../shell/charts';
import { ApiError, appApi, getToken } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime, mil } from '../../lib/fmt';
import type { Notification } from '../../lib/types';
import './M10Account.css';

interface Home {
  agent: { id: string; name: string; tier: Tier; owner: string; type?: string; city?: string };
  account: { name: string; role: 'DLC' | 'DLNV' };
  commit: { month: number; actual: number; pct: number } | null;
  debt: { amount: number | null; overdueDays: number; creditLimit: number | null } | null;
  sale: { name: string; phone: string };
}
interface Profile {
  id: string; name: string; type: string; owner: string; address: string; city: string; startDate: string; tier: Tier;
  phone?: string; taxCode?: string;
  contract: { id: string; startDate: string; endDate: string; commitMonth: number; policy: string } | null;
  consentAt: string | null; account: { name?: string; role?: 'DLC' | 'DLNV' };
}
interface Staff { id: number; name: string; phone: string; role: 'DLC' | 'DLNV'; active: boolean; consentAt: string | null; me: boolean }

function initials(name: string) {
  const w = name.replace(/\(.*?\)/g, '').trim().split(/\s+/);
  return ((w.length > 1 ? w[w.length - 2][0] : '') + (w[w.length - 1]?.[0] ?? '')).toUpperCase();
}

function Item({ icon, title, sub, right, onClick }: { icon: IconName; title: string; sub?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  const inner = <><Icon name={icon} size={22} /><span className="m10-item__m">{title}{sub && <small>{sub}</small>}</span>{right ?? (onClick && <Icon name="chevronRight" size={18} />)}</>;
  return onClick ? <button type="button" className="m10-item" onClick={onClick}>{inner}</button> : <div className="m10-item is-static">{inner}</div>;
}

/** Không có appApi.delete trong lib → gọi fetch trực tiếp với token app. */
async function removeStaff(id: number) {
  const res = await fetch('/api/app/staff/' + id, { method: 'DELETE', headers: { authorization: 'Bearer ' + (getToken('app') ?? '') } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.message || 'Không gỡ được tài khoản, vui lòng thử lại');
  return data;
}

/** M10 Tài khoản — hồ sơ đại lý & hợp đồng, sale phụ trách, tài khoản nhân viên, lối vào các tiện ích, đăng xuất. */
export default function M10Account() {
  const nav = useNavigate();
  const { user, signOut } = useSession('app');
  const owner = user?.role === 'DLC';
  const q = useApi<Home>('/app/home', { realm: 'app' });
  const pq = useApi<Profile>('/app/profile', { realm: 'app' });
  const sq = useApi<Staff[]>('/app/staff', { realm: 'app' });
  const notif = useApi<Notification[]>('/app/notifications', { realm: 'app' });
  const unread = notif.data?.filter((n) => !n.read).length ?? 0;
  const [sheet, setSheet] = useState<null | { kind: 'add' } | { kind: 'remove'; staff: Staff }>(null);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [formErr, setFormErr] = useState('');

  const add = useAction((b: { name: string; phone: string }) => appApi.post('/app/staff', b), {
    realm: 'app', invalidate: ['/app/staff'], success: 'Đã thêm tài khoản nhân viên',
    onDone: () => { setSheet(null); setForm({ name: '', phone: '' }); },
  });
  const remove = useAction((s: Staff) => removeStaff(s.id), {
    realm: 'app', invalidate: ['/app/staff'], success: (_r, s) => `Đã gỡ tài khoản ${s.name}`,
    onDone: () => setSheet(null),
  });

  function logout() { signOut(); nav('/app/login', { replace: true }); }
  function submitAdd() {
    const phone = form.phone.replace(/\D/g, '');
    if (!form.name.trim()) return setFormErr('Vui lòng nhập họ tên nhân viên');
    if (!/^0\d{9}$/.test(phone)) return setFormErr('Số điện thoại cần đủ 10 số, bắt đầu bằng 0');
    setFormErr('');
    add.mutate({ name: form.name.trim(), phone }, { onError: (e) => setFormErr(e.message) });
  }

  if (q.isLoading) return <PhoneFrame tab="account" title="Tài khoản"><Loading /></PhoneFrame>;
  if (q.error || !q.data) return <PhoneFrame tab="account" title="Tài khoản"><ErrorNote error={q.error} /></PhoneFrame>;
  const { agent: a, account, commit, debt, sale } = q.data;
  const p = pq.data;
  const phone = sale.phone.replace(/\s/g, '');
  const staff = [...(sq.data ?? [])].sort((x, y) => (x.role === 'DLC' ? 0 : 1) - (y.role === 'DLC' ? 0 : 1));
  const hasNv = staff.some((s) => s.role === 'DLNV');

  let overlay = null;
  if (sheet?.kind === 'add') overlay = (
    <div className="demo-sheet__panel" role="dialog" aria-label="Thêm tài khoản nhân viên">
      <span className="demo-sheet__grab" />
      <b className="m10-name">Thêm tài khoản nhân viên</b>
      <div className="demo-muted m10-l">Nhân viên đăng nhập bằng SĐT này, nhận mã OTP qua Zalo. Quyền: xem đơn, điểm và quà — không đổi quà, không xem công nợ.</div>
      <Field label="Họ tên" size="lg" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Field label="Số điện thoại" size="lg" type="tel" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={formErr} />
      <Button variant="primary" size="lg" block icon="plus" disabled={add.isPending} onClick={submitAdd}>{add.isPending ? 'Đang thêm…' : 'Thêm tài khoản'}</Button>
      <Button size="lg" block onClick={() => setSheet(null)}>Huỷ</Button>
    </div>
  );
  if (sheet?.kind === 'remove') overlay = (
    <div className="demo-sheet__panel" role="dialog" aria-label="Gỡ tài khoản nhân viên">
      <span className="demo-sheet__grab" />
      <b className="m10-name">Gỡ tài khoản {sheet.staff.name}?</b>
      <div className="demo-muted m10-l">SĐT {sheet.staff.phone} sẽ không đăng nhập được app nữa. Điểm và đơn hàng của đại lý không bị ảnh hưởng.</div>
      <Button variant="danger" size="lg" block disabled={remove.isPending} onClick={() => remove.mutate(sheet.staff)}>{remove.isPending ? 'Đang gỡ…' : 'Gỡ tài khoản'}</Button>
      <Button size="lg" block onClick={() => setSheet(null)}>Huỷ</Button>
    </div>
  );

  return (
    <PhoneFrame tab="account" title="Tài khoản"
      overlay={overlay && <div className="demo-sheet" onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>{overlay}</div>}>
      <div className="demo-acard">
        <b className="m10-name">{a.name}</b>
        <span className="demo-muted m10-l">{[a.id, a.type, a.city].filter(Boolean).join(' · ')}</span>
        <div className="demo-row"><TierBadge tier={a.tier} /><span className="m10-l">{account.name}{/nhân viên|chủ/i.test(account.name) ? '' : owner ? ' · Chủ đại lý' : ' · Nhân viên'}</span></div>
        {pq.error ? <ErrorNote error={pq.error} /> : p && (
          <InfoGrid cols={2} items={[
            ['Hợp tác từ', p.startDate || '—'],
            ['SĐT đăng nhập', p.phone || '—'],
            ['Địa chỉ kho', [p.address, p.city].filter(Boolean).join(', ') || '—'],
            owner && !!p.taxCode && ['Mã số thuế', p.taxCode],
            owner && !!p.contract && ['Hợp đồng', p.contract.id],
            owner && !!p.contract && ['Hết hạn hợp đồng', p.contract.endDate],
          ]} />
        )}
      </div>
      <div className="demo-acard">
        <span className="demo-muted m10-l">Sale phụ trách</span>
        <div className="m10-sale"><span className="m10-ava" aria-hidden="true">{initials(sale.name)}</span><div className="m10-grow"><b>{sale.name}</b><div className="demo-muted m10-l">{sale.phone} · 8:00–17:30</div></div></div>
        <div className="demo-grid demo-grid--2 m10-btns">
          <a href={'tel:' + phone}><Button variant="primary" size="lg" block icon="phone">Gọi</Button></a>
          <a href={'https://zalo.me/' + phone} target="_blank" rel="noreferrer"><Button size="lg" block icon="chat">Chat Zalo</Button></a>
        </div>
      </div>
      <div className="demo-acard">
        <b>Tài khoản đăng nhập</b>
        <div className="demo-muted m10-l">Mỗi đại lý tối đa 2 tài khoản: Chủ và 1 Nhân viên. Nhân viên xem đơn, điểm và quà — không đổi quà, không xem công nợ.</div>
        {sq.isLoading ? <Loading /> : sq.error ? <ErrorNote error={sq.error} /> : staff.map((s) => (
          <div key={s.id} className="m10-acc">
            <span className="m10-ava m10-ava--sm" aria-hidden="true">{initials(s.name)}</span>
            <div className="m10-grow">
              <b>{s.name}</b>{s.me && <span className="demo-muted m10-l"> (bạn)</span>}
              <div className="demo-muted m10-l">{s.phone} · {s.role === 'DLC' ? 'Chủ đại lý' : 'Nhân viên'}</div>
            </div>
            {owner && s.role === 'DLNV' && <Button size="md" onClick={() => setSheet({ kind: 'remove', staff: s })}>Gỡ</Button>}
          </div>
        ))}
        {owner && !sq.isLoading && !sq.error && (hasNv
          ? <div className="demo-sub m10-s">Đã đủ 1 tài khoản nhân viên. Muốn đổi người, gỡ tài khoản cũ trước khi thêm.</div>
          : <Button size="lg" block icon="plus" onClick={() => { setFormErr(''); setSheet({ kind: 'add' }); }}>Thêm tài khoản nhân viên</Button>)}
      </div>
      <div className="m10-grp">
        {owner && debt && (
          <Item icon="wallet" title="Công nợ" onClick={() => nav('/app/debt')}
            sub={<>Tổng nợ {mil(debt.amount ?? 0)} · {debt.overdueDays > 0 ? <span className="m10-od">quá hạn {debt.overdueDays} ngày</span> : 'không quá hạn'}</>} />
        )}
        <Item icon="bell" title="Thông báo" sub={unread ? `${unread} chưa đọc` : 'Đã đọc hết'} onClick={() => nav('/app/notifications')}
          right={unread ? <StatusBadge tone="danger" icon={null}>{unread}</StatusBadge> : undefined} />
        <Item icon="award" title="Hạng & quyền lợi" sub="Ngưỡng, hệ số, quyền lợi từng hạng" onClick={() => nav('/app/tiers')} />
        <Item icon="trend" title="Bảng xếp hạng" sub="Thứ hạng điểm của Quý đại lý" onClick={() => nav('/app/leaderboard')} />
        <Item icon="gift" title="Yêu cầu đổi quà" sub="Theo dõi quà đã đổi" onClick={() => nav('/app/redemptions')} />
        {owner && p?.contract && (
          <Item icon="file" title="Hợp đồng & cam kết"
            sub={<>{p.contract.id} · hiệu lực {p.contract.startDate}–{p.contract.endDate}{commit ? ` · tháng này đạt ${commit.pct}% cam kết ${mil(commit.month)}` : ''}</>} />
        )}
      </div>
      <div className="m10-grp">
        <Item icon="book" title="Học tập" sub="Khoá học sản phẩm, bài kiểm tra" onClick={() => nav('/app/learning')} />
        <Item icon="download" title="Tài liệu bán hàng" sub="Catalogue, hình ảnh, bảng giá" onClick={() => nav('/app/saleskit')} />
        <Item icon="upload" title="Nộp bằng chứng" sub="Trưng bày, hoạt động để được cộng điểm" onClick={() => nav('/app/evidence')} />
        <Item icon="chat" title="Khiếu nại" sub="Báo sai điểm, đơn hàng, quà" onClick={() => nav('/app/complaints')} />
      </div>
      <div className="m10-grp">
        <Item icon="shield" title="Dữ liệu cá nhân"
          sub={p?.consentAt ? `Đã đồng ý xử lý dữ liệu lúc ${dateTime(p.consentAt)}. Xem, sửa hoặc rút lại: liên hệ sale phụ trách` : 'Chưa ghi nhận đồng ý. Liên hệ sale phụ trách để xem, sửa dữ liệu'} />
      </div>
      <Button size="lg" block icon="logout" onClick={logout}>Đăng xuất</Button>
    </PhoneFrame>
  );
}
