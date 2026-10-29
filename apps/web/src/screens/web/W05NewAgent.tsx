import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { can, mask, type Role } from '@dmp/shared';
import { ApprovalStepper, Button, Card, DataTable, EmptyState, Field, Icon, StatusBadge, Tabs, type ApprovalStep } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { InfoGrid } from '../../shell/charts';
import { pathOf } from '../../shell/registry';
import { api, fileUrl, uploadFile, type UploadedFile } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi, useToast } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, num, vnd } from '../../lib/fmt';
import type { Application as AppBase } from '../../lib/types';
import './W05NewAgent.css';

const DOCS = ['CCCD mặt trước', 'CCCD mặt sau', 'GPKD', 'Hợp đồng ký'];
const DOC_LABEL: Record<string, string> = { GPKD: 'Giấy phép kinh doanh', 'Hợp đồng ký': 'Hợp đồng đã ký (có thể bổ sung sau)' };
const TONE: Record<string, 'pending' | 'info' | 'danger' | 'success' | 'neutral'> = { 'BOD duyệt': 'pending', 'KT cấp mã': 'info', 'Từ chối': 'danger', 'Đã kích hoạt': 'success' };
/** Trường API mới chưa có trong lib/types: id file theo từng loại giấy tờ. */
type Application = AppBase & { docFiles?: Record<string, string> };
const fmtPhone = (p: string) => p.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');

/** W05 Đề xuất & duyệt đại lý mới — Sale/TPKD đề xuất → BOD duyệt → Kế toán cấp mã, tạo hợp đồng, gửi ZNS mời kích hoạt app. */
export default function W05NewAgent() {
  const { user } = useSession();
  const role = user!.role as Role;
  const canPropose = can(role, 'agents.propose');
  const [tab, setTab] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const q = useApi<Application[]>('/applications');
  const list = q.data ?? [];
  const mine = list.filter((x) => (role === 'BOD' && x.stage === 'BOD duyệt') || (role === 'KT' && x.stage === 'KT cấp mã')).length;
  const cur = tab && (tab !== 'create' || canPropose) ? tab : canPropose ? 'create' : 'review';
  return (
    <AdminShell screen="W05" crumb="Danh sách đại lý">
      <Tabs items={[...(canPropose ? [{ key: 'create', label: 'Tạo hồ sơ mới', icon: 'plus' as const }] : []), { key: 'review', label: 'Hồ sơ chờ xử lý', count: role === 'SALE' || role === 'TPKD' ? list.filter((x) => x.stage !== 'Đã kích hoạt' && x.stage !== 'Từ chối').length : mine, alert: mine > 0 }]}
        value={cur} onChange={setTab} />
      {cur === 'create'
        ? <Create onSubmitted={(id) => { setFocus(id); setTab('review'); }} />
        : q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : <Review key={role} list={list} role={role} userId={user!.id} focus={focus} />}
    </AdminShell>
  );
}

/* ---------- Tạo hồ sơ (3 bước) ---------- */
const EMPTY = { name: '', type: 'Nhà thuốc', owner: '', referrerId: '', phone: '', idCard: '', city: '', address: '', taxCode: '', commitMonth: '', creditDays: '15', push: 'Theo chính sách tháng hiện hành' };

function Create({ onSubmitted }: { onSubmitted: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState(EMPTY);
  const [docs, setDocs] = useState<Record<string, UploadedFile>>({});
  const [phoneErr, setPhoneErr] = useState('');
  const ref = useApi<Array<{ id: string; name: string }>>(f.referrerId.length >= 4 ? `/agents-lookup?q=${encodeURIComponent(f.referrerId)}` : null);
  const set = (k: keyof typeof EMPTY, v: string) => { setF({ ...f, [k]: v }); if (k === 'phone') setPhoneErr(''); };
  const refHit = ref.data?.find((r) => r.id.toLowerCase() === f.referrerId.trim().toLowerCase());
  const phoneOk = /^0\d{9}$/.test(f.phone);
  const idOk = !f.idCard || /^\d{12}$/.test(f.idCard);
  const step0Ok = f.name.trim() && f.type && phoneOk && idOk && f.address.trim() && f.city.trim() && !phoneErr;
  const commit = Number(f.commitMonth) || 0;
  const policy = `Chiết khấu kênh ${f.type.toLowerCase()} · cam kết ${num(Math.round(commit / 1e6))} triệu/tháng · nợ ${f.creditDays} ngày${f.push !== 'Theo chính sách tháng hiện hành' ? ' · Push: ' + f.push : ''}`;

  const submit = useMutationSubmit(() => api.post<{ id: string; stage: string }>('/applications', {
    name: f.name.trim(), type: f.type, owner: f.owner.trim(), phone: f.phone, idCard: f.idCard, city: f.city.trim(), address: f.address.trim(), taxCode: f.taxCode.trim(),
    referrerId: f.referrerId.trim() || null, commitMonth: commit, creditDays: Number(f.creditDays), policy,
    docs: Object.keys(docs), docFiles: Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, v.id])),
  }), (r) => { setF(EMPTY); setDocs({}); setStep(0); onSubmitted(r.id); }, (msg) => { if (/SĐT/.test(msg)) { setPhoneErr(msg); setStep(0); } });

  const steps: ApprovalStep[] = ['Thông tin đại lý', 'Giấy tờ', 'Chính sách đề xuất'].map((l, i) => ({ label: l, status: i < step ? 'done' : i === step ? 'current' : 'todo' }));
  const phoneError = phoneErr || (f.phone && !phoneOk ? 'SĐT phải có 10 số, bắt đầu bằng 0' : '');
  return (
    <Card title="Tạo hồ sơ đại lý mới" subtitle="Sale/TPKD đề xuất → BOD duyệt → Kế toán cấp mã và nhập hợp đồng → gửi ZNS mời kích hoạt app">
      <div className="w05-steps"><ApprovalStepper steps={steps} /></div>
      {step === 0 && (
        <div className="w05-form3">
          <Field label="Tên đại lý" required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="VD: Nhà thuốc Thiện Tâm" />
          <Field label="Loại/kênh" as="select" required value={f.type} onChange={(e) => set('type', e.target.value)} options={['Nhà thuốc', 'Spa', 'Phòng khám']} hint="Dùng để áp bảng giá theo kênh" />
          <Field label="Người giới thiệu" placeholder="Mã đại lý giới thiệu (nếu có)" value={f.referrerId} onChange={(e) => set('referrerId', e.target.value.toUpperCase())}
            hint={refHit ? `${refHit.name} — nhận điểm giới thiệu khi đơn đầu đạt mốc` : undefined} error={f.referrerId.length >= 7 && ref.data && !refHit ? 'Không tìm thấy mã đại lý này' : ''} />
          <Field label="Tên chủ cơ sở" value={f.owner} onChange={(e) => set('owner', e.target.value)} />
          <Field label="Số điện thoại chủ" required inputMode="numeric" value={f.phone} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} error={phoneError} hint="Dùng để đăng nhập app bằng OTP Zalo" />
          <Field label="Số CCCD" inputMode="numeric" value={f.idCard} onChange={(e) => set('idCard', e.target.value.replace(/\D/g, '').slice(0, 12))} error={idOk ? '' : 'CCCD gồm 12 số'} hint="Ảnh CCCD được lưu mã hoá" />
          <Field label="Địa chỉ kho" required value={f.address} onChange={(e) => set('address', e.target.value)} />
          <Field label="Tỉnh/thành" required value={f.city} onChange={(e) => set('city', e.target.value)} placeholder="VD: Hà Nội" />
          <Field label="Mã số thuế" value={f.taxCode} onChange={(e) => set('taxCode', e.target.value.replace(/[^\d-]/g, ''))} />
        </div>
      )}
      {step === 1 && <DocUploads docs={docs} onChange={setDocs} />}
      {step === 2 && (
        <div className="w05-form3">
          <Field label="Cam kết doanh số tháng" inputMode="numeric" value={commit ? num(commit) : ''} onChange={(e) => set('commitMonth', e.target.value.replace(/\D/g, ''))} suffix="đ" />
          <Field label="Hạn mức công nợ" value={commit ? num(commit * 2) : ''} readOnly suffix="đ" hint="Tự tính = 2 × cam kết tháng khi cấp mã" />
          <Field label="Số ngày nợ" as="select" value={f.creditDays} onChange={(e) => set('creditDays', e.target.value)} options={['0', '15', '30', '45'].map((v) => ({ value: v, label: v + ' ngày' }))} />
          <Field label="Chính sách Push" as="select" value={f.push} onChange={(e) => set('push', e.target.value)} options={['Theo chính sách tháng hiện hành', 'Không áp dụng']} />
          <Field label="Hạng khởi điểm" value="Thành viên" readOnly hint="Hạng xét tự động từ ngày 01 tháng sau" />
          <div className="w05-policy"><span className="demo-sub">Chính sách gửi BOD</span><div>{policy}</div></div>
        </div>
      )}
      <div className="demo-between w05-foot">
        <span className="demo-muted">Các ô có dấu * là bắt buộc. Hệ thống tự kiểm tra trùng SĐT khi gửi.</span>
        <div className="demo-row">
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Quay lại</Button>}
          {step < 2
            ? <Button variant="primary" disabled={step === 0 && !step0Ok} onClick={() => setStep(step + 1)}>Tiếp tục</Button>
            : <Button variant="primary" icon="send" disabled={!commit || submit.isPending} onClick={() => submit.mutate()}>Gửi BOD duyệt</Button>}
        </div>
      </div>
    </Card>
  );
}

/** Bước 2: tải từng giấy tờ lên (ảnh/PDF ≤ 15MB) — id file gửi kèm hồ sơ. */
function DocUploads({ docs, onChange }: { docs: Record<string, UploadedFile>; onChange: (d: Record<string, UploadedFile>) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pick = (d: string) => { setTarget(d); input.current?.click(); };
  const onFile = async (file?: File) => {
    if (!file || !target) return;
    const label = target;
    setBusy(label);
    try { const up = await uploadFile(file); onChange({ ...docs, [label]: up }); }
    catch (e) { toast({ tone: 'danger', title: 'Tải file thất bại', body: (e as Error).message }); }
    finally { setBusy(null); setTarget(null); if (input.current) input.current.value = ''; }
  };
  const remove = (d: string) => { const n = { ...docs }; delete n[d]; onChange(n); };
  return (
    <>
      <input ref={input} type="file" hidden accept="image/*,application/pdf" onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="w05-drops">{DOCS.map((d) => {
        const up = docs[d];
        return (
          <div key={d} className={'w05-drop' + (up ? ' is-done' : '')}>
            {up && up.mime.startsWith('image/') ? <img className="w05-thumb" src={fileUrl(up.id)} alt="" /> : <Icon name={up ? 'file' : 'upload'} size={24} />}
            <b>{DOC_LABEL[d] ?? d}</b>
            {up ? <span className="w05-fname" title={up.name}>{up.name} · {Math.max(1, Math.round(up.size / 1024))} KB</span> : <span>Ảnh hoặc PDF, tối đa 15MB</span>}
            <span className="demo-row w05-dropact">
              <Button disabled={!!busy} onClick={() => pick(d)} icon={up ? 'refresh' : 'upload'}>{busy === d ? 'Đang tải…' : up ? 'Đổi file' : 'Chọn file'}</Button>
              {up && <Button variant="ghost" disabled={!!busy} onClick={() => remove(d)}>Bỏ</Button>}
            </span>
          </div>
        );
      })}</div>
      <div className="demo-sub w05-mt">Ảnh CCCD chỉ BOD, Kế toán trưởng, Kế toán xem được. Hợp đồng đã ký có thể bổ sung sau tại hồ sơ đại lý.</div>
    </>
  );
}

/** Ảnh thu nhỏ; file không phải ảnh (PDF…) hiện biểu tượng. */
function DocThumb({ id }: { id: string }) {
  const [bad, setBad] = useState(false);
  return bad ? <Icon name="file" size={28} /> : <img className="w05-docthumb" src={fileUrl(id)} alt="" onError={() => setBad(true)} />;
}

/** useAction + bắt lỗi để đưa về đúng ô (trùng SĐT). */
function useMutationSubmit<R extends { id: string }>(fn: () => Promise<R>, done: (r: R) => void, fail: (msg: string) => void) {
  const m = useAction(fn, { success: () => ({ tone: 'success', title: 'Đã gửi hồ sơ cho BOD duyệt', body: 'SLA 2 ngày làm việc. Theo dõi ở tab Hồ sơ chờ xử lý.' }), onDone: (r) => done(r) });
  return { isPending: m.isPending, mutate: () => m.mutate(undefined, { onError: (e) => fail(e.message) }) };
}

/* ---------- Duyệt / cấp mã ---------- */
function Review({ list, role, userId, focus }: { list: Application[]; role: Role; userId: string; focus: string | null }) {
  const nav = useNavigate();
  const needsMe = (x: Application) => (role === 'BOD' && x.stage === 'BOD duyệt') || (role === 'KT' && x.stage === 'KT cấp mã');
  const [selId, setSel] = useState<string | null>(focus);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [issued, setIssued] = useState<{ id: string; agentId: string } | null>(null);

  const approve = useAction((id: string) => api.post(`/applications/${id}/approve`, { note: note.trim() || undefined }), {
    success: () => ({ tone: 'success', title: `Đã duyệt ${cur?.name ?? ''}`, body: 'Chuyển Kế toán cấp mã đại lý.' }), onDone: () => setNote(''),
  });
  const reject = useAction((id: string) => api.post(`/applications/${id}/reject`, { reason }), {
    success: () => ({ tone: 'warning', title: `Đã từ chối hồ sơ ${cur?.id ?? ''}`, body: 'Sale nhận thông báo kèm lý do.' }), onDone: () => { setRejecting(false); setReason(''); },
  });
  const issue = useAction((id: string) => api.post<{ id: string; agentId: string }>(`/applications/${id}/issue-code`), {
    success: (r) => ({ tone: 'success', title: `Đã cấp mã ${r.agentId}`, body: `ZNS mời kích hoạt app đã gửi tới ${cur?.phone ?? 'chủ đại lý'}.` }), onDone: (r) => setIssued(r),
  });

  if (!list.length) return <Card><EmptyState icon="users" title="Chưa có hồ sơ đại lý mới" body={can(role, 'agents.propose') ? 'Bấm tab "Tạo hồ sơ mới" để đề xuất đại lý.' : 'Sale/TPKD đề xuất hồ sơ, hồ sơ sẽ hiện ở đây.'} /></Card>;
  const cur = list.find((x) => x.id === selId) ?? list.find(needsMe) ?? list[0];
  const h = cur.history;
  const bodStep = h.find((x) => x.stage === 'BOD đã duyệt' || x.stage === 'Từ chối');
  const ktStep = h.find((x) => x.stage.startsWith('KT đã cấp mã'));
  const steps: ApprovalStep[] = [
    { label: 'Sale tạo hồ sơ', actor: h[0]?.by ?? cur.saleName, time: h[0]?.at, status: 'done' },
    { label: 'BOD duyệt', actor: bodStep?.by, time: bodStep?.at, note: cur.stage === 'Từ chối' ? 'Từ chối: ' + (cur.reason ?? '') : bodStep?.note, status: cur.stage === 'BOD duyệt' ? 'current' : cur.stage === 'Từ chối' ? 'rejected' : 'done' },
    { label: 'KT cấp mã & nhập HĐ', actor: ktStep?.by, time: ktStep?.at, note: cur.agentId ? 'Mã ' + cur.agentId : undefined, status: cur.stage === 'KT cấp mã' ? 'current' : cur.stage === 'Đã kích hoạt' ? 'done' : 'todo' },
    { label: 'Kích hoạt app', actor: 'ZNS mời đăng nhập', status: cur.stage === 'Đã kích hoạt' ? 'current' : 'todo' },
  ];
  const seePhone = ['BOD', 'KT', 'KTT'].includes(role) || cur.saleId === userId;
  const missing = DOCS.filter((d) => !cur.docs.includes(d));
  const canApprove = can(role, 'agents.approve') && cur.stage === 'BOD duyệt';
  const canCode = can(role, 'agents.issueCode') && cur.stage === 'KT cấp mã';
  const justIssued = issued && issued.id === cur.id ? issued.agentId : cur.agentId;
  const pick = (id: string) => { setSel(id); setRejecting(false); setReason(''); };

  return (
    <div className="w05-review">
      <div className="demo-grid">
        <Card title="Hồ sơ đại lý mới" flush>
          <DataTable rows={list} rowKey="id" itemLabel="hồ sơ" onRowClick={(x) => pick(x.id)}
            columns={[
              { key: 'name', label: 'Đại lý đề xuất', primary: true, render: (x) => <div><div className={'demo-strong' + (x.id === cur.id ? ' w05-sel' : '')}>{x.name}</div><div className="demo-sub">{x.id} · {x.type} · {x.city}</div></div> },
              { key: 'saleName', label: 'Sale', render: (x) => <div>{x.saleName}<div className="demo-sub">{date(x.createdAt)}</div></div> },
              { key: 'stage', label: 'Bước', render: (x) => <StatusBadge tone={TONE[x.stage] ?? 'neutral'}>{x.stage}</StatusBadge> },
            ]} />
        </Card>
        <Card title={cur.name} subtitle={`${cur.id} · đề xuất bởi ${cur.saleName} ngày ${date(cur.createdAt)}`}>
          <ApprovalStepper steps={steps} />
          <div className="w05-gap" />
          <InfoGrid cols={3} items={[
            ['Loại/kênh', cur.type], ['Chủ cơ sở', cur.owner || '—'], ['SĐT chủ', seePhone ? fmtPhone(cur.phone) : <span className="demo-hidden"><Icon name="lock" size={13} />{mask.phone(cur.phone)}</span>],
            ['Địa chỉ', [cur.address, cur.city].filter(Boolean).join(', ') || '—'], ['Mã số thuế', cur.taxCode || '—'], ['CCCD', cur.idCard || '—'],
            ['Cam kết tháng', vnd(cur.commitMonth)], ['Chính sách đề xuất', cur.policy || '—'],
            ['Người giới thiệu', cur.referrerId ? <button key="r" type="button" className="demo-link" onClick={() => nav(pathOf('W04', { id: cur.referrerId! }))}>{cur.referrerId}</button> : '—'],
          ]} />
        </Card>
      </div>
      <div className="demo-grid">
        <Card title="Giấy tờ" subtitle="Ảnh CCCD chỉ BOD, KTT, KT xem được">
          <div className="w05-doclist">{cur.docs.map((d) => {
            const lock = d.startsWith('CCCD') && !['BOD', 'KT', 'KTT'].includes(role);
            const fid = cur.docFiles?.[d];
            const name = DOC_LABEL[d]?.replace(' (có thể bổ sung sau)', '') ?? d;
            if (fid && !lock) return <a key={d} className="w05-docimg w05-docimg--file" href={fileUrl(fid)} target="_blank" rel="noreferrer" title={'Mở ' + name}><DocThumb id={fid} /><span>{name}</span></a>;
            return <div key={d} className="w05-docimg"><Icon name={lock ? 'lock' : 'image'} size={22} />{name}{!lock && !fid && <span className="demo-sub">Chỉ đánh dấu, chưa có file</span>}</div>;
          })}</div>
          {!cur.docs.length && <div className="demo-muted">Chưa có giấy tờ.</div>}
          {missing.length > 0 && <div className="demo-note demo-note--warn w05-mt"><Icon name="alert" size={16} />Thiếu {missing.map((d) => (DOC_LABEL[d] ?? d).replace(' (có thể bổ sung sau)', '')).join(', ')}.</div>}
        </Card>
        {canApprove && (
          <Card title="Quyết định của BOD">
            {rejecting ? (
              <div className="demo-grid">
                <Field as="textarea" label="Lý do từ chối" required value={reason} onChange={(e) => setReason(e.target.value)} error={reason.trim() ? '' : 'Bắt buộc ghi lý do khi từ chối'} />
                <div className="demo-row"><Button onClick={() => setRejecting(false)}>Huỷ</Button><Button variant="danger" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate(cur.id)}>Xác nhận từ chối</Button></div>
              </div>
            ) : (
              <div className="demo-grid">
                <Field as="textarea" label="Ghi chú (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="demo-row">
                  <Button variant="primary" icon="check" disabled={approve.isPending} onClick={() => approve.mutate(cur.id)}>Duyệt</Button>
                  <Button variant="danger" icon="x" onClick={() => setRejecting(true)}>Từ chối</Button>
                </div>
              </div>
            )}
          </Card>
        )}
        {canCode && (
          <Card title="Cấp mã đại lý">
            <div className="demo-grid">
              <div className="demo-muted">Mã đại lý và số hợp đồng tự sinh theo số thứ tự khi bấm cấp mã. Hệ thống tạo hợp đồng 12 tháng, tài khoản app cho chủ đại lý và hạn mức {vnd(cur.commitMonth * 2)}.</div>
              <Button variant="primary" block icon="send" disabled={issue.isPending} onClick={() => issue.mutate(cur.id)}>Cấp mã & gửi ZNS kích hoạt</Button>
            </div>
          </Card>
        )}
        {cur.stage === 'Đã kích hoạt' && justIssued && (
          <Card title="Đã cấp mã">
            <div className="w05-code">{justIssued}</div>
            <div className="demo-muted">Đã gửi ZNS mời đại lý kích hoạt app (M01).</div>
            <div className="w05-mt"><Button icon="user" onClick={() => nav(pathOf('W04', { id: justIssued }))}>Mở hồ sơ đại lý</Button></div>
          </Card>
        )}
        {!canApprove && !canCode && cur.stage !== 'Đã kích hoạt' && (
          <div className="demo-note demo-note--muted"><Icon name="info" size={16} />
            {cur.stage === 'BOD duyệt' ? 'Đang chờ BOD duyệt — chuyển vai trò sang BOD để duyệt.' : cur.stage === 'KT cấp mã' ? 'Đang chờ Kế toán cấp mã — chuyển vai trò sang Kế toán.' : 'Hồ sơ đã bị từ chối. Sale có thể bổ sung giấy tờ và gửi lại.'}
          </div>
        )}
      </div>
    </div>
  );
}
