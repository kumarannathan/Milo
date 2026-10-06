// Helpers shared by the sales screens (Approvals, Accounts, Account detail, Conversations).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useResource } from '../lib/live.js';
import { initials } from '../lib/format.js';
import { Skeleton } from '../components/ui.jsx';
import './sales-shared.css';

// ── Agents ─────────────────────────────────────────────────────

/** Agents keyed by id, plus each agent's config as a plain { key: value } object. */
export function useAgents() {
  const { data } = useResource('/api/agents', ['agents']);
  return useMemo(() => {
    const agents = data?.agents ?? [];
    const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    const config = (id) => Object.fromEntries((byId[id]?.config ?? []).map((f) => [f.key, f.value]));
    return { agents, byId, config, loaded: !!data };
  }, [data]);
}

export function agentName(byId, id) {
  if (!id) return '';
  return byId[id]?.name ?? (id === 'user' || id === 'you' ? 'You' : id.charAt(0).toUpperCase() + id.slice(1));
}

export function agentMono(byId, id) {
  return byId[id]?.mono ?? (id ? id.slice(0, 2).replace(/^./, (c) => c.toUpperCase()) : '··');
}

// ── Selection kept in the URL ──────────────────────────────────

/**
 * Selected id mirrored to `#/<page>/<id>` with replaceState, so picking a row doesn't
 * remount the screen. Links from elsewhere still land on the right item.
 */
export function useHashSelection(page, initial) {
  const [id, setId] = useState(initial ?? null);
  useEffect(() => {
    const onHash = () => {
      const m = window.location.hash.match(/^#\/([^/?]+)(?:\/([^/?]+))?/);
      if (m && m[1] === page) setId(m[2] ? decodeURIComponent(m[2]) : null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [page]);
  const select = useCallback(
    (next) => {
      setId(next ?? null);
      const hash = next ? `#/${page}/${encodeURIComponent(next)}` : `#/${page}`;
      if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
    },
    [page],
  );
  return [id, select];
}

// ── Enter animations ───────────────────────────────────────────

/**
 * Remembers when each id first showed up. Rows present on the first load don't animate;
 * rows that arrive later get `row-enter` for a moment.
 */
export function useFreshIds(ids, ready = true) {
  const seen = useRef(null);
  const now = Date.now();
  if (ready && seen.current === null) seen.current = new Map(ids.map((id) => [id, 0]));
  if (seen.current) for (const id of ids) if (!seen.current.has(id)) seen.current.set(id, now);
  return (id) => {
    const t = seen.current?.get(id);
    return !!t && now - t < 700;
  };
}

// ── Keyboard ───────────────────────────────────────────────────

export function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** True when a dialog is open, so page shortcuts stay out of its way. */
export function dialogOpen() {
  return !!document.querySelector('.dialog-root');
}

// ── Textareas ──────────────────────────────────────────────────

export function useAutosize(ref, value, min = 0) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(min, el.scrollHeight)}px`;
  }, [ref, value, min]);
}

// ── Time zones ─────────────────────────────────────────────────

const ZONE_LABELS = {
  'America/New_York': 'ET',
  'America/Detroit': 'ET',
  'America/Toronto': 'ET',
  'America/Kentucky/Louisville': 'ET',
  'America/Indiana/Indianapolis': 'ET',
  'America/Chicago': 'CT',
  'America/Winnipeg': 'CT',
  'America/Denver': 'MT',
  'America/Boise': 'MT',
  'America/Phoenix': 'MT',
  'America/Edmonton': 'MT',
  'America/Los_Angeles': 'PT',
  'America/Vancouver': 'PT',
  'America/Anchorage': 'AKT',
  'Pacific/Honolulu': 'HT',
};

const formatters = new Map();
function zoned(tz, opts) {
  const key = `${tz}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || undefined });
    } catch {
      f = new Intl.DateTimeFormat('en-US', opts);
    }
    formatters.set(key, f);
  }
  return f;
}

/** "ET", "CT", or whatever short name Intl gives for other zones. */
export function zoneLabel(tz, at = new Date()) {
  if (!tz) return '';
  if (ZONE_LABELS[tz]) return ZONE_LABELS[tz];
  const part = zoned(tz, { timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? tz;
}

export function formatInZone(v, tz, opts) {
  if (v == null) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return zoned(tz, opts).format(d);
}

/** "Wed 9:10 AM" in the given zone. */
export function formatDayTimeInZone(v, tz) {
  return formatInZone(v, tz, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "Fri Oct 9, 11:30 AM–12:00 PM MT" */
export function formatMeetingRange(start, durationMin, tz) {
  if (!start) return '—';
  const s = new Date(start);
  const e = new Date(s.getTime() + (Number(durationMin) || 30) * 60_000);
  const day = formatInZone(s, tz, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  const from = formatInZone(s, tz, { hour: 'numeric', minute: '2-digit' });
  const to = formatInZone(e, tz, { hour: 'numeric', minute: '2-digit' });
  const label = zoneLabel(tz, s);
  return `${day}, ${from}–${to}${label ? ` ${label}` : ''}`;
}

// ── Sources ────────────────────────────────────────────────────

/** A clickable URL for a source like "acmehealth.org/careers", or null for plain notes. */
export function sourceHref(src) {
  if (!src) return null;
  const s = String(src).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/\s/.test(s) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return null;
  return `https://${s}`;
}

/** "https://www.acmehealth.org/careers/" → "acmehealth.org/careers" */
export function sourceLabel(src) {
  return String(src ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
}

export function SourceLink({ src, className = 'src-link' }) {
  const href = sourceHref(src);
  const label = sourceLabel(src);
  if (!label) return null;
  if (!href) return <span className={className}>{label}</span>;
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  );
}

// ── Score ──────────────────────────────────────────────────────

export function ScoreBars({ parts }) {
  return (
    <div className="score-bars">
      {parts.map((p) => {
        const value = Math.round(Number(p.value) || 0);
        return (
          <div key={p.key ?? p.label} className="score-part">
            <div className="score-part-head">
              <span>
                {p.label} {p.weight != null && <span className="score-weight">×{Number(p.weight).toFixed(2)}</span>}
              </span>
              <span className="score-value">{value}</span>
            </div>
            <span className="score-track">
              <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ScoreTotal({ value, size = 'md' }) {
  return (
    <span className={size === 'lg' ? 'score-total score-total-lg' : 'score-total'}>
      {value ?? '—'}
      <span className="score-max">/100</span>
    </span>
  );
}

/** "91+ goes to outreach" thresholds from the Qualifier config. */
export function thresholds(config) {
  const outreach = Number(config.outreachAt) || 91;
  const research = Number(config.researchAt) || 70;
  return { outreach, research };
}

// ── Company and people marks ───────────────────────────────────

export function CompanyMark({ name, size = 'md' }) {
  return <span className={`company-mark company-mark-${size}`}>{initials(name)}</span>;
}

export function DetailSkeleton() {
  return (
    <div className="detail-skeleton">
      <div className="detail-skeleton-head">
        <Skeleton width={40} height={40} radius={20} />
        <div className="detail-skeleton-lines">
          <Skeleton width="40%" height={16} />
          <Skeleton width="60%" height={12} />
        </div>
      </div>
      <Skeleton height={160} radius={8} />
      <Skeleton width="70%" height={12} />
      <Skeleton width="55%" height={12} />
    </div>
  );
}
