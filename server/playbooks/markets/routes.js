// Markets API routes. Control-room stats live in stats.js.

import { HttpError, badRequest, notFound } from '../../http.js';
import { round2 } from './format.js';
import { portfolio } from './ledger.js';
import { queueAnalysis } from './queue.js';
import { marketsStats } from './stats.js';

export { marketsStats };

const STATUSES = ['watching', 'closed', 'resolved', 'ignored'];
const LIST_HISTORY_POINTS = 60;
const EQUITY_POINTS = 300;
const RANGES = { '1d': 1, '7d': 7, '30d': 30, all: null };

/** Accepts a polymarket.com link (/event/<event>/<market>, /event/<event>, /market/<slug>) or a bare slug. */
export function parseMarketRef(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s) || /^(www\.)?polymarket\.com\//i.test(s)) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
      return null;
    }
    if (!/(^|\.)polymarket\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
    const at = parts.findIndex((p) => p === 'event' || p === 'market');
    const slug = at === -1 ? null : parts[parts.length - 1];
    return slug && parts.length > at + 1 && /^[a-z0-9][a-z0-9-]*$/i.test(slug) ? slug.toLowerCase() : null;
  }
  return /^[a-z0-9][a-z0-9-]{2,200}$/i.test(s) ? s.toLowerCase() : null;
}

/** Evenly thins a series to at most `max` points, always keeping the newest. */
export function downsample(points, max) {
  if (!Array.isArray(points) || points.length <= max) return points ?? [];
  const step = points.length / max;
  const out = [];
  for (let i = 1; i <= max; i++) out.push(points[Math.min(points.length - 1, Math.ceil(i * step) - 1)]);
  return out;
}

function positionSummary(p) {
  if (!p) return null;
  const { id, side, shares, entryPrice, markPrice, stake, value, pnl, pnlPct, openedAt } = p;
  return { id, side, shares, entryPrice, markPrice, stake, value, pnl, pnlPct, openedAt };
}

const byNewest = (field) => (a, b) => String(b[field] ?? '').localeCompare(String(a[field] ?? ''));

const closesAt = (m) => {
  const t = Date.parse(m.endDate ?? '');
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
};

const SORTS = {
  volume: (a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0),
  edge: (a, b) => (b.edge == null ? -1 : Math.abs(b.edge)) - (a.edge == null ? -1 : Math.abs(a.edge)) || (b.volume24h ?? 0) - (a.volume24h ?? 0),
  closing: (a, b) => closesAt(a) - closesAt(b),
};

export function positionsSummary(store) {
  const { cash, exposure, equity, unrealizedPnl, startingBalance, open } = portfolio(store);
  const closed = store.list('positions', { status: 'closed' });
  const realizedPnl = round2(closed.reduce((s, p) => s + (Number(p.realizedPnl) || 0), 0));
  const totalPnl = round2(equity - startingBalance);
  return {
    equity,
    cash,
    exposure,
    unrealizedPnl,
    realizedPnl,
    totalPnl,
    totalPnlPct: startingBalance ? Math.round((totalPnl / startingBalance) * 1000) / 10 : 0,
    startingBalance,
    winRate: closed.length ? Math.round((closed.filter((p) => p.realizedPnl > 0).length / closed.length) * 1000) / 1000 : null,
    openCount: open.length,
    closedCount: closed.length,
  };
}

export function registerMarketsRoutes(router, { store, runner }) {
  const requireMarkets = () => {
    const ws = store.getValue('workspace');
    if (!ws) throw new HttpError(409, 'Finish setup first.');
    if (ws.playbook !== 'markets') throw notFound('Markets are not part of this workspace.');
    return ws;
  };

  const loadMarket = (id) => {
    requireMarkets();
    const market = store.get('markets', id);
    if (!market) throw notFound('No market with that id.');
    return market;
  };

  const openByMarket = () => new Map(store.list('positions', { status: 'open' }).map((p) => [p.marketId, p]));

  // ── Markets ──────────────────────────────────────────────────
  router.get('/api/markets', ({ query }) => {
    requireMarkets();
    const status = query.status ?? 'watching';
    if (status !== 'all' && !STATUSES.includes(status)) throw badRequest('Status must be watching, closed, resolved, ignored or all.');
    const sort = query.sort ?? 'volume';
    if (!SORTS[sort]) throw badRequest('Sort must be volume, edge or closing.');
    const q = String(query.q ?? '').trim().toLowerCase();

    const all = store.list('markets');
    const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((m) => m.status === s).length]));
    counts.all = all.length;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    counts.analyzedToday = all.filter((m) => m.lastAnalyzedAt && Date.parse(m.lastAnalyzedAt) >= midnight.getTime()).length;

    const open = openByMarket();
    const markets = all
      .filter((m) => status === 'all' || m.status === status)
      .filter((m) => !q || `${m.question} ${m.category ?? ''} ${m.slug ?? ''}`.toLowerCase().includes(q))
      .sort(SORTS[sort])
      .map((m) => ({ ...m, priceHistory: downsample(m.priceHistory, LIST_HISTORY_POINTS), openPosition: positionSummary(open.get(m.id)) }));
    return { markets, counts };
  });

  router.post('/api/markets/add', ({ body }) => {
    requireMarkets();
    const slug = parseMarketRef(body.url);
    if (!slug) throw badRequest('Paste a polymarket.com market link, like https://polymarket.com/event/…');
    runner.enqueue('scan_markets', { slug, url: String(body.url).trim() }, { createdBy: 'user', dedupeKey: `scan:${slug}` });
    // The Scanner runs on a schedule; a pasted link should not wait for it.
    runner.requestRun('scanner');
    return { ok: true };
  });

  router.get('/api/markets/:id', ({ params }) => {
    const market = loadMarket(params.id);
    const signals = store
      .list('signals', { marketId: market.id })
      .sort(byNewest('at'))
      .slice(0, 50);
    const positions = store.list('positions', { marketId: market.id }).sort(byNewest('openedAt'));
    const approvals = store.list('approvals', (a) => a.kind === 'trade' && a.marketId === market.id).sort(byNewest('createdAt'));
    return { market: { ...market, openPosition: positionSummary(openByMarket().get(market.id)) }, signals, positions, approvals };
  });

  router.post('/api/markets/:id/ignore', ({ params }) => {
    const market = loadMarket(params.id);
    if (market.status === 'resolved') throw new HttpError(409, 'This market has already resolved.');
    const updated = store.update('markets', market.id, { status: 'ignored', ignoredAt: new Date().toISOString() });
    return { market: updated };
  });

  router.post('/api/markets/:id/watch', ({ params }) => {
    const market = loadMarket(params.id);
    if (market.status === 'closed' || market.status === 'resolved') throw new HttpError(409, 'Trading has ended on this market.');
    const patch = { status: 'watching', ignoredAt: null };
    if (market.status !== 'watching') patch.watchedAt = new Date().toISOString();
    const updated = store.update('markets', market.id, patch);
    if (!updated.lastAnalyzedAt) queueAnalysis(runner.enqueue, store, market.id, 'manual');
    return { market: updated };
  });

  router.post('/api/markets/:id/analyze', ({ params }) => {
    const market = loadMarket(params.id);
    if (market.status === 'closed' || market.status === 'resolved') throw new HttpError(409, 'Trading has ended on this market.');
    queueAnalysis(runner.enqueue, store, market.id, 'manual');
    return { ok: true };
  });

  // ── Positions ────────────────────────────────────────────────
  router.get('/api/positions', ({ query }) => {
    requireMarkets();
    const status = query.status ?? 'all';
    if (!['open', 'closed', 'all'].includes(status)) throw badRequest('Status must be open, closed or all.');
    const markets = new Map(store.list('markets').map((m) => [m.id, m]));
    const rows = store.list('positions', (p) => status === 'all' || p.status === status);
    const open = rows.filter((p) => p.status === 'open').sort(byNewest('openedAt'));
    const closed = rows.filter((p) => p.status === 'closed').sort(byNewest('closedAt'));
    const positions = [...open, ...closed].map((p) => {
      const m = markets.get(p.marketId);
      return { ...p, market: m ? { id: m.id, question: m.question, yesPrice: m.yesPrice, status: m.status, outcome: m.outcome ?? null, url: m.url ?? null } : null };
    });
    return { positions, summary: positionsSummary(store) };
  });

  router.post('/api/positions/:id/close', ({ params }) => {
    requireMarkets();
    const position = store.get('positions', params.id);
    if (!position) throw notFound('No position with that id.');
    if (position.status !== 'open') throw new HttpError(409, 'This position is already closed.');
    const market = store.get('markets', position.marketId);
    if (market?.status === 'closed') throw new HttpError(409, 'Trading has ended on this market. The position settles when it resolves.');
    runner.enqueue('close_position', { positionId: position.id }, { createdBy: 'user', dedupeKey: `close:${position.id}` });
    runner.requestRun('bookkeeper');
    return { ok: true };
  });

  // ── Equity and signals ───────────────────────────────────────
  router.get('/api/equity', ({ query }) => {
    requireMarkets();
    const range = query.range ?? '7d';
    if (!(range in RANGES)) throw badRequest('Range must be 1d, 7d, 30d or all.');
    const days = RANGES[range];
    const cutoff = days ? Date.now() - days * 86_400_000 : -Infinity;
    const points = store
      .list('equity', (p) => Date.parse(p.at) >= cutoff)
      .map(({ at, value }) => ({ at, value }));
    return { points: downsample(points, EQUITY_POINTS) };
  });

  router.get('/api/signals', ({ query }) => {
    requireMarkets();
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const kind = query.kind ? String(query.kind) : null;
    const markets = new Map(store.list('markets').map((m) => [m.id, m]));
    const signals = store
      .list('signals', (s) => !kind || s.kind === kind)
      .sort(byNewest('at'))
      .slice(0, limit)
      .map((s) => ({ ...s, question: markets.get(s.marketId)?.question ?? null }));
    return { signals };
  });
}
