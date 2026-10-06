import { cents, money, pct, pts, sideLabel, usd } from '../format.js';
import { agentConfig, edgePoints, holding, lastActivity, openPosition, openPositions, portfolio, quotePatch } from '../ledger.js';
import { sizeTrade } from '../sizing.js';

const REJECT_COOLDOWN_MS = 24 * 3_600_000;
const round4 = (n) => Math.round(n * 10000) / 10000;

/** The Analyst's reasoning as plain text for the review screen. */
export function rationaleText(market) {
  const brief = market.brief ?? {};
  const parts = [];
  if (brief.summary) parts.push(brief.summary);
  parts.push(
    `Estimate ${pct(market.estimate)} vs market ${pct(market.yesPrice)} (edge ${pts(edgePoints(market.estimate, market.yesPrice))}). Confidence ${pct(market.confidence ?? 0)}.`,
  );
  if (brief.factors?.length) {
    parts.push(['What moves it:', ...brief.factors.map((f) => `- ${f.text} (${sideLabel(f.direction)}, ${f.weight})`)].join('\n'));
  }
  if (brief.sources?.length) parts.push(['Sources:', ...brief.sources.map((s) => `- ${s.title}: ${s.url}`)].join('\n'));
  return parts.join('\n\n');
}

const asReason = (message) => String(message).replace(/\.$/, '').replace(/^[A-Z]/, (c) => c.toLowerCase());

function pendingTrades(store) {
  return store.list('approvals', (a) => a.kind === 'trade' && a.status === 'pending');
}

function consider(ctx, marketId, limits) {
  const { store, config } = ctx;
  const market = store.get('markets', marketId);
  if (!market || market.status !== 'watching') return { kind: 'skipped', why: 'not on the watchlist' };
  const skip = (why) => {
    store.update('markets', market.id, lastActivity('trader', `Passed: ${why}`));
    return { kind: 'skipped', why };
  };

  if (market.estimate == null) return skip('no estimate yet');
  const edge = edgePoints(market.estimate, market.yesPrice);
  if (Math.abs(edge) < limits.minEdge) return skip(`edge moved to ${pts(edge)}`);
  if ((market.confidence ?? 0) * 100 < limits.minConfidence) return skip('confidence is below your minimum');
  const held = holding(store, market.id);
  if (held) return skip(`already holding ${sideLabel(held.side)}`);
  const pending = pendingTrades(store);
  if (pending.some((a) => a.marketId === market.id)) return skip('a trade is already waiting for review');

  const side = market.estimate > market.yesPrice ? 'yes' : 'no';
  const recentlyRejected = store.find(
    'approvals',
    (a) => a.kind === 'trade' && a.status === 'rejected' && a.marketId === market.id && a.trade?.side === side && Date.now() - Date.parse(a.decidedAt ?? a.createdAt) < REJECT_COOLDOWN_MS,
  );
  if (recentlyRejected) return skip(`you passed on ${sideLabel(side)} here in the last day`);
  const maxOpen = Number(config.maxOpenPositions) || 10;
  if (openPositions(store).length + pending.length >= maxOpen) return skip(`at the limit of ${maxOpen} open positions`);

  // Stakes already waiting for review are set aside so approving them all stays within cash.
  const { equity, cash } = portfolio(store);
  const reserved = pending.reduce((s, a) => s + (Number(a.trade?.stake) || 0), 0);
  const sized = sizeTrade({
    estimate: market.estimate,
    yesPrice: market.yesPrice,
    equity,
    cash: Math.max(0, cash - reserved),
    kellyFraction: Number(config.kellyFraction) || 0.25,
    maxStakePct: Number(config.maxStakePct) || 5,
  });
  if (sized.skip) return skip(sized.skip);

  const label = `${sideLabel(sized.side)} at ${cents(sized.price)} · ${usd(sized.stake)}`;
  if (ctx.workspace?.autonomy === 'autopilot') {
    const { position, error } = openPosition(store, { market, side: sized.side, stake: sized.stake, agentId: 'trader', reason: market.brief?.summary ?? '' });
    if (error) return skip(asReason(error));
    return { kind: 'opened', position, market };
  }

  const approval = store.insert('approvals', {
    kind: 'trade',
    status: 'pending',
    agentId: 'trader',
    marketId: market.id,
    trade: {
      side: sized.side,
      stake: sized.stake,
      price: round4(sized.price),
      shares: round4(sized.shares),
      edge: sized.edge,
      estimate: market.estimate,
      confidence: market.confidence,
      rationale: market.brief?.summary ?? '',
    },
    subject: `Buy ${label}`,
    body: rationaleText(market),
    decidedAt: null,
    rejectReason: null,
  });
  store.update('markets', market.id, lastActivity('trader', `Proposed ${label}`));
  ctx.activity({
    pre: `proposed buying ${sideLabel(sized.side)} on`,
    link: market.question,
    href: `#/approvals/${approval.id}`,
    post: `· ${usd(sized.stake)} at ${cents(sized.price)} · edge ${pts(sized.edge)}`,
    tag: 'trade',
  });
  return { kind: 'proposed', approval, market, label };
}

export default {
  id: 'trader',
  name: 'Trader',
  mono: 'Tr',
  job: 'Sizes and places paper trades when the edge is big enough',
  consumes: ['propose_trade'],
  produces: [],
  schedule: { type: 'event' },
  batch: 5,
  capabilities: [
    { key: 'markets.quote', required: true },
    { key: 'notify.post', required: false },
  ],
  config: [
    { key: 'kellyFraction', label: 'Kelly fraction', type: 'number', default: 0.25, min: 0.05, max: 1, step: 0.05 },
    { key: 'maxStakePct', label: 'Max stake', type: 'number', default: 5, min: 1, max: 100, suffix: '% of bankroll' },
    { key: 'maxOpenPositions', label: 'Max open positions', type: 'number', default: 10, min: 1, max: 100 },
  ],

  async run(ctx) {
    const { store } = ctx;
    const analyst = agentConfig(store, ctx.playbook, 'analyst');
    const limits = { minEdge: Number(analyst.minEdge) || 8, minConfidence: Number(analyst.minConfidence) || 0 };

    // Size against a fresh price, not the one the Analyst saw.
    const markets = [...new Set(ctx.tasks.map((t) => t.payload?.marketId))]
      .map((id) => store.get('markets', id))
      .filter((m) => m?.status === 'watching');
    if (markets.length) {
      ctx.progress('Checking prices');
      const { quotes = [] } = await ctx.call('markets.quote', { externalIds: markets.map((m) => m.externalId) });
      for (const q of quotes) {
        const m = store.find('markets', { externalId: q.externalId });
        if (m) store.update('markets', m.id, quotePatch(m, q));
      }
    }

    const counts = { proposed: 0, opened: 0, skipped: 0 };
    const alerts = [];
    for (const task of ctx.tasks) {
      const result = consider(ctx, task.payload?.marketId, limits);
      counts[result.kind] += 1;
      if (result.kind === 'proposed') alerts.push(`Trade waiting for review: Buy ${result.label} on "${result.market.question}".`);
      if (result.kind === 'opened') {
        const p = result.position;
        alerts.push(`Opened ${sideLabel(p.side)} on "${result.market.question}" · ${usd(p.stake)} at ${cents(p.entryPrice)} (paper).`);
      }
      ctx.complete(task);
    }
    for (const text of alerts.slice(0, 3)) await ctx.notify(text);

    const parts = [];
    if (counts.proposed) parts.push(`proposed ${counts.proposed} trade${counts.proposed === 1 ? '' : 's'}`);
    if (counts.opened) parts.push(`opened ${counts.opened} position${counts.opened === 1 ? '' : 's'}`);
    if (counts.skipped) parts.push(`passed on ${counts.skipped}`);
    const summary = parts.length ? parts.join(', ') : 'nothing to do';
    return { summary: `${summary.charAt(0).toUpperCase()}${summary.slice(1)}. Cash ${money(portfolio(store).cash)}.` };
  },
};
