// The Analyst's prompt and the cleanup applied to whatever the model returns.

import { cents, money, usd } from './format.js';

export const BRIEF_SYSTEM = `You are a calibrated forecaster for prediction markets. Your job is to estimate the probability that a market resolves YES and explain why in plain language.

How you work:
- Start from a base rate: how often do events like this happen in comparable situations? Then adjust for the specific evidence in front of you.
- Treat the market price as a strong prior. Markets with real money behind them are usually well calibrated. Move away from the price only when the evidence clearly supports it, and by no more than the evidence justifies.
- Read the question literally. Time left until the close date matters: the less time remains, the more the status quo should dominate.
- Large trades are weak evidence. Mention them when relevant, but do not follow them blindly.
- Avoid overconfidence. Keep estimates between 3% and 97% unless the outcome is effectively settled. Confidence describes how solid your evidence is, not how extreme your estimate is.
- Cite only sources from the material provided. Never invent a source, a quote or a URL.
- If the evidence is thin, say so, keep the estimate close to the market price and set confidence low.
- Write plainly. No hype, no exclamation marks.`;

function daysUntil(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round(((t - Date.now()) / 86_400_000) * 10) / 10);
}

function ago(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

function pricePath(history = []) {
  if (history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  return `${cents(first.p)} on ${String(first.at).slice(0, 10)} → ${cents(last.p)} now`;
}

/** The user prompt for one market. `news` is [{ title, url, snippet, publishedAt }]. */
export function briefPrompt({ market, news = [], whales = [] }) {
  const days = daysUntil(market.endDate);
  const lines = [
    `Question: ${market.question}`,
    market.category ? `Category: ${market.category}` : null,
    market.endDate ? `Closes: ${market.endDate}${days != null ? ` (in ${days} days)` : ''}` : null,
    `Current YES price: ${cents(market.yesPrice)} (the market implies ${Math.round(market.yesPrice * 100)}%)`,
    `24h volume: ${money(market.volume24h ?? 0, { cents: false })} · Liquidity: ${money(market.liquidity ?? 0, { cents: false })}`,
    pricePath(market.priceHistory) ? `Recent price path: ${pricePath(market.priceHistory)}` : null,
    market.url ? `Market page: ${market.url}` : null,
    '',
    'News and search results:',
    ...(news.length
      ? news.map((n, i) => `${i + 1}. ${n.title}${n.publishedAt ? ` (${String(n.publishedAt).slice(0, 10)})` : ''}${n.snippet ? ` — ${n.snippet}` : ''}\n   ${n.url}`)
      : ['(none found)']),
    '',
    'Large trades on this market in the last two days:',
    ...(whales.length
      ? whales.map((w) => `- ${usd(w.size)} ${String(w.side).toUpperCase()} ${w.action} at ${cents(w.price)}, ${ago(w.at)}`)
      : ['(none)']),
    '',
    'Return JSON with exactly these fields:',
    '{',
    '  "summary": "2 to 4 plain sentences: what the question hinges on and where you land",',
    '  "estimate": probability that the market resolves YES, a number from 0 to 1,',
    '  "confidence": how much you trust your estimate, a number from 0 to 1,',
    '  "factors": [{ "text": "one short sentence", "direction": "yes" or "no", "weight": "low", "medium" or "high" }] (3 to 5 items),',
    '  "verdict": "yes" if YES looks underpriced, "no" if it looks overpriced, "pass" if the price looks about right,',
    '  "sources": [{ "title": "...", "url": "..." }] taken only from the news list above',
    '}',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

function probability(v) {
  let n = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n <= 100) n /= 100;
  return Math.min(1, Math.max(0, n));
}

const WEIGHTS = new Set(['low', 'medium', 'high']);

function cleanFactors(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((f) => (typeof f === 'string' ? { text: f } : f ?? {}))
    .filter((f) => String(f.text ?? '').trim())
    .map((f) => {
      const d = String(f.direction ?? '').toLowerCase();
      return {
        text: String(f.text).trim().slice(0, 300),
        direction: d === 'no' || d === 'against' ? 'no' : 'yes',
        weight: WEIGHTS.has(String(f.weight).toLowerCase()) ? String(f.weight).toLowerCase() : 'medium',
      };
    })
    .slice(0, 6);
}

// Sources must come from what we gave the model, so a made-up URL never reaches the UI.
function cleanSources(list, news) {
  const known = new Map(news.filter((n) => n.url).map((n) => [n.url, n]));
  const picked = [];
  for (const s of Array.isArray(list) ? list : []) {
    const url = String(s?.url ?? '').trim();
    if (!known.has(url) || picked.some((p) => p.url === url)) continue;
    picked.push({ title: String(s.title || known.get(url).title || url).slice(0, 200), url });
  }
  if (!picked.length) for (const n of news.slice(0, 3)) picked.push({ title: n.title, url: n.url });
  return picked.slice(0, 6);
}

/**
 * Turns model output into a brief. Returns null when there is no usable estimate.
 * @returns {{ summary, estimate, confidence, factors, verdict, sources } | null}
 */
export function normalizeBrief(data, { news = [], yesPrice }) {
  if (!data || typeof data !== 'object') return null;
  const raw = probability(data.estimate ?? data.probability ?? data.p_yes);
  if (raw == null) return null;
  const estimate = Math.round(Math.min(0.99, Math.max(0.01, raw)) * 1000) / 1000;
  const confidence = Math.round((probability(data.confidence) ?? 0.5) * 100) / 100;
  const edge = (estimate - yesPrice) * 100;
  let verdict = String(data.verdict ?? '').toLowerCase();
  if (!['yes', 'no', 'pass'].includes(verdict)) verdict = edge >= 3 ? 'yes' : edge <= -3 ? 'no' : 'pass';
  return {
    summary: String(data.summary ?? '').trim().slice(0, 1500) || 'No summary was returned.',
    estimate,
    confidence,
    factors: cleanFactors(data.factors),
    verdict,
    sources: cleanSources(data.sources, news),
  };
}
