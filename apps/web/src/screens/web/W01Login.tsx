import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { INTERNAL_ROLES, ROLE_LABEL } from '@dmp/shared';
import { Button, EmptyState, Field, Icon, OtpInput } from '../../ds';
import { api } from '../../lib/api';
import { useSession, type SessionUser } from '../../lib/session';
import './W01Login.css';

type Step = 'login' | '2fa' | 'forgot' | 'sent';

/** W01 Đăng nhập & 2FA — email + mật khẩu, OTP 2FA cho SA/BOD/KTT/KT, khoá sau 5 lần sai. */
export default function W01Login() {
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const { signIn, switchRole } = useSession('admin');
  const [step, setStep] = useState<Step>('login');
  const [email, setEmail] = useState('an.nv@dmpvietphap.com');
  const [pass, setPass] = useState('');
  const [otp, setOtp] = useState('');
  const [err, setErr] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const done = (token: string, user: SessionUser) => { signIn(token, user); nav(loc.state?.from ?? '/', { replace: true }); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api.post('/auth/login', { email, password: pass });
      if (r.step === '2fa') { setDevCode(r.devCode ?? ''); setOtp(''); setStep('2fa'); }
      else done(r.token, r.user);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setErr('');
    try { const r = await api.post('/auth/2fa', { email, code: otp }); done(r.token, r.user); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  let form;
  if (step === 'login') form = (
    <form className="login__form" onSubmit={submit}>
      <div><h2>Đăng nhập</h2><p>Dành cho nhân viên nội bộ DMP Việt Pháp.</p></div>
      <Field label="Email công ty" type="email" value={email} onChange={(e) => setEmail(e.target.value)} size="lg" required autoComplete="username" />
      <Field label="Mật khẩu" type="password" value={pass} onChange={(e) => setPass(e.target.value)} size="lg" required autoComplete="current-password" error={err} hint="Bản demo: mọi tài khoản dùng mật khẩu Dmp@2026" />
      <div className="login__row"><label><input type="checkbox" className="dmp-check" defaultChecked /> Ghi nhớ thiết bị này</label>
        <button type="button" className="demo-link" onClick={() => setStep('forgot')}>Quên mật khẩu?</button></div>
      <Button variant="primary" size="lg" block type="submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</Button>
      <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Đại lý không đăng nhập ở đây — đại lý dùng app bằng số điện thoại và mã OTP Zalo.</div>
    </form>
  );
  if (step === '2fa') form = (
    <div className="login__form">
      <div><h2>Xác thực 2 lớp</h2><p>Nhập mã 6 số từ ứng dụng Authenticator trên điện thoại của anh/chị. Bắt buộc với SA, BOD, KTT, Kế toán.</p></div>
      <OtpInput value={otp} onChange={setOtp} error={!!err} />
      {err && <div className="app-error">{err}</div>}
      {devCode && <div className="demo-note"><Icon name="info" size={16} />Bản demo: mã xác thực là <b>{devCode}</b></div>}
      <Button variant="primary" size="lg" block disabled={otp.length < 6 || busy} onClick={verify}>Xác nhận</Button>
      <button type="button" className="demo-link" onClick={() => { setStep('login'); setErr(''); }}>‹ Quay lại</button>
    </div>
  );
  if (step === 'forgot') form = (
    <div className="login__form">
      <div><h2>Quên mật khẩu</h2><p>Nhập email công ty, hệ thống gửi đường dẫn đặt lại mật khẩu có hiệu lực 15 phút.</p></div>
      <Field label="Email công ty" type="email" size="lg" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button variant="primary" size="lg" block onClick={() => setStep('sent')}>Gửi đường dẫn</Button>
      <button type="button" className="demo-link" onClick={() => setStep('login')}>‹ Quay lại đăng nhập</button>
    </div>
  );
  if (step === 'sent') form = (
    <div className="login__form"><EmptyState icon="send" title="Đã gửi email" body={`Kiểm tra hộp thư ${email}. Đường dẫn hết hạn sau 15 phút.`} action={<Button onClick={() => setStep('login')}>Về đăng nhập</Button>} /></div>
  );

  return (
    <div className="login">
      <div className="login__brand">
        <div><h1>DMP<br />Việt Pháp</h1><p>Hệ thống quản lý đại lý & tích điểm — theo dõi đại lý, hợp đồng, điểm, hạng và quà trên một nơi.</p></div>
        <ul>
          <li><Icon name="shield" size={20} />Phân quyền theo vai trò, mọi thao tác được ghi nhật ký</li>
          <li><Icon name="refresh" size={20} />Đồng bộ đơn hàng từ KiotViet mỗi 15 phút</li>
          <li><Icon name="star" size={20} />Điểm và hạng minh bạch, có cách tính từng bước</li>
        </ul>
        <div className="login__foot">Logo chính thức sẽ thay khối chữ này khi có file logo.</div>
      </div>
      <div className="login__panel">
        {form}
        {step === 'login' && (
          <div className="login__demo">
            <b>Vào nhanh (bản demo)</b>
            <div className="demo-row">
              {INTERNAL_ROLES.map((r) => (
                <button key={r} type="button" className="dmp-btn dmp-btn--secondary dmp-btn--md" onClick={async () => { await switchRole(r); nav('/', { replace: true }); }}>{ROLE_LABEL[r]}</button>
              ))}
              <a className="dmp-btn dmp-btn--ghost dmp-btn--md" href="/app">App đại lý ↗</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
