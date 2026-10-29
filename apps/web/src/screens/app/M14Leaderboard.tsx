import { useState } from 'react';
import { EmptyState, FilterChip, Tabs, TierIcon, type Tier } from '../../ds';
import { PhoneFrame } from '../../shell/PhoneFrame';
import { ErrorNote, Loading, useApi } from '../../lib/hooks';
import { mil, num, ty } from '../../lib/fmt';
import './M14Leaderboard.css';

interface Row { rank: number; name: string; tier: Tier; city: string; value: number; me: boolean }
interface Board { metric: 'sales' | 'points'; scope: string; scopeLabel: string; total: number; top: Row[]; me: Row; gapToNext: number }

const SCOPES = [{ key: 'type', label: 'Cùng loại hình' }, { key: 'city', label: 'Cùng tỉnh' }, { key: 'all', label: 'Toàn quốc' }];

/** M14 Bảng xếp hạng — doanh số tháng hoặc điểm hạng, trong cùng loại hình / tỉnh / toàn quốc. Tên đại lý khác đã được che. */
export default function M14Leaderboard() {
  const [metric, setMetric] = useState<'sales' | 'points'>('sales');
  const [scope, setScope] = useState('type');
  const q = useApi<Board>(`/app/leaderboard?metric=${metric}&scope=${scope}`, { realm: 'app' });
  const fmt = (v: number) => (metric === 'points' ? num(v) + ' điểm' : v >= 1e9 ? ty(v) : mil(v));
  const d = q.data;
  const top = d?.top ?? [];
  const podium = [top[1], top[0], top[2]];

  const footer = d && (
    <div className="m14-mebar">
      <span className="m14-mebar__rank">#{d.me.rank}</span>
      <span className="m14-mebar__m">
        <b>Bạn: hạng {d.me.rank}/{d.total}</b>
        <span>{d.me.rank === 1 ? 'Đang dẫn đầu — giữ vững nhé!' : `Còn ${fmt(d.gapToNext)} để vượt lên hạng ${d.me.rank - 1}`}</span>
      </span>
      <span className="m14-mebar__v">{fmt(d.me.value)}</span>
    </div>
  );

  return (
    <PhoneFrame title="Bảng xếp hạng" back flush footer={footer}>
      <div className="m14-pad">
        <Tabs variant="pill" value={metric} onChange={(k) => setMetric(k as 'sales' | 'points')} items={[{ key: 'sales', label: 'Doanh số tháng', icon: 'trend' }, { key: 'points', label: 'Điểm hạng', icon: 'star' }]} />
        <div className="m14-chips" role="group" aria-label="Phạm vi so sánh">
          {SCOPES.map((s) => <FilterChip key={s.key} selected={scope === s.key} onClick={() => setScope(s.key)}>{s.label}</FilterChip>)}
        </div>
        {d && <span className="m14-sub">{d.scopeLabel} · {num(d.total)} đại lý · tên đại lý khác được che một phần</span>}
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : !top.length ? (
        <EmptyState icon="chart" title="Chưa có dữ liệu xếp hạng" body="Thử chọn phạm vi khác." />
      ) : (
        <>
          {top.length >= 3 && (
            <div className="m14-pod">
              {podium.map((x) => x && (
                <div key={x.rank} className={'m14-pod__c m14-pod__c--' + x.rank + (x.me ? ' is-me' : '')}>
                  <span className="m14-pod__r">{x.rank}</span>
                  <TierIcon tier={x.tier} size={28} />
                  <b>{x.me ? 'Bạn' : x.name}</b>
                  <span className="m14-sub">{x.city}</span>
                  <span className="m14-pod__v">{fmt(x.value)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="m14-list">
            {top.slice(top.length >= 3 ? 3 : 0).map((x) => (
              <div key={x.rank} className={'m14-row' + (x.me ? ' is-me' : '')}>
                <span className="m14-row__n">{x.rank}</span>
                <TierIcon tier={x.tier} size={24} />
                <span className="m14-row__m"><b>{x.me ? x.name + ' (bạn)' : x.name}</b><span>{x.city}</span></span>
                <span className="m14-row__v">{fmt(x.value)}</span>
              </div>
            ))}
            {d && d.me.rank > top.length && <div className="m14-more">… {num(d.me.rank - top.length - 1)} đại lý khác …</div>}
          </div>
        </>
      )}
    </PhoneFrame>
  );
}
