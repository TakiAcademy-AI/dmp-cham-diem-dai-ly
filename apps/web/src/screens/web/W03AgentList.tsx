import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { can, mask, type Role } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, Field, FilterChip, Icon, Pagination, PointFunds, QuickView, StatusBadge, TierBadge, type Tier } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { InfoGrid } from '../../shell/charts';
import { pathOf } from '../../shell/registry';
import { api, downloadExport } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi, useToast } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, mil, num, vnd } from '../../lib/fmt';
import type { Agent } from '../../lib/types';
import './W03AgentList.css';

const STATUS: Record<string, ['info' | 'danger' | 'warning' | 'dormant' | 'neutral', string]> = {
  ok: ['info', 'Đang hoạt động'], overdue: ['danger', 'Nợ quá hạn'], atrisk: ['warning', 'Sắp rớt hạng'], dormant: ['dormant', 'Ngủ đông'], locked: ['neutral', 'Tạm ngưng'],
};
const TIER_OPT = [{ value: '', label: 'Tất cả' }, { value: 'member', label: 'Thành viên' }, { value: 'bronze', label: 'Đồng' }, { value: 'silver', label: 'Bạc' }, { value: 'gold', label: 'Vàng' }, { value: 'diamond', label: 'Kim Cương' }, { value: 'strategic', label: 'Đối tác chiến lược' }];
const PAGE = 15;
const EMPTY_F = { tier: '', type: '', sale: '', status: '', min: '', max: '' };
const st = (s: string) => STATUS[s] ?? STATUS.ok;
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

/** W03 Danh sách đại lý — lọc nhiều điều kiện, chip cảnh báo, chọn nhiều để đề xuất điểm / gửi thông báo / bàn giao sale. */
export default function W03AgentList() {
  const { user } = useSession();
  const role = user!.role as Role;
  const nav = useNavigate();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const query = sp.get('q') ?? '';
  const setQuery = (v: string) => { setSp(v ? { q: v } : {}, { replace: true }); setPage(1); };
  const q = useApi<Agent[]>('/agents');
  const sales = useApi<Array<{ id: string; name: string; status: string }>>(role !== 'SALE' ? '/sales' : null);
  const [flt, setFlt] = useState(EMPTY_F);
  const [chips, setChips] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [quickId, setQuickId] = useState<string | null>(null);
  const [fOpen, setFOpen] = useState(false);
  const [handover, setHandover] = useState<string[] | null>(null);
  const [toSale, setToSale] = useState('');

  const seeDebt = can(role, 'debt.view');
  const canExport = can(role, 'export.excel');
  const all = q.data ?? [];
  const setF = (k: keyof typeof EMPTY_F, v: string) => { setFlt({ ...flt, [k]: v }); setPage(1); };
  const chip = (k: string) => { setChips(chips.includes(k) ? chips.filter((x) => x !== k) : [...chips, k]); setPage(1); };
  const clear = () => { setChips([]); setQuery(''); setFlt(EMPTY_F); };

  const rows = useMemo(() => {
    const s = norm(query.trim()).replace(/\s/g, '');
    return all.filter((a) => {
      if (s && !norm(a.name + a.id + a.phone).replace(/\s/g, '').includes(s)) return false;
      if (flt.tier && a.tier !== flt.tier) return false;
      if (flt.type && a.type !== flt.type) return false;
      if (flt.sale && a.saleName !== flt.sale) return false;
      if (flt.status && a.status !== flt.status) return false;
      if (flt.min && a.rankPoints < +flt.min) return false;
      if (flt.max && a.rankPoints > +flt.max) return false;
      return chips.every((c) => a.flags.includes(c));
    });
  }, [all, query, flt, chips]);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const quick = all.find((a) => a.id === quickId);
  const cnt = (f: string) => all.filter((a) => a.flags.includes(f)).length;
  const types = [...new Set(all.map((a) => a.type))];
  const saleNames = sales.data?.map((s) => s.name) ?? [...new Set(all.map((a) => a.saleName))];
  const curMonth = 'T' + (new Date().getMonth() + 1);

  const doHandover = useAction((v: { agentIds: string[]; toSaleId: string }) => api.post<{ moved: number; to: string }>('/agents/handover', v), {
    success: (r) => ({ tone: 'success', title: `Đã bàn giao ${r.moved} đại lý cho ${r.to}`, body: 'Lịch sử chăm sóc được giữ nguyên. Thao tác đã ghi vào nhật ký.' }),
    onDone: () => { setHandover(null); setToSale(''); },
  });

  const exportXlsx = () => {
    downloadExport('agents');
    toast({ tone: 'success', title: 'Đang tải file Excel danh sách đại lý', body: 'File xuất từ máy chủ theo phạm vi dữ liệu của bạn · lần xuất đã ghi nhật ký.' });
  };

  const bulk = (sel: Agent[]) => (
    <>
      {can(role, 'points.manualPropose') && <Button icon="star" onClick={() => { toast({ tone: 'info', title: `Đề xuất cộng điểm cho ${sel.length} đại lý`, body: 'Chọn hạng mục và gửi BOD duyệt ở màn Cộng điểm hàng loạt.' }); nav(pathOf('W14')); }}>Đề xuất cộng điểm</Button>}
      {can(role, 'notify.broadcast') && <Button icon="send" onClick={() => nav(pathOf('W20'))}>Gửi thông báo</Button>}
      {can(role, 'agents.handover') && <Button icon="handover" onClick={() => setHandover(sel.map((a) => a.id))}>Bàn giao sale</Button>}
    </>
  );

  const cols = [
    { key: 'name', label: 'Đại lý', primary: true, render: (a: Agent) => <div><button type="button" className="demo-link" onClick={(e) => { e.stopPropagation(); setQuickId(a.id); }}>{a.name}</button><div className="demo-sub">{a.id} · {a.type}</div></div> },
    { key: 'tier', label: 'Hạng', render: (a: Agent) => <TierBadge tier={a.tier as Tier} /> },
    { key: 'pts', label: 'Điểm hạng / thưởng', align: 'right' as const, render: (a: Agent) => <div><div className="demo-strong">{num(a.rankPoints)}</div><div className="demo-sub">{num(a.rewardPoints)} thưởng</div></div> },
    { key: 'salesMonth', label: `Doanh số ${curMonth}`, align: 'right' as const, render: (a: Agent) => mil(a.salesMonth) },
    { key: 'commitPct', label: '% cam kết', align: 'right' as const, render: (a: Agent) => <span className={'w03-pct' + (a.commitPct < 50 ? ' w03-pct--bad' : a.commitPct < 80 ? ' w03-pct--mid' : '')}>{a.commitPct}%</span> },
    ...(seeDebt ? [{ key: 'debt', label: 'Công nợ', align: 'right' as const, render: (a: Agent) => (a.debt == null ? <span className="demo-hidden"><Icon name="lock" size={13} />—</span> : a.debt ? <div><div>{mil(a.debt)}</div>{a.overdueDays > 0 && <div className="demo-sub w03-od">quá hạn {a.overdueDays} ngày</div>}</div> : '0') }] : []),
    ...(role === 'MKT' ? [{ key: 'phone', label: 'SĐT', render: (a: Agent) => <span className="demo-hidden"><Icon name="lock" size={13} />{a.masked.phone ? a.phone : mask.phone(a.phone)}</span> }] : []),
    { key: 'saleName', label: 'Sale' },
    { key: 'lastOrder', label: 'Đặt gần nhất', render: (a: Agent) => date(a.lastOrder) },
    { key: 'status', label: 'Trạng thái', render: (a: Agent) => <StatusBadge tone={st(a.status)[0]}>{st(a.status)[1]}</StatusBadge> },
  ];

  return (
    <AdminShell screen="W03" searchPlaceholder="Tìm nhanh theo mã, tên, SĐT đại lý" onSearch={(v) => setQuery(v)}
      sub={role === 'SALE' ? 'Chỉ hiện đại lý bạn phụ trách' : role === 'MKT' ? 'Dữ liệu nhạy cảm đã che; không có cột công nợ' : `${rows.length} đại lý khớp bộ lọc`}
      actions={<>
        {canExport && <Button icon="download" onClick={exportXlsx}>Xuất Excel</Button>}
        {can(role, 'agents.propose') && <Button variant="primary" icon="plus" onClick={() => nav(pathOf('W05'))}>Đề xuất đại lý mới</Button>}
      </>}>
      <Card>
        <div className="w03-stack">
          <div className="demo-filters w03-filters">
            <Field className="w03-fsearch" label="Tìm trong danh sách" placeholder="Mã, tên, SĐT" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button className="w03-ftoggle" icon="filter" onClick={() => setFOpen(!fOpen)}>{fOpen ? 'Ẩn bộ lọc' : `Bộ lọc (${role === 'SALE' ? 5 : 6})`}</Button>
            <div className={'w03-fmore' + (fOpen ? ' is-open' : '')}>
              <Field label="Hạng" as="select" value={flt.tier} onChange={(e) => setF('tier', e.target.value)} options={TIER_OPT} />
              <Field label="Loại/kênh" as="select" value={flt.type} onChange={(e) => setF('type', e.target.value)} options={[{ value: '', label: 'Tất cả' }, ...types]} />
              {role !== 'SALE' && <Field label="Sale" as="select" value={flt.sale} onChange={(e) => setF('sale', e.target.value)} options={[{ value: '', label: 'Tất cả' }, ...saleNames]} />}
              <Field label="Trạng thái" as="select" value={flt.status} onChange={(e) => setF('status', e.target.value)}
                options={[{ value: '', label: 'Tất cả' }, ...Object.entries(STATUS).filter(([k]) => k !== 'locked' || all.some((a) => a.status === 'locked')).map(([k, v]) => ({ value: k, label: v[1] }))]} />
              <Field label="Điểm hạng từ" placeholder="0" inputMode="numeric" value={flt.min} onChange={(e) => setF('min', e.target.value.replace(/\D/g, ''))} />
              <Field label="đến" placeholder="100000" inputMode="numeric" value={flt.max} onChange={(e) => setF('max', e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
          <div className="demo-between">
            <div className="demo-row">
              <FilterChip selected={chips.includes('dormant')} count={cnt('dormant')} onClick={() => chip('dormant')}>Ngủ đông</FilterChip>
              <FilterChip selected={chips.includes('atrisk')} count={cnt('atrisk')} onClick={() => chip('atrisk')}>Sắp rớt hạng</FilterChip>
              {seeDebt && <FilterChip selected={chips.includes('overdue')} count={cnt('overdue')} onClick={() => chip('overdue')}>Nợ quá hạn</FilterChip>}
              <FilterChip selected={chips.includes('expiring')} count={cnt('expiring')} onClick={() => chip('expiring')}>HĐ sắp hết hạn</FilterChip>
              <FilterChip selected={chips.includes('birthday')} count={cnt('birthday')} onClick={() => chip('birthday')}>Sinh nhật tuần này</FilterChip>
            </div>
            <div className="w03-legend">
              <span><i className="w03-sw w03-sw--danger" />Nợ quá hạn</span><span><i className="w03-sw w03-sw--warning" />Sắp rớt hạng</span><span><i className="w03-sw w03-sw--dormant" />Ngủ đông</span>
            </div>
          </div>
        </div>
      </Card>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="w03-table">
          <DataTable key={role} rows={shown} rowKey="id" selectable itemLabel="đại lý" bulkActions={bulk}
            onRowClick={(a) => nav(pathOf('W04', { id: a.id }))}
            rowTone={(a) => (a.status === 'overdue' || a.status === 'atrisk' || a.status === 'dormant' ? a.status : null)}
            columns={cols}
            empty={<EmptyState icon="search" title="Không có đại lý khớp bộ lọc" body="Bỏ bớt điều kiện lọc hoặc tìm theo mã đại lý." action={<Button onClick={clear}>Xoá bộ lọc</Button>} />} />
          <div className="w03-pager"><Pagination page={page} total={rows.length} pageSize={PAGE} itemLabel="đại lý" onChange={setPage} /></div>
        </div>
      )}

      {quick && (
        <QuickView title={quick.name} onClose={() => setQuickId(null)}
          footer={<><Button onClick={() => setQuickId(null)}>Đóng</Button><Button variant="primary" onClick={() => nav(pathOf('W04', { id: quick.id }))}>Mở hồ sơ</Button></>}>
          <div className="w03-qv">
            <div className="demo-row"><TierBadge tier={quick.tier as Tier} size="lg" /><StatusBadge tone={st(quick.status)[0]}>{st(quick.status)[1]}</StatusBadge><span className="demo-muted">{quick.id} · {quick.type} · {quick.city}</span></div>
            <PointFunds rank={quick.rankPoints} reward={quick.rewardPoints} pending={quick.pendingPoints} />
            <InfoGrid cols={2} items={[
              ['Sale phụ trách', quick.saleName], ['Đặt gần nhất', date(quick.lastOrder)],
              [`Doanh số ${curMonth}`, vnd(quick.salesMonth)], ['Cam kết', quick.commitMonth ? `${vnd(quick.commitMonth)} (${quick.commitPct}%)` : '—'],
            ]} />
          </div>
        </QuickView>
      )}

      {handover && (
        <QuickView title={`Bàn giao ${handover.length} đại lý`} onClose={() => setHandover(null)}
          footer={<><Button onClick={() => setHandover(null)}>Huỷ</Button><Button variant="primary" icon="handover" disabled={!toSale || doHandover.isPending} onClick={() => doHandover.mutate({ agentIds: handover, toSaleId: toSale })}>Xác nhận bàn giao</Button></>}>
          <div className="w03-qv">
            <Field label="Sale nhận bàn giao" as="select" required value={toSale} onChange={(e) => setToSale(e.target.value)}
              options={[{ value: '', label: 'Chọn sale' }, ...(sales.data ?? []).map((s) => ({ value: s.id, label: s.name + (s.status !== 'Đang hoạt động' ? ` (${s.status})` : '') }))]} />
            <div className="demo-sub">{all.filter((a) => handover.includes(a.id)).map((a) => `${a.id} ${a.name}`).join(' · ')}</div>
            <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Lịch sử chăm sóc, điểm và đơn hàng được giữ nguyên. Thao tác ghi vào nhật ký.</div>
          </div>
        </QuickView>
      )}
    </AdminShell>
  );
}
