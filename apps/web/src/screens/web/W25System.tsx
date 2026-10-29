import { useState } from 'react';
import { can } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, Field, Icon, QuickView, StatusBadge } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { InfoGrid } from '../../shell/charts';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime, num } from '../../lib/fmt';
import type { AuditRow } from '../../lib/types';
import './W25System.css';

interface Integration { key: string; name: string; status: string; note: string; env?: string[] }
interface SystemInfo { db: string; ledgerRows: number; integrations: Integration[]; cron?: boolean }
interface Job { key: string; name: string; schedule: string; last: { status: string; message: string; at: string } | null }
interface SyncRes { mode: 'live' | 'mock'; created: Array<{ id: string; points: number }>; skipped: string[] }
/** Job làm thay đổi số liệu nghiệp vụ hàng loạt — hỏi lại trước khi chạy tay. */
const HEAVY: Record<string, string> = {
  expire: 'Trừ các lô điểm đã quá hạn của mọi đại lý (ghi bút toán hết hạn).',
  lock: 'Khoá sổ kỳ trước — sau khi khoá, mở lại cần BOD duyệt.',
  tier: 'Xét hạng toàn bộ đại lý theo doanh số kỳ — có thể lên/rớt hạng và gửi ZNS.',
  dormant: 'Đánh dấu ngủ đông các đại lý quá 60 ngày không có đơn.',
};
type Tone = 'success' | 'info' | 'warning' | 'neutral' | 'danger' | 'pending';

/** Mô tả phạm vi tích hợp theo bản thiết kế; trạng thái lấy từ API. */
const DESC: Record<string, string> = {
  kiotviet: 'Khách hàng, SP, giá, đơn, trả hàng · mỗi 15 phút · dự phòng import Excel hằng ngày',
  misa: 'Thanh toán, số dư công nợ · GĐ1 kế toán import file · GĐ3 kết nối API',
  zalocrm: 'Mapping mã đại lý; đẩy sự kiện (lên/rớt hạng, ngủ đông, sinh nhật, HĐ hết hạn) qua webhook khi IT của khách cung cấp API',
  zns: 'OTP đăng nhập; thông báo cộng điểm, lên hạng, điểm sắp hết hạn, đơn được duyệt',
};
const LATER = [
  { key: 'bkav', name: 'BKav Invoice', d: 'Xuất hoá đơn VAT' },
  { key: 'ship', name: 'GHTK / Viettel Post · Ngân hàng', d: 'Vận chuyển quà · đối soát thanh toán tự động' },
];
const statusTone = (s: string): Tone => (/đã kết nối|hoạt động/i.test(s) ? 'success' : /chờ/i.test(s) ? 'warning' : /lỗi/i.test(s) ? 'danger' : 'info');
/** Template ZNS đã đăng ký với Zalo — chưa có API quản lý template, hiển thị theo hồ sơ đăng ký. */
const ZNS_TPL: Array<[string, string]> = [['OTP', 'Đã duyệt'], ['Cộng điểm', 'Đã duyệt'], ['Lên hạng', 'Đã duyệt'], ['Sắp rớt hạng', 'Chờ duyệt'], ['Điểm sắp hết hạn', 'Chờ duyệt'], ['Đơn được duyệt', 'Đã duyệt'], ['Nợ đến hạn', 'Bị trả lại — sửa câu chữ']];
const CONFIRM_WORD = 'NẠP LẠI';

/** W25 Hệ thống & tích hợp — chỉ SA. Trạng thái tích hợp + biến môi trường cần đặt, đồng bộ KiotViet (thật/giả lập), job định kỳ, nạp lại dữ liệu demo có bước xác nhận. */
export default function W25System() {
  const { user } = useSession();
  const role = user!.role;
  const q = useApi<SystemInfo>('/system');
  const audit = useApi<AuditRow[]>(can(role, 'audit.view') ? '/audit?q=KiotViet' : null);
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');

  const jq = useApi<{ enabled: boolean; jobs: Job[] }>('/system/jobs');
  const [runAsk, setRunAsk] = useState<Job | null>(null);
  const sync = useAction(() => api.post<SyncRes>('/orders/sync', { count: 2 }), {
    success: (r) => ({
      tone: r.skipped?.length ? 'warning' : 'success',
      title: `Đồng bộ KiotViet xong${r.mode === 'mock' ? ' (giả lập)' : ''}`,
      body: `${r.created.length} đơn mới${r.created.length ? ' · ' + r.created.map((c) => c.id).join(', ') : ''}${r.skipped?.length ? ` · bỏ qua ${r.skipped.length}: ${r.skipped.slice(0, 3).join('; ')}${r.skipped.length > 3 ? '…' : ''}` : ''}`,
    }),
  });
  const runJob = useAction((j: Job) => api.post<{ key: string; status: string; message: string }>(`/system/jobs/${j.key}/run`), {
    success: (r, j) => ({ tone: r.status === 'OK' ? 'success' : 'danger', title: `${j.name}: ${r.status === 'OK' ? 'đã chạy' : 'lỗi'}`, body: r.message || 'Không có việc cần làm.' }),
    onDone: () => setRunAsk(null),
  });
  const askRun = (j: Job) => (HEAVY[j.key] ? setRunAsk(j) : runJob.mutate(j));
  const reset = useAction(() => api.post('/system/reset'), {
    success: () => ({ tone: 'success', title: 'Đã nạp lại dữ liệu demo', body: 'Mọi màn hình đã được làm mới theo dữ liệu mẫu.' }),
    onDone: () => { setConfirm(false); setTyped(''); },
  });

  const logs = (audit.data ?? []).filter((a) => /KiotViet/i.test(a.action));

  const action = (k: string) => {
    if (k === 'kiotviet') return can(role, 'orders.sync') ? <Button icon="refresh" disabled={sync.isPending} onClick={() => sync.mutate()}>{sync.isPending ? 'Đang đồng bộ…' : 'Đồng bộ lại'}</Button> : null;
    return null;
  };

  return (
    <AdminShell screen="W25" sub="Chỉ SA. Tách quyền kỹ thuật khỏi nghiệp vụ: SA cấu hình nhưng không duyệt điểm, không duyệt tiền.">
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="demo-grid">
          <div className="w25-ints">
            {(q.data?.integrations ?? []).map((x) => (
              <div key={x.key} className="w25-int">
                <div className="w25-int__h"><b>{x.name}</b><StatusBadge tone={statusTone(x.status)}>{x.status}</StatusBadge></div>
                <p>{DESC[x.key] ?? x.note}</p>
                {DESC[x.key] && <p className="w25-int__note"><Icon name="info" size={13} />{x.note}</p>}
                {x.env && x.env.length > 0 && (
                  <div className="w25-env">
                    <span className="demo-sub">{/đã kết nối/i.test(x.status) ? 'Biến môi trường đang dùng' : 'Cần đặt biến môi trường (file .env của API) rồi khởi động lại:'}</span>
                    <span className="w25-env__list">{x.env.map((e) => <code key={e}>{e}</code>)}</span>
                  </div>
                )}
                {action(x.key) && <div>{action(x.key)}</div>}
              </div>
            ))}
            {LATER.map((x) => (
              <div key={x.key} className="w25-int is-off">
                <div className="w25-int__h"><b>{x.name}</b><StatusBadge tone="neutral">GĐ3</StatusBadge></div>
                <p>{x.d}</p>
              </div>
            ))}
          </div>

          <Card title="Job định kỳ" subtitle={jq.data ? (jq.data.enabled ? 'Đang bật · máy chủ kiểm tra mỗi phút và chạy job đến hạn' : 'Đang tắt (CRON_ENABLED=false) — chỉ chạy tay') : undefined} flush>
            {jq.isLoading ? <Loading /> : jq.error ? <ErrorNote error={jq.error} /> : (
              <div className="w25-log">
                <DataTable rows={jq.data?.jobs ?? []} rowKey="key" itemLabel="job"
                  rowTone={(j) => (j.last?.status === 'Lỗi' ? 'overdue' : null)}
                  empty={<EmptyState icon="clock" title="Chưa khai báo job nào" />}
                  columns={[
                    { key: 'name', label: 'Job', primary: true, render: (j) => <div><div className="demo-strong">{j.name}</div><div className="demo-sub">{j.key}</div></div> },
                    { key: 'schedule', label: 'Lịch chạy' },
                    { key: 'at', label: 'Lần chạy gần nhất', render: (j) => (j.last ? dateTime(j.last.at) : <span className="demo-muted">Chưa chạy</span>) },
                    { key: 'st', label: 'Kết quả', render: (j) => (!j.last ? null : <div><StatusBadge tone={j.last.status === 'OK' ? 'success' : 'danger'}>{j.last.status}</StatusBadge>{j.last.message ? <div className="demo-sub">{j.last.message}</div> : null}</div>) },
                    ...(can(role, 'system.manage') ? [{ key: 'x', label: '', render: (j: Job) => <Button icon="refresh" disabled={runJob.isPending} onClick={() => askRun(j)}>{runJob.isPending && runJob.variables?.key === j.key ? 'Đang chạy…' : 'Chạy ngay'}</Button> }] : []),
                  ]} />
              </div>
            )}
          </Card>

          <div className="demo-grid demo-grid--side w25-side">
            <Card title="Nhật ký đồng bộ KiotViet" subtitle="Lấy từ nhật ký thao tác (W24)" flush>
              {audit.isLoading ? <Loading /> : audit.error ? <ErrorNote error={audit.error} /> : (
                <div className="w25-log">
                  <DataTable rows={logs} rowKey="id" itemLabel="lần đồng bộ"
                    rowTone={(x) => (/lỗi/i.test(x.newValue) ? 'overdue' : null)}
                    empty={<EmptyState icon="refresh" title="Chưa có lần đồng bộ nào" body='Bấm "Đồng bộ lại" ở thẻ KiotViet để kéo đơn mới.' />}
                    columns={[
                      { key: 'at', label: 'Thời gian', render: (x) => dateTime(x.at) },
                      { key: 'action', label: 'Thao tác', primary: true, render: (x) => <div>{x.action}<div className="demo-sub">{x.userName}</div></div> },
                      { key: 'newValue', label: 'Bản ghi', render: (x) => x.newValue || '—' },
                      { key: 's', label: 'Kết quả', render: (x) => (/lỗi/i.test(x.newValue) ? <StatusBadge tone="danger">Lỗi</StatusBadge> : <StatusBadge tone="success">OK</StatusBadge>) },
                      { key: 'oldValue', label: 'Ghi chú', render: (x) => (x.oldValue && x.oldValue !== '—' ? `Trước đó: ${x.oldValue}` : '') },
                    ]} />
                </div>
              )}
            </Card>
            <div className="demo-grid">
              <Card title="Template ZNS" subtitle="Phải được Zalo duyệt trước 25/11/2026">
                <ul className="w25-tpl">{ZNS_TPL.map(([n, s]) => (
                  <li key={n}><span>{n}</span><StatusBadge tone={s === 'Đã duyệt' ? 'success' : s === 'Chờ duyệt' ? 'pending' : 'danger'}>{s}</StatusBadge></li>
                ))}</ul>
              </Card>
              <Card title="Thông tin công ty">
                <InfoGrid cols={1} items={[
                  ['Tên', 'Công ty TNHH Thương mại DMP Việt Pháp'], ['Website', 'dmpvietphap.com'], ['Kho', 'Hà Nội · TP.HCM'],
                  ['Mẫu in', 'Phiếu xuất quà tặng · Biên bản bàn giao'], ['Logo', <span className="demo-muted">Chưa tải lên — chờ file từ khách</span>],
                ]} />
              </Card>
              <Card title="Dữ liệu & môi trường">
                <InfoGrid cols={1} items={[['Cơ sở dữ liệu', q.data?.db ?? '—'], ['Bút toán sổ điểm', num(q.data?.ledgerRows ?? 0)]]} />
                {can(role, 'demo.reset') && (
                  <div className="w25-reset">
                    <Button variant="danger" icon="refresh" onClick={() => { setTyped(''); setConfirm(true); }}>Nạp lại dữ liệu demo</Button>
                    <span className="demo-sub">Xoá toàn bộ dữ liệu hiện tại và nạp lại bộ dữ liệu mẫu.</span>
                  </div>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}

      {runAsk && (
        <QuickView title={`Chạy ngay: ${runAsk.name}?`} onClose={() => setRunAsk(null)}
          footer={<><Button onClick={() => setRunAsk(null)}>Huỷ</Button><Button variant="danger" icon="refresh" disabled={runJob.isPending} onClick={() => runJob.mutate(runAsk)}>{runJob.isPending ? 'Đang chạy…' : 'Chạy ngay'}</Button></>}>
          <div className="demo-grid">
            <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />{HEAVY[runAsk.key]}</div>
            <div className="demo-sub">Lịch tự động: {runAsk.schedule}. Chạy tay được ghi nhật ký thao tác (W24).</div>
          </div>
        </QuickView>
      )}

      {confirm && (
        <QuickView title="Nạp lại dữ liệu demo?" onClose={() => setConfirm(false)}
          footer={<>
            <Button onClick={() => setConfirm(false)}>Huỷ</Button>
            <Button variant="danger" icon="refresh" disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || reset.isPending} onClick={() => reset.mutate()}>{reset.isPending ? 'Đang nạp lại…' : 'Xoá và nạp lại'}</Button>
          </>}>
          <div className="demo-grid">
            <div className="demo-note demo-note--danger"><Icon name="alert" size={16} />Mọi đơn hàng, bút toán điểm, yêu cầu duyệt, đổi quà và tài khoản tạo thêm sẽ bị xoá và thay bằng dữ liệu mẫu ban đầu. Mọi người đang dùng bản demo đều bị ảnh hưởng. Không hoàn tác được.</div>
            <Field label={`Gõ "${CONFIRM_WORD}" để xác nhận`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        </QuickView>
      )}
    </AdminShell>
  );
}
