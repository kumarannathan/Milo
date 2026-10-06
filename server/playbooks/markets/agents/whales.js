import { cents, round2, shortWallet, sideLabel, usd } from '../format.js';
import { lastActivity, marketHref } from '../ledger.js';
import { queueAnalysis } from '../queue.js';

const OVERLAP_MS = 2 * 60_000; // trades can show up in the feed a little late
const MAX_GAP_MS = 24 * 3_600_000;
const REANALYZE_AFTER_MS = 3_600_000;
const HUGE_MULTIPLE = 5;
const MAX_ALERTS = 3;

function tradeKey(t) {
  return t.txHash ? `${t.externalId}:${t.txHash}` : `${t.externalId}:${t.wallet}:${t.at}:${t.side}:${t.action}:${Math.round(t.size)}`;
}

// "a $12,400" but "an $8,000" / "an $18,000": follows how the amount is read aloud.
function article(amount) {
  const lead = amount.replace(/^\$/, '').split(/[,.]/)[0];
  return lead.startsWith('8') || lead === '11' || lead === '18' ? 'an' : 'a';
}

function describe(t) {
  const amount = usd(t.size);
  return { amount, text: `${amount} ${sideLabel(t.side)} ${t.action}` };
}

export default {
  id: 'whales',
  name: 'Whale Watch',
  mono: 'Wh',
  job: 'Follows large trades on the markets you watch',
  consumes: [],
  produces: ['analyze_market'],
  schedule: { type: 'cron', cron: '*/10 * * * *' },
  demoSchedule: { type: 'cron', cron: '*/3 * * * *' },
  capabilities: [
    { key: 'markets.trades', required: true },
    { key: 'notify.post', required: false },
  ],
  config: [
    { key: 'minTradeUsd', label: 'Min trade size', type: 'number', default: 5000, min: 100, prefix: '$' },
    { key: 'lookbackMinutes', label: 'Look back', type: 'number', default: 60, min: 5, suffix: 'minutes' },
  ],

  async run(ctx) {
    const { store, config } = ctx;
    const minTrade = Math.max(1, Number(config.minTradeUsd) || 5000);
    const watched = store.list('markets', { status: 'watching' });
    if (!watched.length) return { summary: 'Nothing on the watchlist yet.' };

    const startedAt = new Date();
    const cursor = store.get('agents', ctx.agent.id)?.cursor;
    const since = cursor
      ? Math.max(Date.parse(cursor) - OVERLAP_MS, startedAt - MAX_GAP_MS)
      : startedAt - (Number(config.lookbackMinutes) || 60) * 60_000;

    ctx.progress(`Checking trades on ${watched.length} markets`);
    const { trades = [] } = await ctx.call('markets.trades', {
      externalIds: watched.map((m) => m.externalId),
      minSize: minTrade,
      since: new Date(since).toISOString(),
    });

    const byExternal = new Map(watched.map((m) => [m.externalId, m]));
    const seen = new Set(store.list('signals', (s) => s.kind === 'whale' && s.dedupeKey).map((s) => s.dedupeKey));
    const fresh = trades
      .filter((t) => t && byExternal.has(t.externalId) && Number(t.size) >= minTrade)
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    const perMarket = new Map();
    let count = 0;
    for (const t of fresh) {
      const key = tradeKey(t);
      if (seen.has(key)) continue;
      seen.add(key);
      const market = byExternal.get(t.externalId);
      const { text } = describe(t);
      const verb = t.action === 'sell' ? 'sold' : 'bought';
      store.insert('signals', {
        marketId: market.id,
        kind: 'whale',
        at: t.at,
        title: text,
        body: `${shortWallet(t.wallet)}${t.trader ? ` (${t.trader})` : ''} ${verb} ${sideLabel(t.side)} at ${cents(t.price)}.`,
        wallet: t.wallet ?? null,
        side: t.side,
        action: t.action,
        size: round2(t.size),
        price: t.price,
        url: t.txHash && !ctx.demo ? `https://polygonscan.com/tx/${t.txHash}` : null,
        agentId: ctx.agent.id,
        dedupeKey: key,
      });
      count += 1;
      if (!perMarket.has(market.id)) perMarket.set(market.id, []);
      perMarket.get(market.id).push(t);
    }

    let alerts = 0;
    let requeued = 0;
    for (const [marketId, list] of perMarket) {
      const market = store.get('markets', marketId);
      const biggest = list.reduce((a, b) => (b.size > a.size ? b : a));
      const { amount, text } = describe(biggest);
      ctx.activity({
        pre: `saw ${article(amount)} ${text} on`,
        link: market.question,
        href: marketHref(market),
        post: list.length > 1 ? `and ${list.length - 1} more large trade${list.length === 2 ? '' : 's'}` : '',
        tag: 'whale',
      });
      store.update('markets', marketId, lastActivity(ctx.agent.id, list.length > 1 ? `${list.length} large trades, biggest ${text}` : `Large trade: ${text}`));

      const analyzedAt = market.lastAnalyzedAt ? Date.parse(market.lastAnalyzedAt) : 0;
      if (Date.now() - analyzedAt > REANALYZE_AFTER_MS) {
        queueAnalysis(ctx.emit, store, marketId, 'whale');
        requeued += 1;
      }
      if (biggest.size >= minTrade * HUGE_MULTIPLE && alerts < MAX_ALERTS) {
        alerts += 1;
        await ctx.notify(`Whale Watch: ${article(amount)} ${text} on "${market.question}" at ${cents(biggest.price)}.`);
      }
    }

    store.update('agents', ctx.agent.id, { cursor: startedAt.toISOString() });
    return {
      summary: count
        ? `Found ${count} large trade${count === 1 ? '' : 's'} on ${perMarket.size} market${perMarket.size === 1 ? '' : 's'}${requeued ? `, asked the Analyst to look again at ${requeued}` : ''}.`
        : `No new trades of ${usd(minTrade)} or more.`,
    };
  },
};
