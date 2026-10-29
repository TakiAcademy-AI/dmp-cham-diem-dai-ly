import { useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { can, canRevealField, mask, TIER_ORDER, type Role, type Tier as STier } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, Field, Icon, KpiCard, MaskedField, PointFunds, PointValue, QuickView, StatusBadge, Tabs, TierBadge, TierProgress, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { BarLine, InfoGrid } from '../../shell/charts';
import { pathOf } from '../../shell/registry';
import { api, fileUrl, uploadFile } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi, useToast } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, dateTime, mil, num, tierName, vnd } from '../../lib/fmt';
import type { AgentDetail, AuditRow, LedgerRow, PointSummary } from '../../lib/types';
import './W04AgentProfile.css';

type SField = 'phone' | 'idCard' | 'dob' | 'bank';
const STATUS: Record<string, ['info' | 'danger' | 'warning' | 'dormant' | 'neutral', string]> = {
  ok: ['info', 'Đang hoạt động'], overdue: ['danger', 'Nợ quá hạn'], atrisk: ['warning', 'Sắp rớt hạng'], dormant: ['dormant', 'Ngủ đông'], locked: ['neutral', 'Tạm ngưng'],
};
const ORDER_ST: Record<string, 'success' | 'pending' | 'info' | 'neutral' | 'warning'> = { 'Hoàn tất': 'success', 'Chờ duyệt': 'pending', 'Đang giao': 'info', 'Huỷ': 'neutral', 'Trả hàng một phần': 'warning' };
const FUND: Record<string, string> = { both: 'Hạng + thưởng', rank: 'Điểm hạng', reward: 'Điểm thưởng' };
const MASKERS: Record<SField, (v: string) => string> = { phone: mask.phone, idCard: mask.idCard, dob: mask.birthday, bank: mask.bank };
const LABEL: Record<SField, string> = { phone: 'SĐT', idCard: 'CCCD', dob: 'ngày sinh', bank: 'số tài khoản' };
const fmtPhone = (p: string) => p.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');

type Dialog = null | 'explain' | 'points' | 'tier' | 'credit' | 'adjust' | 'sensitive' | 'suspend';
/** Trường API mới chưa có trong lib/types. */
type Agent4 = AgentDetail & { docFiles?: Record<string, string>; suspendReason?: string | null };
interface Monthly { agentId: string; month: string; sales: number; commit: number }
/** "T3/26" → 2603 để sắp xếp theo thời gian (API trả theo thứ tự chữ). */
const monthKey = (m: string) => { const x = m.match(/T(\d+)\/(\d+)/); return x ? +x[2] * 100 + +x[1] : 0; };
/** Khoá giấy tờ dùng chung với hồ sơ W05 (KT cấp mã sẽ chép docFiles sang đại lý). */
const DOC_KEYS = ['CCCD mặt trước', 'CCCD mặt sau', 'GPKD', 'Hợp đồng ký'];
const DOC_NAME: Record<string, string> = { GPKD: 'Giấy phép kinh doanh', 'Giấy phép kinh doanh': 'Giấy phép kinh doanh' };

/** W04 Hồ sơ đại lý — thông tin che theo vai trò (bấm "Hiện" có ghi nhật ký), hợp đồng, đơn, sổ điểm, công nợ, hoạt động, lịch sử. */
export default function W04AgentProfile() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const role = user!.role as Role;
  const nav = useNavigate();
  const q = useApi<AgentDetail>('/agents/' + encodeURIComponent(id));
  const pts = useApi<PointSummary>(`/agents/${encodeURIComponent(id)}/points`);
  const led = useApi<LedgerRow[]>(`/ledger?agentId=${encodeURIComponent(id)}`);
  const hist = useApi<AuditRow[]>(`/agents/${encodeURIComponent(id)}/history`);
  const monthly = useApi<Monthly[]>(`/agents/${encodeURIComponent(id)}/monthly`);
  const [tab, setTab] = useState('info');
  const [revealed, setRevealed] = useState<Partial<Record<SField, string>>>({});
  const [dialog, setDialog] = useState<Dialog>(null);

  const reveal = useAction((f: SField) => api.post<{ field: SField; value: string }>(`/agents/${id}/reveal`, { field: f }), {
    invalidate: ['/audit', `/agents/${id}/history`],
    success: (r) => ({ tone: 'info', title: `Đã ghi nhật ký: xem ${LABEL[r.field]}`, body: `${user!.name} · ${dateTime(new Date())}` }),
    onDone: (r) => setRevealed((x) => ({ ...x, [r.field]: r.value })),
  });

  const reactivate = useAction(() => api.post<{ status: string }>(`/agents/${id}/reactivate`), {
    success: () => ({ tone: 'success', title: 'Đã kích hoạt lại đại lý', body: 'Tài khoản app được mở lại; đại lý đặt hàng và tích điểm bình thường.' }),
  });

  const back = <Button icon="arrowLeft" onClick={() => nav(pathOf('W03'))}>Danh sách đại lý</Button>;
  if (q.isLoading) return <AdminShell screen="W04" crumb="Danh sách đại lý"><Loading /></AdminShell>;
  if (q.error || !q.data) return <AdminShell screen="W04" crumb="Danh sách đại lý" actions={back}><ErrorNote error={q.error} /></AdminShell>;
  const a = q.data as Agent4;
  const p = pts.data;
  const c = a.contract;
  const ledger = led.data ?? [];
  const st = STATUS[a.status] ?? STATUS.ok;

  /** Trường nhạy cảm: vai trò được "Hiện" → che + nút Hiện (ghi audit); được xem sẵn → hiện; còn lại → khoá. */
  const sensitive = (f: SField, fmt: (v: string) => ReactNode = (v) => v, note?: ReactNode) => {
    const raw = (a as unknown as Record<SField, string>)[f] ?? '';
    const isMasked = a.masked[f];
    if (canRevealField(role, f)) {
      const full = revealed[f] ?? null;
      return <MaskedField key={role + f} masked={isMasked ? raw : MASKERS[f](raw)} value={full != null ? fmt(full) : undefined} canReveal onReveal={() => reveal.mutate(f)} />;
    }
    if (!isMasked) return <span>{fmt(raw)}</span>;
    return <span className="demo-hidden"><Icon name="lock" size={13} />{raw}{note ? <> <span className="demo-sub">{note}</span></> : null}</span>;
  };

  const owner = a.accounts.find((x) => x.role === 'DLC');
  const staff = a.accounts.filter((x) => x.role === 'DLNV');
  const unpaid = a.orders.filter((o) => o.pay !== 'Đã thanh toán' && o.status !== 'Huỷ');
  const activities = ledger.filter((l) => l.type === 'activity' || l.type === 'bonus' || l.type === 'manual');
  const now = new Date();
  const mLabel = (ago: number) => { const d = new Date(now.getFullYear(), now.getMonth() - ago, 1); return `T${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; };
  const months = [...(monthly.data ?? [])].sort((x, y) => monthKey(x.month) - monthKey(y.month)).slice(-12);
  const trv = (v: number) => Math.round((v / 1e6) * 10) / 10;
  const locked = a.status === 'locked';
  const phoneReal = !a.masked.phone ? a.phone.replace(/\s/g, '') : revealed.phone ?? null;

  const tabs = [
    { key: 'info', label: 'Thông tin chung' },
    { key: 'contract', label: 'Hợp đồng & cam kết' },
    { key: 'orders', label: 'Đơn hàng', count: a.orders.length },
    { key: 'ledger', label: 'Sổ điểm' },
    ...(!a.masked.debt ? [{ key: 'debt', label: 'Công nợ', alert: a.overdueDays > 0 }] : []),
    { key: 'act', label: 'Hoạt động & đào tạo' },
    { key: 'hist', label: 'Lịch sử thay đổi' },
  ];
  const curTab = tabs.some((t) => t.key === tab) ? tab : 'info';

  let body: ReactNode = null;
  if (curTab === 'info') body = (
    <>
      <InfoGrid cols={3} items={[
        ['Tên chủ cơ sở', a.owner || '—'], ['Loại/kênh', `${a.type} (bảng giá kênh ${a.type.toLowerCase()})`], ['Ngày bắt đầu hợp tác', date(a.startDate)],
        ['Số điện thoại', sensitive('phone', fmtPhone)],
        ['CCCD', sensitive('idCard')],
        ['Ngày sinh', sensitive('dob', (v) => v, role === 'SALE' ? '(sale thấy ngày/tháng để chúc mừng)' : undefined)],
        ['Địa chỉ kho', [a.address, a.city].filter(Boolean).join(', ') || '—'], ['Mã số thuế', a.taxCode || '—'],
        ['Số tài khoản', <div key="bank">{sensitive('bank', (v) => `${v.replace(/(\d{4})(?=\d)/g, '$1 ')} · ${a.bankName}`)}{can(role, 'agents.editSensitive') && <button type="button" className="demo-link w04-small" onClick={() => setDialog('sensitive')}>Sửa (ghi log)</button>}</div>],
        ['Người giới thiệu', a.referrerId ? <button type="button" className="demo-link" onClick={() => nav(pathOf('W04', { id: a.referrerId! }))}>{a.referrerId}</button> : '—'],
        ['Tài khoản app', owner ? `Chủ: ${a.appActivated ? 'đã kích hoạt' : 'chưa kích hoạt'} · NV: ${staff.length} tài khoản` : 'Chưa có tài khoản'],
        ['Nhận thông báo', a.push && a.push !== '—' ? a.push : 'ZNS mặc định'],
      ]} />
      <AgentDocs agentId={a.id} docFiles={a.docFiles ?? {}} canUpload={can(role, 'agents.editSensitive') || can(role, 'agents.propose')}
        lockId={!canRevealField(role, 'idCard') && a.masked.idCard} />
      <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Đổi vai trò ở góc trên (Sale ↔ BOD) để thấy trường nào bị che. Mỗi lần bấm "Hiện" đều được ghi nhật ký.</div>
    </>
  );
  if (curTab === 'contract') body = c ? (
    <>
      <InfoGrid cols={4} items={[
        ['Số hợp đồng', c.id], ['Hiệu lực', `${date(c.startDate)} – ${date(c.endDate)}`],
        ['Cam kết tháng / quý', `${mil(c.commitMonth)} / ${mil(c.commitMonth * 3)}`],
        ['Hạn mức công nợ', a.creditLimit != null ? `${vnd(a.creditLimit)} · ${a.creditDays} ngày` : `Đã ẩn · ${a.creditDays} ngày`],
        ['Chính sách', c.policy || '—'], ['Chính sách Push', a.push && a.push !== '—' ? a.push : 'Theo chính sách tháng hiện hành'],
        ['Trạng thái', <StatusBadge key="s" tone={c.status === 'Hiệu lực' ? 'success' : 'neutral'}>{c.status}</StatusBadge>],
        ['Đạt cam kết tháng này', <b key="p" className={a.commitPct < 50 ? 'w04-bad' : a.commitPct < 80 ? 'w04-mid' : undefined}>{a.commitPct}%</b>],
      ]} />
      <div>
        <div className="w04-label">Cam kết so với thực tế 12 tháng (triệu đồng)</div>
        {monthly.isLoading ? <Loading label="Đang tải doanh số 12 tháng…" /> : monthly.error ? <ErrorNote error={monthly.error} /> : !months.length
          ? <EmptyState icon="chart" title="Chưa có doanh số theo tháng" body="Doanh số được tổng hợp từ đơn hoàn tất mỗi tháng." />
          : <>
            <BarLine labels={months.map((m) => m.month)} bars={{ name: 'Thực tế', values: months.map((m) => trv(m.sales)) }}
              line={{ name: 'Cam kết', values: months.map((m) => trv(m.commit)) }} format={(v) => String(v).replace('.', ',') + ' tr'} height={220} width={960} highlightLast
              tipExtra={(i) => <div className="demo-sub">Đạt {months[i].commit ? Math.round((months[i].sales / months[i].commit) * 100) : 0}% cam kết</div>} />
            <div className="demo-sub">{months.filter((m) => m.commit && m.sales >= m.commit).length}/{months.length} tháng đạt cam kết · doanh số trước VAT từ đơn hoàn tất.</div>
          </>}
      </div>
    </>
  ) : <EmptyState icon="file" title="Chưa có hợp đồng" body="Kế toán nhập hợp đồng khi cấp mã đại lý." />;
  if (curTab === 'orders') body = (
    <DataTable rows={a.orders} rowKey="id" itemLabel="đơn" empty={<EmptyState icon="box" title="Chưa có đơn hàng" />}
      rowTone={(o) => (o.pay === 'Quá hạn' ? 'overdue' : null)}
      columns={[
        { key: 'id', label: 'Mã đơn', primary: true, render: (o) => <div><b>{o.id}</b><div className="demo-sub">{o.source}</div></div> },
        { key: 'orderedAt', label: 'Ngày', render: (o) => dateTime(o.orderedAt) },
        { key: 'value', label: 'Giá trị', align: 'right', render: (o) => vnd(o.value) },
        { key: 'status', label: 'Trạng thái', render: (o) => <StatusBadge tone={ORDER_ST[o.status]}>{o.status}</StatusBadge> },
        { key: 'pay', label: 'Thanh toán' },
        { key: 'points', label: 'Điểm', align: 'right', render: (o) => (o.pointState === 'none' ? '—' : <PointValue value={Math.round(o.points * (1 - o.returnedPct))} state={o.pointState} />) },
      ]} />
  );
  if (curTab === 'ledger') body = (
    <>
      <PointFunds rank={p?.rank ?? a.rankPoints} reward={p?.reward ?? a.rewardPoints} pending={p?.pending ?? a.pendingPoints} onExplain={() => setDialog('explain')} />
      {led.isLoading ? <Loading /> : led.error ? <ErrorNote error={led.error} /> : (
        <DataTable rows={ledger} rowKey="id" itemLabel="bút toán" empty={<EmptyState icon="book" title="Chưa có biến động điểm" />}
          columns={[
            { key: 'createdAt', label: 'Ngày', render: (l) => dateTime(l.createdAt) },
            { key: 'item', label: 'Hạng mục', primary: true },
            { key: 'ref', label: 'Chứng từ' },
            { key: 'fund', label: 'Quỹ', render: (l) => FUND[l.fund] ?? l.fund },
            { key: 'delta', label: '± Điểm', align: 'right', render: (l) => <PointValue value={l.fund === 'rank' ? l.deltaRank : l.deltaReward} state={l.state} /> },
            { key: 'byUser', label: 'Người duyệt' },
            { key: 'rule', label: 'Quy tắc' },
          ]} />
      )}
      <div className="demo-note demo-note--muted"><Icon name="lock" size={16} />Sổ cái chỉ ghi thêm — không có nút sửa hay xoá. Sai sót được xử lý bằng "Điều chỉnh" (KTT đề xuất, BOD duyệt).</div>
    </>
  );
  if (curTab === 'debt') body = (
    <>
      <div className="demo-grid demo-grid--4">
        <KpiCard label="Tổng nợ" value={mil(a.debt ?? 0)} />
        <KpiCard label="Hoá đơn chưa thanh toán" value={unpaid.length} hint={unpaid.length ? vnd(unpaid.reduce((t, o) => t + o.value, 0)) : undefined} tone={unpaid.length ? 'warning' : undefined} />
        <KpiCard label="Quá hạn" value={a.overdueDays > 0 ? `${a.overdueDays} ngày` : '0'} tone={a.overdueDays > 0 ? 'danger' : undefined} />
        <KpiCard label="Hạn mức đã dùng" value={a.creditLimit ? Math.round(((a.debt ?? 0) / a.creditLimit) * 100) + '%' : '—'} hint={a.creditLimit ? `Hạn mức ${mil(a.creditLimit)} · ${a.creditDays} ngày` : undefined} />
      </div>
      <DataTable rows={unpaid} rowKey="id" itemLabel="hoá đơn" empty={<EmptyState icon="check" title="Không có hoá đơn còn nợ" />}
        columns={[
          { key: 'id', label: 'Hoá đơn / đơn', primary: true, render: (o) => <b>{o.id}</b> },
          { key: 'orderedAt', label: 'Ngày', render: (o) => date(o.orderedAt) },
          { key: 'due', label: 'Hạn trả', render: (o) => { const d = new Date(o.orderedAt); d.setDate(d.getDate() + a.creditDays); return date(d); } },
          { key: 'value', label: 'Giá trị', align: 'right', render: (o) => vnd(o.value) },
          { key: 'pay', label: 'Trạng thái', render: (o) => <StatusBadge tone={o.pay === 'Quá hạn' ? 'danger' : 'pending'}>{o.pay}</StatusBadge> },
        ]} />
      <div className="demo-sub">Nguồn: kế toán nhập/import từ MISA (GĐ1). Hệ thống chỉ hiển thị, không tính lãi phạt.</div>
    </>
  );
  if (curTab === 'act') body = (
    <>
      <DataTable rows={activities} rowKey="id" itemLabel="hoạt động" empty={<EmptyState icon="award" title="Chưa có hoạt động được cộng điểm" body="Đào tạo, sự kiện, khảo sát được cộng điểm sẽ hiện ở đây." />}
        columns={[
          { key: 'createdAt', label: 'Ngày', render: (l) => date(l.createdAt) },
          { key: 'item', label: 'Hoạt động', primary: true },
          { key: 'byUser', label: 'Người duyệt' },
          { key: 'p', label: 'Điểm', align: 'right', render: (l) => <PointValue value={l.deltaReward || l.deltaRank} state={l.state} /> },
        ]} />
      <div className="demo-sub">Học tập, quiz và chứng nhận đầy đủ thuộc GĐ2 (W19).</div>
    </>
  );
  if (curTab === 'hist') {
    const events: Array<[string, string, string]> = [
      ...(hist.data ?? []).map((r): [string, string, string] => [dateTime(r.at), `${r.userName} (${r.role})`, r.action + (r.oldValue && r.oldValue !== '—' ? `: ${r.oldValue} → ${r.newValue}` : r.newValue && r.newValue !== '—' ? `: ${r.newValue}` : '')]),
      ...(a.tierProtectedUntil ? [['—', 'Hệ thống', `Đang bảo vệ hạng ${tierName(a.tier)} tới ${date(a.tierProtectedUntil)}`] as [string, string, string]] : []),
      [date(a.startDate), 'Hệ thống', 'Bắt đầu hợp tác, cấp mã ' + a.id],
    ];
    body = hist.isLoading ? <Loading /> : hist.error ? <ErrorNote error={hist.error} /> : (
      <>
        <ul className="w04-hist">{events.map((h, i) => <li key={i}><span className="demo-muted">{h[0]}</span><b>{h[1]}</b><span>{h[2]}</span></li>)}</ul>
        <div className="demo-sub">Gồm mọi thao tác ghi nhật ký nhắm tới đại lý này (sửa thông tin, giấy tờ, tạm ngưng, xem trường nhạy cảm…). Giá trị nhạy cảm chỉ BOD, Kế toán thấy.</div>
      </>
    );
  }

  const actions = (
    <>
      {back}
      {can(role, 'points.manualPropose') && <Button icon="star" onClick={() => setDialog('points')}>Đề xuất cộng điểm</Button>}
      {can(role, 'tier.manualPropose') && <Button icon="award" onClick={() => setDialog('tier')}>Đề xuất nâng hạng tay</Button>}
      {can(role, 'credit.exceptionPropose') && a.overdueDays > 0 && <Button icon="wallet" onClick={() => setDialog('credit')}>Ngoại lệ công nợ</Button>}
      {can(role, 'points.adjustPropose') && <Button icon="edit" onClick={() => setDialog('adjust')}>Đề xuất điều chỉnh điểm</Button>}
      {can(role, 'agents.suspend') && (locked
        ? <Button variant="primary" icon="refresh" disabled={reactivate.isPending} onClick={() => reactivate.mutate()}>Kích hoạt lại</Button>
        : <Button variant="danger" icon="x" onClick={() => setDialog('suspend')}>Tạm ngưng</Button>)}
    </>
  );

  const exp = p?.expiring[0];
  return (
    <AdminShell screen="W04" crumb="Danh sách đại lý" title="Hồ sơ đại lý" actions={actions}>
      {locked && (
        <div className="demo-note demo-note--warn w04-locked"><Icon name="lock" size={16} />
          <span><b>Đại lý đang tạm ngưng.</b> {a.suspendReason ? <>Lý do: {a.suspendReason}. </> : null}Tài khoản app đã khoá, không đặt hàng và không tích điểm mới.{can(role, 'agents.suspend') ? ' Bấm "Kích hoạt lại" khi đủ điều kiện.' : ''}</span>
        </div>
      )}
      <Card>
        <div className="w04-ph">
          <div className="w04-ph__name">
            <div className="demo-row"><TierBadge tier={a.tier as Tier} size="lg" /><StatusBadge tone={st[0]}>{st[1]}</StatusBadge>{a.flags.includes('expiring') && <StatusBadge tone="warning">HĐ sắp hết hạn</StatusBadge>}</div>
            <h2>{a.name}</h2>
            <div className="w04-ph__meta">{a.id} · {a.type} · {a.city} · Sale: <b>{a.saleName}</b></div>
            <div className="demo-row">
              {phoneReal ? <a className="dmp-btn dmp-btn--secondary dmp-btn--md w04-a" href={'tel:' + phoneReal}><Icon name="phone" size={16} />Gọi</a> : <Button icon="phone" disabled title="SĐT đang bị che">Gọi</Button>}
              {phoneReal ? <a className="dmp-btn dmp-btn--secondary dmp-btn--md w04-a" href={'https://zalo.me/' + phoneReal} target="_blank" rel="noreferrer"><Icon name="chat" size={16} />Chat Zalo</a> : <Button icon="chat" disabled>Chat Zalo</Button>}
              <span className="demo-sub">Lịch sử chăm sóc lấy từ Zalo CRM</span>
            </div>
          </div>
          <div className="w04-ph__pts">
            <span className="w04-label">Điểm hạng</span><span className="w04-big">{num(p?.rank ?? a.rankPoints)}</span>
            {p && <TierProgress compact tier={a.tier as Tier} value={p.progress.value} target={p.progress.target} nextTier={p.progress.next as Tier | null}
              footnote={`${p.protectedUntil ? `Bảo vệ hạng ${tierName(a.tier)} tới ${date(p.protectedUntil)} · ` : ''}xét hạng ${date(new Date(now.getFullYear(), now.getMonth() + 1, 1)).slice(0, 5)}`} />}
          </div>
          <div className="w04-ph__pts">
            <span className="w04-label">Điểm thưởng khả dụng</span><span className="w04-big w04-big--primary">{num(p?.reward ?? a.rewardPoints)}</span>
            {(p?.pending ?? a.pendingPoints) > 0 && <span className="w04-pending">+{num(p?.pending ?? a.pendingPoints)} điểm đang chờ thanh toán</span>}
            {exp && <span className="demo-sub">{num(exp.points)} điểm hết hạn {date(exp.date)}</span>}
          </div>
        </div>
      </Card>
      <div className="w04-tabwrap">
        <Tabs key={role} items={tabs} value={curTab} onChange={setTab} />
        <div className="w04-tabbody">{body}</div>
      </div>

      {dialog === 'explain' && p && (
        <QuickView title="Vì sao có số điểm này?" onClose={() => setDialog(null)}>
          <InfoGrid cols={2} items={[
            [`Điểm hạng ${num(p.rank)}`, 'Tổng điểm hạng trong kỳ xét hạng; không bị trừ khi đổi quà'],
            [`Điểm thưởng ${num(p.reward)}`, `Cộng dồn các lô còn hạn (FIFO)${exp ? `; lô gần nhất hết hạn ${date(exp.date)}` : ''}`],
            [`+${num(p.pending)} đang chờ`, unpaid.length ? `Đơn ${unpaid.filter((o) => o.pointState === 'pending').map((o) => o.id).join(', ') || '—'} chưa thanh toán đủ` : 'Không có đơn chờ thanh toán'],
            [`Hạng ${tierName(p.tier)}`, p.protectedUntil ? `Đang bảo vệ hạng tới ${date(p.protectedUntil)}` : p.progress.next ? `Còn ${num(p.progress.remaining)} điểm để lên ${tierName(p.progress.next)}` : 'Hạng cao nhất'],
            ['Giá trị điểm', `1 điểm = ${vnd(p.pointValueVND)} · quy tắc v${p.ruleVersion}`],
          ]} />
        </QuickView>
      )}
      {(dialog === 'points' || dialog === 'adjust') && <PointsDialog agentId={a.id} adjust={dialog === 'adjust'} onClose={() => setDialog(null)} />}
      {dialog === 'tier' && <TierDialog agentId={a.id} current={a.tier} onClose={() => setDialog(null)} />}
      {dialog === 'credit' && <CreditDialog agentId={a.id} overdue={a.overdueDays} onClose={() => setDialog(null)} />}
      {dialog === 'suspend' && <SuspendDialog agentId={a.id} name={a.name} onClose={() => setDialog(null)} />}
      {dialog === 'sensitive' && <SensitiveDialog agentId={a.id} bankName={a.bankName} onClose={() => setDialog(null)} />}
    </AdminShell>
  );
}

/* ---------- Giấy tờ đính kèm ---------- */
function AgentDocs({ agentId, docFiles, canUpload, lockId }: { agentId: string; docFiles: Record<string, string>; canUpload: boolean; lockId: boolean }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const keys = [...DOC_KEYS, ...Object.keys(docFiles).filter((k) => !DOC_KEYS.includes(k) && !(k === 'Giấy phép kinh doanh' && docFiles.GPKD))];
  const attach = useAction((v: { label: string; fileId: string | null }) => api.patch(`/agents/${agentId}/docs`, v), {
    invalidate: ['/agents/' + agentId],
    success: (_r, v) => ({ tone: 'success', title: v.fileId ? `Đã lưu ${DOC_NAME[v.label] ?? v.label}` : `Đã gỡ ${DOC_NAME[v.label] ?? v.label}`, body: 'Thao tác được ghi nhật ký.' }),
  });
  const pick = (label: string) => { setTarget(label); input.current?.click(); };
  const onFile = async (f: File | undefined) => {
    if (!f || !target) return;
    setBusy(target);
    try {
      const up = await uploadFile(f).catch((e: Error) => { toast({ tone: 'danger', title: 'Tải file thất bại', body: e.message }); return null; });
      if (up) await attach.mutateAsync({ label: target, fileId: up.id }).catch(() => null); // lỗi đã báo qua useAction
    } finally { setBusy(null); setTarget(null); if (input.current) input.current.value = ''; }
  };
  return (
    <div>
      <div className="w04-label">Giấy tờ đính kèm</div>
      <input ref={input} type="file" hidden accept="image/*,application/pdf" onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="w04-docs">{keys.map((k) => {
        const fid = docFiles[k] ?? (k === 'GPKD' ? docFiles['Giấy phép kinh doanh'] : undefined);
        const hide = k.startsWith('CCCD') && lockId;
        const name = DOC_NAME[k] ?? k;
        return (
          <div key={k} className={'w04-doc' + (fid && !hide ? ' has-file' : '')}>
            {hide ? <><Icon name="lock" size={20} />{name}<span className="demo-sub">{fid ? 'Đã có · vai trò không xem được ảnh' : 'Ảnh không hiển thị'}</span></>
              : fid ? <a className="w04-doc__file" href={fileUrl(fid)} target="_blank" rel="noreferrer" title={`Mở ${name}`}><DocThumb id={fid} /><span>{name}</span></a>
                : <><Icon name="image" size={20} />{name}<span className="demo-sub">Chưa có</span></>}
            {canUpload && !hide && (
              <button type="button" className="demo-link w04-doc__act" disabled={!!busy} onClick={() => pick(k)}>{busy === k ? 'Đang tải…' : fid ? 'Thay file' : 'Tải lên'}</button>
            )}
          </div>
        );
      })}</div>
      {canUpload && <div className="demo-sub w04-mt">Ảnh hoặc PDF, tối đa 15MB. Mỗi lần tải lên/thay được ghi nhật ký.</div>}
    </div>
  );
}

/** Ảnh thu nhỏ; file không phải ảnh (PDF…) hiện biểu tượng. */
function DocThumb({ id }: { id: string }) {
  const [bad, setBad] = useState(false);
  return bad ? <span className="w04-doc__icon"><Icon name="file" size={28} /></span> : <img className="w04-doc__img" src={fileUrl(id)} alt="" onError={() => setBad(true)} />;
}

function SuspendDialog({ agentId, name, onClose }: { agentId: string; name: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const send = useAction(() => api.post(`/agents/${agentId}/suspend`, { reason: reason.trim() }), {
    success: () => ({ tone: 'warning', title: `Đã tạm ngưng ${name}`, body: 'Tài khoản app đã khoá. Zalo CRM đã nhận thông báo.' }), onDone: onClose,
  });
  return (
    <QuickView title="Tạm ngưng đại lý" onClose={onClose}
      footer={<><Button onClick={onClose}>Huỷ</Button><Button variant="danger" icon="x" disabled={!reason.trim() || send.isPending} onClick={() => send.mutate()}>Xác nhận tạm ngưng</Button></>}>
      <div className="w04-form">
        <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Khi tạm ngưng: mọi tài khoản app của {name} bị khoá, không đặt hàng và không tích điểm mới. Điểm hiện có được giữ nguyên. Có thể kích hoạt lại bất cứ lúc nào.</div>
        <Field label="Lý do tạm ngưng" as="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Ngừng hợp tác theo đề nghị của đại lý" hint="Hiện trên hồ sơ và ghi nhật ký" />
      </div>
    </QuickView>
  );
}

/* ---------- Popup đề xuất ---------- */
function PointsDialog({ agentId, adjust, onClose }: { agentId: string; adjust: boolean; onClose: () => void }) {
  const [points, setPoints] = useState('');
  const [title, setTitle] = useState(adjust ? 'Điều chỉnh sai sót' : '');
  const [reason, setReason] = useState('');
  const send = useAction(() => api.post('/points/manual', { agentIds: [agentId], points: Number(points), title, reason, kind: adjust ? 'adjust' : 'manual' }), {
    success: () => ({ tone: 'success', title: adjust ? 'Đã gửi đề xuất điều chỉnh điểm' : 'Đã gửi đề xuất cộng điểm', body: 'Chờ BOD duyệt ở Hàng chờ duyệt.' }), onDone: onClose,
  });
  const n = Number(points);
  const ok = points !== '' && Number.isInteger(n) && n !== 0 && (adjust || n > 0) && title.trim() && reason.trim();
  return (
    <QuickView title={adjust ? 'Đề xuất điều chỉnh điểm' : 'Đề xuất cộng điểm'} onClose={onClose}
      footer={<><Button onClick={onClose}>Huỷ</Button><Button variant="primary" icon="send" disabled={!ok || send.isPending} onClick={() => send.mutate()}>Gửi BOD duyệt</Button></>}>
      <div className="w04-form">
        <Field label="Số điểm" required inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(adjust ? /[^\d-]/g : /\D/g, ''))} hint={adjust ? 'Số âm để trừ điểm' : 'Số nguyên dương'} suffix="điểm" />
        <Field label="Hạng mục" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Trưng bày đạt chuẩn tháng 10" />
        <Field label="Lý do" as="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </QuickView>
  );
}

function TierDialog({ agentId, current, onClose }: { agentId: string; current: string; onClose: () => void }) {
  const higher = TIER_ORDER.filter((t) => TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(current as STier));
  const [tier, setTier] = useState<string>(higher[0] ?? '');
  const [reason, setReason] = useState('');
  const send = useAction(() => api.post(`/agents/${agentId}/requests`, { kind: 'tier', tier, reason }), { success: 'Đã gửi đề xuất nâng hạng — chờ BOD duyệt', onDone: onClose });
  return (
    <QuickView title="Đề xuất nâng hạng tay" onClose={onClose}
      footer={<><Button onClick={onClose}>Huỷ</Button><Button variant="primary" icon="send" disabled={!tier || !reason.trim() || send.isPending} onClick={() => send.mutate()}>Gửi BOD duyệt</Button></>}>
      <div className="w04-form">
        {higher.length ? <Field label="Hạng đề xuất" as="select" value={tier} onChange={(e) => setTier(e.target.value)} options={higher.map((t) => ({ value: t, label: tierName(t) }))} hint={`Hạng hiện tại: ${tierName(current)}`} />
          : <div className="demo-note demo-note--muted">Đại lý đang ở hạng cao nhất.</div>}
        <Field label="Lý do" as="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </QuickView>
  );
}

function CreditDialog({ agentId, overdue, onClose }: { agentId: string; overdue: number; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const send = useAction(() => api.post(`/agents/${agentId}/requests`, { kind: 'credit', amount: Number(amount), reason }), { success: 'Đã gửi đề xuất ngoại lệ công nợ — chờ BOD duyệt', onDone: onClose });
  return (
    <QuickView title="Ngoại lệ đặt hàng khi nợ quá hạn" onClose={onClose}
      footer={<><Button onClick={onClose}>Huỷ</Button><Button variant="primary" icon="send" disabled={!Number(amount) || !reason.trim() || send.isPending} onClick={() => send.mutate()}>Gửi BOD duyệt</Button></>}>
      <div className="w04-form">
        <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Đại lý đang nợ quá hạn {overdue} ngày.</div>
        <Field label="Giá trị đơn cần đặt" required inputMode="numeric" value={amount ? num(Number(amount)) : ''} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} suffix="đ" />
        <Field label="Lý do" as="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </QuickView>
  );
}

function SensitiveDialog({ agentId, bankName, onClose }: { agentId: string; bankName: string; onClose: () => void }) {
  const [bank, setBank] = useState('');
  const [bn, setBn] = useState(bankName);
  const [idCard, setIdCard] = useState('');
  const send = useAction(() => api.patch(`/agents/${agentId}/sensitive`, { ...(bank ? { bank } : {}), ...(bn && bn !== bankName ? { bankName: bn } : {}), ...(idCard ? { idCard } : {}) }), {
    success: 'Đã cập nhật — giá trị cũ/mới (đã che) được ghi nhật ký', onDone: onClose,
  });
  return (
    <QuickView title="Sửa thông tin nhạy cảm" onClose={onClose}
      footer={<><Button onClick={onClose}>Huỷ</Button><Button variant="primary" icon="check" disabled={(!bank && !idCard && bn === bankName) || send.isPending} onClick={() => send.mutate()}>Lưu</Button></>}>
      <div className="w04-form">
        <Field label="Số tài khoản mới" inputMode="numeric" value={bank} onChange={(e) => setBank(e.target.value.replace(/\D/g, ''))} hint="Để trống nếu không đổi" />
        <Field label="Ngân hàng" value={bn} onChange={(e) => setBn(e.target.value)} />
        <Field label="Số CCCD mới" inputMode="numeric" value={idCard} onChange={(e) => setIdCard(e.target.value.replace(/\D/g, '').slice(0, 12))} hint="12 số · để trống nếu không đổi" />
        <div className="demo-note demo-note--muted"><Icon name="shield" size={16} />Chỉ Kế toán được sửa. Mọi thay đổi ghi nhật ký với giá trị đã che.</div>
      </div>
    </QuickView>
  );
}

