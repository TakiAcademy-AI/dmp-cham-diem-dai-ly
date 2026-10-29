import { useState } from 'react';
import { ROLE_LABEL, TWO_FA_ROLES, type InternalRole, type Role } from '@dmp/shared';
import { Button, Card, Icon, OtpInput, StatusBadge } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { InfoGrid } from '../../shell/charts';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import './W26Security.css';

interface Me { kind: 'user' | 'agent'; id: string; name: string; role: Role; email?: string; totpEnabled?: boolean; demo?: boolean }
interface Setup { secret: string; url: string }

/** Khoá base32 tách nhóm 4 ký tự để dễ gõ tay. */
const groupSecret = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();
const QR = (url: string) => 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(url);

/** W26 Tài khoản & bảo mật — thông tin đăng nhập, bật/tắt xác thực 2 lớp bằng ứng dụng Authenticator. */
export default function W26Security() {
  const q = useApi<Me>('/auth/me');
  const me = q.data;
  const required = !!me && (TWO_FA_ROLES as string[]).includes(me.role);
  return (
    <AdminShell screen="W26" sub="Thông tin đăng nhập và xác thực 2 lớp của riêng anh/chị">
      {q.isLoading ? <Loading /> : q.error || !me ? <ErrorNote error={q.error} /> : (
        <div className="w26-grid">
          <Card title="Tài khoản">
            <InfoGrid cols={2} items={[
              ['Họ tên', me.name],
              ['Vai trò', ROLE_LABEL[me.role] ?? me.role],
              ['Email đăng nhập', me.email || '—'],
              ['Xác thực 2 lớp', me.totpEnabled
                ? <StatusBadge key="t" tone="success" icon="shield">Ứng dụng Authenticator</StatusBadge>
                : required ? <StatusBadge key="t" tone="info" icon="bell">Mã gửi qua email</StatusBadge> : <StatusBadge key="t" tone="neutral">Chưa bật</StatusBadge>],
            ]} />
            <div className={'demo-note w26-mt ' + (required && !me.totpEnabled ? 'demo-note--warn' : 'demo-note--muted')}>
              <Icon name="shield" size={16} />
              <span>
                {(TWO_FA_ROLES as InternalRole[]).map((r) => ROLE_LABEL[r]).join(', ')} bắt buộc xác thực 2 lớp khi đăng nhập web vì xem được dữ liệu tài chính và thông tin nhạy cảm của đại lý.
                {required
                  ? me.totpEnabled ? ' Anh/chị đang dùng ứng dụng Authenticator.' : ' Hiện mã 6 số được gửi qua email công ty mỗi lần đăng nhập — nên chuyển sang ứng dụng Authenticator để không phụ thuộc hộp thư.'
                  : ' Vai trò của anh/chị không bắt buộc, nhưng nên bật để bảo vệ tài khoản.'}
              </span>
            </div>
            {me.demo && <div className="demo-sub w26-mt">Chế độ trình diễn: đổi vai trò ở thanh trên không cần mã 2 lớp.</div>}
          </Card>
          {me.kind === 'user' && (me.totpEnabled ? <Disable required={required} /> : <Enable />)}
        </div>
      )}
    </AdminShell>
  );
}

function Enable() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const start = useAction(() => api.post<Setup>('/auth/totp/setup'), { invalidate: [], onDone: (r) => { setSetup(r); setCode(''); setErr(''); } });
  const enable = useAction(() => api.post('/auth/totp/enable', { secret: setup!.secret, code }), {
    invalidate: ['/auth/me'],
    success: () => ({ tone: 'success', title: 'Đã bật xác thực Authenticator', body: 'Lần đăng nhập sau, nhập mã 6 số trong ứng dụng.' }),
    onDone: () => setSetup(null),
  });
  const confirm = () => { setErr(''); enable.mutate(undefined, { onError: (e) => setErr(e.message) }); };

  if (!setup) return (
    <Card title="Ứng dụng Authenticator" subtitle="Google Authenticator, Microsoft Authenticator hoặc ứng dụng tương tự">
      <ol className="w26-steps">
        <li>Cài ứng dụng Authenticator trên điện thoại.</li>
        <li>Bấm "Bắt đầu thiết lập" rồi quét mã QR.</li>
        <li>Nhập mã 6 số ứng dụng hiển thị để xác nhận.</li>
      </ol>
      <Button variant="primary" icon="qr" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Đang tạo mã…' : 'Bắt đầu thiết lập'}</Button>
    </Card>
  );
  return (
    <Card title="Quét mã QR" subtitle="Mã chỉ có hiệu lực khi anh/chị xác nhận bằng mã 6 số bên dưới">
      <div className="w26-setup">
        <img className="w26-qr" src={QR(setup.url)} width={180} height={180} alt="Mã QR thiết lập Authenticator" />
        <div className="w26-manual">
          <div className="dmp-field__label">Không quét được? Nhập khoá thủ công</div>
          <code className="w26-secret">{groupSecret(setup.secret)}</code>
          <div className="demo-sub">Loại khoá: theo thời gian (TOTP) · 6 số · 30 giây</div>
        </div>
      </div>
      <div className="w26-otp">
        <OtpInput label="Mã 6 số trong ứng dụng" value={code} onChange={(c) => { setCode(c); setErr(''); }} error={!!err} />
        {err && <div className="w26-err" role="alert">{err}</div>}
      </div>
      <div className="demo-row w26-mt">
        <Button onClick={() => setSetup(null)}>Huỷ</Button>
        <Button variant="primary" icon="check" disabled={code.length !== 6 || enable.isPending} onClick={confirm}>Xác nhận & bật</Button>
      </div>
    </Card>
  );
}

function Disable({ required }: { required: boolean }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const off = useAction(() => api.post('/auth/totp/disable', { code }), {
    invalidate: ['/auth/me'],
    success: () => ({ tone: 'warning', title: 'Đã tắt xác thực Authenticator', body: required ? 'Lần đăng nhập sau, mã 6 số sẽ gửi qua email công ty.' : undefined }),
    onDone: () => { setOpen(false); setCode(''); },
  });
  const confirm = () => { setErr(''); off.mutate(undefined, { onError: (e) => setErr(e.message) }); };
  return (
    <Card title="Ứng dụng Authenticator" subtitle="Đang bật">
      <div className="w26-on"><Icon name="shield" size={20} />Mỗi lần đăng nhập web, anh/chị nhập mã 6 số trong ứng dụng.</div>
      {!open ? (
        <div className="w26-mt"><Button variant="danger" icon="x" onClick={() => { setOpen(true); setCode(''); setErr(''); }}>Tắt Authenticator</Button></div>
      ) : (
        <>
          {required && <div className="demo-note demo-note--warn w26-mt"><Icon name="alert" size={16} />Vai trò của anh/chị vẫn bắt buộc 2 lớp: sau khi tắt, mã đăng nhập sẽ gửi qua email công ty.</div>}
          <div className="w26-otp">
            <OtpInput label="Nhập mã hiện tại trong ứng dụng để xác nhận" value={code} onChange={(c) => { setCode(c); setErr(''); }} error={!!err} />
            {err && <div className="w26-err" role="alert">{err}</div>}
          </div>
          <div className="demo-row w26-mt">
            <Button onClick={() => setOpen(false)}>Huỷ</Button>
            <Button variant="danger" disabled={code.length !== 6 || off.isPending} onClick={confirm}>Xác nhận tắt</Button>
          </div>
        </>
      )}
      <div className="demo-sub w26-mt">Đổi điện thoại? Tắt rồi thiết lập lại trên máy mới. Mất điện thoại: liên hệ Quản trị hệ thống để gỡ.</div>
    </Card>
  );
}
