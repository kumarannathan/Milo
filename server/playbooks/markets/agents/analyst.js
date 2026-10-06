import { ProviderError } from '../../../providers/io.js';
import { cents, pct, pts } from '../format.js';
import { edgePoints, lastActivity, marketHref } from '../ledger.js';
import { BRIEF_SYSTEM, briefPrompt, normalizeBrief } from '../prompts.js';

const FORCED = new Set(['whale', 'manual']);
const MAX_NEWS = 8;
const NEWS_SIGNALS = 3;
const WHALE_WINDOW_MS = 48 * 3_600_000;

// Research sources are optional: a failing one costs the brief some context, not the run.
async function optional(ctx, capability, args, pickRows) {
  if (!ctx.has(capability)) return [];
  try {
    return pickRows(await ctx.call(capability, args)) ?? [];
  } catch {
    return [];
  }
}

async function gatherNews(ctx, market) {
  const query = market.question;
  const [web, news] = await Promise.all([
    optional(ctx, 'web.search', { query, maxResults: 5, days: 30, topic: 'market' }, (r) =>
      (r?.results ?? []).map((x) => ({ title: x.title, url: x.url, snippet: x.snippet ?? '', publishedAt: x.publishedAt ?? null }))),
    optional(ctx, 'signals.news', { query, days: 14, topic: 'market' }, (r) =>
      (r?.items ?? []).map((x) => ({ title: x.title, url: x.url, snippet: x.summary ?? '', publishedAt: x.publishedAt ?? null }))),
  ]);
  const out = [];
  for (const item of [...news, ...web]) {
    if (!item.title || !item.url || out.some((o) => o.url === item.url)) continue;
    out.push({ ...item, title: String(item.title).slice(0, 200), snippet: String(item.snippet ?? '').slice(0, 400) });
  }
  return out.slice(0, MAX_NEWS);
}

function recentWhales(store, marketId) {
  const cutoff = Date.now() - WHALE_WINDOW_MS;
  return store
    .list('signals', (s) => s.marketId === marketId && s.kind === 'whale' && Date.parse(s.at) >= cutoff)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 8)
    .map(({ side, action, size, price, at }) => ({ side, action, size, price, at }));
}

function recordNews(store, market, news) {
  const known = new Set(store.list('signals', (s) => s.marketId === market.id && s.kind === 'news').map((s) => s.url));
  for (const n of news.filter((n) => !known.has(n.url)).slice(0, NEWS_SIGNALS)) {
    store.insert('signals', {
      marketId: market.id,
      kind: 'news',
      at: n.publishedAt ?? new Date().toISOString(),
      title: n.title,
      body: n.snippet,
      wallet: null,
      side: null,
      action: null,
      size: null,
      price: null,
      url: n.url,
      agentId: 'analyst',
    });
  }
}

async function analyze(ctx, task) {
  const { store, config } = ctx;
  const { marketId, reason = 'new' } = task.payload ?? {};
  const market = store.get('markets', marketId);
  if (!market) return ctx.fail(task, 'That market is no longer tracked.');
  if (['closed', 'resolved'].includes(market.status) || (market.status === 'ignored' && reason !== 'manual')) return ctx.complete(task);
  const hours = Number(config.reanalyzeHours) || 12;
  const recent = market.lastAnalyzedAt && Date.now() - Date.parse(market.lastAnalyzedAt) < hours * 3_600_000;
  if (recent && !FORCED.has(reason)) return ctx.complete(task);

  ctx.progress(`Researching ${market.question}`);
  const news = await gatherNews(ctx, market);
  const whales = recentWhales(store, market.id);
  const input = {
    market: {
      externalId: market.externalId,
      question: market.question,
      category: market.category,
      endDate: market.endDate,
      yesPrice: market.yesPrice,
      volume24h: market.volume24h,
      liquidity: market.liquidity,
      url: market.url,
    },
    news,
    whales,
  };

  const { data, model } = await ctx.llm({
    purpose: 'market_brief',
    json: true,
    input,
    system: BRIEF_SYSTEM,
    prompt: briefPrompt({ market, news, whales }),
    maxTokens: 1200,
  });
  const brief = normalizeBrief(data, { news, yesPrice: market.yesPrice });
  if (!brief) {
    ctx.activity({ pre: 'could not get a probability for', link: market.question, href: marketHref(market), post: 'from the model', tag: 'error', level: 'warn' });
    return ctx.fail(task, 'The model did not return a probability.');
  }

  // The price may have moved while the model was thinking.
  const current = store.get('markets', market.id);
  const at = new Date().toISOString();
  const edge = edgePoints(brief.estimate, current.yesPrice);
  store.update('markets', market.id, {
    brief: { summary: brief.summary, factors: brief.factors, verdict: brief.verdict, sources: brief.sources, model: model ?? null, at },
    estimate: brief.estimate,
    confidence: brief.confidence,
    edge,
    lastAnalyzedAt: at,
    ...lastActivity('analyst', `Estimated ${pct(brief.estimate)} · edge ${pts(edge)}`),
  });
  store.insert('signals', {
    marketId: market.id,
    kind: 'brief',
    at,
    title: `Estimate ${pct(brief.estimate)} vs market ${cents(current.yesPrice)}`,
    body: brief.summary,
    wallet: null,
    side: brief.verdict === 'pass' ? null : brief.verdict,
    action: null,
    size: null,
    price: current.yesPrice,
    url: null,
    agentId: 'analyst',
  });
  recordNews(store, market, news);
  ctx.activity({
    pre: 'estimated',
    link: market.question,
    href: marketHref(market),
    post: `at ${pct(brief.estimate)} vs ${cents(current.yesPrice)} · edge ${pts(edge)}`,
    tag: 'brief',
  });

  let proposed = false;
  const minEdge = Number(config.minEdge) || 8;
  const minConfidence = Number(config.minConfidence) || 0;
  if (current.status === 'watching' && Math.abs(edge) >= minEdge && brief.confidence * 100 >= minConfidence) {
    ctx.emit('propose_trade', { marketId: market.id }, { dedupeKey: `trade:${market.id}` });
    proposed = true;
  }
  ctx.complete(task);
  return { proposed };
}

export default {
  id: 'analyst',
  name: 'Analyst',
  mono: 'An',
  job: 'Writes a brief and estimates the odds for each market',
  consumes: ['analyze_market'],
  produces: ['propose_trade'],
  schedule: { type: 'event' },
  batch: 3,
  capabilities: [
    { key: 'web.search', required: false },
    { key: 'signals.news', required: false },
    { key: 'llm.complete', required: true },
  ],
  config: [
    { key: 'minEdge', label: 'Trade when edge is', type: 'number', default: 8, min: 1, max: 50, suffix: '+ pts' },
    { key: 'minConfidence', label: 'Min confidence', type: 'number', default: 60, min: 0, max: 100, suffix: '%' },
    { key: 'reanalyzeHours', label: 'Re-check a market after', type: 'number', default: 12, min: 1, suffix: 'hours' },
  ],

  async run(ctx) {
    let written = 0;
    let proposed = 0;
    for (const task of ctx.tasks) {
      try {
        const result = await analyze(ctx, task);
        if (result) {
          written += 1;
          if (result.proposed) proposed += 1;
        }
      } catch (err) {
        // A malformed answer only sinks this market; auth, rate limits and outages stop the run.
        if (!(err instanceof ProviderError) || err.code !== 'bad_response') throw err;
        ctx.fail(task, err.message);
      }
    }
    if (!written) return { summary: 'Nothing needed a fresh look.' };
    return { summary: `Wrote ${written} brief${written === 1 ? '' : 's'}${proposed ? `, flagged ${proposed} for a trade` : ''}.` };
  },
};
