import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApprovalStepper, Button, Field, Icon, OtpInput, PointValue, TierBadge, type Tier } from '../../ds';
import { appApi } from '../../lib/api';
import { useSession, type SessionUser } from '../../lib/session';
import { PhoneFrame } from '../../shell/PhoneFrame';
import './M01Login.css';

const STEPS = [['phone', 'Nhập SĐT'], ['otp', 'OTP Zalo'], ['welcome', 'Chào mừng'], ['consent', 'Đồng ý dữ liệu'], ['a2hs', 'Thêm vào màn hình chính']] as const;
type Step = (typeof STEPS)[number][0];

/** M01 Kích hoạt & đăng nhập — SĐT → OTP qua Zalo ZNS → chào mừng → đồng ý dữ liệu (Luật BVDLCN) → thêm vào màn hình chính. */
export default function M01Login() {
  const nav = useNavigate();
  const { signIn } = useSession('app');
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('0912345789');
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState('');
  const [err, setErr] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{ token: string; user: SessionUser } | null>(null);
  const [welcome, setWelcome] = useState<{ tier: Tier; reward: number } | null>(null);

  async function sendOtp() {
    setBusy(true); setErr('');
    try { const r = await appApi.post('/auth/agent/otp', { phone }); setDevCode(r.devCode ?? ''); setOtp(''); setStep('otp'); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setErr('');
    try {
      const r = await appApi.post('/auth/agent/verify', { phone, code: otp });
      setSession(r);
      // Lấy hạng & điểm để chào mừng (token tạm, chưa lưu phiên)
      const home = await fetch('/api/app/home', { headers: { authorization: 'Bearer ' + r.token } }).then((x) => x.json());
      setWelcome({ tier: home.agent.tier, reward: home.points.reward });
      setStep('welcome');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  /** Lưu bằng chứng đồng ý (thời điểm + thiết bị) bằng token vừa cấp — phiên chưa lưu nên gọi trực tiếp. */
  async function consent() {
    if (!session) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/app/consent', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.token }, body: '{}' });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.message || 'Không lưu được sự đồng ý, vui lòng thử lại'); }
      setStep('a2hs');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  function finish() {
    if (session) signIn(session.token, session.user);
    nav('/app', { replace: true });
  }

  let body;
  if (step === 'phone') body = (
    <>
      <div className="m01-hero"><div className="m01-brand">DMP</div><h2>Đăng nhập</h2><p>Nhập số điện thoại đã đăng ký với DMP Việt Pháp. Mã xác thực sẽ gửi qua Zalo.</p></div>
      <Field label="Số điện thoại" size="lg" type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} error={err} hint="Bản demo: 0912345789 (chủ Nhà thuốc Minh Châu) hoặc 0987000125 (nhân viên)" />
      <div className="m01-grow" />
      <Button variant="primary" size="lg" block disabled={busy || phone.replace(/\D/g, '').length < 10} onClick={sendOtp}>Nhận mã qua Zalo</Button>
      <div className="demo-muted" style={{ textAlign: 'center' }}>Chưa là đại lý? Gọi hotline 1900 xxxx</div>
    </>
  );
  if (step === 'otp') body = (
    <>
      <div className="m01-hero"><h2>Nhập mã xác thực</h2><p>Mã 6 số đã gửi qua Zalo tới <b>{phone}</b>. Hiệu lực trong 5 phút.</p></div>
      <OtpInput value={otp} onChange={setOtp} error={!!err} />
      {err && <div className="app-error">{err}</div>}
      {devCode && <div className="m01-zns"><b>Zalo · DMP Việt Pháp (ZNS) — bản demo</b>Mã xác thực DMP Việt Pháp của Quý đại lý là {devCode}. Hiệu lực trong 5 phút.</div>}
      <div className="demo-muted"><button type="button" className="demo-link" onClick={sendOtp}>Gửi lại mã</button></div>
      <div className="m01-grow" />
      <Button variant="primary" size="lg" block disabled={otp.length < 6 || busy} onClick={verify}>Xác nhận</Button>
      {devCode && otp.length < 6 && <button type="button" className="demo-link" style={{ textAlign: 'center' }} onClick={() => setOtp(devCode)}>Điền mã demo</button>}
    </>
  );
  if (step === 'welcome') body = (
    <>
      <div className="m01-hero" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 24 }}><div className="m01-brand">DMP</div><h2>Chào mừng {session?.user.agentName}</h2><p>Từ nay Quý đại lý xem điểm, hạng, đổi quà và theo dõi đơn hàng ngay trên điện thoại.</p></div>
      {welcome && <div className="demo-acard"><div className="demo-row"><TierBadge tier={welcome.tier} size="lg" /><span>Hạng hiện tại</span></div><PointValue value={welcome.reward} signed={false} size="hero" /><span className="demo-muted">điểm thưởng khả dụng</span></div>}
      <div className="m01-grow" />
      <Button variant="primary" size="lg" block onClick={() => setStep('consent')}>Tiếp tục</Button>
    </>
  );
  if (step === 'consent') body = (
    <>
      <div className="m01-hero"><h2>Đồng ý xử lý dữ liệu cá nhân</h2><p>Theo Luật Bảo vệ dữ liệu cá nhân (hiệu lực 01/01/2026).</p></div>
      <div className="m01-consent">DMP Việt Pháp thu thập và xử lý các dữ liệu sau để quản lý đại lý và tích điểm:
        <ul><li>Họ tên, số điện thoại, ngày sinh, địa chỉ kho</li><li>CCCD (ảnh được lưu mã hoá), mã số thuế, số tài khoản</li><li>Lịch sử đơn hàng, thanh toán, điểm và quà</li></ul>
        Dữ liệu chỉ dùng cho mục đích hợp tác kinh doanh, không chia sẻ cho bên thứ ba ngoài đối tác vận chuyển khi giao quà. Quý đại lý có quyền yêu cầu xem, sửa hoặc rút lại sự đồng ý bất cứ lúc nào tại mục Tài khoản.</div>
      <label className="m01-check"><input type="checkbox" className="dmp-check" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>Tôi đã đọc và đồng ý với điều khoản xử lý dữ liệu cá nhân của DMP Việt Pháp.</span></label>
      <div className="m01-grow" />
      {err && <div className="app-error">{err}</div>}
      <Button variant="primary" size="lg" block disabled={!agree || busy} onClick={consent}>{busy ? 'Đang lưu…' : 'Đồng ý và tiếp tục'}</Button>
      <div className="demo-sub" style={{ textAlign: 'center' }}>Hệ thống lưu thời điểm và thiết bị đồng ý làm bằng chứng.</div>
    </>
  );
  if (step === 'a2hs') body = (
    <>
      <div className="m01-hero"><h2>Thêm vào màn hình chính</h2><p>Không cần tải app từ kho ứng dụng — thêm biểu tượng DMP lên màn hình để mở nhanh như app.</p></div>
      <ol className="m01-a2hs">
        <li><span className="m01-n">1</span>Bấm nút <b>Chia sẻ</b> (iPhone) hoặc <b>⋮</b> (Android) trên trình duyệt</li>
        <li><span className="m01-n">2</span>Chọn <b>Thêm vào MH chính</b></li>
        <li><span className="m01-n">3</span>Bấm <b>Thêm</b> — biểu tượng DMP xuất hiện trên màn hình</li>
      </ol>
      <div className="m01-grow" />
      <Button variant="primary" size="lg" block onClick={finish}>Vào trang chủ</Button>
      <button type="button" className="demo-link" style={{ textAlign: 'center' }} onClick={finish}>Để sau</button>
    </>
  );
  const idx = STEPS.findIndex((x) => x[0] === step);
  return (
    <PhoneFrame title={step === 'otp' ? 'Xác thực' : undefined} back={false}
      side={<>
        <b>Các bước kích hoạt</b>
        <ApprovalStepper orientation="vertical" steps={STEPS.map((x, i) => ({ label: x[1], status: i < idx ? 'done' : i === idx ? 'current' : 'todo' }))} />
        <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Đại lý nhận ZNS mời kích hoạt sau khi KT cấp mã (W05). Tối đa 2 tài khoản: Chủ và Nhân viên.</div>
        <a className="demo-link" href="/" target="_blank" rel="noreferrer">Mở web quản trị ↗</a>
      </>}>
      {body}
    </PhoneFrame>
  );
}
