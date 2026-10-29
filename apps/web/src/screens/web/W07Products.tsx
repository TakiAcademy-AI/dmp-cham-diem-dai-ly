import { useMemo, useState } from 'react';
import { can } from '@dmp/shared';
import { Button, Card, DataTable, EmptyState, Field, Icon, QuickView, StatusBadge, Tabs, type DataTableColumn } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction, useApi } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { date, num, vnd } from '../../lib/fmt';
import type { Product } from '../../lib/types';
import './W07Products.css';

/** Chiết khấu kênh minh hoạ (bản thiết kế) — bảng giá theo kênh thật nằm ở KiotViet. */
const CHANNELS: Array<[string, number]> = [['Nhà thuốc', 0], ['Spa', 0.03], ['Phòng khám', 0.05]];
const round1k = (n: number) => Math.round(n / 1000) * 1000;
/** multiplierUntil lưu dạng dd/mm/yyyy (như dữ liệu KiotViet) ↔ yyyy-mm-dd của ô chọn ngày. */
const toIso = (s: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s ?? ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : (s ?? ''); };
const fromIso = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

/** W07 Sản phẩm & bảng giá — đọc từ KiotViet; cây nhãn → dòng; 2 thuộc tính điểm riêng (không tính điểm, hệ số). */
export default function W07Products() {
  const { user } = useSession();
  const role = user!.role;
  const q = useApi<Product[]>('/products');
  const [node, setNode] = useState<{ brand: string | null; line: string | null }>({ brand: null, line: null });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState('sku');
  const seeCost = can(role, 'products.viewCost');
  const canPropose = can(role, 'products.propose');
  const [prop, setProp] = useState<Product | null>(null);

  const prods = q.data ?? [];
  const brands = useMemo(() => {
    const m = new Map<string, string[]>();
    prods.forEach((p) => { const l = m.get(p.brand) ?? []; if (!l.includes(p.line)) l.push(p.line); m.set(p.brand, l); });
    return [...m.entries()];
  }, [prods]);
  const rows = prods.filter((p) => (!node.brand || p.brand === node.brand) && (!node.line || p.line === node.line));

  const cols: DataTableColumn<Product>[] = [
    { key: 'name', label: 'SKU', primary: true, render: (p) => <div><div className="demo-strong">{p.name}</div><div className="demo-sub">{p.sku} · {p.reg}</div></div> },
    { key: 'line', label: 'Dòng' },
    { key: 'price', label: 'Giá bán (chưa VAT)', align: 'right', render: (p) => vnd(p.price) },
    ...(seeCost ? [{ key: 'cost', label: 'Giá vốn', align: 'right' as const, render: (p: Product) => (p.cost == null ? '—' : vnd(p.cost)) }] : []),
    { key: 'stock', label: 'Tồn (HN + HCM)', align: 'right', render: (p) => num(p.stock) },
    { key: 'np', label: 'Không tính điểm', render: (p) => (p.noPoint ? <StatusBadge tone="neutral">Không tính điểm</StatusBadge> : <span className="demo-muted">Tính điểm</span>) },
    { key: 'mult', label: 'Hệ số điểm', render: (p) => (
      <span className="demo-row"><span className={'w07-mult' + (p.multiplier > 1 ? ' is-up' : '')}>×{String(p.multiplier).replace('.', ',')}</span>{p.multiplierUntil ? <span className="demo-sub">tới {date(p.multiplierUntil)}</span> : null}</span>
    ) },
    ...(canPropose ? [{ key: 'x', label: '', render: (p: Product) => <Button icon="edit" onClick={() => setProp(p)}>Đề xuất đổi</Button> }] : []),
  ];

  const toggle = (bn: string) => { setOpen({ ...open, [bn]: !open[bn] }); setNode({ brand: bn, line: null }); };

  return (
    <AdminShell screen="W07" crumb="Sản phẩm"
      sub={`Tên, giá, tồn đọc từ KiotViet · ${canPropose ? 'KTT đề xuất hệ số điểm / "không tính điểm", BOD duyệt' : 'hệ số điểm và "không tính điểm" do KTT đề xuất, BOD duyệt'}${seeCost ? '' : ' · giá vốn bị ẩn với vai trò này'}`}
      actions={<span className="w07-ro"><Icon name="refresh" size={14} />Đồng bộ KiotViet mỗi 15 phút</span>}>
      <div className="w07-tabs"><Tabs value={tab} onChange={setTab} items={[{ key: 'sku', label: 'Sản phẩm', count: prods.length }, { key: 'price', label: 'Bảng giá theo kênh' }]} /></div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : !prods.length ? (
        <Card><EmptyState icon="box" title="Chưa có sản phẩm" body="Bấm Đồng bộ ngay ở màn Đơn hàng để kéo danh mục từ KiotViet." /></Card>
      ) : tab === 'sku' ? (
        <div className="w07-pp">
          <ul className="w07-tree">
            <li><button type="button" className={!node.brand ? 'is-on' : ''} onClick={() => setNode({ brand: null, line: null })}>Tất cả nhãn<span className="w07-cnt">{prods.length}</span></button></li>
            {brands.map(([bn, lines]) => (
              <li key={bn}>
                <button type="button" className={node.brand === bn && !node.line ? 'is-on' : ''} aria-expanded={!!open[bn]} onClick={() => toggle(bn)}>
                  <Icon name="chevronRight" size={14} className={'w07-chev' + (open[bn] ? ' open' : '')} />{bn}<span className="w07-cnt">{prods.filter((p) => p.brand === bn).length}</span>
                </button>
                {open[bn] && (
                  <ul>{lines.map((ln) => (
                    <li key={ln}><button type="button" className={node.brand === bn && node.line === ln ? 'is-on' : ''} onClick={() => setNode({ brand: bn, line: ln })}>{ln}<span className="w07-cnt">{prods.filter((p) => p.brand === bn && p.line === ln).length}</span></button></li>
                  ))}</ul>
                )}
              </li>
            ))}
          </ul>
          <div className="demo-grid w07-main">
            <div className="demo-note demo-note--muted"><Icon name="lock" size={16} />Tên, giá, tồn, lô/hạn dùng đồng bộ từ KiotViet — sửa tại KiotViet. Hàng tặng, hàng mẫu, hàng thanh lý cận date không tính điểm.</div>
            <DataTable rows={rows} rowKey="sku" columns={cols} itemLabel="sản phẩm" />
          </div>
        </div>
      ) : (
        <Card title="Bảng giá theo loại/kênh" subtitle="Chỉ xem · chiết khấu kênh minh hoạ, lấy từ KiotViet" flush>
          <div className="w07-main">
            <DataTable rows={prods} rowKey="sku" itemLabel="sản phẩm" columns={[
              { key: 'name', label: 'SKU', primary: true, render: (p: Product) => <div><div className="demo-strong">{p.name}</div><div className="demo-sub">{p.sku}</div></div> },
              ...CHANNELS.map(([k, d]) => ({ key: k, label: k, align: 'right' as const, render: (p: Product) => vnd(round1k(p.price * (1 + d))) })),
            ]} />
          </div>
        </Card>
      )}
      {prop && <ProposeDialog p={prop} onClose={() => setProp(null)} />}
    </AdminShell>
  );
}

/** KTT đề xuất đổi thuộc tính điểm của một SKU → tạo yêu cầu BOD duyệt (W13 · Sản phẩm). */
function ProposeDialog({ p, onClose }: { p: Product; onClose: () => void }) {
  const [noPoint, setNoPoint] = useState(p.noPoint);
  const [mult, setMult] = useState(String(p.multiplier));
  const [until, setUntil] = useState(toIso(p.multiplierUntil));
  const [reason, setReason] = useState('');
  const untilOut = fromIso(until);
  const untilChanged = untilOut !== (p.multiplierUntil ?? '');
  const changed = noPoint !== p.noPoint || Number(mult) !== p.multiplier || untilChanged;
  const send = useAction(() => api.post<{ id: string }>(`/products/${encodeURIComponent(p.sku)}/proposal`, {
    noPoint, multiplier: Number(mult), ...(untilChanged ? { multiplierUntil: untilOut } : {}), reason: reason.trim(),
  }), {
    success: (r) => ({ tone: 'success', title: `Đã gửi BOD duyệt (${r.id})`, body: `${p.sku} ${p.name} — thay đổi áp dụng sau khi BOD duyệt ở W13.` }),
    onDone: onClose,
  });
  return (
    <QuickView title={'Đề xuất đổi điểm · ' + p.sku} onClose={onClose}
      footer={<><Button onClick={onClose}>Đóng</Button><Button variant="primary" icon="send" disabled={!changed || !reason.trim() || send.isPending} onClick={() => send.mutate()}>Gửi BOD duyệt</Button></>}>
      <div className="w07-form">
        <div><div className="demo-strong">{p.name}</div><div className="demo-sub">Hiện tại: {p.noPoint ? 'không tính điểm' : 'tính điểm'} · ×{String(p.multiplier).replace('.', ',')}{p.multiplierUntil ? ` tới ${date(p.multiplierUntil)}` : ''}</div></div>
        <label className="w07-check"><input type="checkbox" checked={noPoint} onChange={(e) => setNoPoint(e.target.checked)} />Không tính điểm (hàng tặng, hàng mẫu, thanh lý cận date)</label>
        <Field label="Hệ số điểm" as="select" value={mult} onChange={(e) => setMult(e.target.value)} disabled={noPoint}
          options={[1, 1.5, 2, 3, 4, 5].map((m) => ({ value: String(m), label: '×' + String(m).replace('.', ',') }))} />
        <Field label="Áp dụng hệ số tới ngày" type="date" value={until} onChange={(e) => setUntil(e.target.value)} disabled={noPoint} hint="Để trống nếu không giới hạn" />
        <Field label="Lý do" as="textarea" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Đẩy dòng mới quý IV theo kế hoạch nhãn" />
        <div className="demo-note demo-note--muted"><Icon name="info" size={16} />Chưa đổi ngay: BOD duyệt ở Hàng chờ duyệt (W13) thì mới áp dụng cho đơn mới.</div>
      </div>
    </QuickView>
  );
}
