import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { can, type Role } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, FilterChip, Icon, StatusBadge, TierBadge, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { BarLine, InfoGrid } from '../../shell/charts';
import { pathOf } from '../../shell/registry';
import { downloadExport } from '../../lib/api';
import { ErrorNote, Loading, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, mil } from '../../lib/fmt';
import type { Agent, Contract } from '../../lib/types';
import './W06Contracts.css';

type Band = 'all' | 'lt50' | 'mid' | 'gt80';
interface Row extends Contract { commitPct: number; agent?: Agent; expiring: boolean; endTs: number }

/** dd/mm/yyyy hoặc ISO → timestamp. */
const ts = (d: string) => { const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : new Date(d).getTime(); };
const pctCls = (p: number) => (p < 50 ? 'w06-bad' : p <= 80 ? 'w06-mid' : 'w06-ok');
interface Monthly { agentId: string; month: string; sales: number; commit: number }
/** "T3/26" → 2603 để sắp xếp theo thời gian (API trả theo thứ tự chữ). */
const monthKey = (m: string) => { const x = m.match(/T(\d+)\/(\d+)/); return x ? +x[2] * 100 + +x[1] : 0; };
const trv = (v: number) => Math.round((v / 1e6) * 10) / 10;

/** W06 Hợp đồng & cam kết — tiến độ cam kết từng đại lý, cảnh báo hợp đồng sắp hết hạn. */
export default function W06Contracts() {
  const { user } = useSession();
  const role = user!.role as Role;
  const nav = useNavigate();
  const q = useApi<Contract[]>('/contracts');
  const ag = useApi<Agent[]>(can(role, 'agents.view') ? '/agents' : null);
  const [band, setBand] = useState<Band>('all');
  const [exp, setExp] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const am = new Map((ag.data ?? []).map((a) => [a.id, a]));
  const soon = Date.now() + 30 * 864e5;
  const all: Row[] = (q.data ?? []).map((c) => {
    const agent = am.get(c.agentId);
    const endTs = ts(c.endDate);
    return { ...c, commitPct: c.commitPct ?? 0, agent, endTs, expiring: !!agent?.flags.includes('expiring') || (endTs > Date.now() - 864e5 && endTs <= soon) };
  }).sort((a, b) => Number(b.expiring) - Number(a.expiring) || a.agentId.localeCompare(b.agentId));
  const expiring = all.filter((r) => r.expiring).sort((a, b) => a.endTs - b.endTs);
  const inBand = (r: Row, b: Band) => (b === 'lt50' ? r.commitPct < 50 : b === 'mid' ? r.commitPct >= 50 && r.commitPct <= 80 : b === 'gt80' ? r.commitPct > 80 : true);
  const rows = all.filter((r) => (!exp || r.expiring) && inBand(r, band));
  const cur = all.find((r) => r.id === sel) ?? rows[0] ?? all[0];
  const now = new Date();
  const mLabel = (ago: number) => { const d = new Date(now.getFullYear(), now.getMonth() - ago, 1); return `T${d.getMonth() + 1}`; };
  const mq = useApi<Monthly[]>(cur ? `/agents/${encodeURIComponent(cur.agentId)}/monthly` : null);
  const months = [...(mq.data ?? [])].sort((a, b) => monthKey(a.month) - monthKey(b.month)).slice(-12);
  const sales = months.map((m) => trv(m.sales));
  const commits = months.map((m) => trv(m.commit));
  const canExport = can(role, 'export.excel');

  return (
    <AdminShell screen="W06" sub={`${rows.length} hợp đồng · ${expiring.length} hợp đồng hết hạn trong 30 ngày`}
      actions={(canExport || can(role, 'agents.issueCode')) ? <>
        {canExport && <Button icon="download" onClick={() => downloadExport('contracts')} title="Mỗi lần xuất được ghi nhật ký">Xuất Excel</Button>}
        {can(role, 'agents.issueCode') && <Button variant="primary" icon="plus" onClick={() => nav(pathOf('W05'))} title="Hợp đồng mới được tạo khi Kế toán cấp mã đại lý">Nhập hợp đồng</Button>}
      </> : null}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : !all.length ? (
        <Card><EmptyState icon="file" title="Chưa có hợp đồng" body="Hợp đồng được tạo khi Kế toán cấp mã cho đại lý mới." /></Card>
      ) : (
        <>
          {!exp && expiring.length > 0 && (
            <div className="demo-note demo-note--warn"><Icon name="clock" size={16} />
              <span>{expiring.length} hợp đồng sắp hết hạn ({expiring.map((r) => date(r.endDate).slice(0, 5)).join(', ')}/{new Date(expiring[0].endTs).getFullYear()}). Hệ thống đã đẩy việc gia hạn sang Zalo CRM cho sale phụ trách. <button type="button" className="demo-link" onClick={() => setExp(true)}>Xem {expiring.length} hợp đồng</button></span>
            </div>
          )}
          <div className="demo-between">
            <div className="demo-row">
              <FilterChip selected={band === 'all'} onClick={() => setBand('all')} count={all.length}>Tất cả</FilterChip>
              <FilterChip selected={band === 'lt50'} onClick={() => setBand('lt50')} count={all.filter((r) => inBand(r, 'lt50')).length}>Dưới 50% cam kết</FilterChip>
              <FilterChip selected={band === 'mid'} onClick={() => setBand('mid')} count={all.filter((r) => inBand(r, 'mid')).length}>50–80%</FilterChip>
              <FilterChip selected={band === 'gt80'} onClick={() => setBand('gt80')} count={all.filter((r) => inBand(r, 'gt80')).length}>Trên 80%</FilterChip>
              <span className="w06-sp" />
              <FilterChip selected={exp} onClick={() => setExp(!exp)} count={expiring.length}>Sắp hết hạn</FilterChip>
            </div>
            <span className="demo-muted">Bấm một dòng để xem biểu đồ của đại lý đó</span>
          </div>
          <div className="demo-grid">
            {cur && (
              <Card title={cur.agentName ?? cur.agentId} subtitle={`${cur.id} · cam kết ${mil(cur.commitMonth)}/tháng`}
                actions={<Button icon="user" onClick={() => nav(pathOf('W04', { id: cur.agentId }))}>Hồ sơ</Button>}>
                <div className="w06-detail">
                  <div>
                    {mq.isLoading ? <Loading label="Đang tải doanh số 12 tháng…" /> : mq.error ? <ErrorNote error={mq.error} /> : !months.length
                      ? <EmptyState icon="chart" title="Chưa có doanh số theo tháng" body="Doanh số được tổng hợp từ đơn hoàn tất mỗi tháng." />
                      : <BarLine labels={months.map((m) => m.month)} bars={{ name: 'Thực tế', values: sales }} line={{ name: 'Cam kết', values: commits }}
                          format={(v) => String(v).replace('.', ',') + ' tr'} width={640} height={200} highlightLast
                          tipExtra={(i) => <div className="demo-sub">Đạt {commits[i] ? Math.round((sales[i] / commits[i]) * 100) : 0}% cam kết</div>} />}
                    {months.length > 0 && <div className="demo-sub">{months.length} tháng gần nhất · triệu đồng · {months.filter((m) => m.commit && m.sales >= m.commit).length}/{months.length} tháng đạt cam kết</div>}
                  </div>
                  <InfoGrid cols={1} items={[
                    ['Đạt cam kết tháng này', <b key="p" className={pctCls(cur.commitPct)}>{cur.commitPct}%</b>],
                    ['Hạn mức công nợ', cur.agent ? (cur.agent.creditLimit != null ? `${mil(cur.agent.creditLimit)} · ${cur.agent.creditDays} ngày` : `Đã ẩn · ${cur.agent.creditDays} ngày`) : '—'],
                    ['Hiệu lực', `${date(cur.startDate)} – ${date(cur.endDate)}`],
                    ['Chính sách', cur.policy || '—'],
                    ['Trạng thái', <StatusBadge key="s" tone={cur.expiring ? 'warning' : cur.status === 'Hiệu lực' ? 'success' : 'neutral'}>{cur.expiring ? 'Sắp hết hạn' : cur.status}</StatusBadge>],
                  ]} />
                </div>
              </Card>
            )}
            <div className="w06-table">
              <DataTable rows={rows} rowKey="id" itemLabel="hợp đồng" onRowClick={(r) => setSel(r.id)} rowTone={(r) => (r.expiring ? 'atrisk' : null)}
                empty={<EmptyState icon="search" title="Không có hợp đồng khớp bộ lọc" action={<Button onClick={() => { setBand('all'); setExp(false); }}>Xoá bộ lọc</Button>} />}
                columns={[
                  { key: 'agentName', label: 'Số HĐ / Đại lý', primary: true, render: (r) => <div><div className={'demo-strong' + (r.id === cur?.id ? ' w06-sel' : '')}>{r.agentName}</div><div className="demo-sub">{r.id} · {r.agentId}</div></div> },
                  { key: 'tier', label: 'Hạng', render: (r) => (r.tier ? <TierBadge tier={r.tier as Tier} /> : '—') },
                  { key: 'end', label: 'Hết hạn', render: (r) => (r.expiring ? <StatusBadge tone="warning">{date(r.endDate)}</StatusBadge> : date(r.endDate)) },
                  { key: 'commitMonth', label: 'Cam kết tháng', align: 'right', render: (r) => mil(r.commitMonth) },
                  { key: 'pct', label: `Thực tế ${mLabel(0)}`, render: (r) => <span className="w06-pct"><span className="w06-bar"><i style={{ width: Math.min(100, r.commitPct) + '%' }} /></span><b className={pctCls(r.commitPct)}>{r.commitPct}%</b></span> },
                  { key: 'limit', label: 'Hạn mức', align: 'right', render: (r) => (r.agent ? (r.agent.creditLimit != null ? `${mil(r.agent.creditLimit)} · ${r.agent.creditDays}n` : `— · ${r.agent.creditDays}n`) : '—') },
                  { key: 'saleName', label: 'Sale' },
                  { key: 'push', label: 'Chính sách Push', render: (r) => (r.agent?.push && r.agent.push !== '—' ? r.agent.push : <span className="demo-muted">Theo tháng</span>) },
                ]} />
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}
