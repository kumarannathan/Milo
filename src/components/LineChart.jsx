import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatDate, formatDateTime, formatTime } from '../lib/format.js';
import './line-chart.css';

// Lightweight responsive SVG line/area chart. No dependencies.
// points: [{ at, value }] in any order. `reference` draws a dashed horizontal line.

const PAD_TOP = 12;
const PAD_RIGHT = 12;
const GUTTER = 48;
const AXIS_H = 22;
const dayHour = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric' });

// Axis labels: times within a day and a half, weekday and hour within a week, dates beyond.
function axisFormat(span) {
  if (span <= 36 * 3_600_000) return formatTime;
  if (span <= 8 * 86_400_000) return (t) => dayHour.format(new Date(t));
  return formatDate;
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

// Pads the data range, widens it to at least `minSpan` around its middle, then snaps to nice ticks.
function domainFor(values, fixed, minSpan = 0, clamp) {
  if (fixed) {
    const step = (fixed[1] - fixed[0]) / 4;
    return { lo: fixed[0], hi: fixed[1], step, ticks: ticksFor(fixed[0], fixed[1], step) };
  }
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  let span = hi - lo;
  if (span === 0) span = Math.abs(hi) * 0.04 || 1;
  lo -= span * 0.15;
  hi += span * 0.15;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  if (clamp) {
    if (lo < clamp[0]) [lo, hi] = [clamp[0], Math.min(clamp[1], hi + (clamp[0] - lo))];
    if (hi > clamp[1]) [lo, hi] = [Math.max(clamp[0], lo - (hi - clamp[1])), clamp[1]];
  }
  const step = niceStep((hi - lo) / 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (clamp) {
    lo = Math.max(lo, clamp[0]);
    hi = Math.min(hi, clamp[1]);
  }
  return { lo, hi, step, ticks: ticksFor(lo, hi, step) };
}

function ticksFor(lo, hi, step) {
  const out = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function LineChart({
  points,
  height = 220,
  formatValue = (v) => String(v),
  formatTip,
  reference,
  referenceLabel,
  color = 'var(--foreground)',
  domain,
  minSpan = 0,
  clamp,
  axes = true,
  emptyText = 'Not enough data to chart yet.',
  label,
}) {
  const wrapRef = useRef(null);
  const lineRef = useRef(null);
  const width = useWidth(wrapRef);
  const gradId = `lc${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [hover, setHover] = useState(null);

  const data = useMemo(
    () =>
      (points ?? [])
        .map((p) => ({ t: Date.parse(p.at), v: Number(p.value) }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a, b) => a.t - b.t),
    [points],
  );
  const ok = data.length >= 2 && width > 0;

  const geo = useMemo(() => {
    if (!ok) return null;
    const left = axes ? GUTTER : 0;
    const bottom = axes ? AXIS_H : 4;
    const innerW = Math.max(10, width - left - (axes ? PAD_RIGHT : 0));
    const innerH = Math.max(10, height - PAD_TOP - bottom);
    const values = data.map((d) => d.v);
    if (reference != null && Number.isFinite(Number(reference))) values.push(Number(reference));
    const { lo, hi, step, ticks } = domainFor(values, domain, minSpan, clamp);
    const t0 = data[0].t;
    const t1 = data[data.length - 1].t;
    const x = (t) => left + (t1 === t0 ? innerW : ((t - t0) / (t1 - t0)) * innerW);
    const y = (v) => PAD_TOP + (1 - (v - lo) / (hi - lo || 1)) * innerH;
    const pts = data.map((d) => [x(d.t), y(d.v)]);
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    const base = PAD_TOP + innerH;
    const area = `${line}L${pts[pts.length - 1][0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`;
    const span = t1 - t0;
    const fmtX = axisFormat(span);
    const xTicks = axes ? [0, 1 / 3, 2 / 3, 1].map((f) => ({ f, t: t0 + span * f })) : [];
    return { left, innerW, innerH, base, lo, hi, step, ticks, x, y, pts, line, area, xTicks, fmtX };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, data, width, height, axes, reference, domain, minSpan, clamp?.[0], clamp?.[1]]);

  // Draw the line in once, the first time it has data.
  const drawn = useRef(false);
  const drawTimer = useRef(null);
  useEffect(() => {
    const el = lineRef.current;
    if (!el || drawn.current || !geo) return;
    drawn.current = true;
    const len = el.getTotalLength?.() ?? 0;
    if (!len) return;
    el.style.transition = 'none';
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len}`;
    el.getBoundingClientRect();
    el.style.transition = 'stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)';
    el.style.strokeDashoffset = '0';
    drawTimer.current = setTimeout(() => {
      el.style.transition = '';
      el.style.strokeDasharray = '';
      el.style.strokeDashoffset = '';
    }, 950);
  }, [geo]);
  useEffect(() => () => clearTimeout(drawTimer.current), []);

  function onMove(e) {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let lo = 0;
    let hi = geo.pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (geo.pts[mid][0] < mx) lo = mid;
      else hi = mid;
    }
    const i = Math.abs(geo.pts[lo][0] - mx) <= Math.abs(geo.pts[hi][0] - mx) ? lo : hi;
    setHover(i);
  }

  const hp = geo && hover != null ? geo.pts[hover] : null;
  const hd = hover != null ? data[hover] : null;
  const refY = geo && reference != null && Number.isFinite(Number(reference)) ? geo.y(Number(reference)) : null;
  const tipLeft = hp ? Math.min(Math.max(hp[0], 70), width - 70) : 0;

  return (
    <div className="lc" ref={wrapRef} style={{ height }} role="img" aria-label={label}>
      {!ok ? (
        width > 0 && <div className="lc-empty">{emptyText}</div>
      ) : (
        <>
          <svg width={width} height={height} className="lc-svg" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.12" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {axes &&
              geo.ticks.map((t) => (
                <g key={t}>
                  <line className="lc-grid" x1={geo.left} x2={geo.left + geo.innerW} y1={geo.y(t)} y2={geo.y(t)} />
                  <text className="lc-label" x={geo.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end">
                    {formatValue(t, false, geo.step)}
                  </text>
                </g>
              ))}
            {axes &&
              geo.xTicks.map(({ f, t }) => (
                <text key={f} className="lc-label" x={geo.x(t)} y={height - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
                  {geo.fmtX(t)}
                </text>
              ))}
            <path className="lc-area" d={geo.area} fill={`url(#${gradId})`} />
            {refY != null && (
              <g className="lc-ref">
                <line x1={geo.left} x2={geo.left + geo.innerW} y1={refY} y2={refY} />
                {referenceLabel && <RefLabel geo={geo} refY={refY} text={referenceLabel} />}
              </g>
            )}
            <path ref={lineRef} className="lc-line" d={geo.line} style={{ stroke: color }} />
            {hp && (
              <g className="lc-hover">
                <line x1={hp[0]} x2={hp[0]} y1={PAD_TOP} y2={geo.base} />
                <circle cx={hp[0]} cy={hp[1]} r="4" style={{ fill: color }} />
              </g>
            )}
            {!hp && <circle className="lc-last" cx={geo.pts[geo.pts.length - 1][0]} cy={geo.pts[geo.pts.length - 1][1]} r="3" style={{ fill: color }} />}
          </svg>
          {hp && hd && (
            <div className="lc-tip" style={{ left: tipLeft, top: Math.max(hp[1] - 12, 0) }}>
              <span className="lc-tip-value">{formatValue(hd.v, true, geo.step)}</span>
              <span className="lc-tip-time">{formatTip ? formatTip(hd.t) : formatDateTime(hd.t)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Puts the reference label where the line doesn't run through it: right end first, then
// left, above the dashed line before below. Falls back to the spot with the fewest crossings.
function RefLabel({ geo, refY, text }) {
  const w = text.length * 6.8 + 8;
  const right = geo.left + geo.innerW;
  const spots = [
    { end: true, above: true },
    { end: true, above: false },
    { end: false, above: true },
    { end: false, above: false },
  ].map((spot) => {
    const x0 = spot.end ? right - w : geo.left;
    const x1 = spot.end ? right : geo.left + w;
    const y0 = spot.above ? refY - 18 : refY + 2;
    const y1 = spot.above ? refY - 2 : refY + 18;
    const offChart = y0 < 0 || y1 > geo.base;
    const hits = geo.pts.filter(([px, py]) => px >= x0 - 4 && px <= x1 + 4 && py >= y0 - 3 && py <= y1 + 3).length;
    return { ...spot, score: hits + (offChart ? 1000 : 0) };
  });
  const best = spots.reduce((a, b) => (b.score < a.score ? b : a));
  return (
    <text x={best.end ? right - 4 : geo.left + 4} y={best.above ? refY - 6 : refY + 14} textAnchor={best.end ? 'end' : 'start'}>
      {text}
    </text>
  );
}

/** Tiny inline line for table cells. `values` is a list of numbers, oldest first. */
export function Sparkline({ values, width = 56, height = 18, color = 'currentColor', className = '' }) {
  const v = (values ?? []).map(Number).filter(Number.isFinite);
  if (v.length < 2) {
    return (
      <svg className={`sparkline sparkline-empty ${className}`} width={width} height={height} aria-hidden="true">
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} />
      </svg>
    );
  }
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const pad = 2;
  const pts = v.map((n, i) => [pad + (i / (v.length - 1)) * (width - pad * 2), pad + (1 - (n - lo) / span) * (height - pad * 2)]);
  const last = pts[pts.length - 1];
  return (
    <svg className={`sparkline ${className}`} width={width} height={height} aria-hidden="true">
      <polyline points={pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')} style={{ stroke: color }} />
      <circle cx={last[0]} cy={last[1]} r="1.75" style={{ fill: color }} />
    </svg>
  );
}
