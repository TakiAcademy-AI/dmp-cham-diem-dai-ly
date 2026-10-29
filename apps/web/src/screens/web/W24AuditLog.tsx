import { useDeferredValue, useState } from 'react';
import { can } from '@dmp/shared';
import { Button, DataTable, EmptyState, Field } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { downloadExport } from '../../lib/api';
import { ErrorNote, Loading, useApi, useToast } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime } from '../../lib/fmt';
import type { AuditRow } from '../../lib/types';
import './W24AuditLog.css';

type Kind = 'order' | 'agent' | 'sensitive' | 'config' | 'points' | 'security' | 'bank' | 'export';
const KIND: Record<Kind, string> = { order: 'Đơn hàng', agent: 'Đại lý', sensitive: 'Xem dữ liệu nhạy cảm', config: 'Cấu hình', points: 'Điểm & quà', security: 'Bảo mật', bank: 'Ngân hàng', export: 'Xuất dữ liệu' };

/** Phân nhóm thao tác theo câu chữ hành động (server ghi `action` dạng văn bản). */
function kindOf(a: AuditRow): Kind {
  const s = a.action;
  if (/tài khoản ngân hàng|CCCD/i.test(s)) return 'bank';
  if (/^Xuất/i.test(s)) return 'export';
  if (/^Xem/i.test(s)) return 'sensitive';
  if (/đăng nhập|2FA|khoá tài khoản|thất bại/i.test(s)) return 'security';
  if (/đơn|trả hàng|thanh toán|KiotViet/i.test(s)) return 'order';
  if (/điểm|quà|yêu cầu|khoá sổ/i.test(s)) return 'points';
  if (/đại lý|hồ sơ|cấp mã/i.test(s)) return 'agent';
  if (/duyệt|xác nhận|giao/i.test(s)) return 'points';
  return 'config';
}
const roleShort = (r: string) => (r === 'SALE' ? 'Sale' : r);

/** W24 Nhật ký thao tác — chỉ đọc; tìm theo người dùng/thao tác/đối tượng (server), lọc nhóm và khoảng ngày (trình duyệt). */
export default function W24AuditLog() {
  const { user } = useSession();
  const role = user!.role;
  const toast = useToast();
  const [qq, setQ] = useState('');
  const dq = useDeferredValue(qq.trim());
  const [kind, setKind] = useState('Tất cả');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useApi<AuditRow[]>('/audit' + (dq ? '?q=' + encodeURIComponent(dq) : ''), { placeholderData: (prev) => prev });

  const rows = (q.data ?? []).map((a) => ({ ...a, kind: kindOf(a) })).filter((x) => {
    if (kind !== 'Tất cả' && KIND[x.kind] !== kind) return false;
    const day = new Date(x.at);
    if (from && day < new Date(from + 'T00:00:00')) return false;
    if (to && day > new Date(to + 'T23:59:59')) return false;
    return true;
  });
  const filtered = !!(qq || from || to || kind !== 'Tất cả');

  const exportXlsx = () => {
    downloadExport('audit');
    toast({ tone: 'success', title: 'Đang tải file Excel nhật ký thao tác', body: 'Lần xuất này cũng được ghi vào nhật ký.' });
  };

  return (
    <AdminShell screen="W24"
      sub="Mọi thay đổi thông tin ngân hàng, mọi lần bấm Hiện dữ liệu nhạy cảm và mọi lần xuất Excel đều được ghi. Không ai sửa hoặc xoá được nhật ký."
      actions={can(role, 'audit.view') ? <Button icon="download" onClick={exportXlsx}>Xuất Excel</Button> : null}>
      <div className="demo-filters w24-filters">
        <Field label="Tìm" placeholder="Người dùng, thao tác, đối tượng" value={qq} onChange={(e) => setQ(e.target.value)} />
        <Field label="Nhóm thao tác" as="select" value={kind} onChange={(e) => setKind(e.target.value)} options={['Tất cả', ...Object.values(KIND)]} />
        <Field label="Từ ngày" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="Đến ngày" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {filtered && <Button variant="ghost" onClick={() => { setQ(''); setKind('Tất cả'); setFrom(''); setTo(''); }}>Xoá lọc</Button>}
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="w24-table">
          <DataTable rows={rows} rowKey="id" itemLabel="dòng" rowTone={(x) => (x.kind === 'security' && /thất bại|khoá/i.test(x.action + x.newValue) ? 'overdue' : null)}
            empty={<EmptyState icon="history" title={filtered ? 'Không có thao tác khớp bộ lọc' : 'Chưa có thao tác nào được ghi'} body={filtered ? 'Thử bỏ bớt điều kiện lọc hoặc mở rộng khoảng ngày.' : undefined} />}
            columns={[
              { key: 'at', label: 'Thời gian', render: (x) => dateTime(x.at) },
              { key: 'userName', label: 'Người dùng', render: (x) => `${x.userName} (${roleShort(x.role)})` },
              { key: 'action', label: 'Thao tác', primary: true, render: (x) => <div>{x.action}<div className="demo-sub">{KIND[x.kind]}</div></div> },
              { key: 'target', label: 'Đối tượng' },
              { key: 'chg', label: 'Giá trị cũ → mới', render: (x) => ((!x.oldValue || x.oldValue === '—') && (!x.newValue || x.newValue === '—')
                ? <span className="demo-muted">—</span>
                : <span className="w24-diff"><span className="w24-old">{x.oldValue || '—'}</span>→<span className="w24-new">{x.newValue || '—'}</span></span>) },
              { key: 'ip', label: 'IP', render: (x) => x.ip || <span className="demo-muted">—</span> },
            ]} />
        </div>
      )}
    </AdminShell>
  );
}
