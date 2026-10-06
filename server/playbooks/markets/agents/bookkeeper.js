import { money, sideLabel, signedMoney } from '../format.js';
import { closePosition, lastActivity, markPatch, openPositions, portfolio, quotePatch, recordEquity } from '../ledger.js';

// Closed markets are re-quoted for a while so we notice when they resolve.
const CLOSED_WATCH_MS = 14 * 24 * 3_600_000;

function marketsToPrice(store, closeTasks) {
  const held = new Set(openPositions(store).map((p) => p.marketId));
  for (const t of closeTasks) {
    const p = store.get('positions', t.payload?.positionId);
    if (p) held.add(p.marketId);
  }
  const cutoff = Date.now() - CLOSED_WATCH_MS;
  return store.list(
    'markets',
    (m) => held.has(m.id) || m.status === 'watching' || (m.status === 'closed' && Date.parse(m.closedAt ?? m.updatedAt ?? 0) > cutoff),
  );
}

function applyQuotes(store, quotes) {
  const quoted = new Set();
  let resolved = 0;
  for (const q of quotes) {
    const market = store.find('markets', { externalId: q.externalId });
    if (!market) continue;
    quoted.add(market.id);
    const before = market.status;
    const after = store.update('markets', market.id, quotePatch(market, q));
    if (before !== 'resolved' && after.status === 'resolved') {
      resolved += 1;
      store.update('markets', market.id, lastActivity('bookkeeper', `Resolved ${sideLabel(after.outcome)}`));
    }
  }
  return { quoted, resolved };
}

export default {
  id: 'bookkeeper',
  name: 'Bookkeeper',
  mono: 'Bk',
  job: 'Marks positions to market and settles resolved ones',
  consumes: ['close_position'],
  produces: [],
  schedule: { type: 'cron', cron: '*/5 * * * *' },
  demoSchedule: { type: 'cron', cron: '*/1 * * * *' },
  wakeOnTasks: true,
  capabilities: [
    { key: 'markets.quote', required: true },
    { key: 'notify.post', required: false },
  ],
  config: [
    { key: 'takeProfitPts', label: 'Take profit at', type: 'number', default: 0, min: 0, max: 100, suffix: '+ pts (0 = off)' },
    { key: 'stopLossPts', label: 'Stop loss at', type: 'number', default: 0, min: 0, max: 100, suffix: '− pts (0 = off)' },
  ],

  async run(ctx) {
    const { store, config } = ctx;
    const closeTasks = ctx.tasks.filter((t) => t.type === 'close_position');
    const markets = marketsToPrice(store, closeTasks);
    let quotes = [];
    if (markets.length) {
      ctx.progress(`Pricing ${markets.length} market${markets.length === 1 ? '' : 's'}`);
      ({ quotes = [] } = await ctx.call('markets.quote', { externalIds: [...new Set(markets.map((m) => m.externalId))] }));
    }

    // From here on nothing awaits, so a position can't be approved or closed underneath us.
    const { quoted, resolved } = applyQuotes(store, quotes);
    const takeProfit = Number(config.takeProfitPts) || 0;
    const stopLoss = Number(config.stopLossPts) || 0;
    const settled = [];
    let closed = 0;
    let marked = 0;

    for (const p of openPositions(store)) {
      const market = store.get('markets', p.marketId);
      if (!market) continue;
      if (market.status === 'resolved' && (market.outcome === 'yes' || market.outcome === 'no')) {
        const done = closePosition(store, p, { exitPrice: market.outcome === p.side ? 1 : 0, closeReason: 'resolved' });
        if (done) settled.push({ position: done, market });
        continue;
      }
      if (!quoted.has(market.id)) continue;
      const patch = markPatch(p, market.yesPrice);
      store.update('positions', p.id, patch);
      marked += 1;
      // After trading ends the position just waits to settle.
      if (market.status === 'closed') continue;
      const move = (patch.markPrice - p.entryPrice) * 100;
      if (takeProfit > 0 && move >= takeProfit) {
        if (closePosition(store, p, { exitPrice: patch.markPrice, closeReason: 'take_profit' })) closed += 1;
      } else if (stopLoss > 0 && -move >= stopLoss) {
        if (closePosition(store, p, { exitPrice: patch.markPrice, closeReason: 'stop_loss' })) closed += 1;
      }
    }

    for (const task of closeTasks) {
      const p = store.get('positions', task.payload?.positionId);
      if (!p || p.status !== 'open') {
        ctx.complete(task);
        continue;
      }
      if (store.get('markets', p.marketId)?.status === 'closed') {
        ctx.fail(task, 'Trading has ended on this market. The position settles when it resolves.');
        continue;
      }
      if (closePosition(store, p, { exitPrice: p.markPrice ?? p.entryPrice, closeReason: 'manual' })) closed += 1;
      ctx.complete(task);
    }

    recordEquity(store);

    for (const { position, market } of settled.slice(0, 5)) {
      await ctx.notify(`Settled ${sideLabel(position.side)} on "${market.question}": resolved ${sideLabel(market.outcome)} · ${signedMoney(position.realizedPnl)}.`);
    }

    const { equity, open } = portfolio(store);
    const parts = [`Marked ${marked} position${marked === 1 ? '' : 's'}`];
    if (settled.length) parts.push(`settled ${settled.length}`);
    if (closed) parts.push(`closed ${closed}`);
    if (resolved) parts.push(`${resolved} market${resolved === 1 ? '' : 's'} resolved`);
    return { summary: `${parts.join(', ')}. Equity ${money(equity)} with ${open.length} open.` };
  },
};
