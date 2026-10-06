// Formatting and small pieces shared by the Markets, Market detail, Positions,
// control-room and trade-approval screens.
import { useRef } from 'react';
import { api } from '../lib/api.js';
import { formatAgo, formatDate, formatMoney, formatPct } from '../lib/format.js';
import { ConfirmDialog, useAction } from '../components/feedback.jsx';
import { Tag } from '../components/ui.jsx';
import './markets-shared.css';

const MINUS = '−';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A 0–1 price as cents: "41¢". Sub-cent prices keep one decimal: "0.4¢". */
export function cents(p) {
  if (p == null || Number.isNaN(Number(p))) return '—';
  const c = Number(p) * 100;
  if ((c > 0 && c < 1) || (c > 99 && c < 100)) return `${Math.round(c * 10) / 10}¢`;
  return `${Math.round(c)}¢`;
}

/** A 0–1 probability as a whole percent: "58%". */
export function prob(p) {
  if (p == null || Number.isNaN(Number(p))) return '—';
  return `${Math.round(Number(p) * 100)}%`;
}

/** Signed probability points: "+9.5 pts", "−4 pts". */
export function pts(n, { unit = true } = {}) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Math.round(Number(n) * 10) / 10;
  const s = v === 0 ? '0' : `${v < 0 ? MINUS : '+'}${Math.abs(v)}`;
  return unit ? `${s} pts` : s;
}

/** Signed cents for price moves: "+3¢", "−1.5¢". */
export function centsChange(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Math.round(Number(n) * 1000) / 10;
  if (v === 0) return '0¢';
  return `${v < 0 ? MINUS : '+'}${Math.abs(v)}¢`;
}

/** "$1.5M", "$870K", "$640". */
export function compactMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Math.abs(Number(n));
  const sign = Number(n) < 0 ? MINUS : '';
  if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `${sign}$${Math.round(v / 1e3)}K`;
  return `${sign}$${Math.round(v)}`;
}

/** Stakes and trade sizes: "$38", "$38.50", "$12,400". */
export function stakeMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Math.round(Number(n) * 100) / 100;
  return formatMoney(v, { cents: Math.abs(v) < 100 && v !== Math.round(v) });
}

export function shares(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: Number(n) >= 100 ? 0 : 1 });
}

/** "0xa53c…44aa" */
export function shortWallet(w) {
  const s = String(w ?? '');
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s || 'Unknown wallet';
}

/** When a market closes, relative while it is near: "in 38 min", "in 5 h", "in 3 days", "Dec 15". */
export function closesLabel(endDate, now = Date.now()) {
  if (!endDate) return '—';
  const t = Date.parse(endDate);
  if (Number.isNaN(t)) return '—';
  const ms = t - now;
  if (ms <= 0) return 'Closed';
  if (ms < HOUR) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < DAY) return `in ${Math.round(ms / HOUR)} h`;
  const days = Math.round(ms / DAY);
  if (days <= 14) return `in ${days} ${days === 1 ? 'day' : 'days'}`;
  return formatDate(endDate);
}

/** Price move over the last 24 hours (or the whole history when it is shorter), in 0–1 units. */
export function change24h(market, now = Date.now()) {
  const h = market?.priceHistory;
  if (!Array.isArray(h) || h.length < 2 || market.yesPrice == null) return null;
  const since = now - DAY;
  let base = h[0];
  for (const point of h) {
    if (Date.parse(point.at) <= since) base = point;
    else break;
  }
  return Number(market.yesPrice) - Number(base.p);
}

export function pnlClass(n) {
  const v = Number(n);
  if (!v || Number.isNaN(v)) return 'pnl-flat';
  return v > 0 ? 'pnl-up' : 'pnl-down';
}

/** Signed dollars with an optional percent: "+$4.20 (+11%)". Green and red are for P/L only. */
export function PnL({ value, pct, className = '', showPct = true }) {
  if (value == null) return <span className="muted">—</span>;
  const text = `${formatMoney(value, { sign: true })}${showPct && pct != null ? ` (${formatPct(pct, { sign: true, digits: !pct ? 0 : Math.abs(pct) < 1 ? 2 : Math.abs(pct) < 10 ? 1 : 0 })})` : ''}`;
  return <Fade className={`${pnlClass(value)} ${className}`}>{text}</Fade>;
}

/** Edge in points. Colored by the side it favors once it clears the trading threshold. */
export function Edge({ value, min = 8, unit = true }) {
  if (value == null) return <span className="muted">—</span>;
  const strong = Math.abs(value) >= min;
  const cls = !strong ? 'edge-weak' : value > 0 ? 'edge-yes' : 'edge-no';
  return <Fade className={cls}>{pts(value, { unit })}</Fade>;
}

export function SideTag({ side, children, size }) {
  return (
    <Tag kind="side" value={side} className={size === 'lg' ? 'tag-lg' : undefined}>
      {children}
    </Tag>
  );
}

/** Re-mounts its text when the value changes so the new number fades in. */
export function Fade({ children, className = '', title }) {
  const text = typeof children === 'string' || typeof children === 'number' ? String(children) : undefined;
  return (
    <span key={text} className={`num-fade ${className}`.trim()} title={title}>
      {children}
    </span>
  );
}

/**
 * Rows that were on screen at first load rise in with a short stagger; rows that show up
 * on later refetches slide down. Each id keeps its class, so refetches never replay it.
 * Returns a function `(id, index) => { className, style }`.
 */
export function useAppear(items) {
  const ref = useRef(null);
  if (items) {
    if (ref.current === null) {
      ref.current = new Map(items.map((it, i) => [it.id, { cls: 'appear', delay: Math.min(i, 14) * 22 }]));
    } else {
      for (const it of items) if (!ref.current.has(it.id)) ref.current.set(it.id, { cls: 'row-enter', delay: 0 });
    }
  }
  return (id) => {
    const hit = ref.current?.get(id);
    if (!hit) return { className: '', style: undefined };
    return { className: hit.cls, style: hit.delay ? { animationDelay: `${hit.delay}ms` } : undefined };
  };
}

/** Minimum edge the Analyst trades on, read from its settings. */
export function minEdgeFrom(agents) {
  const analyst = (agents ?? []).find((a) => a.id === 'analyst');
  const field = analyst?.config?.find((f) => f.key === 'minEdge');
  const v = Number(field?.value);
  return Number.isFinite(v) && v > 0 ? v : 8;
}

export function agentById(agents) {
  return Object.fromEntries((agents ?? []).map((a) => [a.id, a]));
}

const WEIGHT = { low: 1, medium: 2, high: 3 };

/** The Analyst's factors: which side each one points to and how much it weighs. */
export function Factors({ factors, compact = false }) {
  return (
    <div className={compact ? 'factors factors-compact' : 'factors'}>
      {factors.map((f, i) => {
        const w = WEIGHT[f.weight] ?? 1;
        return (
          <div key={i} className="factor">
            <Tag kind="side" value={f.direction} />
            <span className="factor-text">{f.text}</span>
            <span className="factor-weight" title={`${f.weight ?? 'low'} weight`}>
              <span className="weight" aria-hidden="true">
                {[1, 2, 3].map((n) => (
                  <span key={n} className={n <= w ? 'on' : ''} />
                ))}
              </span>
              {!compact && (f.weight ?? 'low')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** "0xa53c…44aa bought YES $12,400 at 41¢" for whale signals. Compact puts the wallet on its own line. */
export function WhaleLine({ signal: s, compact = false, now }) {
  const verb = s.action === 'sell' ? 'sold' : 'bought';
  if (compact) {
    return (
      <div className="whale-compact">
        <div className="whale">
          {s.side && <Tag kind="side" value={s.side} />}
          <span className="whale-size">{stakeMoney(s.size)}</span>
          <span className="whale-price">at {cents(s.price)}</span>
          <span className="whale-ago">{formatAgo(s.at, now)}</span>
        </div>
        <span className="whale-who" title={s.wallet ?? undefined}>
          {shortWallet(s.wallet)} {verb}
        </span>
      </div>
    );
  }
  return (
    <div className="whale">
      <span className="whale-wallet" title={s.wallet ?? undefined}>
        {shortWallet(s.wallet)}
      </span>
      <span className="whale-verb">{verb}</span>
      {s.side && <Tag kind="side" value={s.side} />}
      <span className="whale-size">{stakeMoney(s.size)}</span>
      <span className="whale-price">at {cents(s.price)}</span>
    </div>
  );
}

/** Confirms a manual close. Bookkeeper sells at the market price on its next run. */
export function ClosePositionDialog({ position, question, onClose, onClosed }) {
  const last = useRef(null);
  if (position) last.current = position;
  const p = position ?? last.current;
  const [close, busy] = useAction((id) => api.post(`/api/positions/${id}/close`), {
    success: 'Bookkeeper will close it at the market price.',
    onDone: () => {
      if (p) onClosed?.(p.id);
      onClose();
    },
  });
  const side = p?.side === 'no' ? 'NO' : 'YES';
  return (
    <ConfirmDialog
      open={!!position}
      onClose={onClose}
      onConfirm={() => p && close(p.id)}
      busy={busy}
      title="Close this position?"
      description={question ?? p?.market?.question}
      confirmLabel="Close position"
    >
      {p && (
        <div className="close-body">
          <p>
            Bookkeeper sells your {shares(p.shares)} {side} shares at the market price, about {cents(p.markPrice)} right now. That returns about{' '}
            <b>{stakeMoney(p.value)}</b> on a {stakeMoney(p.stake)} stake, <PnL value={p.pnl} pct={p.pnlPct} /> if the price holds.
          </p>
          <span className="paper-note">Paper trade. No real money moves.</span>
        </div>
      )}
    </ConfirmDialog>
  );
}
