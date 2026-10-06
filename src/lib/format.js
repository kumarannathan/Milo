// Formatting helpers shared by every screen. Times use the viewer's locale and time zone.

const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false });

const toDate = (v) => (v instanceof Date ? v : new Date(v));
const valid = (v) => v != null && !Number.isNaN(toDate(v).getTime());

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatTime(v) {
  return valid(v) ? time.format(toDate(v)) : '—';
}

export function formatClock(v) {
  return valid(v) ? clock.format(toDate(v)) : '—';
}

// "2:46 PM" today, "Mon" this week, "Oct 6" otherwise.
export function formatShort(v, now = new Date()) {
  if (!valid(v)) return '—';
  const d = toDate(v);
  if (sameDay(d, now)) return time.format(d);
  const days = (now - d) / 86_400_000;
  if (days > 0 && days < 6) return weekday.format(d);
  return d.getFullYear() === now.getFullYear() ? day.format(d) : dayYear.format(d);
}

// "Oct 6, 2:41 PM"
export function formatDateTime(v) {
  return valid(v) ? dayTime.format(toDate(v)) : '—';
}

export function formatDate(v) {
  if (!valid(v)) return '—';
  const d = toDate(v);
  return d.getFullYear() === new Date().getFullYear() ? day.format(d) : dayYear.format(d);
}

export function formatWeekday(v) {
  return valid(v) ? weekday.format(toDate(v)).toUpperCase() : '';
}

// "2m", "1h", "3d"
export function formatAgo(v, now = Date.now()) {
  if (!valid(v)) return '—';
  const s = Math.max(0, Math.round((now - toDate(v).getTime()) / 1000));
  if (s < 60) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// "1 min", "38 min", "2 h", "3 days"
export function formatAgoLong(v, now = Date.now()) {
  if (!valid(v)) return '—';
  const s = Math.max(0, Math.round((now - toDate(v).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

// Time until a future date: "in 4 min", "in 2 h"
export function formatIn(v, now = Date.now()) {
  if (!valid(v)) return '—';
  const s = Math.round((toDate(v).getTime() - now) / 1000);
  if (s <= 30) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}

export function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function formatNumber(n) {
  return n == null ? '—' : Number(n).toLocaleString('en-US');
}

export function formatMoney(n, { cents = true, sign = false } = {}) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const prefix = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return `${prefix}$${abs}`;
}

export function formatCost(n) {
  if (n == null) return '—';
  if (n === 0) return '$0';
  return `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;
}

export function formatCents(p) {
  if (p == null) return '—';
  return `${Math.round(p * 100)}¢`;
}

export function formatPct(n, { sign = false, digits = 0 } = {}) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const abs = Math.abs(v).toFixed(digits);
  const prefix = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return `${prefix}${abs}%`;
}

export function formatSigned(n, digits = 0) {
  if (n == null) return '—';
  const v = Number(n);
  return `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(digits)}`;
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function plural(n, one, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

export function sentenceCase(s = '') {
  const t = String(s).replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
