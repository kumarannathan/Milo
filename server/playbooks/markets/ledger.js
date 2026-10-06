// Paper-trading bookkeeping shared by the agents, approval hooks and routes.
// Everything here is synchronous so a position can never be opened or closed twice
// across an await.

import { cents, round2, sideLabel, signedMoney, usd } from './format.js';

export const PRICE_HISTORY_MAX = 300;
// Points closer than this are merged. A little under a minute so a once-a-minute
// schedule with some jitter still gets one point per run.
const MERGE_MS = 55_000;

const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const nowIso = () => new Date().toISOString();

/** An agent's settings with defaults filled in, for agents that read another agent's limits. */
export function agentConfig(store, playbook, agentId) {
  const def = playbook?.agents?.find((a) => a.id === agentId);
  const state = store.get('agents', agentId);
  return { ...Object.fromEntries((def?.config ?? []).map((f) => [f.key, f.default])), ...(state?.config ?? {}) };
}

/** Same shape as ctx.activity, for code that runs outside an agent (approval hooks). */
export function recordActivity(store, agentId, { pre = '', link = '', href = null, post = '', tag = null, level = 'info' }) {
  return store.insert('activity', { agentId, at: nowIso(), pre, link, href, post, tag, level });
}

export function lastActivity(agentId, text) {
  return { lastActivity: { agentId, text, at: nowIso() } };
}

export const marketHref = (market) => `#/markets/${market.id}`;

export function sidePrice(yesPrice, side) {
  const p = Number(yesPrice);
  return side === 'no' ? round4(1 - p) : round4(p);
}

/** Appends a price point, keeping about one point per minute and the newest 300. */
export function withPrice(history, p, at = nowIso()) {
  const list = Array.isArray(history) ? history.slice() : [];
  const point = { at, p: round4(p) };
  const last = list[list.length - 1];
  if (last && Date.parse(at) - Date.parse(last.at) < MERGE_MS) list[list.length - 1] = { at: last.at, p: point.p };
  else list.push(point);
  return list.length > PRICE_HISTORY_MAX ? list.slice(-PRICE_HISTORY_MAX) : list;
}

/** Market fields that follow from a fresh quote. Never moves a market back to watching. */
export function quotePatch(market, quote) {
  const patch = {};
  if (Number.isFinite(quote.yesPrice)) {
    patch.yesPrice = round4(quote.yesPrice);
    patch.priceHistory = withPrice(market.priceHistory, quote.yesPrice);
    if (market.estimate != null) patch.edge = edgePoints(market.estimate, quote.yesPrice);
  }
  if (quote.outcome === 'yes' || quote.outcome === 'no') {
    patch.status = 'resolved';
    patch.outcome = quote.outcome;
    patch.resolvedAt = market.resolvedAt ?? nowIso();
  } else if (quote.closed && market.status !== 'resolved') {
    patch.status = 'closed';
    patch.closedAt = market.closedAt ?? nowIso();
  }
  return patch;
}

/** Edge in probability points: estimate minus price, times 100, one decimal. */
export function edgePoints(estimate, yesPrice) {
  if (estimate == null || !Number.isFinite(Number(yesPrice))) return null;
  return Math.round((Number(estimate) - Number(yesPrice)) * 1000) / 10;
}

// ── Wallet ──────────────────────────────────────────────────────────

export function getWallet(store) {
  const w = store.getValue('wallet');
  if (w && Number.isFinite(Number(w.cash))) return w;
  const start = Number(store.getValue('workspace')?.settings?.startingBalance) || 1000;
  return store.setValue('wallet', { startingBalance: start, cash: start });
}

function adjustCash(store, delta) {
  const w = getWallet(store);
  return store.patchValue('wallet', { cash: round2(Number(w.cash) + delta) });
}

export function openPositions(store) {
  return store.list('positions', { status: 'open' });
}

export function portfolio(store) {
  const w = getWallet(store);
  const open = openPositions(store);
  const exposure = round2(open.reduce((s, p) => s + (Number(p.value) || 0), 0));
  const unrealizedPnl = round2(open.reduce((s, p) => s + (Number(p.pnl) || 0), 0));
  const cash = round2(w.cash);
  return { cash, exposure, equity: round2(cash + exposure), unrealizedPnl, startingBalance: Number(w.startingBalance) || 0, open };
}

/** Writes an equity point; points less than a minute apart are merged into the last one. */
export function recordEquity(store, at = new Date()) {
  const { cash, exposure, equity } = portfolio(store);
  const rows = store.data.equity;
  const last = rows[rows.length - 1];
  if (last && at.getTime() - Date.parse(last.at) < MERGE_MS) {
    return store.update('equity', last.id, { value: equity, cash, exposure });
  }
  return store.insert('equity', { at: at.toISOString(), value: equity, cash, exposure });
}

// ── Positions ───────────────────────────────────────────────────────

export function markPatch(position, yesPrice) {
  const markPrice = sidePrice(yesPrice, position.side);
  const value = round2(position.shares * markPrice);
  const pnl = round2(value - position.stake);
  return { markPrice, value, pnl, pnlPct: position.stake ? Math.round((pnl / position.stake) * 1000) / 10 : 0 };
}

export function holding(store, marketId) {
  return store.find('positions', (p) => p.marketId === marketId && p.status === 'open');
}

/**
 * Opens a paper position at the market's last known price and takes the stake from cash.
 * Returns { position } or { error } when it cannot be opened.
 */
export function openPosition(store, { market, side, stake, approvalId = null, agentId = 'trader', reason = '' }) {
  if (!market) return { error: 'That market no longer exists.' };
  if (market.status === 'resolved' || market.status === 'closed') return { error: 'This market has closed.' };
  const price = sidePrice(market.yesPrice, side);
  if (!(price > 0 && price < 1)) return { error: 'There is no usable price for this market.' };
  if (approvalId && store.find('positions', { approvalId })) return { error: 'This trade was already placed.' };
  const existing = holding(store, market.id);
  if (existing) return { error: `Already holding ${sideLabel(existing.side)} on this market.` };

  const wallet = getWallet(store);
  const amount = Math.floor(Math.min(Number(stake) || 0, Number(wallet.cash) || 0) * 100) / 100;
  if (amount < 1) return { error: 'Not enough paper cash for this trade.' };

  const at = nowIso();
  const shares = round4(amount / price);
  const position = store.insert('positions', {
    marketId: market.id,
    side,
    shares,
    entryPrice: price,
    stake: amount,
    markPrice: price,
    value: round2(shares * price),
    pnl: round2(shares * price - amount),
    pnlPct: 0,
    status: 'open',
    openedAt: at,
    closedAt: null,
    exitPrice: null,
    realizedPnl: null,
    reason,
    closeReason: null,
    approvalId,
    agentId,
  });
  adjustCash(store, -amount);

  store.update('markets', market.id, lastActivity(agentId, `Opened ${sideLabel(side)} · ${usd(amount)} at ${cents(price)}`));
  recordActivity(store, agentId, {
    pre: `opened ${sideLabel(side)} on`,
    link: market.question,
    href: '#/positions',
    post: `· ${usd(amount)} at ${cents(price)}`,
    tag: 'opened',
  });
  return { position };
}

/**
 * Closes a position at `exitPrice` (price of its side) and returns the proceeds to cash.
 * closeReason: 'resolved' | 'take_profit' | 'stop_loss' | 'manual'.
 */
export function closePosition(store, position, { exitPrice, closeReason, agentId = 'bookkeeper' }) {
  const current = store.get('positions', position.id);
  if (!current || current.status !== 'open') return null;
  const value = round2(current.shares * exitPrice);
  const realizedPnl = round2(value - current.stake);
  const closed = store.update('positions', current.id, {
    status: 'closed',
    closedAt: nowIso(),
    exitPrice: round4(exitPrice),
    markPrice: round4(exitPrice),
    value,
    pnl: realizedPnl,
    pnlPct: current.stake ? Math.round((realizedPnl / current.stake) * 1000) / 10 : 0,
    realizedPnl,
    closeReason,
  });
  adjustCash(store, value);

  const market = store.get('markets', current.marketId);
  const question = market?.question ?? 'a market';
  const side = sideLabel(current.side);
  if (closeReason === 'resolved') {
    const outcome = sideLabel(market?.outcome);
    if (market) store.update('markets', market.id, lastActivity(agentId, `Settled ${side} · ${signedMoney(realizedPnl)}`));
    recordActivity(store, agentId, {
      pre: `settled ${side} on`,
      link: question,
      href: '#/positions',
      post: `· resolved ${outcome} · ${signedMoney(realizedPnl)}`,
      tag: 'settled',
    });
  } else {
    const why = { take_profit: ' to take profit', stop_loss: ' at the stop loss', manual: ' as you asked' }[closeReason] ?? '';
    if (market) store.update('markets', market.id, lastActivity(agentId, `Closed ${side} at ${cents(exitPrice)} · ${signedMoney(realizedPnl)}`));
    recordActivity(store, agentId, {
      pre: `closed ${side} on`,
      link: question,
      href: '#/positions',
      post: `at ${cents(exitPrice)}${why} · ${signedMoney(realizedPnl)}`,
      tag: 'closed',
    });
  }
  return closed;
}
