// Formatting shared by agents, routes and stats. Negative numbers use a true minus sign.

const MINUS = '−';

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function grouped(n, digits) {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** "$1,042.10"; `cents: false` gives "$1,042". */
export function money(n, { cents = true } = {}) {
  const v = Number(n) || 0;
  const s = `$${grouped(Math.abs(cents ? round2(v) : Math.round(v)), cents ? 2 : 0)}`;
  return v < 0 && s !== '$0.00' && s !== '$0' ? `${MINUS}${s}` : s;
}

/** "+$31.20" / "−$31.20". */
export function signedMoney(n, opts) {
  const s = money(Math.abs(Number(n) || 0), opts);
  if (s === '$0.00' || s === '$0') return s;
  return `${n < 0 ? MINUS : '+'}${s}`;
}

/** Stakes and trade sizes: "$38", "$38.50", "$12,400". */
export function usd(n) {
  const v = round2(n);
  return money(v, { cents: Math.abs(v) < 100 && v !== Math.round(v) });
}

/** A 0–1 price as cents: "41¢", "0.5¢". */
export function cents(p) {
  const c = (Number(p) || 0) * 100;
  if (c > 0 && c < 1) return `${Math.round(c * 10) / 10}¢`;
  if (c > 99 && c < 100) return `${Math.round(c * 10) / 10}¢`;
  return `${Math.round(c)}¢`;
}

/** A 0–1 probability as a whole percent: "58%". */
export const pct = (p) => `${Math.round((Number(p) || 0) * 100)}%`;

/** Signed points: "+17 pts", "−4.5 pts". */
export function pts(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  if (v === 0) return '0 pts';
  return `${v < 0 ? MINUS : '+'}${Math.abs(v)} pts`;
}

/** Signed percent with one decimal: "+4.2%". */
export function signedPct(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  if (v === 0) return '0%';
  return `${v < 0 ? MINUS : '+'}${Math.abs(v)}%`;
}

export const sideLabel = (side) => (side === 'no' ? 'NO' : 'YES');

export function shortWallet(w) {
  const s = String(w ?? '');
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s || 'unknown wallet';
}
