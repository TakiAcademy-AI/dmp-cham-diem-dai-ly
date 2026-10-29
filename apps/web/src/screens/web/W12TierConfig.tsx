import { useState } from 'react';
import { can, DEFAULT_PARAMS, TIER_NAME, type RuleParams, type Tier, type TierDef } from '@dmp/shared';
import { Button, Card, Icon, KpiCard, QuickView, Tabs, TierBadge } from '../../ds';
import { AdminShell } from '../../shell/AdminShell';
import { HBars } from '../../shell/charts';
import { api } from '../../lib/api';
import { ErrorNote, Loading, useAction } from '../../lib/hooks';
import { mil, num } from '../../lib/fmt';
import { dec, DraftActions, parseNum, RejectedNote, useRuleDraft, useSimulation, VersionList } from './W11PointRules';
import './W12TierConfig.css';

type Th = Partial<Record<Tier, number>>;
const PRESETS: Array<{ label: string; th: Th }> = [
  { label: 'Theo khảo sát', th: Object.fromEntries(DEFAULT_PARAMS.tiers.filter((t) => t.threshold != null).map((t) => [t.key, t.threshold!])) },
  { label: 'Hạ ngưỡng 40%', th: { member: 0, bronze: 3000, silver: 6000, gold: 12000, diamond: 30000 } },
  { label: 'Đồng dễ, KC khó', th: { member: 0, bronze: 2500, silver: 8000, gold: 18000, diamond: 40000 } },
];
const KEEP_RATIO = 0.8;

/** Ô nhập trong bảng hạng (giữ chuỗi đang gõ, định dạng lại khi rời ô). */
function Cell({ value, onNum, readOnly, decimals, label, wide }: { value: number; onNum: (n: number) => void; readOnly?: boolean; decimals?: boolean; label: string; wide?: boolean }) {
  const show = (n: number) => (decimals ? dec(n) : num(n));
  const [txt, setTxt] = useState<string | null>(null);
  return <input className={'w12-in' + (wide ? ' w12-in--wide' : '')} aria-label={label} inputMode={decimals ? 'decimal' : 'numeric'} readOnly={readOnly}
    value={txt ?? show(value)} onFocus={() => setTxt(show(value))} onBlur={() => setTxt(null)}
    onChange={(e) => { setTxt(e.target.value); onNum(parseNum(e.target.value, decimals)); }} />;
}

/** W12 Cấu hình bảng hạng — ngưỡng, hệ số, mô phỏng phân bổ hạng & chi phí điểm trên dữ liệu thật; nháp → BOD duyệt. */
export default function W12TierConfig() {
  const d = useRuleDraft();
  const { params, setParams, role } = d;
  const simQ = useSimulation(params);
  const baseSim = useSimulation(d.active?.params ?? null);
  const [confirmJob, setConfirmJob] = useState(false);
  const review = useAction(() => api.post<{ reviewed: number; changes: unknown[] }>('/jobs/tier-review'), {
    success: (r) => ({ tone: 'success', title: `Đã xét hạng ${num(r.reviewed)} đại lý`, body: `${r.changes.length} đại lý đổi hạng theo bảng đang hiệu lực.` }),
    onDone: () => setConfirmJob(false),
  });

  if (d.q.isLoading || (d.q.data && !params)) return <AdminShell screen="W12"><Loading /></AdminShell>;
  if (d.q.error || !params) return <AdminShell screen="W12"><ErrorNote error={d.q.error ?? new Error('Chưa có bộ quy tắc điểm nào')} /></AdminShell>;

  /** BOD được chỉnh thử để xem phân bổ (không lưu); KTT/MKT chỉnh rồi lưu nháp. */
  const editable = (d.canPropose && !d.pendingSubmit) || role === 'BOD';
  const vnd = params.tierBasis === 'revenue3m';
  const scale = vnd ? params.vndPerPoint : 1;
  const baseTiers = d.base?.params.tiers ?? [];
  const setTier = (k: Tier, patch: Partial<TierDef>) => setParams({ ...params, tiers: params.tiers.map((t) => (t.key === k ? { ...t, ...patch } : t)) });
  const setThreshold = (k: Tier, n: number) => setTier(k, { threshold: n, keep: Math.round(n * KEEP_RATIO) });
  const setBasis = (b: string) => {
    if (b === params.tierBasis) return;
    const f = b === 'revenue3m' ? params.vndPerPoint : 1 / params.vndPerPoint;
    setParams({ ...params, tierBasis: b as RuleParams['tierBasis'], tiers: params.tiers.map((t) => ({ ...t, threshold: t.threshold == null ? null : Math.round(t.threshold * f), keep: t.keep == null ? null : Math.round(t.keep * f) })) });
  };
  const preset = (th: Th) => setParams({ ...params, tiers: params.tiers.map((t) => (th[t.key] != null && !t.special ? { ...t, threshold: th[t.key]! * scale, keep: Math.round(th[t.key]! * scale * KEEP_RATIO) } : t)) });

  const s = simQ.data, b0 = baseSim.data;
  const pv = params.pointValueVND;
  const protect = params.tiers.find((t) => t.key === 'bronze')?.protectMonths ?? 0;
  const total = s ? s.distribution.reduce((t, x) => t + x.current, 0) : 0;
  /** Doanh số/tháng cần để đạt ngưỡng (giải thích con số ngưỡng). */
  const needMonthly = (t: TierDef) => (t.threshold == null ? 0 : vnd ? t.threshold / 3 : (t.threshold * params.vndPerPoint) / 3 / (1 + params.vatRate));
  const tierOf = (k: Tier) => params.tiers.find((t) => t.key === k);

  return (
    <AdminShell screen="W12"
      sub={`Xét ngày 01 hằng tháng theo 3 tháng gần nhất; dưới ngưỡng duy trì thì rớt 1 bậc; bảo vệ hạng ${protect} tháng sau khi lên hạng`}
      actions={<>
        <DraftActions d={d} what="bảng hạng" />
        {can(role, 'periods.lock') && <Button icon="refresh" onClick={() => setConfirmJob(true)}>Chạy xét hạng ngay</Button>}
      </>}>
      {d.rejected && <RejectedNote d={d} />}
      {d.pendingSubmit && <div className="demo-note"><Icon name="clock" size={16} />Bản nháp v{d.draft?.version} đang chờ BOD duyệt — tạm khoá chỉnh sửa. Bảng hạng v{d.active?.version} vẫn đang hiệu lực.</div>}
      <div className="w12-bar">
        <div className="w12-unit"><span className="demo-strong">Xét hạng theo</span>
          <Tabs variant="pill" value={params.tierBasis} onChange={(k) => editable && setBasis(k)} items={[{ key: 'points', label: 'Điểm hạng' }, { key: 'revenue3m', label: 'Doanh số 3 tháng' }]} />
          <span className="demo-muted">[CHỜ CHỐT] — quyết định này đổi câu "còn X điểm" hay "còn X triệu" trên app.</span>
        </div>
        {editable && (
          <div className="demo-row"><span className="demo-muted">Phương án thử:</span>
            {PRESETS.map((p) => <Button key={p.label} onClick={() => preset(p.th)}>{p.label}</Button>)}
          </div>
        )}
      </div>

      <div className="demo-grid">
        <Card title="Bảng hạng" subtitle={vnd ? 'Ngưỡng tính bằng doanh số 3 tháng gần nhất (đ, chưa VAT)' : 'Ngưỡng tính bằng điểm hạng trong 3 tháng gần nhất'} flush>
          <div className="w12-scroll">
            <table className="w12-tt">
              <thead><tr><th>Hạng</th><th>Ngưỡng lên hạng</th><th>Ngưỡng duy trì</th><th>Hệ số điểm</th><th>Bảo vệ</th><th>Quyền lợi</th></tr></thead>
              <tbody>{params.tiers.map((t) => {
                const bt = baseTiers.find((x) => x.key === t.key);
                const changed = !bt || bt.threshold !== t.threshold || bt.multiplier !== t.multiplier;
                return (
                  <tr key={t.key} className={changed ? 'is-changed' : ''}>
                    <td><TierBadge tier={t.key} />{t.proposed && <div className="demo-sub">đề xuất thêm</div>}</td>
                    <td>{t.special ? <span className="demo-muted">BOD duyệt</span> : t.key === 'member' ? <span className="demo-muted">Mặc định</span> : (
                      <><Cell label={'Ngưỡng ' + t.name} wide={vnd} value={t.threshold ?? 0} readOnly={!editable} onNum={(n) => setThreshold(t.key, n)} />
                        <div className="demo-sub">≈ {mil(needMonthly(t))}/tháng</div></>
                    )}</td>
                    <td>{t.keep && t.key !== 'member' ? <Cell label={'Ngưỡng duy trì ' + t.name} wide={vnd} value={t.keep} readOnly onNum={() => {}} /> : '—'}</td>
                    <td><Cell label={'Hệ số ' + t.name} decimals value={t.multiplier} readOnly={!editable} onNum={(n) => setTier(t.key, { multiplier: n })} /></td>
                    <td className="demo-muted">{t.protectMonths ? t.protectMonths + ' tháng' : '—'}</td>
                    <td className="w12-ben">{t.benefits.join(' · ')}{t.key === 'bronze' && t.multiplier === 1 && <div className="w12-warn">Hệ số hạng Đồng chưa có trong khảo sát</div>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="demo-sub w12-foot">Ngưỡng duy trì mặc định = {Math.round(KEEP_RATIO * 100)}% ngưỡng lên hạng (tự tính khi đổi ngưỡng). Dưới ngưỡng duy trì thì rớt 1 bậc, trừ khi còn trong thời gian bảo vệ hạng. Hạng Thành viên chờ khách chốt có dùng hay không. Dòng tô xanh = khác bản v{d.base?.version}.</div>
        </Card>

        <div className="demo-grid demo-grid--2">
          <Card title={`Nếu áp dụng ngưỡng này, phân bổ ${total || '…'} đại lý sẽ là…`} subtitle="Cột: phương án đang chỉnh · nét đứt: hạng hiện tại">
            {!s ? <Loading label="Đang mô phỏng…" /> : (
              <>
                <HBars compare rows={s.distribution.map((x) => {
                  const dd = x.simulated - x.current;
                  return { label: <TierBadge tier={x.tier} />, value: x.simulated, compare: x.current, valueLabel: x.simulated + (dd ? (dd > 0 ? ` (+${dd})` : ` (−${-dd})`) : ''), tip: `Hiện tại ${x.current} → phương án ${x.simulated}` };
                })} />
                <div className="demo-sub" style={{ marginTop: 8 }}>{s.moves.up} đại lý lên hạng · {s.moves.down} đại lý xuống hạng so với hạng hiện tại (chưa tính bảo vệ hạng).</div>
              </>
            )}
          </Card>
          <Card title="Chi phí điểm ước tính / tháng" subtitle={`Theo doanh số tháng này của ${total || '…'} đại lý · 1 điểm = ${num(pv)}đ`}>
            {!s ? <Loading label="Đang mô phỏng…" /> : (
              <div className="w12-cost">
                <KpiCard label="Điểm phát sinh" value={num(s.monthlyPoints)} delta={b0 && b0.monthlyPoints ? Math.round(((s.monthlyPoints - b0.monthlyPoints) / b0.monthlyPoints) * 1000) / 10 : 0} deltaLabel="so hiện tại" />
                <KpiCard label="Giá trị quy đổi" value={mil(s.monthlyPoints * pv)} />
                <KpiCard label="Chi phí / doanh số" value={dec(s.costPct) + '%'} tone={s.costPct > 1.5 ? 'warning' : undefined} hint={b0 ? `Hiện tại ${dec(b0.costPct)}%` : undefined} />
              </div>
            )}
            <div className="demo-note demo-note--muted" style={{ marginTop: 12 }}><Icon name="info" size={16} />
              Với ngưỡng đang chỉnh, đại lý cần khoảng {mil(needMonthly(tierOf('bronze')!))}/tháng để đạt hạng {TIER_NAME.bronze}; {TIER_NAME.diamond} cần khoảng {mil(needMonthly(tierOf('diamond')!))}/tháng. Xem tài liệu "Ghi chú rủi ro & Cơ chế điểm".
            </div>
          </Card>
        </div>

        <Card title="Lịch sử phiên bản">
          <VersionList history={d.q.data?.history ?? []} prefix="w12" />
        </Card>
      </div>

      {confirmJob && (
        <QuickView title="Chạy xét hạng ngay?" onClose={() => setConfirmJob(false)}
          footer={<><Button onClick={() => setConfirmJob(false)}>Huỷ</Button><Button variant="primary" icon="refresh" disabled={review.isPending} onClick={() => review.mutate()}>Chạy xét hạng</Button></>}>
          <div className="demo-note demo-note--warn"><Icon name="alert" size={16} />Job thường chạy tự động ngày 01. Chạy tay sẽ áp bảng hạng v{d.active?.version} đang hiệu lực (không phải bản nháp) cho mọi đại lý: lên hạng khi đạt ngưỡng, rớt 1 bậc khi dưới ngưỡng duy trì và hết bảo vệ.</div>
        </QuickView>
      )}
    </AdminShell>
  );
}
