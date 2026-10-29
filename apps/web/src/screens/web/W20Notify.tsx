import { useState } from 'react';
import { can, TIER_ORDER } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, Field, Icon, StatusBadge, Tabs, TierBadge, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { dateTime, num, tierName, vnd } from '../../lib/fmt';
import type { Agent } from '../../lib/types';
import './W20Notify.css';

/** Template ZNS đã đăng ký: biến `<tên>` do server điền theo từng đại lý; biến khác điền chung cho cả lô. */
const TPL: Array<{ name: string; key: string; body: string; sample: Record<string, string>; approved: boolean }> = [
  { name: 'Cộng điểm', key: 'points', body: 'Quý đại lý <tên> vừa nhận +<điểm> điểm từ <hạng mục>. Điểm khả dụng: <số dư>.', sample: { 'điểm': '150', 'hạng mục': 'Đào tạo offline', 'số dư': '12.650' }, approved: true },
  { name: 'Lên hạng', key: 'tier_up', body: 'Chúc mừng <tên> đã lên hạng <hạng>! Xem quyền lợi mới tại <link>.', sample: { 'hạng': 'Vàng', 'link': 'dmp.vn/q' }, approved: true },
  { name: 'Sắp rớt hạng', key: 'tier_risk', body: '<tên> cần thêm <số> doanh số trước <ngày> để giữ hạng <hạng>.', sample: { 'số': '12.000.000đ', 'ngày': '01/11/2026', 'hạng': 'Vàng' }, approved: true },
  { name: 'Điểm sắp hết hạn', key: 'expiring', body: '<điểm> điểm của Quý đại lý <tên> sẽ hết hạn ngày <ngày>.', sample: { 'điểm': '1.200', 'ngày': '31/03/2027' }, approved: true },
  { name: 'Đơn được duyệt', key: 'order_approved', body: 'Đơn <mã> trị giá <tiền> đã được duyệt. Dự kiến +<điểm> điểm.', sample: { 'mã': 'DH0123', 'tiền': '26.562.800đ', 'điểm': '512' }, approved: true },
  { name: 'Nợ đến hạn', key: 'debt_due', body: 'Hoá đơn <số> trị giá <tiền> đến hạn ngày <ngày>.', sample: { 'số': 'HD-10421', 'tiền': '25.300.000đ', 'ngày': '25/11/2026' }, approved: false },
];
const PREVIEW_NAME = 'Nhà thuốc Minh Châu';
const varsOf = (body: string) => Array.from(new Set(Array.from(body.matchAll(/<([^>]+)>/g)).map((m) => m[1]).filter((v) => v !== 'tên')));
const fill = (body: string, vals: Record<string, string>) => body.replace(/<([^>]+)>/g, (m, k) => (k === 'tên' ? m : vals[k]?.trim() || m));

type Chan = 'ZNS' | 'APP' | 'BOTH';
/** GET /notifications/batches */
interface Batch { batchId: string | null; title: string; body: string; channel: string; template: string; sender: string; createdAt: string; sent: number; read: number; failed: number }
interface Scheduled { id: number; payload: { tiers?: string[]; agentIds?: string[]; channel?: string; title: string; body: string; template?: string }; sendAt: string; status: string; sender: string; result: string | null }
const SCH_TONE: Record<string, 'pending' | 'success' | 'neutral' | 'danger'> = { 'Chờ gửi': 'pending', 'Đã gửi': 'success', 'Đã huỷ': 'neutral', 'Lỗi': 'danger' };
/** Giá trị mặc định cho ô hẹn giờ: 1 giờ tới, làm tròn phút, theo giờ máy (datetime-local). */
const defaultAt = () => { const d = new Date(Date.now() + 3600e3); d.setSeconds(0, 0); return new Date(+d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };

/** W20 Gửi thông báo — soạn theo template ZNS, chọn nhóm nhận, gửi qua /notifications/broadcast; bảng "Đã gửi gần đây" gộp từ hộp thư. */
export default function W20Notify() {
  const { user } = useSession();
  const role = user!.role;
  const canSend = can(role, 'notify.broadcast');
  const bq = useApi<{ batches: Batch[]; scheduled: Scheduled[] }>('/notifications/batches');
  const ag = useApi<Agent[]>(canSend ? '/agents' : null);

  const [tiers, setTiers] = useState<Record<string, boolean>>({ gold: true, diamond: true, strategic: true });
  const [type, setType] = useState('Tất cả');
  const [sale, setSale] = useState('Tất cả');
  const [chan, setChan] = useState<Chan>('ZNS');
  const [tpl, setTpl] = useState(0);
  const [vals, setVals] = useState<Record<string, string>>(TPL[0].sample);
  const [when, setWhen] = useState('Gửi ngay');
  const [at, setAt] = useState(defaultAt);

  const agents = (ag.data ?? []).filter((a) => a.status !== 'locked');
  const types = Array.from(new Set(agents.map((a) => a.type))).filter(Boolean);
  const sales = Array.from(new Map(agents.map((a) => [a.saleId, a.saleName])).entries());
  const targets = agents.filter((a) => tiers[a.tier] && (type === 'Tất cả' || a.type === type) && (sale === 'Tất cả' || a.saleId === sale));
  const nChan = chan === 'BOTH' ? 2 : 1;
  const cost = chan === 'APP' ? 0 : targets.length * 300;
  const t = TPL[tpl];
  const vars = varsOf(t.body);
  const missing = vars.filter((v) => !vals[v]?.trim());
  const narrowed = type !== 'Tất cả' || sale !== 'Tất cả';

  const send = useAction(async () => {
    const body = fill(t.body, vals);
    const payload = narrowed ? { agentIds: targets.map((a) => a.id) } : { tiers: TIER_ORDER.filter((k) => tiers[k]) };
    const chans: Array<'ZNS' | 'App'> = chan === 'ZNS' ? ['ZNS'] : chan === 'APP' ? ['App'] : ['ZNS', 'App'];
    const sendAt = when === 'Hẹn giờ' ? new Date(at).toISOString() : undefined;
    let sent = 0, costVND = 0, scheduled = 0;
    for (const c of chans) {
      const r = await api.post<{ sent?: number; costVND?: number; scheduled?: boolean }>('/notifications/broadcast', { ...payload, channel: c, title: t.name, body, template: t.key, ...(sendAt ? { sendAt } : {}) });
      sent += r.sent ?? 0; costVND += r.costVND ?? 0; if (r.scheduled) scheduled++;
    }
    return { sent, costVND, scheduled, sendAt };
  }, {
    invalidate: ['/notifications'],
    success: (r) => (r.scheduled
      ? { tone: 'success', title: `Đã hẹn gửi lúc ${dateTime(r.sendAt!)}`, body: `${r.scheduled} lịch hẹn (${num(targets.length)} đại lý) — xem và huỷ ở mục Lịch hẹn bên dưới.` }
      : { tone: 'success', title: `Đã gửi ${num(r.sent)} thông báo`, body: (r.costVND ? `Chi phí ZNS ${vnd(r.costVND)}. ` : '') + 'Thống kê đã gửi/đã đọc cập nhật bên dưới.' }),
  });
  const cancel = useAction((id: number) => api.post(`/notifications/scheduled/${id}/cancel`), { invalidate: ['/notifications'], success: (_r, id) => `Đã huỷ lịch gửi BC${id}` });

  const batches = bq.data?.batches ?? [];
  const scheduled = bq.data?.scheduled ?? [];
  const pendingN = scheduled.filter((x) => x.status === 'Chờ gửi').length;
  const atBad = when === 'Hẹn giờ' && (!at || +new Date(at) < Date.now() + 60e3);
  const audience = (p: Scheduled['payload']) => (p.agentIds?.length ? `${num(p.agentIds.length)} đại lý chọn riêng` : p.tiers?.length ? p.tiers.map(tierName).join(', ') : 'Tất cả đại lý');

  const chanLabel = (cs: string[]) => cs.map((c) => (c === 'App' ? 'Trong app' : c)).join(' + ');
  const pickTpl = (i: number) => { setTpl(i); setVals(TPL[i].sample); };

  const preview = t.body.split(/(<[^>]+>)/).map((part, i) => {
    const m = /^<(.+)>$/.exec(part);
    return m ? <span key={i} className="w20-var">{m[1] === 'tên' ? PREVIEW_NAME : vals[m[1]]?.trim() || part}</span> : <span key={i}>{part}</span>;
  });
  const disabledReason = !t.approved ? 'Template chưa được duyệt' : atBad ? 'Chọn thời điểm sau hiện tại' : null;

  return (
    <AdminShell screen="W20"
      sub={canSend ? 'Template ZNS phải được Zalo duyệt trước — đăng ký ngay, không để sát UAT' : role === 'BOD' ? 'BOD xem thống kê; gửi do MKT/TPKD' : 'Thống kê thông báo đã gửi; gửi hàng loạt do MKT/TPKD'}>
      {canSend && (
        <div className="w20-compose">
          <Card title="Soạn thông báo">
            {ag.isLoading ? <Loading /> : ag.error ? <ErrorNote error={ag.error} /> : (
              <div className="demo-grid">
                <div>
                  <div className="dmp-field__label w20-lbl">Nhóm nhận theo hạng</div>
                  <div className="w20-tiers">{TIER_ORDER.map((k) => (
                    <label key={k}><input type="checkbox" className="dmp-check" checked={!!tiers[k]} onChange={(e) => setTiers({ ...tiers, [k]: e.target.checked })} /><TierBadge tier={k as Tier} /></label>
                  ))}</div>
                </div>
                <div className="w20-two">
                  <Field label="Loại/kênh đại lý" as="select" value={type} onChange={(e) => setType(e.target.value)} options={['Tất cả', ...types]} />
                  <Field label="Sale phụ trách" as="select" value={sale} onChange={(e) => setSale(e.target.value)} options={[{ value: 'Tất cả', label: 'Tất cả' }, ...sales.map(([id, n]) => ({ value: id, label: n }))]} />
                </div>
                <div>
                  <div className="dmp-field__label w20-lbl">Kênh gửi</div>
                  <Tabs variant="pill" value={chan} onChange={(k) => setChan(k as Chan)} items={[{ key: 'ZNS', label: 'Zalo ZNS' }, { key: 'APP', label: 'Trong app' }, { key: 'BOTH', label: 'Cả hai' }]} />
                </div>
                <Field label="Template" as="select" value={String(tpl)} onChange={(e) => pickTpl(+e.target.value)}
                  options={TPL.map((x, i) => ({ value: String(i), label: `${x.name} · ${x.approved ? 'Đã duyệt' : 'Chờ Zalo duyệt'}` }))} hint="Nội dung ZNS cố định theo template đã đăng ký; chỉ điền biến" />
                {vars.length > 0 && (
                  <div className="w20-vars">
                    {vars.map((v) => <Field key={v} label={`Biến <${v}>`} value={vals[v] ?? ''} onChange={(e) => setVals({ ...vals, [v]: e.target.value })} />)}
                  </div>
                )}
                <div className="w20-two">
                  <Field label="Gửi lúc" as="select" value={when} onChange={(e) => setWhen(e.target.value)} options={['Gửi ngay', 'Hẹn giờ']} />
                  {when === 'Hẹn giờ' ? <Field label="Ngày giờ" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} error={atBad && at ? 'Phải sau hiện tại ít nhất 1 phút' : undefined} hint="Hệ thống kiểm tra lịch hẹn mỗi phút" /> : <span />}
                </div>
                <div className="demo-between">
                  <span className="demo-muted">Sẽ gửi tới <b className="w20-count">{num(targets.length)} đại lý</b>{nChan > 1 ? ' × 2 kênh' : ''}{cost ? ' · chi phí ZNS ước tính ' + vnd(cost) : ''}</span>
                  <Button variant="primary" icon="send" disabled={!targets.length || !!disabledReason || missing.length > 0 || send.isPending} onClick={() => send.mutate()}>
                    {disabledReason ?? (send.isPending ? 'Đang gửi…' : when === 'Hẹn giờ' ? 'Hẹn gửi' : 'Gửi')}
                  </Button>
                </div>
                {missing.length > 0 && t.approved && <div className="demo-sub">Điền biến {missing.map((v) => `<${v}>`).join(', ')} trước khi gửi.</div>}
              </div>
            )}
          </Card>
          <Card title="Xem trước" subtitle={chan === 'APP' ? 'Thông báo trong app (M09)' : 'Tin Zalo của đại lý'}>
            <div className="w20-zalo">
              <div className="w20-bubble"><b>DMP Việt Pháp · {t.name}</b>{preview}</div>
              <span className="demo-sub">Biến tô xanh được điền theo từng đại lý.</span>
            </div>
          </Card>
        </div>
      )}
      {(scheduled.length > 0 || canSend) && (
        <Card title="Lịch hẹn" subtitle={pendingN ? `${pendingN} lịch đang chờ gửi` : 'Không có lịch nào đang chờ'} flush>
          {bq.isLoading ? <Loading /> : bq.error ? <ErrorNote error={bq.error} /> : !scheduled.length ? (
            <EmptyState icon="calendar" title="Chưa có lịch hẹn gửi" body={canSend ? 'Chọn "Hẹn giờ" khi soạn thông báo để gửi vào thời điểm định trước.' : undefined} />
          ) : (
            <div className="w20-out">
              <DataTable rows={scheduled} rowKey="id" itemLabel="lịch hẹn"
                columns={[
                  { key: 'sendAt', label: 'Gửi lúc', render: (x) => dateTime(x.sendAt) },
                  { key: 'title', label: 'Nội dung', primary: true, render: (x) => <div><div className="demo-strong">{x.payload.title}</div><div className="demo-sub w20-clip">{x.payload.body}</div></div> },
                  { key: 'to', label: 'Nhóm nhận', render: (x) => audience(x.payload) },
                  { key: 'ch', label: 'Kênh', render: (x) => chanLabel([x.payload.channel ?? 'ZNS']) },
                  { key: 'st', label: 'Trạng thái', render: (x) => <div><StatusBadge tone={SCH_TONE[x.status] ?? 'neutral'}>{x.status}</StatusBadge>{x.result ? <div className="demo-sub">{x.result}</div> : null}</div> },
                  { key: 'by', label: 'Người hẹn', render: (x) => <span className="demo-sub">{x.sender}</span> },
                  ...(canSend ? [{ key: 'x', label: '', render: (x: Scheduled) => (x.status === 'Chờ gửi' ? <Button variant="ghost" icon="x" disabled={cancel.isPending} onClick={() => cancel.mutate(x.id)}>Huỷ lịch</Button> : null) }] : []),
                ]} />
            </div>
          )}
        </Card>
      )}
      <Card title="Đã gửi gần đây" flush>
        {bq.isLoading ? <Loading /> : bq.error ? <ErrorNote error={bq.error} /> : !batches.length ? (
          <EmptyState icon="bell" title="Chưa có thông báo nào" body={canSend ? 'Soạn thông báo ở trên và bấm Gửi.' : 'Thông báo do MKT/TPKD gửi sẽ hiện ở đây.'} />
        ) : (
          <div className="w20-out">
            <DataTable rows={batches.map((b, i) => ({ ...b, k: b.batchId ?? 'n' + i }))} rowKey="k" itemLabel="lượt gửi"
              columns={[
                { key: 'at', label: 'Thời gian', render: (x) => dateTime(x.createdAt) },
                { key: 'title', label: 'Nội dung', primary: true },
                { key: 'ch', label: 'Kênh', render: (x) => chanLabel([x.channel]) },
                { key: 'n', label: 'Người nhận', align: 'right', render: (x) => num(x.sent) },
                { key: 'ok', label: 'Gửi thành công', align: 'right', render: (x) => (x.failed ? <span className="w20-fail">{x.sent - x.failed}/{x.sent}</span> : `${x.sent}/${x.sent}`) },
                { key: 'read', label: 'Đã đọc', align: 'right', render: (x) => `${x.read} (${Math.round((x.read / Math.max(1, x.sent)) * 100)}%)` },
                { key: 'by', label: 'Người gửi', render: (x) => (!x.batchId || x.sender === 'Hệ thống' ? 'Hệ thống (tự động)' : <span className="w20-by"><Icon name="send" size={13} />{x.sender}</span>) },
              ]} />
          </div>
        )}
      </Card>
    </AdminShell>
  );
}
