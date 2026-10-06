import { cents, money } from '../format.js';
import { PRICE_HISTORY_MAX, agentConfig, edgePoints, lastActivity, marketHref, withPrice } from '../ledger.js';
import { analysisPending, queueAnalysis } from '../queue.js';

// Prices this close to 0 or 100 leave nothing to trade, so they are not added to the watchlist.
const MIN_PRICE = 0.03;
const MAX_PRICE = 0.97;
const ACTIVITY_LINES = 6;
const REFRESH_PER_RUN = 10;

function keywordList(...values) {
  const words = values.flatMap((v) => String(v ?? '').split(',')).map((s) => s.trim()).filter(Boolean);
  return [...new Set(words.map((w) => w.toLowerCase()))];
}

// Whole-word match so "AI" finds "AI model" but not "said".
function mentionsAny(market, words) {
  const text = `${market.question} ${market.category ?? ''}`.toLowerCase();
  return words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text));
}

function seedHistory(found) {
  const points = (Array.isArray(found.history) ? found.history : [])
    .filter((h) => h && Number.isFinite(Number(h.p)) && Number.isFinite(Date.parse(h.at)))
    .map((h) => ({ at: new Date(h.at).toISOString(), p: Number(h.p) }))
    .slice(-(PRICE_HISTORY_MAX - 1));
  return withPrice(points, found.yesPrice);
}

function newMarket(found, foundBy, now) {
  return {
    externalId: found.externalId,
    question: found.question,
    slug: found.slug ?? null,
    url: found.url ?? null,
    category: found.category ?? null,
    endDate: found.endDate ?? null,
    yesPrice: found.yesPrice,
    priceHistory: seedHistory(found),
    volume24h: Number(found.volume24h) || 0,
    liquidity: Number(found.liquidity) || 0,
    status: 'watching',
    outcome: null,
    estimate: null,
    confidence: null,
    edge: null,
    brief: null,
    lastAnalyzedAt: null,
    watchedAt: now,
    foundBy,
    lastActivity: { agentId: 'scanner', text: foundBy === 'user' ? 'Added from your link' : 'Started watching', at: now },
  };
}

// Fresh listing data for a market we already track. Status is left to the Bookkeeper.
function refreshPatch(market, found) {
  const patch = {
    volume24h: Number(found.volume24h) || market.volume24h || 0,
    liquidity: Number(found.liquidity) || market.liquidity || 0,
    endDate: found.endDate ?? market.endDate,
    url: market.url ?? found.url ?? null,
    category: market.category ?? found.category ?? null,
  };
  if (Number.isFinite(found.yesPrice) && !['closed', 'resolved'].includes(market.status)) {
    patch.yesPrice = found.yesPrice;
    patch.priceHistory = withPrice(market.priceHistory, found.yesPrice);
    if (market.estimate != null) patch.edge = edgePoints(market.estimate, found.yesPrice);
  }
  return patch;
}

const tradeable = (m) => Number.isFinite(m.yesPrice) && m.yesPrice >= MIN_PRICE && m.yesPrice <= MAX_PRICE;

async function addFromLinks(ctx) {
  const { store } = ctx;
  let added = 0;
  for (const task of ctx.tasks) {
    const slug = String(task.payload?.slug ?? '').trim();
    if (!slug) {
      ctx.complete(task);
      continue;
    }
    ctx.progress(`Looking up ${slug}`);
    const { markets: found = [] } = await ctx.call('markets.search', { slug, limit: 10 });
    if (!found.length) {
      ctx.fail(task, 'No open Yes/No market was found at that link.');
      ctx.activity({ pre: 'could not find an open market at', link: task.payload?.url || slug, href: null, post: '', tag: 'error', level: 'warn' });
      continue;
    }
    const now = new Date().toISOString();
    for (const f of found) {
      let market = store.find('markets', { externalId: f.externalId });
      if (market) {
        const patch = refreshPatch(market, f);
        if (market.status === 'ignored') Object.assign(patch, { status: 'watching', watchedAt: now, ignoredAt: null });
        market = store.update('markets', market.id, patch);
      } else {
        market = store.insert('markets', newMarket(f, 'user', now));
        added += 1;
      }
      if (market.status === 'watching') {
        ctx.activity({ pre: 'added', link: market.question, href: marketHref(market), post: `from your link · YES at ${cents(market.yesPrice)}`, tag: 'watch' });
        queueAnalysis(ctx.emit, store, market.id, 'manual');
      }
    }
    ctx.complete(task);
  }
  return added;
}

function rank(preferred) {
  const score = (m) => (preferred.has(m.externalId) ? 1 : 0);
  return (a, b) => score(b) - score(a) || (b.volume24h ?? 0) - (a.volume24h ?? 0);
}

async function scan(ctx) {
  const { store, config } = ctx;
  const maxWatched = Math.max(1, Number(config.maxWatched) || 30);
  const keywords = keywordList(config.keywords);
  const focus = keywordList(ctx.settings.focus);
  const args = {
    limit: Math.min(300, maxWatched * 3),
    minVolume: Number(config.minVolume) || 0,
    minLiquidity: Number(config.minLiquidity) || 0,
    closesWithinDays: Number(config.closesWithinDays) || undefined,
    keywords,
  };

  ctx.progress('Scanning open markets');
  const { markets: broad = [] } = await ctx.call('markets.search', args);
  // Focus topics are a preference, not a filter: search them too and rank them first.
  let preferred = [];
  if (focus.length) {
    const { markets = [] } = await ctx.call('markets.search', { ...args, keywords: focus });
    preferred = keywords.length ? markets.filter((m) => mentionsAny(m, keywords)) : markets;
  }
  const candidates = [];
  const seen = new Set();
  for (const m of [...preferred, ...broad]) {
    if (!m?.externalId || !m.question || seen.has(m.externalId)) continue;
    seen.add(m.externalId);
    candidates.push(m);
  }

  const now = new Date().toISOString();
  let refreshed = 0;
  const fresh = [];
  for (const f of candidates) {
    const market = store.find('markets', { externalId: f.externalId });
    if (market) {
      store.update('markets', market.id, refreshPatch(market, f));
      refreshed += 1;
    } else if (tradeable(f)) {
      fresh.push(f);
    }
  }

  const watching = store.count('markets', { status: 'watching' });
  const slots = Math.max(0, maxWatched - watching);
  const ranked = fresh.sort(rank(new Set(preferred.map((m) => m.externalId))));
  const added = ranked.slice(0, slots).map((f) => store.insert('markets', newMarket(f, 'scanner', now)));
  for (const market of added.slice(0, ACTIVITY_LINES)) {
    ctx.activity({
      pre: 'started watching',
      link: market.question,
      href: marketHref(market),
      post: `· YES at ${cents(market.yesPrice)} · ${money(market.volume24h, { cents: false })} traded in 24h`,
      tag: 'watch',
    });
  }
  if (added.length > ACTIVITY_LINES) {
    ctx.activity({ pre: 'added', link: `${added.length - ACTIVITY_LINES} more markets`, href: '#/markets', post: 'to the watchlist', tag: 'watch' });
  }
  for (const market of added) queueAnalysis(ctx.emit, store, market.id, 'new');
  return { added: added.length, refreshed, full: slots === 0 && fresh.length > 0 };
}

// Markets past their end date stop trading; the Bookkeeper settles them once they resolve.
function closeEnded(ctx) {
  const now = Date.now();
  const ended = ctx.store.list('markets', (m) => m.status === 'watching' && m.endDate && Date.parse(m.endDate) <= now);
  for (const m of ended) {
    ctx.store.update('markets', m.id, { status: 'closed', closedAt: new Date().toISOString(), ...lastActivity('scanner', 'Trading ended') });
  }
  return ended.length;
}

// Estimates go stale; queue the oldest ones for another look.
function refreshStale(ctx) {
  const hours = Number(agentConfig(ctx.store, ctx.playbook, 'analyst').reanalyzeHours) || 12;
  const cutoff = Date.now() - hours * 3_600_000;
  const stale = ctx.store
    .list('markets', (m) => m.status === 'watching' && (!m.lastAnalyzedAt || Date.parse(m.lastAnalyzedAt) < cutoff))
    .filter((m) => !analysisPending(ctx.store, m.id))
    .sort((a, b) => (a.lastAnalyzedAt ?? '').localeCompare(b.lastAnalyzedAt ?? ''))
    .slice(0, REFRESH_PER_RUN);
  for (const m of stale) queueAnalysis(ctx.emit, ctx.store, m.id, m.lastAnalyzedAt ? 'refresh' : 'new');
  return stale.length;
}

export default {
  id: 'scanner',
  name: 'Scanner',
  mono: 'Sn',
  job: 'Finds active markets worth watching',
  consumes: ['scan_markets'],
  produces: ['analyze_market'],
  schedule: { type: 'cron', cron: '*/30 * * * *' },
  demoSchedule: { type: 'cron', cron: '*/10 * * * *' },
  capabilities: [
    { key: 'markets.search', required: true },
  ],
  config: [
    { key: 'minVolume', label: 'Min 24h volume', type: 'number', default: 25000, min: 0, prefix: '$' },
    { key: 'minLiquidity', label: 'Min liquidity', type: 'number', default: 10000, min: 0, prefix: '$' },
    { key: 'closesWithinDays', label: 'Closes within', type: 'number', default: 90, min: 1, suffix: 'days' },
    { key: 'maxWatched', label: 'Watchlist size', type: 'number', default: 30, min: 1, max: 200, suffix: 'markets' },
    { key: 'keywords', label: 'Keywords', type: 'text', default: '', help: 'Comma-separated. Leave empty for all topics.' },
  ],

  async run(ctx) {
    const linked = await addFromLinks(ctx);
    const closed = closeEnded(ctx);
    const { added, refreshed, full } = await scan(ctx);
    const requeued = refreshStale(ctx);
    const watching = ctx.store.count('markets', { status: 'watching' });

    const parts = [`Added ${added + linked} market${added + linked === 1 ? '' : 's'}`, `watching ${watching}`];
    if (refreshed) parts.push(`refreshed ${refreshed}`);
    if (closed) parts.push(`${closed} closed`);
    if (requeued) parts.push(`${requeued} queued for a fresh look`);
    if (full) parts.push('watchlist is full');
    return { summary: `${parts.join(', ')}.` };
  },
};
