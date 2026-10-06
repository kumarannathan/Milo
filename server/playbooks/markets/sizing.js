// Position sizing for binary contracts that pay $1 per share if the side wins.

const MIN_STAKE = 1;
const floor2 = (n) => Math.floor(n * 100) / 100;

/** YES when the estimate is above the price, otherwise NO (which costs 1 − yesPrice). */
export function pickSide(estimate, yesPrice) {
  const side = estimate > yesPrice ? 'yes' : 'no';
  return {
    side,
    price: side === 'yes' ? yesPrice : 1 - yesPrice,
    probability: side === 'yes' ? estimate : 1 - estimate,
  };
}

/**
 * Fractional Kelly: for a contract costing c that wins with probability p, the full-Kelly
 * fraction of bankroll is (p − c) / (1 − c). The stake is that times `kellyFraction`, capped
 * by `maxStakePct` of equity and by available cash.
 *
 * @returns {{ side, price, probability, kelly, stake, shares, edge } | { skip: string }}
 */
export function sizeTrade({ estimate, yesPrice, equity, cash, kellyFraction = 0.25, maxStakePct = 5 }) {
  if (!Number.isFinite(estimate) || !Number.isFinite(yesPrice)) return { skip: 'no estimate or price' };
  const { side, price, probability } = pickSide(estimate, yesPrice);
  if (!(price >= 0.02 && price <= 0.98)) return { skip: 'the price is too close to 0 or 100' };
  const kelly = (probability - price) / (1 - price);
  if (!(kelly > 0)) return { skip: 'no edge at the current price' };
  const stake = floor2(Math.min(equity * kelly * kellyFraction, (equity * maxStakePct) / 100, cash));
  if (stake < MIN_STAKE) return { skip: cash < MIN_STAKE ? 'not enough paper cash' : 'the edge is too small to size' };
  return {
    side,
    price,
    probability,
    kelly,
    stake,
    shares: stake / price,
    edge: Math.round((probability - price) * 1000) / 10,
  };
}
