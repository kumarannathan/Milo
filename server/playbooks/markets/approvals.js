// Approval hooks for trade proposals. The approval routes call these synchronously, and
// openPosition refuses a second position for the same approval, so a trade is placed once.

import { sideLabel } from './format.js';
import { marketHref, openPosition, recordActivity, sidePrice } from './ledger.js';

function enrich(approval, store) {
  if (approval.kind !== 'trade') return {};
  const market = store.get('markets', approval.marketId);
  if (!market) return { market: null, currentPrice: null };
  const { id, question, url, category, endDate, yesPrice, status, outcome, estimate, confidence, edge } = market;
  return {
    market: { id, question, url, category, endDate, yesPrice, status, outcome, estimate, confidence, edge },
    currentPrice: approval.trade?.side ? sidePrice(yesPrice, approval.trade.side) : null,
    position: approval.positionId ? store.get('positions', approval.positionId) : null,
  };
}

function approve(approval, { store }) {
  if (approval.kind !== 'trade') return;
  const market = store.get('markets', approval.marketId);
  const { side, stake } = approval.trade ?? {};
  const { position, error } = openPosition(store, {
    market,
    side: side === 'no' ? 'no' : 'yes',
    stake,
    approvalId: approval.id,
    agentId: 'trader',
    reason: approval.trade?.rationale ?? '',
  });
  if (error) {
    store.update('approvals', approval.id, { status: 'failed', error });
    recordActivity(store, 'trader', {
      pre: 'could not place the trade on',
      link: market?.question ?? 'a market',
      href: `#/approvals/${approval.id}`,
      post: `· ${error}`,
      tag: 'error',
      level: 'warn',
    });
    return;
  }
  // 'sent' means executed for trades.
  store.update('approvals', approval.id, {
    status: 'sent',
    positionId: position.id,
    executedAt: position.openedAt,
    executedPrice: position.entryPrice,
    error: null,
  });
}

function reject(approval, { store }, note = {}) {
  if (approval.kind !== 'trade') return;
  const market = store.get('markets', approval.marketId);
  const side = sideLabel(approval.trade?.side);
  store.insert('notes', {
    agentId: 'trader',
    kind: 'trade_rejected',
    marketId: approval.marketId,
    approvalId: approval.id,
    side: approval.trade?.side ?? null,
    text: note.reason || 'Rejected without a reason.',
    tags: note.tags ?? [],
    at: new Date().toISOString(),
  });
  recordActivity(store, 'trader', {
    pre: `dropped the ${side} trade on`,
    link: market?.question ?? 'a market',
    href: market ? marketHref(market) : null,
    post: note.reason ? `· you said: ${note.reason}` : '· you passed on it',
    tag: 'trade',
  });
  if (market) {
    store.update('markets', market.id, {
      lastActivity: { agentId: 'trader', text: `You passed on ${side}${note.reason ? `: ${note.reason}` : ''}`, at: new Date().toISOString() },
    });
  }
}

export const tradeApprovals = { enrich, approve, reject };
