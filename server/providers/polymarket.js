import { ProviderError } from './io.js';

// Polymarket's public read APIs. No key or account needed.
//   Gamma (markets and events): https://gamma-api.polymarket.com
//   Data (trades):              https://data-api.polymarket.com
// Gamma returns `outcomes`, `outcomePrices` and `clobTokenIds` as JSON-encoded strings and
// numbers as strings, so everything is parsed defensively. `conditionId` is the external id.

const GAMMA = 'https://gamma-api.polymarket.com';
const DATA = 'https://data-api.polymarket.com';
const PAGE = 100; // Gamma caps `limit` at 100
const MAX_PAGES = 5;
const TRADES_PAGE = 500;
const TRADES_MAX_OFFSET = 1500;

// First match wins, so more specific categories come before broad ones.
const CATEGORY_TAGS = [
  ['Economy', ['economy', 'fed', 'fed-rates', 'fomc', 'economic-policy', 'macro-indicators', 'inflation', 'interest-rates', 'finance', 'stocks', 'business']],
  ['Crypto', ['crypto', 'bitcoin', 'ethereum', 'crypto-prices', 'solana']],
  ['Tech', ['tech', 'ai', 'technology', 'big-tech']],
  ['Science', ['science', 'space']],
  ['Weather', ['weather', 'climate', 'hurricanes', 'temperature']],
  ['Sports', ['sports', 'esports', 'soccer', 'nfl', 'nba', 'mlb', 'nhl', 'tennis', 'golf', 'f1']],
  ['Culture', ['pop-culture', 'culture', 'movies', 'music', 'awards', 'entertainment']],
  ['Politics', ['politics', 'elections', 'us-presidential-election', 'midterms', 'global-elections', 'world-elections']],
  ['World', ['geopolitics', 'world', 'middle-east', 'ukraine', 'china']],
];

export function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  }
}

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
}

const round2 = (n) => Math.round(n * 100) / 100;

function isoDate(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function categoryOf(raw) {
  const tags = [...(Array.isArray(raw.tags) ? raw.tags : []), ...(Array.isArray(raw.events?.[0]?.tags) ? raw.events[0].tags : [])];
  const slugs = new Set(tags.map((t) => String(t?.slug ?? '').toLowerCase()).filter(Boolean));
  for (const [category, keys] of CATEGORY_TAGS) if (keys.some((k) => slugs.has(k))) return category;
  return typeof raw.category === 'string' && raw.category ? raw.category : null;
}

function marketUrl(raw) {
  const slug = raw.slug;
  const eventSlug = raw.events?.[0]?.slug;
  if (eventSlug && slug && eventSlug !== slug) return `https://polymarket.com/event/${eventSlug}/${slug}`;
  if (eventSlug || slug) return `https://polymarket.com/event/${eventSlug || slug}`;
  return null;
}

/** One Gamma market, normalized. Non Yes/No markets are flagged with binary: false. */
export function parseGammaMarket(raw) {
  const outcomes = parseList(raw?.outcomes).map((o) => String(o));
  const prices = parseList(raw?.outcomePrices).map(num);
  const yesAt = outcomes.findIndex((o) => /^yes$/i.test(o.trim()));
  const noAt = outcomes.findIndex((o) => /^no$/i.test(o.trim()));
  const idx = yesAt === -1 ? 0 : yesAt;

  let yesPrice = prices[idx] ?? null;
  if (yesPrice == null) yesPrice = num(raw?.lastTradePrice);
  if (yesPrice == null && num(raw?.bestBid) != null && num(raw?.bestAsk) != null) yesPrice = (num(raw.bestBid) + num(raw.bestAsk)) / 2;

  const closed = raw?.closed === true || raw?.closed === 'true';
  const settledPrices = prices.length === 2 && prices.every((p) => p === 0 || p === 1);
  const resolved = closed && (String(raw?.umaResolutionStatus ?? '').toLowerCase() === 'resolved' || settledPrices);
  let outcome = null;
  if (resolved && yesPrice != null) outcome = yesPrice >= 0.99 ? 'yes' : yesPrice <= 0.01 ? 'no' : null;

  return {
    externalId: raw?.conditionId ?? null,
    question: String(raw?.question ?? '').trim(),
    slug: raw?.slug ?? null,
    category: categoryOf(raw ?? {}),
    endDate: isoDate(raw?.endDate ?? raw?.endDateIso),
    yesPrice: yesPrice == null ? null : Math.min(1, Math.max(0, yesPrice)),
    volume24h: num(raw?.volume24hr) ?? 0,
    volume: num(raw?.volumeNum) ?? num(raw?.volume) ?? 0,
    liquidity: num(raw?.liquidityNum) ?? num(raw?.liquidity) ?? 0,
    url: marketUrl(raw ?? {}),
    closed,
    outcome,
    binary: outcomes.length === 2 && yesAt !== -1 && noAt !== -1,
  };
}

/** One Data API trade. `size` is in dollars (shares × price). */
export function parseTrade(raw) {
  const externalId = raw?.conditionId ?? raw?.market ?? null;
  const shares = num(raw?.size);
  const price = num(raw?.price);
  const ts = num(raw?.timestamp);
  if (!externalId || shares == null || price == null || ts == null) return null;
  const outcome = String(raw.outcome ?? '').trim().toLowerCase();
  const side = outcome === 'yes' || outcome === 'no' ? outcome : Number(raw.outcomeIndex) === 1 ? 'no' : 'yes';
  return {
    externalId,
    wallet: raw.proxyWallet ?? raw.wallet ?? null,
    trader: raw.pseudonym || null,
    side,
    action: String(raw.side ?? '').toUpperCase() === 'SELL' ? 'sell' : 'buy',
    size: round2(shares * price),
    shares,
    price,
    at: new Date(ts > 1e12 ? ts : ts * 1000).toISOString(),
    txHash: raw.transactionHash ?? null,
  };
}

function publicMarket(m) {
  const { externalId, question, slug, category, endDate, yesPrice, volume24h, volume, liquidity, url } = m;
  return { externalId, question, slug, category, endDate, yesPrice, volume24h, volume, liquidity, url };
}

function keywordList(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  return list.map((k) => String(k).trim().toLowerCase()).filter(Boolean);
}

function matchesKeywords(raw, m, keywords) {
  const tags = (Array.isArray(raw.tags) ? raw.tags : []).map((t) => t?.label ?? '');
  const text = [m.question, m.slug, m.category, raw.events?.[0]?.title, ...tags].join(' ').toLowerCase();
  return keywords.some((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text));
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

async function getList(io, op, url, query) {
  const body = await io.http(op, url, { query, timeoutMs: 20_000 });
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null;
  if (!rows) throw new ProviderError('Polymarket returned an unexpected response.', { op, code: 'bad_response' });
  return rows;
}

const gammaMarkets = (io, query) => getList(io, 'polymarket.gamma_markets', `${GAMMA}/markets`, query);

// A slug can name a market or a whole event (polymarket.com/event/<slug>).
async function marketsBySlug(io, slug, limit) {
  let rows = await gammaMarkets(io, { slug, include_tag: true });
  if (!rows.length) {
    const events = await getList(io, 'polymarket.gamma_events', `${GAMMA}/events`, { slug });
    const event = events[0];
    rows = (event?.markets ?? []).map((m) => ({ ...m, events: m.events ?? [{ slug: event.slug, title: event.title, tags: event.tags }] }));
  }
  return rows
    .map(parseGammaMarket)
    .filter((m) => m.externalId && m.binary && !m.closed && m.yesPrice != null)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, limit)
    .map(publicMarket);
}

async function search(args = {}, { io }) {
  const limit = Math.min(500, Math.max(1, Number(args.limit) || 50));
  if (args.slug) return { markets: await marketsBySlug(io, String(args.slug).trim(), limit) };

  const minVolume = Number(args.minVolume) || 0;
  const minLiquidity = Number(args.minLiquidity) || 0;
  const keywords = keywordList(args.keywords);
  const now = Date.now();
  const query = {
    active: true,
    closed: false,
    archived: false,
    order: 'volume24hr',
    ascending: false,
    include_tag: true,
    limit: PAGE,
    liquidity_num_min: minLiquidity || undefined,
    end_date_min: new Date(now).toISOString(),
    end_date_max: Number(args.closesWithinDays) > 0 ? new Date(now + Number(args.closesWithinDays) * 86_400_000).toISOString() : undefined,
  };
  // Without keywords most of a page is usable; with them we read further down the volume list.
  const pages = keywords.length ? MAX_PAGES : Math.min(MAX_PAGES, Math.ceil(limit / 40) + 1);

  const out = [];
  for (let page = 0; page < pages && out.length < limit; page++) {
    const rows = await gammaMarkets(io, { ...query, offset: page * PAGE });
    for (const raw of rows) {
      const m = parseGammaMarket(raw);
      if (!m.externalId || !m.question || !m.binary || m.closed || m.yesPrice == null) continue;
      if (m.volume24h < minVolume || m.liquidity < minLiquidity) continue;
      if (keywords.length && !matchesKeywords(raw, m, keywords)) continue;
      if (out.some((o) => o.externalId === m.externalId)) continue;
      out.push(publicMarket(m));
    }
    // Pages are sorted by 24h volume, so once a page ends below the floor nothing later qualifies.
    if (rows.length < PAGE || (num(rows[rows.length - 1]?.volume24hr) ?? 0) < minVolume) break;
  }
  return { markets: out.slice(0, limit) };
}

async function quote(args = {}, { io }) {
  const ids = [...new Set((args.externalIds ?? []).filter(Boolean))];
  const found = new Map();
  for (const chunk of chunks(ids, 25)) {
    // Gamma hides closed markets unless asked, so look those up separately.
    for (const raw of await gammaMarkets(io, { condition_ids: chunk, limit: chunk.length })) {
      const m = parseGammaMarket(raw);
      if (m.externalId) found.set(m.externalId, m);
    }
    const missing = chunk.filter((id) => !found.has(id));
    if (missing.length) {
      for (const raw of await gammaMarkets(io, { condition_ids: missing, closed: true, limit: missing.length })) {
        const m = parseGammaMarket(raw);
        if (m.externalId) found.set(m.externalId, m);
      }
    }
  }
  return {
    quotes: ids
      .filter((id) => found.get(id)?.yesPrice != null)
      .map((id) => {
        const m = found.get(id);
        return { externalId: id, yesPrice: m.yesPrice, closed: m.closed, outcome: m.outcome };
      }),
  };
}

async function trades(args = {}, { io }) {
  const ids = [...new Set((args.externalIds ?? []).filter(Boolean))];
  const minSize = Number(args.minSize) || 0;
  const since = args.since ? Date.parse(args.since) : Date.now() - 60 * 60_000;
  const out = [];
  for (const chunk of chunks(ids, 10)) {
    for (let offset = 0; offset <= TRADES_MAX_OFFSET; offset += TRADES_PAGE) {
      const rows = await getList(io, 'polymarket.data_trades', `${DATA}/trades`, {
        market: chunk.join(','),
        limit: TRADES_PAGE,
        offset,
        filterType: minSize > 0 ? 'CASH' : undefined,
        filterAmount: minSize > 0 ? minSize : undefined,
      });
      for (const raw of rows) {
        const t = parseTrade(raw);
        if (t && Date.parse(t.at) >= since && t.size >= minSize) out.push(t);
      }
      // Trades come newest first; stop once a page reaches back past `since`.
      const oldest = rows.length ? parseTrade(rows[rows.length - 1]) : null;
      if (rows.length < TRADES_PAGE || !oldest || Date.parse(oldest.at) < since) break;
    }
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { trades: out };
}

export default {
  id: 'polymarket',
  name: 'Polymarket',
  category: 'Markets',
  site: 'polymarket.com',
  playbooks: ['markets'],
  description: 'Public Polymarket prices, volume and large trades, read only with no key needed.',
  fields: [],
  handlers: {
    'markets.search': search,
    'markets.quote': quote,
    'markets.trades': trades,
  },
  async test({ io }) {
    await gammaMarkets(io, { limit: 1, active: true, closed: false });
    return { account: 'public API' };
  },
};
