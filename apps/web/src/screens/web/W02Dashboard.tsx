import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { can, ROLE_LABEL, type Role } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, FilterChip, Icon, KpiCard, PointValue, StatusBadge, TierBadge, TierIcon, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { BarLine, HBars } from '../../shell/charts';
import { pathOf } from '../../shell/registry';
import { api, downloadExport } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, dateTime, mil, num, tierName, ty, vnd } from '../../lib/fmt';
import type { Agent, Approval, Order, Product, Redemption, RuleSet } from '../../lib/types';
import './W02Dashboard.css';

interface ListAgent { id: string; name: string; tier: string; lastOrder: string; salesMonth: number; debt: number | null; overdueDays: number; dob: string; contractEnd: string; commitPct: number }
interface Dashboard {
  role: string;
  kpi: {
    agents: number; active: number; activeRate: number; salesMonth: number; salesLastMonth: number; commitMonth: number; commitPct: number;
    pointsIssued: number; pointsRedeemed: number; pendingPointsOrders: number; approvalsPending: number; redemptionsOpen: number; applicationsOpen: number;
    debtTotal: number | null; overdueCount: number;
  };
  series: Array<{ month: string; revenue: number; revenueLY: number; issued: number; redeemed: number; activeRate: number; commitActual: number }>;
  tierDist: Array<{ tier: string; count: number; prev: number | null }>;
  lists: { dormant: ListAgent[]; atrisk: ListAgent[]; expiring: ListAgent[]; birthday: ListAgent[]; overdue: ListAgent[] };
  queues: {
    approvals: Array<{ id: string; kind: string; title: string; points: number | null; requestedBy: string; requestedAt: string; dueAt: string | null }>;
    redemptions: Array<{ id: string; stage: string; giftName: string; points: number; agentId: string }>;
    applications: Array<{ id: string; name: string; stage: string }>;
  };
}

/** Tiền lớn: ≥ 1 tỷ hiện “4,82 tỷ”, còn lại “820 triệu”. */
const big = (v: number) => (Math.abs(v) >= 1e9 ? ty(v) : mil(v));
const pct1 = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 1000) / 10 : 0);
const monthNo = (m?: string) => (m ? (m.match(/T(\d+)/)?.[1] ?? m) : '');
/** Ngày xét hạng: 01 tháng sau. */
const nextReview = () => { const d = new Date(); return date(new Date(d.getFullYear(), d.getMonth() + 1, 1)); };

/** W02 Trang chủ theo vai trò — BOD (tổng quan), Sale (việc cần làm), Kế toán (hàng chờ), Marketing (hoạt động & campaign). */
export default function W02Dashboard() {
  const { user } = useSession();
  const role = user!.role as Role;
  const q = useApi<Dashboard>('/dashboard');
  const view = role === 'SALE' ? 'sale' : role === 'KT' ? 'kt' : role === 'MKT' ? 'mkt' : role === 'KHO' ? 'kho' : role === 'SA' ? 'sa' : 'bod';
  const title = { bod: 'Tổng quan kinh doanh', kt: 'Việc chờ xử lý của Kế toán', sale: `Chào ${user!.name}, hôm nay có việc cần làm`, mkt: 'Hoạt động & campaign', kho: 'Quà cần chuẩn bị & giao', sa: 'Tổng quan hệ thống' }[view];
  const d = q.data;
  return (
    <AdminShell screen="W02" title={title} sub={`Cập nhật ${dateTime(new Date())} · đồng bộ KiotViet 15 phút/lần`}
      actions={view === 'bod' && d && can(role, 'export.excel') ? <ExportBtn /> : null}>
      {q.isLoading ? <Loading /> : q.error || !d ? <ErrorNote error={q.error} /> : (
        view === 'sale' ? <Sale d={d} /> : view === 'kt' ? <Kt d={d} /> : view === 'mkt' ? <Mkt d={d} /> : view === 'kho' ? <Kho /> : view === 'sa' ? <Sa d={d} /> : <Bod d={d} role={role} />
      )}
    </AdminShell>
  );
}

/* ---------- Xuất Excel phía server (ghi audit log) ---------- */
function ExportBtn() {
  return <Button icon="download" onClick={() => downloadExport('agents')} title="Danh sách đại lý kèm hạng, điểm, doanh số · mỗi lần xuất được ghi nhật ký">Xuất Excel</Button>;
}

/* ---------- BOD / KTT / TPKD ---------- */
/** Phân bổ hạng: cột = tháng này, vạch = tháng trước (không có với Sale vì chỉ thấy đại lý mình phụ trách). */
function TierDistCard({ d, m, prevM }: { d: Dashboard; m: string; prevM: string }) {
  const hasPrev = d.tierDist.some((t) => t.prev != null);
  const delta = (t: Dashboard['tierDist'][number]) => (t.prev == null ? null : t.count - t.prev);
  const dl = (n: number | null) => (n == null || n === 0 ? '' : n > 0 ? ` (+${n})` : ` (${n})`);
  return (
    <Card title="Phân bổ hạng" subtitle={`${d.kpi.agents} đại lý · tháng ${m}${hasPrev ? ` · vạch dọc: tháng ${prevM}` : ''}`}>
      <HBars compare={hasPrev} rows={d.tierDist.map((t) => {
        const n = delta(t);
        return {
          label: <TierBadge tier={t.tier as Tier} />, value: t.count, compare: t.prev ?? undefined,
          valueLabel: <span>{t.count}{n ? <span className={'w02-tdelta ' + (n > 0 ? 'is-up' : 'is-down')}>{dl(n)}</span> : null}</span>,
          tip: `Tháng ${m}: ${t.count} đại lý hạng ${tierName(t.tier)}${t.prev != null ? ` · tháng ${prevM}: ${t.prev}` : ''}`,
        };
      })} />
    </Card>
  );
}

const TONE: Record<string, ['danger' | 'warning' | 'dormant', string]> = { overdue: ['danger', 'Nợ quá hạn'], atrisk: ['warning', 'Sắp rớt hạng'], dormant: ['dormant', 'Ngủ đông'], expiring: ['warning', 'HĐ sắp hết hạn'] };
type AlertKind = 'overdue' | 'atrisk' | 'dormant' | 'expiring';

function AlertTable({ d }: { d: Dashboard }) {
  const nav = useNavigate();
  const [flt, setFlt] = useState<'all' | AlertKind>('all');
  const all = [
    ...d.lists.overdue.map((a) => ({ key: a.id + 'o', a, kind: 'overdue' as const, note: a.debt != null ? `Nợ quá hạn ${vnd(a.debt)} · ${a.overdueDays} ngày` : `Quá hạn ${a.overdueDays} ngày` })),
    ...d.lists.atrisk.map((a) => ({ key: a.id + 'r', a, kind: 'atrisk' as const, note: `Doanh số tháng ${mil(a.salesMonth)} · đạt ${a.commitPct}% cam kết` })),
    ...d.lists.dormant.map((a) => ({ key: a.id + 'd', a, kind: 'dormant' as const, note: `Đơn gần nhất ${date(a.lastOrder)}` })),
    ...d.lists.expiring.map((a) => ({ key: a.id + 'e', a, kind: 'expiring' as const, note: `Hợp đồng hết hạn ${date(a.contractEnd)}` })),
  ];
  const rows = all.filter((r) => flt === 'all' || r.kind === flt);
  const chips: Array<['all' | AlertKind, string, number]> = [['all', 'Tất cả', all.length], ['overdue', 'Nợ quá hạn', d.lists.overdue.length], ['atrisk', 'Sắp rớt hạng', d.lists.atrisk.length], ['dormant', 'Ngủ đông', d.lists.dormant.length], ['expiring', 'HĐ sắp hết hạn', d.lists.expiring.length]];
  return (
    <div className="w02-stack">
      <div className="demo-row">{chips.map(([k, l, n]) => <FilterChip key={k} selected={flt === k} count={n} onClick={() => setFlt(k)}>{l}</FilterChip>)}</div>
      <DataTable rows={rows} rowKey="key" itemLabel="cảnh báo" onRowClick={(r) => nav(pathOf('W04', { id: r.a.id }))}
        rowTone={(r) => (r.kind === 'expiring' ? 'atrisk' : r.kind)}
        empty={<EmptyState icon="check" title="Không có cảnh báo" body="Mọi đại lý đều ổn trong nhóm này." />}
        columns={[
          { key: 'a', label: 'Đại lý', primary: true, render: (r) => <div><div className="demo-strong">{r.a.name}</div><div className="demo-sub">{r.a.id}</div></div> },
          { key: 't', label: 'Hạng', render: (r) => <TierBadge tier={r.a.tier as Tier} /> },
          { key: 'note', label: 'Chi tiết', render: (r) => r.note },
          { key: 'k', label: 'Cảnh báo', render: (r) => <StatusBadge tone={TONE[r.kind][0]}>{TONE[r.kind][1]}</StatusBadge> },
        ]} />
    </div>
  );
}

function Bod({ d, role }: { d: Dashboard; role: Role }) {
  const nav = useNavigate();
  const ag = useApi<Agent[]>(can(role, 'agents.view') ? '/agents' : null);
  const rules = useApi<{ active: RuleSet | null }>(can(role, 'rules.view') ? '/rules' : null);
  const k = d.kpi;
  const A = ag.data ?? [];
  const last = d.series.at(-1), prev = d.series.at(-2);
  const m = monthNo(last?.month);
  const vip = A.filter((a) => ['gold', 'diamond', 'strategic'].includes(a.tier));
  const vipActive = vip.filter((a) => a.salesMonth > 0).length;
  const appOn = A.filter((a) => a.appActivated).length;
  const reward = A.reduce((t, a) => t + a.rewardPoints, 0);
  const overdueDebt = d.lists.overdue.reduce((t, a) => t + (a.debt ?? 0), 0);
  const debtVisible = d.lists.overdue.some((a) => a.debt != null) || d.lists.overdue.length === 0;
  const pv = rules.data?.active?.params?.pointValueVND;
  const top = [...A].sort((a, b) => b.salesMonth - a.salesMonth).slice(0, 10);
  const toTy = (v: number) => Math.round(v / 1e7) / 100;
  return (
    <>
      <div className="demo-grid demo-grid--4">
        <KpiCard label={`Doanh số tháng ${m}`} value={ty(k.salesMonth)} delta={pct1(k.salesMonth, k.salesLastMonth)} deltaLabel="so tháng trước" />
        <KpiCard label="Tỷ lệ đại lý active" value={k.activeRate + '%'} delta={last && prev ? Math.round((last.activeRate - prev.activeRate) * 10) / 10 : undefined} deltaLabel="so tháng trước" hint={`${k.active}/${k.agents}`} />
        <KpiCard label="Active nhóm VIP" value={vip.length ? Math.round((vipActive / vip.length) * 100) + '%' : '—'} hint={`${vipActive}/${vip.length} · Vàng, KC, Đối tác CL`} />
        <KpiCard label="Công nợ quá hạn" value={debtVisible ? mil(overdueDebt) : 'Đã ẩn'} tone="danger" hint={`${k.overdueCount} đại lý`} onClick={() => nav('/debt')} />
        <KpiCard label="Điểm phát sinh tháng" value={num(k.pointsIssued)} hint={`Đã đổi ${num(k.pointsRedeemed)}${A.length ? ' · Tồn ' + num(reward) : ''}`} />
        <KpiCard label="Chi phí điểm / doanh số" value={pv && k.salesMonth ? String(Math.round(((k.pointsIssued * pv) / k.salesMonth) * 1000) / 10).replace('.', ',') + '%' : '—'}
          hint={pv ? `${num(k.pointsIssued)} điểm × ${vnd(pv)} / ${ty(k.salesMonth)}` : 'Cần quyền xem quy tắc điểm'} />
        <KpiCard label="Tỷ lệ đạt cam kết HĐ" value={k.commitPct + '%'} hint={`${big(k.salesMonth)} / ${big(k.commitMonth)} cam kết`} />
        <KpiCard label="Tỷ lệ kích hoạt app" value={A.length ? Math.round((appOn / A.length) * 100) + '%' : '—'} hint={A.length ? `${appOn}/${A.length} đại lý` : undefined} />
      </div>
      <Card title="Doanh số 12 tháng" subtitle="Tỷ đồng · cột: năm nay · nét đứt: cùng kỳ năm trước">
        <BarLine labels={d.series.map((s) => s.month)} bars={{ name: 'Năm nay', values: d.series.map((s) => toTy(s.revenue)) }} line={{ name: 'Cùng kỳ', values: d.series.map((s) => toTy(s.revenueLY)) }}
          format={(v) => String(v).replace('.', ',') + ' tỷ'} tick={(v) => String(v).replace('.', ',')} height={220} width={980} highlightLast />
      </Card>
      <div className="demo-grid demo-grid--side">
        <Card title="Danh sách cảnh báo" subtitle="Bấm chip để lọc · bấm dòng để mở hồ sơ"><AlertTable d={d} /></Card>
        <div className="demo-grid">
          <TierDistCard d={d} m={m} prevM={monthNo(prev?.month)} />
          {A.length > 0 && (
            <Card title={`Top 10 đại lý tháng ${m}`}>
              <ol className="w02-top10">{top.map((a) => (
                <li key={a.id}><span className="w02-top10__c"><TierIcon tier={a.tier as Tier} size={18} label={tierName(a.tier)} /><button type="button" className="w02-top10__n" title={a.name} onClick={() => nav(pathOf('W04', { id: a.id }))}>{a.name}</button></span><span className="demo-num">{big(a.salesMonth)}</span></li>
              ))}</ol>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- Sale: việc cần làm hôm nay (375px) ---------- */
interface TaskItem { id: string; name: string; tier: string; extra?: ReactNode }
function Sale({ d }: { d: Dashboard }) {
  const nav = useNavigate();
  const ag = useApi<Agent[]>('/agents');
  const ord = useApi<Order[]>('/orders');
  const red = useApi<Redemption[]>('/redemptions');
  const [openSel, setOpen] = useState<string | null | undefined>(undefined);
  const A = ag.data ?? [];
  const byId = new Map(A.map((a) => [a.id, a]));
  const asItem = (a: ListAgent, extra?: ReactNode): TaskItem => ({ id: a.id, name: a.name, tier: a.tier, extra });
  const waiting = (ord.data ?? []).filter((o) => o.status === 'Chờ duyệt');
  const newReds = (red.data ?? []).filter((r) => r.stage === 'new');
  const groups: Array<[string, string, string, string, TaskItem[]]> = [
    ['dormant', 'dormant', 'Đại lý ngủ đông', 'Lâu chưa có đơn — gọi chăm sóc', d.lists.dormant.map((a) => asItem(a, `Đơn gần nhất ${date(a.lastOrder)}`))],
    ['atrisk', 'warning', 'Đại lý sắp rớt hạng', `Cần thêm doanh số trước ngày xét hạng ${nextReview()}`, d.lists.atrisk.map((a) => asItem(a, `Đạt ${a.commitPct}% cam kết`))],
    ['expiring', 'warning', 'Hợp đồng sắp hết hạn', 'Trong 30 ngày tới — chuẩn bị gia hạn', d.lists.expiring.map((a) => asItem(a, `Hết hạn ${date(a.contractEnd)}`))],
    ['birthday', 'info', 'Sinh nhật tuần này', 'Gửi lời chúc qua Zalo, hệ thống tự cộng điểm sinh nhật', d.lists.birthday.map((a) => asItem(a, a.dob ? `Sinh nhật ${a.dob.slice(0, 5)}` : undefined))],
    ['orders', 'pending', 'Đơn chờ duyệt', 'Đơn của đại lý mình đang chờ Kế toán', waiting.map((o) => ({ id: o.agentId, name: o.agentName, tier: o.tierAtOrder, extra: `${o.id} · ${vnd(o.value)}` }))],
    ['gifts', 'pending', 'Quà cần xác nhận', 'Đại lý mình vừa gửi yêu cầu đổi quà', newReds.map((r) => ({ id: r.agentId, name: r.agentName ?? r.agentId, tier: r.tier ?? 'member', extra: `${r.id} · ${r.giftName}` }))],
  ];
  const total = groups.reduce((s, g) => s + g[4].length, 0);
  const open = openSel === undefined ? (groups.find((g) => g[4].length)?.[0] ?? null) : openSel;
  const k = d.kpi;
  const m = monthNo(d.series.at(-1)?.month);
  const remain = Math.max(0, k.commitMonth - k.salesMonth);
  return (
    <div className="demo-grid demo-grid--side">
      <Card title={`Việc cần làm hôm nay (${total})`} subtitle="Bấm từng nhóm để xem danh sách và gọi ngay">
        <ul className="w02-tasks">{groups.map(([key, tone, t, sub, items]) => {
          const on = open === key;
          return (
            <li key={key} className="w02-task">
              <button type="button" className="w02-task__head" aria-expanded={on} onClick={() => setOpen(on ? null : key)}>
                <span className={'w02-task__n w02-n-' + tone}>{items.length}</span>
                <span className="w02-task__t"><b>{t}</b><span>{sub}</span></span>
                <Icon name="chevronRight" size={18} className={on ? 'w02-rot' : undefined} />
              </button>
              {on && (items.length ? (
                <ul className="w02-task__list">{items.map((a, i) => {
                  const ph = byId.get(a.id)?.phone;
                  const real = ph && !byId.get(a.id)?.masked.phone ? ph.replace(/\s/g, '') : null;
                  return (
                    <li key={a.id + i}>
                      <span className="w02-task__who"><button type="button" className="demo-link" onClick={() => nav(pathOf('W04', { id: a.id }))}>{a.name}</button> <span className="demo-sub">{a.id}{a.extra ? <> · {a.extra}</> : null}</span></span>
                      <span className="demo-row">
                        <TierBadge tier={a.tier as Tier} />
                        {real && <a className="dmp-btn dmp-btn--secondary dmp-btn--md" href={'tel:' + real}><Icon name="phone" size={16} />Gọi</a>}
                        {real && <a className="dmp-btn dmp-btn--secondary dmp-btn--md" href={'https://zalo.me/' + real} target="_blank" rel="noreferrer"><Icon name="chat" size={16} />Zalo</a>}
                        {key === 'gifts' && <Button onClick={() => nav('/redemptions')}>Xác nhận</Button>}
                      </span>
                    </li>
                  );
                })}</ul>
              ) : <div className="w02-task__empty demo-muted">Không có việc trong nhóm này.</div>)}
            </li>
          );
        })}</ul>
      </Card>
      <div className="demo-grid">
        <KpiCard label={`Doanh số đại lý phụ trách T${m}`} value={big(k.salesMonth)} delta={pct1(k.salesMonth, k.salesLastMonth)} deltaLabel="so tháng trước" hint={`${k.commitPct}% tổng cam kết ${big(k.commitMonth)}`} />
        <Card title={`Tiến độ cam kết tháng ${m}`}>
          <div className="dmp-progress">
            <div className="dmp-progress__track" role="progressbar" aria-valuenow={k.commitPct} aria-valuemin={0} aria-valuemax={100}><div className="dmp-progress__fill" style={{ width: Math.min(100, k.commitPct) + '%' }} /></div>
            <div className="dmp-progress__msg">{remain > 0 ? <>Còn <strong>{big(remain)}</strong> để đạt tổng cam kết {big(k.commitMonth)}</> : <>Đã đạt tổng cam kết {big(k.commitMonth)}</>}</div>
          </div>
        </Card>
        <KpiCard label="Đại lý active" value={`${k.active} / ${k.agents}`} hint={`${k.activeRate}% có đơn trong tháng`} onClick={() => nav('/agents')} />
      </div>
    </div>
  );
}

/* ---------- Kế toán ---------- */
function Kt({ d }: { d: Dashboard }) {
  const nav = useNavigate();
  const ord = useApi<Order[]>('/orders');
  const approve = useAction((id: string) => api.post(`/orders/${id}/approve`), { success: 'Đã duyệt đơn — điểm ở trạng thái Treo chờ thanh toán' });
  const pay = useAction((id: string) => api.post<{ activated: number; id: string }>(`/orders/${id}/payment`), {
    success: (r) => ({ tone: 'success', title: `+${num(r.activated)} điểm đã chuyển sang Khả dụng`, body: `Đã gửi ZNS báo cộng điểm cho đại lý. Đơn ${r.id} đã thanh toán đủ.` }),
  });
  if (ord.isLoading) return <Loading />;
  if (ord.error) return <ErrorNote error={ord.error} />;
  const O = ord.data ?? [];
  const waiting = O.filter((o) => o.status === 'Chờ duyệt');
  const unpaid = O.filter((o) => o.status !== 'Huỷ' && o.status !== 'Chờ duyệt' && o.pay !== 'Đã thanh toán' && o.pointState === 'pending');
  const redConfirmed = d.queues.redemptions.filter((r) => r.stage === 'confirmed').length;
  const pendingPts = O.filter((o) => o.pointState === 'pending').reduce((s, o) => s + Math.round(o.points * (1 - o.returnedPct)), 0);
  const apps = d.queues.applications.filter((a) => a.stage === 'KT cấp mã');
  return (
    <>
      <div className="demo-grid demo-grid--4">
        <KpiCard label="Đơn chờ duyệt" value={waiting.length} tone={waiting.length ? 'warning' : undefined} hint="SLA: trong ngày" onClick={() => nav('/orders')} />
        <KpiCard label="Thanh toán cần ghi nhận" value={unpaid.length} hint="Đơn còn điểm treo" onClick={() => nav('/debt')} />
        <KpiCard label="Đổi quà chờ duyệt" value={redConfirmed} hint="Sale đã xác nhận" onClick={() => nav('/redemptions')} />
        <KpiCard label="Điểm đang treo" value={num(pendingPts)} hint="Chờ thanh toán đủ" />
      </div>
      {apps.length > 0 && (
        <div className="demo-note"><Icon name="info" size={16} /><span>{apps.length} hồ sơ đại lý mới đã được BOD duyệt, chờ Kế toán cấp mã: {apps.map((a) => a.name).join(', ')}. <button type="button" className="demo-link" onClick={() => nav(pathOf('W05'))}>Cấp mã ngay</button></span></div>
      )}
      <div className="demo-grid demo-grid--2">
        <Card title="Đơn chờ duyệt" flush>
          <DataTable rows={waiting} rowKey="id" itemLabel="đơn" empty={<EmptyState icon="check" title="Không còn đơn chờ duyệt" />}
            columns={[
              { key: 'id', label: 'Mã đơn', primary: true, render: (o) => <div><b>{o.id}</b><div className="demo-sub">{dateTime(o.orderedAt)}</div></div> },
              { key: 'agentName', label: 'Đại lý' },
              { key: 'value', label: 'Giá trị', align: 'right', render: (o) => vnd(o.value) },
              { key: 'x', label: '', render: (o) => <Button variant="primary" disabled={approve.isPending} onClick={() => approve.mutate(o.id)}>Duyệt</Button> },
            ]} />
        </Card>
        <Card title="Thanh toán cần ghi nhận" flush>
          <DataTable rows={unpaid} rowKey="id" itemLabel="đơn" empty={<EmptyState icon="check" title="Không có thanh toán cần ghi nhận" />}
            columns={[
              { key: 'id', label: 'Đơn', primary: true, render: (o) => <div><b>{o.id}</b><div className="demo-sub">{o.pay}</div></div> },
              { key: 'agentName', label: 'Đại lý' },
              { key: 'p', label: 'Điểm treo', align: 'right', render: (o) => <PointValue value={Math.round(o.points * (1 - o.returnedPct))} state="pending" /> },
              { key: 'x', label: '', render: (o) => <Button disabled={pay.isPending} onClick={() => pay.mutate(o.id)}>Ghi nhận</Button> },
            ]} />
        </Card>
      </div>
    </>
  );
}

/* ---------- Marketing ---------- */
function Mkt({ d }: { d: Dashboard }) {
  const nav = useNavigate();
  const ap = useApi<Approval[]>('/approvals?status=pending');
  const pr = useApi<Product[]>('/products');
  const rows = (ap.data ?? []).filter((a) => a.kind === 'evidence' || a.kind === 'manual');
  const today = new Date().toISOString().slice(0, 10);
  const camp = (pr.data ?? []).filter((p) => p.multiplier > 1 && (!p.multiplierUntil || p.multiplierUntil >= today || /\//.test(p.multiplierUntil)));
  return (
    <div className="demo-grid demo-grid--side">
      <Card title="Bằng chứng hoạt động & đề xuất điểm chờ duyệt" subtitle="Đại lý nộp link, ảnh trên app (GĐ2) · sự kiện, đào tạo do Marketing đề xuất">
        {ap.isLoading ? <Loading /> : ap.error ? <ErrorNote error={ap.error} /> : (
          <DataTable rows={rows} rowKey="id" itemLabel="yêu cầu" onRowClick={() => nav('/approvals')} empty={<EmptyState icon="check" title="Không có yêu cầu chờ duyệt" />}
            columns={[
              { key: 'agentName', label: 'Đại lý', primary: true, render: (r) => <div><div className="demo-strong">{r.agentName ?? 'Nhiều đại lý'}</div><div className="demo-sub">{r.id} · {r.requestedBy}</div></div> },
              { key: 'title', label: 'Hạng mục' },
              { key: 'points', label: 'Điểm', align: 'right', render: (r) => (r.points != null ? <PointValue value={r.points} /> : '—') },
              { key: 'w', label: 'Chờ', render: (r) => <span className="demo-muted">{r.dueAt ? 'Hạn ' + date(r.dueAt) : dateTime(r.requestedAt)}</span> },
            ]} />
        )}
      </Card>
      <div className="demo-grid">
        <Card title="Campaign đang chạy" subtitle="Sản phẩm đang nhân hệ số điểm">
          {pr.isLoading ? <Loading /> : camp.length ? (
            <ul className="w02-camp">{camp.slice(0, 6).map((p) => (
              <li key={p.sku} className="demo-between"><div><b>{p.name} ×{p.multiplier} điểm</b><div className="demo-sub">{p.brand}{p.multiplierUntil ? ' · tới ' + date(p.multiplierUntil) : ''}</div></div><StatusBadge tone="success">Đang chạy</StatusBadge></li>
            ))}</ul>
          ) : <EmptyState icon="star" title="Chưa có campaign nhân điểm" body="Cấu hình hệ số điểm sản phẩm ở màn Sản phẩm & bảng giá." />}
        </Card>
        <Card title="Đại lý (dữ liệu đã che)">
          <div className="demo-muted">Marketing thấy SĐT dạng 091****789, không thấy công nợ và CCCD. Đang có {d.kpi.agents} đại lý, {d.kpi.activeRate}% active tháng này.</div>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Kho ---------- */
function Kho() {
  const nav = useNavigate();
  const red = useApi<Redemption[]>('/redemptions');
  if (red.isLoading) return <Loading />;
  if (red.error) return <ErrorNote error={red.error} />;
  const rows = (red.data ?? []).filter((r) => r.stage === 'approved' || r.stage === 'shipping');
  return (
    <Card title={`Quà cần chuẩn bị & giao (${rows.length})`} subtitle="Kế toán đã duyệt — xuất kho và cập nhật vận chuyển" flush>
      <DataTable rows={rows} rowKey="id" itemLabel="yêu cầu" onRowClick={() => nav('/redemptions')} empty={<EmptyState icon="check" title="Không có quà cần giao" />}
        columns={[
          { key: 'id', label: 'Mã', primary: true, render: (r) => <div><b>{r.id}</b><div className="demo-sub">{dateTime(r.createdAt)}</div></div> },
          { key: 'agentName', label: 'Đại lý' },
          { key: 'giftName', label: 'Quà', render: (r) => `${r.giftName} × ${r.qty}` },
          { key: 'stage', label: 'Bước', render: (r) => <StatusBadge tone={r.stage === 'shipping' ? 'info' : 'pending'}>{r.stage === 'shipping' ? 'Đang giao' : 'Chờ xuất kho'}</StatusBadge> },
        ]} />
    </Card>
  );
}

/* ---------- Quản trị hệ thống ---------- */
function Sa({ d }: { d: Dashboard }) {
  const nav = useNavigate();
  return (
    <>
      <div className="demo-grid demo-grid--4">
        <KpiCard label="Đại lý" value={num(d.kpi.agents)} hint={`${d.kpi.activeRate}% active`} />
        <KpiCard label="Yêu cầu chờ duyệt" value={d.kpi.approvalsPending} />
        <KpiCard label="Đổi quà đang xử lý" value={d.kpi.redemptionsOpen} />
        <KpiCard label="Hồ sơ đại lý mới" value={d.kpi.applicationsOpen} />
      </div>
      <div className="demo-row">
        <Button icon="users" onClick={() => nav('/users')}>Người dùng & phân quyền</Button>
        <Button icon="sliders" onClick={() => nav('/system')}>Hệ thống & tích hợp</Button>
      </div>
      <div className="demo-note demo-note--muted"><Icon name="lock" size={16} />Vai trò {ROLE_LABEL.SA} không xem dữ liệu kinh doanh chi tiết của đại lý.</div>
    </>
  );
}
