import { useEffect, useRef, useState, type ReactNode } from 'react';
import { format } from '../ds';

/* Biểu đồ theo README: một trục, cột = giá trị thực (primary), nét đứt = mốc so sánh (ink), tooltip + "Xem dạng bảng". */

function niceMax(v: number) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
}

export interface BarLineProps {
  labels: string[];
  bars: { name: string; values: number[] };
  line?: { name: string; values: number[] };
  width?: number;
  height?: number;
  max?: number;
  format?: (v: number) => string;
  tick?: (v: number) => string;
  highlightLast?: boolean;
  label?: string;
  tipExtra?: (i: number) => ReactNode;
}

/** Đo bề rộng thật của khung để vẽ SVG đúng kích thước (không phóng to chữ/cột theo khung). */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 0) setW(Math.round(e.contentRect.width)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function BarLine(p: BarLineProps) {
  const { labels, bars, line } = p;
  const [boxRef, boxW] = useWidth(p.width ?? 720);
  const W = boxW, H = Math.min(p.height ?? 220, 240), L = 48, R = 12, T = 14, B = 28;
  const all = bars.values.concat(line ? line.values : []);
  const max = p.max ?? niceMax(Math.max(...all));
  const n = labels.length, step = (W - L - R) / n, bw = Math.min(28, step * 0.56);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const ticks = [0, max / 4, max / 2, (max * 3) / 4, max];
  const fmt = p.format ?? ((v: number) => format.number(v));
  const cx = (i: number) => L + step * i + step / 2;
  const last = n - 1;
  return (
    <div className="demo-chart" ref={boxRef}>
      <div className="demo-chart__bar">
        <div className="demo-legend">
          <span><i className="lg-bar" />{bars.name}</span>
          {line && <span><i className="lg-line" />{line.name}</span>}
        </div>
        <button type="button" className="dmp-btn dmp-btn--ghost dmp-btn--md" onClick={() => setTable(!table)}>{table ? 'Xem biểu đồ' : 'Xem dạng bảng'}</button>
      </div>
      {table ? (
        <div className="demo-charttable">
          <table className="dmp-table">
            <thead><tr><th>Kỳ</th><th className="is-num">{bars.name}</th>{line && <th className="is-num">{line.name}</th>}</tr></thead>
            <tbody>{labels.map((l, i) => <tr key={i}><td>{l}</td><td className="is-num">{fmt(bars.values[i])}</td>{line && <td className="is-num">{fmt(line.values[i])}</td>}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="demo-chart__plot" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={p.label ?? bars.name}>
            {ticks.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={i === 0 ? 'ax-base' : 'ax-grid'} /><text x={L - 8} y={y(v) + 4} className="ax-t" textAnchor="end">{p.tick ? p.tick(v) : fmt(v)}</text></g>)}
            {labels.map((l, i) => {
              const v = bars.values[i], top = y(v), hgt = Math.max(0, y(0) - top);
              const cls = (hover === i ? ' is-hover' : '') + (p.highlightLast && i === last ? ' is-last' : '');
              return (
                <g key={i}>
                  <rect className={'bar' + cls} x={cx(i) - bw / 2} y={top} width={bw} height={hgt} rx={4} />
                  <rect className={'bar-foot' + cls} x={cx(i) - bw / 2} y={Math.max(top, y(0) - 4)} width={bw} height={Math.min(4, hgt)} />
                  <text x={cx(i)} y={H - 8} className="ax-t" textAnchor="middle">{l}</text>
                </g>
              );
            })}
            {line && <polyline points={line.values.map((v, i) => `${cx(i)},${y(v)}`).join(' ')} className="ref-line" />}
            {line && line.values.map((v, i) => <circle key={i} cx={cx(i)} cy={y(v)} r={4} className="ref-dot" />)}
            {p.highlightLast && <text x={cx(last)} y={y(bars.values[last]) - 8} className="ax-v" textAnchor="middle">{fmt(bars.values[last])}</text>}
            {labels.map((_, i) => <rect key={'h' + i} x={L + step * i} y={T} width={step} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />)}
            {hover != null && <line x1={cx(hover)} x2={cx(hover)} y1={T} y2={H - B} className="ax-cross" />}
          </svg>
          {hover != null && (
            <div className="demo-tip" style={{ left: (cx(hover) / W) * 100 + '%' }}>
              <b>{labels[hover]}</b>
              <div><i className="lg-bar" />{bars.name}: <strong>{fmt(bars.values[hover])}</strong></div>
              {line && <div><i className="lg-line" />{line.name}: <strong>{fmt(line.values[hover])}</strong></div>}
              {p.tipExtra?.(hover)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface HBarRow { label: ReactNode; value: number; valueLabel?: ReactNode; compare?: number; tip?: ReactNode }
/** Cột ngang một chuỗi; nhãn có thể là TierBadge. */
export function HBars({ rows, compare }: { rows: HBarRow[]; compare?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value), ...(compare ? rows.map((r) => r.compare ?? 0) : []));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="demo-hbars">
      {rows.map((r, i) => (
        <div key={i} className={'demo-hbar' + (hover === i ? ' is-hover' : '')} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="demo-hbar__l">{r.label}</span>
          <span className="demo-hbar__track">
            <span className="demo-hbar__fill" style={{ width: (r.value / max) * 100 + '%' }} />
            {compare && r.compare != null && <span className="demo-hbar__ref" style={{ left: (r.compare / max) * 100 + '%' }} title={'Hiện tại: ' + r.compare} />}
          </span>
          <span className="demo-hbar__v">{r.valueLabel ?? r.value}</span>
          {hover === i && r.tip && <span className="demo-hbar__tip">{r.tip}</span>}
        </div>
      ))}
    </div>
  );
}

/** Lưới nhãn / giá trị. */
export function InfoGrid({ items, cols = 3 }: { items: Array<[ReactNode, ReactNode] | null | false>; cols?: number }) {
  return (
    <dl className="demo-info" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {items.filter(Boolean).map((it, i) => <div key={i} className="demo-info__item"><dt>{(it as [ReactNode, ReactNode])[0]}</dt><dd>{(it as [ReactNode, ReactNode])[1]}</dd></div>)}
    </dl>
  );
}
