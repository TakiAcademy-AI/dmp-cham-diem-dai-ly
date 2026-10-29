import { useState, type ReactNode } from 'react';
import { can, TIER_ORDER } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, Field, Icon, KpiCard, TierBadge, type IconName, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { BarLine, HBars } from '../../shell/charts';
import { downloadExport } from '../../lib/api';
import { ErrorNote, Loading, useApi, useToast } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { mil, num, tierName, vnd } from '../../lib/fmt';
import type { Contract, LedgerRow } from '../../lib/types';
import './W22Reports.css';

interface Month { month: string; revenue: number; revenueLY: number; issued: number; redeemed: number; activeRate: number; commitActual: number }
interface Reports {
  series: Month[];
  bySale: Array<{ id: string; name: string; agents: number; sales: number; active: number; dormant: number }>;
  byTier: Array<{ tier: string; agents: number; sales: number; reward: number }>;
  liability: number; liabilityVND: number;
  top: Array<{ id: string; name: string; tier: string; sales: number; reward: number }>;
  byBrand: Array<{ brand: string; revenue: number; qty: number; orders: number }>;
  tierHistory: Array<{ month: string; counts: Record<string, number> }>;
  commitHistory: Array<{ month: string; sales: number; commit: number }>;
  expiring30: number;
  orderStats: { count: number; avgValue: number };
}

type RepKey = 'sales' | 'points' | 'tiers' | 'rules' | 'commit' | 'active';
const REPORTS: Array<{ key: RepKey; label: string; icon: IconName; roles: string[] }> = [
  { key: 'sales', label: 'Doanh số', icon: 'chart', roles: ['BOD', 'KTT', 'KT', 'TPKD', 'SALE'] },
  { key: 'points', label: 'Điểm phát sinh / đổi / tồn', icon: 'star', roles: ['BOD', 'KTT', 'KT', 'MKT'] },
  { key: 'tiers', label: 'Phân bổ hạng theo tháng', icon: 'award', roles: ['BOD', 'KTT', 'TPKD', 'MKT', 'SALE'] },
  { key: 'rules', label: 'Hiệu quả hạng mục điểm', icon: 'sliders', roles: ['BOD', 'KTT', 'MKT'] },
  { key: 'commit', label: 'Cam kết so với thực tế', icon: 'file', roles: ['BOD', 'KTT', 'KT', 'TPKD', 'SALE'] },
  { key: 'active', label: 'Tỷ lệ active & giữ chân', icon: 'users', roles: ['BOD', 'TPKD', 'SALE', 'MKT'] },
];
const PERIODS = ['Quý này', '6 tháng', '12 tháng', 'Năm 2026'];
/** Báo cáo → file xuất phía server (có ghi nhật ký). Thiếu quyền tải loại đó thì xuất CSV của bảng đang xem. */
const EXPORT: Record<RepKey, { kind: 'agents' | 'orders' | 'ledger' | 'contracts'; perm: 'export.excel' | 'ledger.view'; label: string }> = {
  sales: { kind: 'orders', perm: 'export.excel', label: 'danh sách đơn hàng' },
  points: { kind: 'ledger', perm: 'ledger.view', label: 'sổ cái điểm' },
  tiers: { kind: 'agents', perm: 'export.excel', label: 'danh sách đại lý kèm hạng' },
  rules: { kind: 'ledger', perm: 'ledger.view', label: 'sổ cái điểm' },
  commit: { kind: 'contracts', perm: 'export.excel', label: 'hợp đồng & cam kết' },
  active: { kind: 'agents', perm: 'export.excel', label: 'danh sách đại lý' },
};

const dec = (v: number, d = 2) => String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',');
const tr = (v: number) => dec(v) + ' tỷ';
/** Tiền gọn: ≥ 1 tỷ hiện “x,xx tỷ”, còn lại theo triệu. */
const big = (v: number) => (Math.abs(v) >= 1e9 ? tr(v / 1e9) : mil(v));
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 1000) / 10 : 0);
const pctLabel = (v: number) => (v >= 0 ? '+' : '') + dec(v, 1) + '%';

/** Tải CSV (mở được bằng Excel) — tạo ở trình duyệt từ dữ liệu báo cáo đang xem. */
function downloadCsv(name: string, rows: Array<Array<string | number>>) {
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Gộp sổ điểm theo hạng mục (chỉ bút toán cộng điểm). */
function byCategory(rows: LedgerRow[]) {
  const m = new Map<string, { id: string; n: string; p: number; agents: Set<string>; rule: string }>();
  for (const r of rows) {
    if (r.deltaReward <= 0 || ['reverse', 'redeem', 'expire', 'adjust'].includes(r.type)) continue; // adjust = số dư chuyển đổi/điều chỉnh, không phải hạng mục thưởng
    const n = r.type === 'earn' ? 'Lên đơn & thưởng mốc đơn' : (r.item.split(':')[0] || r.type).trim();
    const x = m.get(n) ?? { id: n, n, p: 0, agents: new Set<string>(), rule: r.rule };
    x.p += r.deltaReward; x.agents.add(r.agentId);
    m.set(n, x);
  }
  return [...m.values()].map((x) => ({ id: x.id, n: x.n, p: x.p, a: x.agents.size, rule: x.rule })).sort((a, b) => b.p - a.p);
}

/** W22 Trung tâm báo cáo — danh sách báo cáo theo vai trò, biểu đồ một trục (cột = thực tế, nét đứt = so sánh). */
export default function W22Reports() {
  const { user } = useSession();
  const role = user!.role;
  const toast = useToast();
  const [rep, setRep] = useState<RepKey>('sales');
  const [period, setPeriod] = useState('12 tháng');
  const avail = REPORTS.filter((x) => x.roles.includes(role));
  const cur = avail.some((x) => x.key === rep) ? rep : avail[0]?.key;

  const q = useApi<Reports>('/reports');
  const ledger = useApi<LedgerRow[]>(cur === 'rules' && can(role, 'ledger.view') ? '/ledger?limit=2000' : null);
  const contracts = useApi<Contract[]>(cur === 'commit' && can(role, 'contracts.view') ? '/contracts' : null);

  const d = q.data;
  const all = d?.series ?? [];
  const series = period === 'Quý này' ? all.slice(-3) : period === '6 tháng' ? all.slice(-6) : period === 'Năm 2026' ? all.filter((s) => s.month.endsWith('/26')) : all;
  const labels = series.map((s) => s.month);
  const last = series.at(-1);
  const sum = (k: keyof Month) => series.reduce((t, s) => t + (s[k] as number), 0);

  let body: ReactNode = null;
  let csv: Array<Array<string | number>> = [];

  if (d && last && cur === 'sales') {
    const rev = sum('revenue'), revLY = sum('revenueLY');
    csv = [['Tháng', 'Doanh số', 'Cùng kỳ năm trước'], ...series.map((s) => [s.month, Math.round(s.revenue), Math.round(s.revenueLY)]), [], ['Nhãn hàng', 'Doanh số', 'Số lượng', 'Số đơn'], ...d.byBrand.map((b) => [b.brand, b.revenue, b.qty, b.orders])];
    body = (<>
      <div className="demo-grid demo-grid--4 w22-kpis">
        <KpiCard label={`Doanh số ${period.toLowerCase()}`} value={tr(rev / 1e9)} delta={pct(rev, revLY)} deltaLabel="so cùng kỳ" />
        <KpiCard label={last.month.replace('T', 'Tháng ').split('/')[0]} value={tr(last.revenue / 1e9)} delta={pct(last.revenue, last.revenueLY)} deltaLabel="so cùng kỳ" />
        <KpiCard label="Số đơn ghi nhận" value={num(d.orderStats.count)} hint="Đơn chưa huỷ trên hệ thống" />
        <KpiCard label="Giá trị đơn TB" value={mil(d.orderStats.avgValue)} hint="Đơn tối thiểu 3 triệu" />
      </div>
      <Card title="Doanh số theo tháng" subtitle="Toàn công ty · tỷ đồng">
        <BarLine labels={labels} bars={{ name: 'Năm nay', values: series.map((s) => s.revenue / 1e9) }} line={{ name: 'Cùng kỳ năm trước', values: series.map((s) => s.revenueLY / 1e9) }}
          format={tr} tick={(v) => dec(v)} width={880} height={240} highlightLast
          tipExtra={(i) => <div className="demo-sub">{pctLabel(pct(series[i].revenue, series[i].revenueLY))} so cùng kỳ</div>} />
      </Card>
      <Card title="Theo nhãn hàng" subtitle="Doanh số trước VAT, sau chiết khấu · tính trên các đơn chưa huỷ đang có trên hệ thống">
        {d.byBrand.length ? <HBars rows={d.byBrand.map((b) => {
          const tot = d.byBrand.reduce((t, x) => t + x.revenue, 0);
          return { label: b.brand, value: b.revenue, valueLabel: b.revenue >= 1e9 ? tr(b.revenue / 1e9) : dec(b.revenue / 1e6, 1) + ' tr', tip: `${tot ? Math.round((b.revenue / tot) * 100) : 0}% doanh số · ${num(b.qty)} sản phẩm · ${num(b.orders)} đơn` };
        })} /> : <EmptyState icon="box" title="Chưa có đơn hàng để chia theo nhãn" />}
      </Card>
      <Card title={`Theo sale phụ trách · ${last.month}`} subtitle={role === 'SALE' ? 'Đại lý bạn phụ trách' : undefined}>
        {d.bySale.length ? <HBars rows={[...d.bySale].sort((a, b) => b.sales - a.sales).map((s) => ({ label: s.name, value: s.sales, valueLabel: big(s.sales), tip: `${s.agents} đại lý · ${s.active} active · ${s.dormant} ngủ đông` }))} /> : <EmptyState icon="users" title="Chưa có dữ liệu theo sale" />}
      </Card>
      <Card title="Top 10 đại lý theo doanh số tháng" flush>
        <DataTable rows={d.top} rowKey="id" itemLabel="đại lý" columns={[
          { key: 'name', label: 'Đại lý', primary: true, render: (x) => <div><div>{x.name}</div><div className="demo-sub">{x.id}</div></div> },
          { key: 'tier', label: 'Hạng', render: (x) => <TierBadge tier={x.tier as Tier} /> },
          { key: 'sales', label: 'Doanh số tháng', align: 'right', render: (x) => vnd(x.sales) },
          { key: 'reward', label: 'Điểm khả dụng', align: 'right', render: (x) => num(x.reward) },
        ]} />
      </Card>
    </>);
  }

  if (d && last && cur === 'points') {
    const issued = sum('issued'), redeemed = sum('redeemed');
    const prev = series.at(-2);
    const max = Math.max(...series.map((s) => Math.max(s.issued, s.redeemed)));
    const short = series.map((s) => s.month.split('/')[0]);
    csv = [['Tháng', 'Điểm phát sinh', 'Điểm đã đổi'], ...series.map((s) => [s.month, s.issued, s.redeemed])];
    body = (<>
      <div className="demo-grid demo-grid--4 w22-kpis">
        <KpiCard label={`Phát sinh ${short.at(-1)}`} value={num(last.issued)} delta={prev ? pct(last.issued, prev.issued) : undefined} deltaLabel="so tháng trước" />
        <KpiCard label={`Đã đổi ${short.at(-1)}`} value={num(last.redeemed)} />
        <KpiCard label="Tồn (khả dụng)" value={num(d.liability)} hint={`≈ ${mil(d.liabilityVND)} nghĩa vụ quy đổi`} />
        <KpiCard label="Sắp hết hạn 30 ngày" value={num(d.expiring30)} tone={d.expiring30 > 0 ? 'warning' : undefined}
          hint={d.expiring30 > 0 ? `≈ ${mil(d.expiring30 * 1000)} · nhắc ZNS trước 30 và 7 ngày` : `Không có lô điểm hết hạn · tỷ lệ đổi ${issued ? Math.round((redeemed / issued) * 100) : 0}%`} />
      </div>
      <div className="demo-grid demo-grid--2">
        <Card title="Điểm phát sinh theo tháng" subtitle="Một chuỗi — xem cột bên cạnh cho điểm đã đổi">
          <BarLine labels={short} bars={{ name: 'Phát sinh', values: series.map((s) => s.issued) }} width={460} height={220} max={niceMax(max)} highlightLast />
        </Card>
        <Card title="Điểm đã đổi theo tháng" subtitle="Cùng thang với biểu đồ bên trái">
          <BarLine labels={short} bars={{ name: 'Đã đổi', values: series.map((s) => s.redeemed) }} width={460} height={220} max={niceMax(max)} highlightLast />
        </Card>
      </div>
      <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Hai biểu đồ cùng thang 0–{num(niceMax(max))} để so sánh trực tiếp; không gộp hai đại lượng lên hai trục.</div>
      <Card title="Điểm khả dụng tồn theo hạng">
        <HBars rows={d.byTier.map((t) => ({ label: <TierBadge tier={t.tier as Tier} />, value: t.reward, valueLabel: num(t.reward), tip: `${t.agents} đại lý · ≈ ${mil(t.reward * 1000)}` }))} />
      </Card>
    </>);
  }

  if (d && cur === 'tiers') {
    const total = d.byTier.reduce((t, x) => t + x.agents, 0);
    const histAll = role === 'SALE' ? [] : d.tierHistory; // lịch sử hạng lưu toàn công ty — Sale chỉ xem phân bổ đại lý mình
    const months = new Set(series.map((s) => s.month));
    const hist = histAll.filter((h) => months.has(h.month));
    const hmax = Math.max(1, ...hist.flatMap((h) => Object.values(h.counts)));
    const first = hist[0], lastH = hist.at(-1);
    const trend = first && lastH && first !== lastH
      ? TIER_ORDER.map((t) => [t, first.counts[t] ?? 0, lastH.counts[t] ?? 0] as const).filter(([, a, b]) => a !== b)
        .map(([t, a, b]) => `${tierName(t)} ${b > a ? 'tăng' : 'giảm'} ${a} → ${b}`).join(', ')
      : '';
    csv = [['Hạng', ...hist.map((h) => h.month), 'Hiện tại'], ...TIER_ORDER.map((t) => [tierName(t), ...hist.map((h) => h.counts[t] ?? 0), d.byTier.find((x) => x.tier === t)?.agents ?? 0])];
    body = (<>
      {hist.length > 0 && (
        <Card title="Phân bổ hạng theo tháng" subtitle={`Số đại lý mỗi hạng tại thời điểm xét hạng · đậm dần theo số lượng · ${period.toLowerCase()}`}>
          <div className="w22-tmwrap">
            <table className="w22-tm">
              <thead><tr><th>Hạng</th>{hist.map((h) => <th key={h.month}>{h.month}</th>)}</tr></thead>
              <tbody>{TIER_ORDER.map((t) => (
                <tr key={t}><td><TierBadge tier={t as Tier} /></td>{hist.map((h) => {
                  const v = h.counts[t] ?? 0;
                  const w = Math.round(8 + (v / hmax) * 62);
                  return <td key={h.month}><span className={'w22-cell' + (w > 45 ? ' is-strong' : '')} style={{ background: `color-mix(in srgb, var(--primary) ${w}%, transparent)` }} title={`${h.month}: ${v} đại lý ${tierName(t)}`}>{v}</span></td>;
                })}</tr>
              ))}</tbody>
            </table>
          </div>
          {trend && <div className="demo-sub w22-mt">Xu hướng {first!.month} → {lastH!.month}: {trend}.</div>}
        </Card>
      )}
      <Card title={role === 'SALE' ? 'Phân bổ hạng đại lý bạn phụ trách' : 'Phân bổ hạng hiện tại'} subtitle={`Số đại lý mỗi hạng · tổng ${total} đại lý`}>
        <HBars rows={d.byTier.map((t) => ({ label: <TierBadge tier={t.tier as Tier} />, value: t.agents, valueLabel: `${t.agents} (${total ? Math.round((t.agents / total) * 100) : 0}%)`, tip: `Doanh số tháng ${big(t.sales)}` }))} />
      </Card>
      <Card title="Doanh số và điểm theo hạng" flush>
        <DataTable rows={d.byTier} rowKey="tier" columns={[
          { key: 'tier', label: 'Hạng', primary: true, render: (x) => <TierBadge tier={x.tier as Tier} /> },
          { key: 'agents', label: 'Số đại lý', align: 'right' },
          { key: 'sales', label: 'Doanh số tháng', align: 'right', render: (x) => vnd(x.sales) },
          { key: 'avg', label: 'TB / đại lý', align: 'right', render: (x) => (x.agents ? mil(x.sales / x.agents) : '—') },
          { key: 'reward', label: 'Điểm khả dụng', align: 'right', render: (x) => num(x.reward) },
        ]} />
      </Card>
    </>);
  }

  if (cur === 'rules') {
    if (!can(role, 'ledger.view')) {
      body = <Card><EmptyState icon="lock" title="Chưa có số liệu theo hạng mục cho vai trò này" body="Báo cáo được tổng hợp từ sổ điểm — vai trò Marketing chưa được cấp quyền xem sổ điểm. Liên hệ KTT để nhận bản xuất." /></Card>;
    } else if (ledger.isLoading) body = <Loading />;
    else if (ledger.error) body = <ErrorNote error={ledger.error} />;
    else {
      const rows = byCategory(ledger.data ?? []);
      csv = [['Hạng mục', 'Điểm đã cộng', 'Quy đổi (VNĐ)', 'Số đại lý nhận', 'Quy tắc'], ...rows.map((r) => [r.n, r.p, r.p * 1000, r.a, r.rule])];
      body = (
        <Card title="Hiệu quả từng hạng mục điểm" subtitle="Tổng hợp từ sổ điểm · chỉ bút toán cộng điểm" flush>
          <DataTable rows={rows} rowKey="id" itemLabel="hạng mục" empty={<EmptyState icon="star" title="Chưa có bút toán cộng điểm" />} columns={[
            { key: 'n', label: 'Hạng mục', primary: true },
            { key: 'p', label: 'Điểm đã cộng', align: 'right', render: (x) => num(x.p) },
            { key: 'v', label: 'Quy đổi', align: 'right', render: (x) => mil(x.p * 1000) },
            { key: 'a', label: 'Số đại lý nhận', align: 'right' },
            { key: 'rule', label: 'Quy tắc', render: (x) => <span className="demo-muted">{x.rule}</span> },
          ]} />
        </Card>
      );
    }
  }

  if (cur === 'commit') {
    if (contracts.isLoading) body = <Loading />;
    else if (contracts.error) body = <ErrorNote error={contracts.error} />;
    else {
      const cs = (contracts.data ?? []).filter((c) => c.commitMonth > 0);
      const commit = cs.reduce((t, c) => t + c.commitMonth, 0);
      const actual = cs.reduce((t, c) => t + (c.salesMonth ?? 0), 0);
      const pc = (c: Contract) => c.commitPct ?? (c.commitMonth ? Math.round(((c.salesMonth ?? 0) / c.commitMonth) * 100) : 0);
      const low = [...cs].sort((a, b) => pc(a) - pc(b));
      const months = new Set(series.map((s) => s.month));
      const hist = (d?.commitHistory ?? []).filter((h) => months.has(h.month) && h.commit > 0);
      csv = [['Mã HĐ', 'Đại lý', 'Cam kết/tháng', 'Thực tế tháng', '% đạt'], ...low.map((c) => [c.id, c.agentName ?? c.agentId, c.commitMonth, c.salesMonth ?? 0, pc(c)])];
      body = !cs.length ? <Card><EmptyState icon="file" title="Chưa có hợp đồng có cam kết" body="Hợp đồng và cam kết doanh số nhập ở màn Hợp đồng (W06)." /></Card> : (<>
        <div className="demo-grid demo-grid--4 w22-kpis">
          <KpiCard label="Tổng cam kết / tháng" value={tr(commit / 1e9)} hint={`${cs.length} hợp đồng`} />
          <KpiCard label="Thực tế tháng này" value={tr(actual / 1e9)} />
          <KpiCard label="Tỷ lệ đạt cam kết" value={(commit ? Math.round((actual / commit) * 100) : 0) + '%'} tone={actual < commit * 0.8 ? 'warning' : undefined} />
          <KpiCard label="Hợp đồng dưới 80%" value={num(cs.filter((c) => pc(c) < 80).length)} tone={cs.some((c) => pc(c) < 80) ? 'warning' : undefined} hint="Cần sale chăm sóc" />
        </div>
        {hist.length > 0 && (
          <Card title={role === 'SALE' ? 'Cam kết so với thực tế · đại lý bạn phụ trách' : 'Cam kết so với thực tế · toàn hệ thống'} subtitle="Tỷ đồng · cột: doanh số thực tế · nét đứt: tổng cam kết hợp đồng">
            <BarLine labels={hist.map((h) => h.month)} bars={{ name: 'Thực tế', values: hist.map((h) => h.sales / 1e9) }} line={{ name: 'Cam kết', values: hist.map((h) => h.commit / 1e9) }}
              format={tr} tick={(v) => dec(v)} width={880} height={240} highlightLast
              tipExtra={(i) => <div className="demo-sub">Đạt {hist[i].commit ? Math.round((hist[i].sales / hist[i].commit) * 100) : 0}% cam kết</div>} />
          </Card>
        )}
        <Card title="% đạt cam kết theo hợp đồng" subtitle="12 hợp đồng thấp nhất · vạch dọc = mốc 100%">
          <HBars compare rows={low.slice(0, 12).map((c) => ({ label: c.agentName ?? c.agentId, value: pc(c), compare: 100, valueLabel: pc(c) + '%', tip: `${mil(c.salesMonth ?? 0)} / ${mil(c.commitMonth)}` }))} />
        </Card>
      </>);
    }
  }

  if (d && last && cur === 'active') {
    csv = [['Tháng', 'Tỷ lệ active (%)'], ...series.map((s) => [s.month, s.activeRate])];
    body = (<>
      <Card title="Tỷ lệ đại lý active theo tháng" subtitle="Có ≥ 1 đơn hoàn tất trong tháng · %">
        <BarLine labels={labels} bars={{ name: 'Active', values: series.map((s) => s.activeRate) }} format={(v) => num(v) + '%'} max={100} width={880} height={240} highlightLast />
      </Card>
      <Card title="Active theo sale phụ trách · tháng này">
        <HBars rows={d.bySale.map((s) => ({ label: s.name, value: s.agents ? Math.round((s.active / s.agents) * 100) : 0, valueLabel: `${s.active}/${s.agents}`, tip: `${s.dormant} đại lý ngủ đông` }))} />
      </Card>
      <div className="demo-note"><Icon name="info" size={16} />Khách đặt mục tiêu active VIP 100%. Đề xuất: đo baseline tháng 12/2026 rồi đặt mục tiêu tăng so với baseline.</div>
    </>);
  }

  const repLabel = avail.find((x) => x.key === cur)?.label ?? 'Báo cáo';
  return (
    <AdminShell screen="W22"
      sub={role === 'SALE' ? 'Sale chỉ xem báo cáo của đại lý mình (O) và không xuất Excel' : 'Theo ma trận: BOD xem tất cả, KTT tài chính, TPKD kinh doanh, MKT điểm'}
      actions={<>
        <Field as="select" aria-label="Kỳ báo cáo" value={period} onChange={(e) => setPeriod(e.target.value)} options={PERIODS} />
        {can(role, 'export.excel') && cur && (can(role, EXPORT[cur].perm)
          ? <Button icon="download" onClick={() => { downloadExport(EXPORT[cur].kind); toast({ tone: 'success', title: 'Đang tải file Excel', body: `${repLabel}: ${EXPORT[cur].label}. Lượt xuất được ghi nhật ký.` }); }}>Xuất Excel</Button>
          : <Button icon="download" disabled={!csv.length} onClick={() => { downloadCsv(`${repLabel} - ${period}`, csv); toast({ tone: 'success', title: 'Đã xuất file', body: `${repLabel} · ${period} (CSV, mở bằng Excel).` }); }}>Xuất CSV</Button>)}
        {role === 'BOD' && <Button icon="calendar" disabled title="Gửi báo cáo định kỳ qua email — cần dịch vụ email, giai đoạn sau">Email sáng thứ Hai</Button>}
      </>}>
      {!avail.length ? <Card><EmptyState icon="lock" title="Vai trò này không có báo cáo nào" /></Card> : (
        <div className="w22-rep">
          <ul className="w22-list">{avail.map((x) => (
            <li key={x.key}><button type="button" className={x.key === cur ? 'is-on' : ''} onClick={() => setRep(x.key)}><Icon name={x.icon} size={16} />{x.label}</button></li>
          ))}</ul>
          <div className="demo-grid w22-body">{q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : body}</div>
        </div>
      )}
    </AdminShell>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : m <= 6 ? 6 : 10) * e;
}
