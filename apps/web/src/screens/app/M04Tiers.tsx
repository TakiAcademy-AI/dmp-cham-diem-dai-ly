import { useEffect, useRef, useState } from 'react';
import { TIER_ORDER, type TierDef } from '@dmp/shared';
import { Icon, StatusBadge, TierBadge, TierIcon, TierProgress, type Tier } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { ErrorNote, Loading, useApi } from '../../lib/hooks';
import { date, mil, num } from '../../lib/fmt';
import type { PointSummary } from '../../lib/types';
import './M04Tiers.css';

interface TiersRes { tiers: TierDef[]; tierBasis: 'points' | 'revenue3m'; version: number; current: PointSummary }

const mult = (m: number) => '×' + String(m).replace('.', ',');

/** Ngày xét hạng kế tiếp: ngày 01 tháng sau. */
function nextReview() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1); }
function monthsLeft(until: string) {
  const u = new Date(until), n = new Date();
  return Math.max(0, (u.getFullYear() - n.getFullYear()) * 12 + u.getMonth() - n.getMonth());
}

/** M04 Hạng & quyền lợi — ngưỡng, hệ số, quyền lợi từng hạng (đọc từ cấu hình W12), tiến độ lên hạng. */
export default function M04Tiers() {
  const q = useApi<TiersRes>('/app/tiers', { realm: 'app' });
  const [selKey, setSelKey] = useState<string | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  // Mở màn: cuộn dải thẻ hạng tới hạng hiện tại
  useEffect(() => {
    const r = rail.current, cur = r?.querySelector<HTMLElement>('.is-cur');
    if (r && cur) r.scrollLeft = cur.offsetLeft - r.offsetLeft - (r.clientWidth - cur.clientWidth) / 2;
  }, [q.data]);
  if (q.isLoading) return <PhoneFrame tab="points" title="Hạng & quyền lợi" back><Loading /></PhoneFrame>;
  if (q.error || !q.data) return <PhoneFrame tab="points" title="Hạng & quyền lợi" back><ErrorNote error={q.error} /></PhoneFrame>;

  const { tiers, tierBasis, current: c } = q.data;
  const byRevenue = tierBasis === 'revenue3m';
  const fmtTh = (n: number) => (byRevenue ? mil(n) : num(n) + ' điểm');
  const curKey = c.tier;
  const sel = tiers.find((t) => t.key === (selKey ?? curKey)) ?? tiers[0];
  const curDef = tiers.find((t) => t.key === curKey);
  const rel = TIER_ORDER.indexOf(sel.key) - TIER_ORDER.indexOf(curKey as Tier);

  return (
    <PhoneFrame tab="points" title="Hạng & quyền lợi" back>
      <div className="m04-info">
        <div>Xét hạng tiếp theo<b>{date(nextReview())}</b></div>
        {c.protectedUntil ? (
          <div>Bảo vệ hạng {curDef?.name}<b>còn {monthsLeft(c.protectedUntil)} tháng</b><span>tới {date(c.protectedUntil)}</span></div>
        ) : (
          <div>Giữ hạng {curDef?.name}<b>{curDef?.keep != null ? fmtTh(curDef.keep) : 'Theo hợp đồng'}</b><span>{byRevenue ? 'doanh số 3 tháng' : 'điểm hạng 3 tháng'}</span></div>
        )}
      </div>
      {c.progress.next && (
        <div className="demo-acard">
          <TierProgress tier={curKey as Tier} nextTier={c.progress.next as Tier} value={c.progress.value} target={c.progress.target} unit={byRevenue ? 'vnd' : 'points'}
            footnote="Xét hạng ngày 01 hằng tháng" />
        </div>
      )}
      <div className="m04-rail" ref={rail} role="listbox" aria-label="Các hạng đại lý">
        {tiers.map((t) => (
          <button type="button" key={t.key} role="option" aria-selected={t.key === sel.key}
            className={'m04-tc' + (t.key === curKey ? ' is-cur' : '') + (t.key === sel.key ? ' is-sel' : '')} onClick={() => setSelKey(t.key)}>
            <span className="m04-tc__top">
              <span className="demo-row"><TierIcon tier={t.key} size={40} /><b className="m04-tc__name">{t.name}</b></span>
              {t.key === curKey && <StatusBadge tone="info">Hạng của bạn</StatusBadge>}
            </span>
            <span className="m04-tc__th">{t.special ? 'Ngưỡng' : 'Ngưỡng lên hạng'}<b>{t.special || t.threshold == null ? 'Do BOD duyệt' : t.threshold ? fmtTh(t.threshold) : 'Mặc định'}</b></span>
            <span className="m04-tc__th">Hệ số tích điểm<b>{mult(t.multiplier)}</b></span>
          </button>
        ))}
      </div>
      <div className="m04-dots" aria-hidden="true">{tiers.map((t) => <i key={t.key} className={t.key === sel.key ? 'on' : ''} />)}</div>
      <div className="demo-acard">
        <div className="demo-between"><b className="m04-bh">Quyền lợi hạng {sel.name}</b><TierBadge tier={sel.key} /></div>
        <ul className="m04-ben">{sel.benefits.map((b) => <li key={b}><Icon name="check" size={18} strokeWidth={2.4} />{b}</li>)}</ul>
        {sel.keep != null && sel.keep > 0 && <div className="demo-muted m04-keep">Giữ hạng: tối thiểu {fmtTh(sel.keep)} · bảo vệ hạng {sel.protectMonths} tháng sau khi lên hạng</div>}
        {rel > 0 && !sel.special && sel.threshold != null && (
          <TierProgress compact value={c.progress.value} target={sel.threshold} nextTier={sel.key} unit={byRevenue ? 'vnd' : 'points'} />
        )}
        {rel > 0 && sel.special && <div className="demo-sub">Hạng Đối tác chiến lược không xét theo ngưỡng — do BOD duyệt theo hợp đồng.</div>}
        {rel < 0 && <div className="demo-sub">Quý đại lý đã vượt hạng này.</div>}
      </div>
      <div className="demo-sub">Ngưỡng và quyền lợi theo bộ quy tắc v{q.data.version}. Xét hạng ngày 01 hằng tháng theo {byRevenue ? 'doanh số 3 tháng gần nhất' : 'điểm hạng tích luỹ 3 tháng gần nhất'}.</div>
    </PhoneFrame>
  );
}
