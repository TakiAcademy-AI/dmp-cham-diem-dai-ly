import { useState } from 'react';
import { can, INTERNAL_ROLES, ROLE_LABEL } from '@dmp/shared';
import { Button, DataTable, EmptyState, Field, Icon, QuickView, StatusBadge, Tabs } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import type { Agent, User as BaseUser } from '../../lib/types';
import { dateTime } from '../../lib/fmt';
import './W23Users.css';

/**
 * Ma trận phân quyền mục 4.2 (DMP_01) — tài liệu tham chiếu nghiệp vụ, hiển thị nguyên văn.
 * Việc kiểm tra quyền thực tế nằm ở `PERMISSIONS` trong `@dmp/shared` (API và web dùng chung).
 */
const MX_ROLES = ['SA', 'BOD', 'KTT', 'KT', 'TPKD', 'SALE', 'MKT', 'KHO', 'ĐL-C', 'ĐL-NV'];
const MATRIX: string[][] = [
  ['User, vai trò, cấu hình, tích hợp', 'F', 'V', '–', '–', '–', '–', '–', '–', '–', '–'],
  ['Đề xuất đại lý mới và chính sách', '–', 'A', 'V', 'F (cấp mã)', 'P', 'P/O', '–', '–', '–', '–'],
  ['Hợp đồng và cam kết doanh số', '–', 'A', 'V', 'F', 'V', 'V/O', '–', '–', 'V/O', '–'],
  ['Sửa thông tin ngân hàng, CCCD', '–', 'V', 'V', 'F (có log)', '–', '–', '–', '–', 'P', '–'],
  ['Xem SĐT đại lý', '–', 'V', 'V', 'V', 'V', 'O', 'ẩn', 'giao hàng', 'O', '–'],
  ['Bàn giao đại lý hàng loạt', '–', 'F', '–', '–', 'F', '–', '–', '–', '–', '–'],
  ['Bảng giá, chiết khấu', '–', 'A', 'P', 'V', 'V', 'V', '–', '–', 'O', 'O'],
  ['Xem giá vốn', '–', 'V', 'V', '–', '–', '–', '–', '–', '–', '–'],
  ['Tạo đơn hàng', '–', '–', '–', 'F', 'V', 'O', '–', '–', 'O', 'O'],
  ['Duyệt đơn', '–', '–', 'V', 'A', 'V', 'V/O', '–', '–', '–', '–'],
  ['Ngoại lệ đặt hàng khi nợ quá hạn', '–', 'A', 'V', 'P', 'P', 'P', '–', '–', '–', '–'],
  ['Ghi nhận thanh toán, công nợ', '–', 'V', 'V', 'F', 'V', 'V/O', '–', '–', 'V/O', '–'],
  ['Cấu hình quy tắc điểm, bảng hạng', '–', 'A', 'P', '–', 'V', '–', 'P', '–', '–', '–'],
  ['Cộng điểm thủ công / hàng loạt', '–', 'A', 'V', '–', 'P', 'P', 'P', '–', '–', '–'],
  ['Điều chỉnh, huỷ điểm đã cộng', '–', 'A', 'P', '–', '–', '–', '–', '–', '–', '–'],
  ['Duyệt bằng chứng hoạt động', '–', 'V', '–', '–', 'V', 'xác nhận', 'A', '–', 'P', 'P'],
  ['Nâng hạng tay, Đối tác chiến lược', '–', 'A', 'V', '–', 'P', 'P', '–', '–', '–', '–'],
  ['Khoá sổ điểm (mở lại cần BOD)', '–', 'A', 'F', '–', '–', '–', '–', '–', '–', '–'],
  ['Danh mục và kho quà', '–', 'A (quà lớn)', 'A (giá trị)', '–', '–', '–', 'F', 'tồn kho', '–', '–'],
  ['Đổi quà', '–', 'V', 'A', 'A', 'V', 'xác nhận', '–', 'giao', 'P', '–'],
  ['Campaign, khuyến mãi', '–', 'A', 'V', '–', 'V', '–', 'P', '–', '–', '–'],
  ['Gửi thông báo hàng loạt', '–', 'V', '–', '–', 'F', 'O', 'F', '–', '–', '–'],
  ['Khiếu nại điểm', '–', 'V', 'V', 'xử lý', 'V', 'V/O', '–', '–', 'P', 'P'],
  ['Dashboard, báo cáo', '–', 'V (tất cả)', 'V (tài chính)', 'V', 'V (KD)', 'O', 'V (điểm)', '–', 'O', '–'],
  ['Xuất Excel', '–', 'F', 'F', 'F', 'F', '–', 'điểm, hoạt động', '–', '–', '–'],
  ['Xem audit log', 'F', 'V', 'V', '–', '–', '–', '–', '–', '–', '–'],
];
const MASKING = [
  { id: 1, f: 'Số điện thoại', full: 'BOD, KTT, KT, TPKD, SALE (đại lý mình), KHO (khi giao)', mask: 'MKT, SALE (đại lý không thuộc mình)', ex: '0912 *** 789' },
  { id: 2, f: 'CCCD và ảnh CCCD', full: 'BOD, KTT, KT', mask: 'Các vai trò còn lại', ex: '0012******45; ảnh không hiển thị' },
  { id: 3, f: 'Ngày sinh', full: 'BOD, KTT, KT', mask: 'SALE thấy dd/mm, không thấy năm', ex: '15/08/****' },
  { id: 4, f: 'Số tài khoản ngân hàng', full: 'KT, KTT (BOD xem)', mask: 'Các vai trò còn lại', ex: '**67' },
  { id: 5, f: 'Giá vốn', full: 'BOD, KTT', mask: 'Ẩn hoàn toàn', ex: '—' },
  { id: 6, f: 'Công nợ', full: 'BOD, KTT, KT, TPKD, SALE (đại lý mình), ĐL-C', mask: 'MKT, ĐL-NV — ẩn hoàn toàn', ex: '—' },
];
/** GET /users trả thêm SĐT (Sale: hiện trên app đại lý) và trạng thái Authenticator. */
type User = BaseUser & { phone?: string; totpEnabled?: boolean };
const MUST_2FA = ['SA', 'BOD', 'KTT', 'KT'];
const ACTIVE = 'Đang hoạt động';
const LOCKED = 'Đã khoá';
const isLeaving = (u: User) => u.status.startsWith('Nghỉ');
/** Tạm khoá do nhập sai mật khẩu nhiều lần (status vẫn "Đang hoạt động", có lockedUntil). */
const tempLocked = (u: User) => !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
const isLocked = (u: User) => /khoá/i.test(u.status) || tempLocked(u);
const statusTone = (s: string) => (s.startsWith('Nghỉ') ? 'warning' : /khoá/i.test(s) ? 'neutral' : 'success');
const roleOpts = INTERNAL_ROLES.map((r) => ({ value: r, label: `${r} · ${ROLE_LABEL[r]}` }));

function Cell({ v }: { v: string }) {
  if (v === '–') return <span className="w23-p w23-p-x" aria-label="Không có quyền">–</span>;
  const m = /^(F|A|P|V|O)(\b|\/| |$)/.exec(v);
  if (!m) return <span className="w23-p-t">{v}</span>;
  return <><span className={'w23-p w23-p-' + m[1]} title={v}>{v.length <= 3 ? v : m[1]}</span>{v.length > 3 && <div className="demo-sub">{v.slice(2)}</div>}</>;
}

interface Perms { roles: string[]; check: Array<{ role: string; count: number }> }

/** W23 Người dùng & phân quyền — SA thêm/sửa tài khoản; BOD xem và bàn giao đại lý của sale nghỉ việc. */
export default function W23Users() {
  const { user } = useSession();
  const role = user!.role;
  const canManage = can(role, 'users.manage');
  const canHandover = can(role, 'agents.handover');
  const q = useApi<User[]>('/users');
  const perms = useApi<Perms>('/permissions');
  const [tab, setTab] = useState('users');
  const [hcol, setHcol] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'SALE', scope: '' });
  const [editing, setEditing] = useState<User | null>(null);
  const [edit, setEdit] = useState({ role: '', status: '', phone: '' });
  const [confirmTotp, setConfirmTotp] = useState(false);
  const [handover, setHandover] = useState<User | null>(null);
  const [toSale, setToSale] = useState('');
  const agents = useApi<Agent[]>(handover ? '/agents' : null);

  const users = q.data ?? [];
  const create = useAction(() => api.post<{ id: string; tempPassword: string }>('/users', form), {
    invalidate: ['/users'],
    success: (r) => ({ tone: 'success', title: `Đã tạo tài khoản ${form.email}`, body: `Mật khẩu tạm: ${r.tempPassword} — yêu cầu đổi ở lần đăng nhập đầu.` }),
    onDone: () => { setAdding(false); setForm({ name: '', email: '', role: 'SALE', scope: '' }); },
  });
  const save = useAction(async (u: User) => {
    if (edit.role && edit.role !== u.role) await api.patch(`/users/${u.id}`, { role: edit.role });
    if (edit.status && edit.status !== u.status) await api.patch(`/users/${u.id}`, { status: edit.status });
    if (edit.phone.trim() !== (u.phone ?? '')) await api.patch(`/users/${u.id}`, { phone: edit.phone.trim() });
    return u;
  }, { invalidate: ['/users'], success: (u) => `Đã cập nhật tài khoản ${u.name}`, onDone: () => setEditing(null) });
  const lock = useAction((u: User) => api.patch(`/users/${u.id}`, { status: isLocked(u) ? ACTIVE : LOCKED }).then(() => u), {
    invalidate: ['/users'],
    success: (u) => (isLocked(u) ? { tone: 'success', title: `Đã mở khoá ${u.name}`, body: tempLocked(u) ? 'Đã xoá bộ đếm nhập sai mật khẩu.' : undefined } : `Đã khoá tài khoản ${u.name}`),
  });
  const toggle2fa = useAction((u: User) => api.patch(`/users/${u.id}`, { twoFA: !u.twoFA }).then(() => u), {
    invalidate: ['/users'],
    success: (u) => (u.twoFA ? `Đã tắt 2FA cho ${u.name}` : { tone: 'success', title: `Đã bật 2FA cho ${u.name}`, body: 'Lần đăng nhập tới sẽ yêu cầu mã xác thực.' }),
  });
  const resetTotp = useAction((u: User) => api.patch(`/users/${u.id}`, { resetTotp: true }).then(() => u), {
    invalidate: ['/users'],
    success: (u) => ({ tone: 'success', title: `Đã đặt lại Authenticator cho ${u.name}`, body: 'Người dùng quét mã QR mới ở lần đăng nhập tới.' }),
    onDone: () => setConfirmTotp(false),
  });

  const fromIds = handover ? (agents.data ?? []).filter((a) => a.saleId === handover.id).map((a) => a.id) : [];
  const receivers = users.filter((u) => u.role === 'SALE' && u.status === ACTIVE && u.id !== handover?.id);
  const target = receivers.find((u) => u.id === toSale) ?? receivers[0];
  const doHandover = useAction(() => api.post<{ moved: number; to: string }>('/agents/handover', { agentIds: fromIds, toSaleId: target!.id }), {
    success: (r) => ({ tone: 'success', title: `Đã bàn giao ${r.moved} đại lý cho ${r.to}`, body: canManage ? undefined : 'Khoá tài khoản sale nghỉ việc do SA thực hiện.' }),
    onDone: () => setHandover(null),
  });

  const openEdit = (u: User) => { setEditing(u); setEdit({ role: u.role, status: u.status, phone: u.phone ?? '' }); setConfirmTotp(false); };
  const editDirty = !!editing && (edit.role !== editing.role || edit.status !== editing.status || edit.phone.trim() !== (editing.phone ?? ''));

  return (
    <AdminShell screen="W23"
      sub="Đề xuất 10 vai trò; vai trò chưa có người làm thì gán cho người kiêm nhiệm. SA cấu hình hệ thống nhưng không duyệt điểm, không duyệt tiền."
      actions={canManage ? <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Thêm người dùng</Button> : null}>
      <div className="w23-tabs"><Tabs items={[{ key: 'users', label: 'Người dùng', count: users.length }, { key: 'matrix', label: 'Ma trận phân quyền' }, { key: 'masking', label: 'Che dữ liệu nhạy cảm' }]} value={tab} onChange={setTab} /></div>
      <div className="w23-body">
        {tab === 'users' && (q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
          <DataTable rows={users} rowKey="id" itemLabel="người dùng" rowTone={(x) => (isLeaving(x) ? 'atrisk' : null)}
            empty={<EmptyState icon="users" title="Chưa có người dùng" body={canManage ? 'Bấm "Thêm người dùng" để tạo tài khoản đầu tiên.' : undefined} />}
            columns={[
              { key: 'name', label: 'Người dùng', primary: true, render: (x) => <div><b>{x.name}</b><div className="demo-sub">{x.email}{x.phone ? ' · ' + x.phone : ''}</div></div> },
              { key: 'role', label: 'Vai trò', render: (x) => <StatusBadge tone="info">{x.role} · {x.roleLabel}</StatusBadge> },
              { key: 'scope', label: 'Phạm vi dữ liệu', render: (x) => (x.role === 'SALE' ? `${x.scope || 'Đại lý phụ trách'} (${x.agents})` : x.scope || '—') },
              { key: 'twoFA', label: '2FA', render: (x) => { const req = MUST_2FA.includes(x.role); return (
                <span className="w23-2fa"><button type="button" role="switch" className="w23-switch" aria-checked={x.twoFA} aria-label={'2FA ' + x.name}
                  disabled={!canManage || toggle2fa.isPending} title={req ? 'Bắt buộc với vai trò này — không tắt được' : x.twoFA ? 'Tắt 2FA' : 'Bật 2FA'} onClick={() => toggle2fa.mutate(x)} />
                  {req ? <span className="demo-sub">Bắt buộc</span> : null}</span>
              ); } },
              { key: 'status', label: 'Trạng thái', render: (x) => (tempLocked(x)
                ? <div><StatusBadge tone="danger" icon="lock">Tạm khoá</StatusBadge><div className="demo-sub">Sai mật khẩu · tới {dateTime(x.lockedUntil)}</div></div>
                : <StatusBadge tone={statusTone(x.status)}>{x.status}</StatusBadge>) },
              { key: 'act', label: '', align: 'right', render: (x) => (
                <span className="w23-acts">
                  {canHandover && isLeaving(x) && x.agents > 0 && <Button icon="handover" onClick={() => { setHandover(x); setToSale(''); }}>Bàn giao đại lý</Button>}
                  {canManage && x.id !== user!.id && <Button variant="ghost" icon="lock" disabled={lock.isPending} onClick={() => lock.mutate(x)}>{isLocked(x) ? 'Mở khoá' : 'Khoá'}</Button>}
                  {canManage && <Button variant="ghost" icon="edit" onClick={() => openEdit(x)}>Sửa</Button>}
                </span>
              ) },
            ]} />
        ))}

        {tab === 'matrix' && (
          <div className="demo-grid">
            <div className="w23-legend">
              <span><span className="w23-p w23-p-F">F</span> Toàn quyền</span><span><span className="w23-p w23-p-A">A</span> Duyệt</span>
              <span><span className="w23-p w23-p-P">P</span> Tạo/đề xuất</span><span><span className="w23-p w23-p-V">V</span> Xem</span>
              <span><span className="w23-p w23-p-O">O</span> Chỉ dữ liệu của mình</span><span><span className="w23-p w23-p-x">–</span> Không có quyền</span>
              <span className="demo-sub">Rê chuột lên tiêu đề cột để tô cả cột</span>
            </div>
            <div className="w23-mx-wrap">
              <table className="w23-mx">
                <thead><tr><th>Chức năng</th>{MX_ROLES.map((k, i) => <th key={k} className={hcol === i ? 'is-col' : ''} onMouseEnter={() => setHcol(i)} onMouseLeave={() => setHcol(null)}>{k}</th>)}</tr></thead>
                <tbody>{MATRIX.map((row) => (
                  <tr key={row[0]}><td>{row[0]}</td>{row.slice(1).map((v, i) => <td key={i} className={hcol === i ? 'is-col' : ''}><Cell v={v} /></td>)}</tr>
                ))}</tbody>
              </table>
            </div>
            <div className="demo-note demo-note--muted">
              <Icon name={canManage ? 'info' : 'lock'} size={16} />
              <span>Ma trận mục 4.2 là tài liệu nghiệp vụ. Quyền thực thi nằm trong bảng <code>PERMISSIONS</code> (gói <code>@dmp/shared</code>) — API và web dùng chung, thay đổi quyền qua phát hành phiên bản và được ghi nhật ký.
                {perms.data && <> Số quyền đang áp dụng: {perms.data.check.map((c) => `${c.role} ${c.count}`).join(' · ')}.</>}</span>
            </div>
          </div>
        )}

        {tab === 'masking' && (
          <div className="demo-grid">
            <DataTable rows={MASKING} rowKey="id" columns={[
              { key: 'f', label: 'Trường', primary: true }, { key: 'full', label: 'Hiển thị đầy đủ' }, { key: 'mask', label: 'Hiển thị che' },
              { key: 'ex', label: 'Quy ước che', render: (x) => <span className="demo-hidden"><Icon name="lock" size={13} />{x.ex}</span> },
            ]} />
            <div className="demo-sub">Nút "Hiện" chỉ xuất hiện với vai trò có quyền xem, mỗi lần bấm đều ghi audit log (lưu tối thiểu 1 năm).</div>
          </div>
        )}
      </div>

      {adding && (
        <QuickView title="Thêm người dùng" onClose={() => setAdding(false)}
          footer={<><Button onClick={() => setAdding(false)}>Huỷ</Button><Button variant="primary" icon="plus" disabled={!form.name.trim() || !form.email.trim() || create.isPending} onClick={() => create.mutate()}>Tạo tài khoản</Button></>}>
          <div className="demo-grid">
            <Field label="Họ tên" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Field label="Email công ty" required type="email" placeholder="ten.xx@dmpvietphap.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Field label="Vai trò" as="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={roleOpts}
              hint={MUST_2FA.includes(form.role) ? 'Vai trò này bắt buộc bật 2FA' : undefined} />
            <Field label="Phạm vi dữ liệu" placeholder={form.role === 'SALE' ? 'Đại lý phụ trách' : 'Toàn bộ'} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
          </div>
        </QuickView>
      )}

      {editing && (
        <QuickView title={`Sửa tài khoản ${editing.name}`} onClose={() => setEditing(null)}
          footer={<><Button onClick={() => setEditing(null)}>Huỷ</Button><Button variant="primary" icon="check" disabled={save.isPending || !editDirty} onClick={() => save.mutate(editing)}>Lưu thay đổi</Button></>}>
          <div className="demo-grid">
            <div className="demo-sub">{editing.email}</div>
            <Field label="Vai trò" as="select" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} options={roleOpts} />
            <Field label="Trạng thái" as="select" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}
              options={Array.from(new Set([editing.status, ACTIVE, LOCKED]))} />
            <Field label="Số điện thoại" type="tel" inputMode="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="VD: 0912 345 678"
              hint={edit.role === 'SALE' ? 'SĐT của Sale hiện trên app đại lý (nút Gọi sale phụ trách)' : undefined} />
            <div className="w23-totp">
              <div><b>Authenticator (2FA)</b><div className="demo-sub">{editing.twoFA ? '2FA đang bật' : '2FA đang tắt'}{editing.totpEnabled !== undefined ? (editing.totpEnabled ? ' · đã cài ứng dụng' : ' · chưa cài ứng dụng') : ''}</div></div>
              {!confirmTotp ? <Button icon="refresh" onClick={() => setConfirmTotp(true)}>Đặt lại Authenticator</Button> : (
                <span className="demo-row"><Button variant="ghost" onClick={() => setConfirmTotp(false)}>Huỷ</Button><Button variant="danger" disabled={resetTotp.isPending} onClick={() => resetTotp.mutate(editing)}>Xác nhận đặt lại</Button></span>
              )}
            </div>
            {confirmTotp && <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Dùng khi người dùng mất điện thoại. Mã cũ hết hiệu lực; lần đăng nhập tới phải quét mã QR mới.</div>}
            <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Mọi thay đổi vai trò, trạng thái, 2FA được ghi nhật ký thao tác (W24).</div>
          </div>
        </QuickView>
      )}

      {handover && (
        <QuickView title={`Bàn giao đại lý của ${handover.name}`} onClose={() => setHandover(null)}
          footer={<><Button onClick={() => setHandover(null)}>Huỷ</Button>
            <Button variant="primary" icon="handover" disabled={!target || !fromIds.length || doHandover.isPending} onClick={() => doHandover.mutate()}>Bàn giao {fromIds.length || ''} đại lý</Button></>}>
          {agents.isLoading ? <Loading /> : agents.error ? <ErrorNote error={agents.error} /> : (
            <div className="demo-grid">
              <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Nhân viên {handover.status.toLowerCase()}. Bàn giao để không mất lịch sử chăm sóc; Sale không xuất được danh sách đại lý ra Excel.</div>
              {!receivers.length ? <EmptyState icon="users" title="Không có sale đang hoạt động để nhận bàn giao" /> : (
                <Field label="Sale nhận bàn giao" as="select" value={target?.id ?? ''} onChange={(e) => setToSale(e.target.value)}
                  options={receivers.map((u) => ({ value: u.id, label: `${u.name} (${u.agents} đại lý)` }))} />
              )}
              <div className="demo-sub">Sẽ chuyển {fromIds.length} đại lý sang sale mới, giữ nguyên lịch sử đơn và điểm.{!canManage && ' Khoá tài khoản sale nghỉ việc do SA thực hiện.'}</div>
            </div>
          )}
        </QuickView>
      )}
    </AdminShell>
  );
}
