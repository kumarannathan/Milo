import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../server/app.js';
import polymarket, { parseGammaMarket, parseList, parseTrade } from '../server/providers/polymarket.js';
import { pastDemoMarketId } from '../server/providers/demo/markets.js';
import { cents, money, pts, signedMoney, usd } from '../server/playbooks/markets/format.js';
import { openPosition, withPrice } from '../server/playbooks/markets/ledger.js';
import { normalizeBrief } from '../server/playbooks/markets/prompts.js';
import { downsample, parseMarketRef } from '../server/playbooks/markets/routes.js';
import { sizeTrade } from '../server/playbooks/markets/sizing.js';

// Demo vendor calls normally take a realistic few hundred milliseconds.
process.env.MILO_DEMO_FAST = '1';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function start() {
  const errors = [];
  const app = await createApp({ dataDir: null, staticDir: null, playbooks: ['sales', 'markets'], log: { error: (...args) => errors.push(args) } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const ok = async (method, path, body) => {
    const res = await call(method, path, body);
    assert.equal(res.status, 200, `${method} ${path}: ${JSON.stringify(res.body)}`);
    return res.body;
  };
  return { app, call, ok, errors };
}

// Ticks the runner until no agent is running and no enabled agent has work waiting.
async function idle(app, timeout = 90_000) {
  const { store, runner } = app;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    runner.tick();
    await sleep(20);
    const requested = store.list('agents').some((a) => a.runRequested);
    const waiting = store.count('tasks', (t) => t.status === 'running' || (t.status === 'queued' && store.get('agents', t.agentId)?.enabled));
    if (!runner.activeCount() && !requested && !waiting) return;
  }
  throw new Error('Agents did not settle in time.');
}

// A demo workspace where agents only run when the test asks, so results don't depend on the clock.
async function demoWorkspace(ok, { autonomy = 'review_trades', maxWatched = 6 } = {}) {
  await ok('POST', '/api/setup', { playbook: 'markets', demo: true, autonomy, agents: ['whales', 'analyst', 'trader', 'bookkeeper'] });
  for (const id of ['scanner', 'whales', 'analyst', 'trader', 'bookkeeper']) await ok('PATCH', `/api/agents/${id}`, { schedule: { type: 'event' } });
  await ok('PATCH', '/api/agents/scanner', { enabled: true, config: { maxWatched } });
  // Every analyzed market with any edge gets a trade, so the flow is deterministic.
  await ok('PATCH', '/api/agents/analyst', { config: { minEdge: 1, minConfidence: 0 } });
}

// ── Helpers ────────────────────────────────────────────────────

test('markets: formatting', () => {
  assert.equal(money(1042.1), '$1,042.10');
  assert.equal(money(-5), '−$5.00');
  assert.equal(signedMoney(31.2), '+$31.20');
  assert.equal(signedMoney(-31.2), '−$31.20');
  assert.equal(money(212.4, { cents: false }), '$212');
  assert.equal(usd(12400), '$12,400');
  assert.equal(usd(38.5), '$38.50');
  assert.equal(usd(38), '$38');
  assert.equal(cents(0.41), '41¢');
  assert.equal(cents(0.004), '0.4¢');
  assert.equal(pts(-4.26), '−4.3 pts');
  assert.equal(pts(17), '+17 pts');
});

test('markets: fractional Kelly sizing', () => {
  const yes = sizeTrade({ estimate: 0.58, yesPrice: 0.41, equity: 1000, cash: 1000, kellyFraction: 0.25, maxStakePct: 5 });
  assert.equal(yes.side, 'yes');
  assert.equal(yes.stake, 50, 'capped at 5% of equity');
  assert.equal(yes.edge, 17);

  const uncapped = sizeTrade({ estimate: 0.5, yesPrice: 0.45, equity: 1000, cash: 1000, kellyFraction: 0.25, maxStakePct: 50 });
  assert.equal(uncapped.stake, Math.floor(1000 * ((0.5 - 0.45) / 0.55) * 0.25 * 100) / 100);

  const no = sizeTrade({ estimate: 0.3, yesPrice: 0.41, equity: 1000, cash: 1000, kellyFraction: 0.25, maxStakePct: 5 });
  assert.equal(no.side, 'no');
  assert.ok(Math.abs(no.price - 0.59) < 1e-9, 'NO costs 1 − yesPrice');

  assert.equal(sizeTrade({ estimate: 0.58, yesPrice: 0.41, equity: 1000, cash: 20, kellyFraction: 0.25, maxStakePct: 5 }).stake, 20, 'limited by cash');
  assert.ok(sizeTrade({ estimate: 0.42, yesPrice: 0.41, equity: 100, cash: 100 }).skip, 'too small to size');
  assert.ok(sizeTrade({ estimate: 0.995, yesPrice: 0.99, equity: 1000, cash: 1000 }).skip, 'price too extreme');
});

test('markets: brief normalization', () => {
  const news = [{ title: 'Real story', url: 'https://example.com/a' }];
  const brief = normalizeBrief(
    {
      summary: 'Short.',
      estimate: 64,
      confidence: '0.7',
      factors: [{ text: 'A reason', direction: 'against', weight: 'huge' }, 'Plain string'],
      sources: [{ title: 'Made up', url: 'https://invented.example/x' }],
    },
    { news, yesPrice: 0.5 },
  );
  assert.equal(brief.estimate, 0.64);
  assert.equal(brief.confidence, 0.7);
  assert.equal(brief.verdict, 'yes', 'derived from the edge when missing');
  assert.deepEqual(brief.factors[0], { text: 'A reason', direction: 'no', weight: 'medium' });
  assert.deepEqual(brief.sources, [{ title: 'Real story', url: 'https://example.com/a' }], 'invented sources are dropped');
  assert.equal(normalizeBrief({ summary: 'no number' }, { news, yesPrice: 0.5 }), null);
  assert.equal(normalizeBrief({ estimate: 140 }, { yesPrice: 0.5 }).estimate, 0.99);
  assert.equal(normalizeBrief({ estimate: 0 }, { yesPrice: 0.5 }).estimate, 0.01);
});

test('markets: link parsing, price history and downsampling', () => {
  assert.equal(parseMarketRef('https://polymarket.com/event/fed-decision-in-october/will-the-fed-cut'), 'will-the-fed-cut');
  assert.equal(parseMarketRef('https://polymarket.com/event/fed-decision-in-october?tid=123'), 'fed-decision-in-october');
  assert.equal(parseMarketRef('polymarket.com/market/some-market'), 'some-market');
  assert.equal(parseMarketRef('some-market-slug'), 'some-market-slug');
  assert.equal(parseMarketRef('https://example.com/event/x'), null);
  assert.equal(parseMarketRef('https://polymarket.com/'), null);
  assert.equal(parseMarketRef('not a link'), null);

  let history = [];
  const t0 = Date.parse('2026-10-06T12:00:00Z');
  history = withPrice(history, 0.4, new Date(t0).toISOString());
  history = withPrice(history, 0.42, new Date(t0 + 20_000).toISOString());
  assert.equal(history.length, 1, 'one point per minute');
  assert.equal(history[0].p, 0.42);
  for (let i = 1; i <= 400; i++) history = withPrice(history, 0.5, new Date(t0 + i * 60_000).toISOString());
  assert.equal(history.length, 300, 'capped at 300 points');

  const points = Array.from({ length: 1000 }, (_, i) => i);
  const thin = downsample(points, 300);
  assert.equal(thin.length, 300);
  assert.equal(thin[thin.length - 1], 999, 'keeps the newest point');
});

// ── Polymarket provider ────────────────────────────────────────

function fakeIo(route) {
  const calls = [];
  return {
    calls,
    async http(op, url, init = {}) {
      calls.push({ op, url, query: init.query ?? {} });
      return route(op, url, init.query ?? {}, calls.length);
    },
  };
}

test('polymarket: parses captured Gamma and Data API responses', async () => {
  const markets = fixture('polymarket-gamma-markets.json');
  assert.deepEqual(parseList('["Yes", "No"]'), ['Yes', 'No']);
  assert.deepEqual(parseList(['a']), ['a']);
  assert.deepEqual(parseList(null), []);

  const blockade = parseGammaMarket(markets[0]);
  assert.match(blockade.externalId, /^0x[0-9a-f]{64}$/);
  assert.equal(blockade.binary, true);
  assert.equal(typeof blockade.yesPrice, 'number');
  assert.equal(blockade.yesPrice, Number(JSON.parse(markets[0].outcomePrices)[0]));
  assert.equal(blockade.category, 'Politics');
  assert.equal(blockade.closed, false);
  assert.equal(blockade.outcome, null);
  assert.ok(blockade.volume24h > 0 && blockade.liquidity > 0);
  assert.match(blockade.url, /^https:\/\/polymarket\.com\/event\//);

  assert.equal(parseGammaMarket(markets[1]).category, 'Economy');
  assert.equal(parseGammaMarket(markets[3]).binary, false, 'team-vs-team markets are not Yes/No');
  const resolved = parseGammaMarket(markets[4]);
  assert.equal(resolved.closed, true);
  assert.equal(resolved.outcome, 'no');
  assert.equal(parseGammaMarket({ conditionId: '0x1', outcomes: 'garbage', outcomePrices: null, lastTradePrice: '0.3' }).yesPrice, 0.3);

  const [raw] = fixture('polymarket-data-trades.json');
  const trade = parseTrade(raw);
  assert.equal(trade.externalId, raw.conditionId);
  assert.equal(trade.side, raw.outcome.toLowerCase());
  assert.equal(trade.action, raw.side.toLowerCase());
  assert.equal(trade.size, Math.round(raw.size * raw.price * 100) / 100, 'size is in dollars');
  assert.equal(trade.at, new Date(raw.timestamp * 1000).toISOString());
  assert.equal(trade.txHash, raw.transactionHash);
  assert.equal(parseTrade({ conditionId: '0x1', size: 10, price: 0.4, timestamp: 1, outcomeIndex: 1, side: 'BUY' }).side, 'no');
  assert.equal(parseTrade({ size: 1 }), null);
});

test('polymarket: search, quote and trades handlers', async () => {
  const markets = fixture('polymarket-gamma-markets.json');
  const open = markets.filter((m) => !m.closed);

  const searchIo = fakeIo(() => open);
  const { markets: found } = await polymarket.handlers['markets.search']({ limit: 10, minVolume: 0, minLiquidity: 0, closesWithinDays: 3650 }, { io: searchIo });
  assert.equal(searchIo.calls[0].op, 'polymarket.gamma_markets');
  assert.equal(searchIo.calls[0].query.order, 'volume24hr');
  assert.ok(found.length >= 3);
  assert.ok(found.every((m) => m.externalId && m.question && typeof m.yesPrice === 'number' && 'volume24h' in m && 'liquidity' in m && 'url' in m));
  assert.ok(!found.some((m) => /Counter-Strike/.test(m.question)), 'non Yes/No markets are skipped');

  const { markets: fed } = await polymarket.handlers['markets.search']({ limit: 10, keywords: ['fed'] }, { io: fakeIo(() => open) });
  assert.ok(fed.length >= 1 && fed.every((m) => /fed/i.test(m.question)));

  const ids = [markets[0].conditionId, markets[4].conditionId];
  const quoteIo = fakeIo((op, url, query) => (query.closed ? [markets[4]] : [markets[0]]));
  const { quotes } = await polymarket.handlers['markets.quote']({ externalIds: ids }, { io: quoteIo });
  assert.equal(quoteIo.calls.length, 2, 'closed markets are looked up separately');
  assert.deepEqual(quoteIo.calls[1].query.condition_ids, [markets[4].conditionId]);
  assert.equal(quotes.length, 2);
  assert.deepEqual(quotes[1], { externalId: markets[4].conditionId, yesPrice: 0, closed: true, outcome: 'no' });

  const trades = fixture('polymarket-data-trades.json');
  const since = new Date((trades[trades.length - 1].timestamp - 1) * 1000).toISOString();
  const tradesIo = fakeIo(() => trades);
  const { trades: big } = await polymarket.handlers['markets.trades']({ externalIds: [trades[0].conditionId], minSize: 1000, since }, { io: tradesIo });
  assert.equal(tradesIo.calls[0].op, 'polymarket.data_trades');
  assert.equal(tradesIo.calls[0].query.filterType, 'CASH');
  assert.equal(tradesIo.calls[0].query.market, trades[0].conditionId);
  assert.ok(big.length >= 1 && big.every((t) => t.size >= 1000));
  assert.ok(big.every((t, i) => i === 0 || big[i - 1].at >= t.at), 'newest first');
});

// ── Demo workspace, end to end ─────────────────────────────────

test('markets: demo workspace from watchlist to settled trades', async (t) => {
  const { app, call, ok, errors } = await start();
  const { store } = app;
  t.after(() => app.close());

  await demoWorkspace(ok);
  assert.deepEqual(store.getValue('wallet'), { startingBalance: 1000, cash: 1000 });

  await t.test('scanner watches markets and the analyst writes briefs', async () => {
    await ok('POST', '/api/agents/scanner/run');
    await idle(app);
    const { markets, counts } = await ok('GET', '/api/markets?status=watching');
    assert.equal(markets.length, 6);
    assert.deepEqual(Object.keys(counts).sort(), ['all', 'analyzedToday', 'closed', 'ignored', 'resolved', 'watching']);
    assert.equal(counts.watching, 6);
    for (let i = 1; i < markets.length; i++) assert.ok(markets[i - 1].volume24h >= markets[i].volume24h, 'sorted by volume');
    for (const m of markets) {
      assert.equal(m.status, 'watching');
      assert.ok(m.yesPrice > 0 && m.yesPrice < 1);
      assert.ok(m.priceHistory.length > 1 && m.priceHistory.length <= 60);
      assert.ok(m.brief?.summary, 'brief written');
      assert.ok(m.brief.factors.length >= 1);
      assert.ok(['yes', 'no', 'pass'].includes(m.brief.verdict));
      assert.ok(m.estimate > 0 && m.estimate < 1);
      assert.ok(m.confidence >= 0 && m.confidence <= 1);
      assert.equal(typeof m.edge, 'number');
      assert.ok(m.lastAnalyzedAt && m.watchedAt && m.foundBy === 'scanner');
      assert.ok(m.lastActivity?.agentId && m.lastActivity.text);
      assert.ok('openPosition' in m);
    }
    const byEdge = (await ok('GET', '/api/markets?sort=edge')).markets;
    assert.ok(Math.abs(byEdge[0].edge) >= Math.abs(byEdge[byEdge.length - 1].edge));
    const searched = (await ok('GET', `/api/markets?status=all&q=${encodeURIComponent(markets[0].question.slice(5, 20))}`)).markets;
    assert.ok(searched.some((m) => m.id === markets[0].id));
    assert.equal((await call('GET', '/api/markets?status=bogus')).status, 400);
    assert.ok(store.count('signals', { kind: 'brief' }) >= 6);
    assert.ok(store.count('activity', { tag: 'watch' }) >= 1);
    assert.ok(store.count('activity', { tag: 'brief' }) >= 6);
  });

  let approvals;
  await t.test('trader proposes trades for review', async () => {
    ({ approvals } = await ok('GET', '/api/approvals'));
    assert.ok(approvals.length >= 3, `expected trade approvals, got ${approvals.length}`);
    for (const a of approvals) {
      assert.equal(a.kind, 'trade');
      assert.equal(a.status, 'pending');
      assert.equal(a.agentId, 'trader');
      assert.match(a.subject, /^Buy (YES|NO) at \d+(\.\d)?¢ · \$[\d,.]+$/);
      assert.ok(a.body.length > 40);
      const { side, stake, price, shares, edge, estimate, confidence, rationale } = a.trade;
      assert.ok(['yes', 'no'].includes(side));
      assert.ok(stake >= 1 && stake <= 50, 'within 5% of a $1,000 bankroll');
      assert.ok(price > 0 && price < 1 && shares > 0 && edge > 0);
      assert.ok(estimate > 0 && confidence > 0 && rationale);
      assert.equal(a.market.id, a.marketId, 'enriched with the market');
      assert.equal(typeof a.currentPrice, 'number');
    }
    assert.equal(store.count('positions'), 0, 'nothing opens without review');
    assert.ok(store.count('activity', { tag: 'trade' }) >= approvals.length);
  });

  let position;
  await t.test('approving opens exactly one position', async () => {
    const target = approvals[0];
    const res = await ok('POST', '/api/approvals/approve', { ids: [target.id, target.id] });
    assert.deepEqual(res.approved, [target.id]);
    assert.equal((await call('POST', `/api/approvals/${target.id}/approve`)).status, 409);
    const positions = store.list('positions', { approvalId: target.id });
    assert.equal(positions.length, 1);
    position = positions[0];
    const approval = store.get('approvals', target.id);
    assert.equal(approval.status, 'sent');
    assert.equal(approval.positionId, position.id);
    assert.equal(position.status, 'open');
    assert.equal(position.side, target.trade.side);
    assert.equal(position.stake, target.trade.stake);
    assert.ok(Math.abs(position.shares * position.entryPrice - position.stake) < 0.01);
    assert.equal(store.getValue('wallet').cash, Math.round((1000 - position.stake) * 100) / 100);
    assert.ok(store.find('activity', (a) => a.tag === 'opened' && a.post.includes(usd(position.stake))));
  });

  await t.test('rejecting records a note and the trader does not re-propose', async () => {
    const target = approvals[1];
    const { approval } = await ok('POST', `/api/approvals/${target.id}/reject`, { reason: 'Too close to the event' });
    assert.equal(approval.status, 'rejected');
    assert.equal(approval.rejectReason, 'Too close to the event');
    assert.ok(store.find('notes', (n) => n.approvalId === target.id && n.kind === 'trade_rejected'));
    assert.ok(store.find('activity', (a) => a.tag === 'trade' && a.pre.startsWith('dropped')));
    app.runner.enqueue('propose_trade', { marketId: target.marketId });
    await idle(app);
    assert.equal(store.count('approvals', (a) => a.marketId === target.marketId), 1);
  });

  await t.test('bookkeeper marks to market and writes equity', async () => {
    await ok('POST', '/api/agents/bookkeeper/run');
    await idle(app);
    const p = store.get('positions', position.id);
    assert.equal(p.status, 'open');
    assert.ok(p.markPrice > 0 && p.markPrice < 1);
    assert.ok(Math.abs(p.value - p.shares * p.markPrice) < 0.01);
    assert.ok(Math.abs(p.pnl - (p.value - p.stake)) < 0.01);
    assert.equal(typeof p.pnlPct, 'number');
    const points = store.list('equity');
    assert.equal(points.length, 1);
    const wallet = store.getValue('wallet');
    assert.ok(Math.abs(points[0].value - (wallet.cash + p.value)) < 0.01);
    assert.ok(Math.abs(points[0].exposure - p.value) < 0.01);

    await ok('POST', '/api/agents/bookkeeper/run');
    await idle(app);
    assert.equal(store.count('equity'), 1, 'at most one point per minute');

    const { points: series } = await ok('GET', '/api/equity?range=1d');
    assert.equal(series.length, 1);
    assert.deepEqual(Object.keys(series[0]).sort(), ['at', 'value']);
    assert.equal((await call('GET', '/api/equity?range=2y')).status, 400);
  });

  await t.test('positions route returns positions and a summary', async () => {
    const { positions, summary } = await ok('GET', '/api/positions?status=open');
    assert.equal(positions.length, 1);
    assert.deepEqual(Object.keys(positions[0].market).sort(), ['id', 'outcome', 'question', 'status', 'url', 'yesPrice']);
    for (const key of ['equity', 'cash', 'exposure', 'unrealizedPnl', 'realizedPnl', 'totalPnl', 'totalPnlPct', 'startingBalance', 'winRate', 'openCount', 'closedCount']) {
      assert.ok(key in summary, `summary.${key}`);
    }
    assert.equal(summary.openCount, 1);
    assert.equal(summary.winRate, null);
    assert.ok(Math.abs(summary.equity - (summary.cash + summary.exposure)) < 0.01);
    assert.equal(summary.startingBalance, 1000);
    const { markets } = await ok('GET', '/api/markets?status=all');
    assert.equal(markets.find((m) => m.id === position.marketId).openPosition.id, position.id);
  });

  await t.test('whale watch records large trades once', async () => {
    await ok('PATCH', '/api/agents/whales', { config: { minTradeUsd: 100, lookbackMinutes: 600 } });
    await ok('POST', '/api/agents/whales/run');
    await idle(app);
    const whales = store.list('signals', { kind: 'whale' });
    assert.ok(whales.length > 0, 'demo trades show up');
    for (const s of whales) {
      assert.ok(s.marketId && s.wallet && ['yes', 'no'].includes(s.side) && ['buy', 'sell'].includes(s.action));
      assert.ok(s.size >= 100 && s.price > 0 && s.at && s.title && s.body);
    }
    assert.ok(store.find('activity', (a) => a.tag === 'whale' && /^saw an? \$[\d,]+ (YES|NO) (buy|sell) on$/.test(a.pre)));
    // A second look at the same window adds nothing new.
    store.update('agents', 'whales', { cursor: null });
    await ok('POST', '/api/agents/whales/run');
    await idle(app);
    assert.equal(store.count('signals', { kind: 'whale' }), whales.length);

    const { signals } = await ok('GET', '/api/signals?kind=whale&limit=5');
    assert.ok(signals.length >= 1 && signals.length <= 5);
    assert.ok(signals.every((s) => s.kind === 'whale' && s.question));
    for (let i = 1; i < signals.length; i++) assert.ok(signals[i - 1].at >= signals[i].at, 'newest first');
  });

  await t.test('market detail and watchlist actions', async () => {
    const detail = await ok('GET', `/api/markets/${position.marketId}`);
    assert.equal(detail.market.id, position.marketId);
    assert.ok(detail.signals.length >= 1 && detail.signals.length <= 50);
    assert.ok(detail.signals.some((s) => s.kind === 'brief'));
    assert.equal(detail.positions.length, 1);
    assert.equal(detail.approvals.length, 1);
    assert.equal((await call('GET', '/api/markets/mkt_missing')).status, 404);

    const other = store.find('markets', (m) => m.id !== position.marketId && m.status === 'watching');
    assert.equal((await ok('POST', `/api/markets/${other.id}/ignore`)).market.status, 'ignored');
    assert.equal((await ok('GET', '/api/markets?status=ignored')).counts.ignored, 1);
    assert.equal((await ok('POST', `/api/markets/${other.id}/watch`)).market.status, 'watching');

    const before = store.get('markets', other.id).lastAnalyzedAt;
    await ok('POST', `/api/markets/${other.id}/analyze`);
    const task = store.find('tasks', (x) => x.type === 'analyze_market' && x.payload.marketId === other.id && x.status === 'queued');
    assert.equal(task.payload.reason, 'manual');
    await idle(app);
    assert.ok(store.get('markets', other.id).lastAnalyzedAt > before, 'manual analysis skips the re-check window');
  });

  await t.test('adding a market by link', async () => {
    assert.equal((await call('POST', '/api/markets/add', { url: 'https://example.com/nope' })).status, 400);
    await ok('POST', '/api/markets/add', { url: 'https://polymarket.com/event/will-it-snow-in-denver-on-new-years-day' });
    await idle(app);
    const added = store.find('markets', { slug: 'will-it-snow-in-denver-on-new-years-day' });
    assert.ok(added, 'market added');
    assert.equal(added.status, 'watching');
    assert.equal(added.foundBy, 'user');
    assert.ok(added.brief, 'analyzed right away');
  });

  await t.test('closing a position at market', async () => {
    const cashBefore = store.getValue('wallet').cash;
    assert.deepEqual(await ok('POST', `/api/positions/${position.id}/close`), { ok: true });
    await idle(app);
    const p = store.get('positions', position.id);
    assert.equal(p.status, 'closed');
    assert.equal(p.closeReason, 'manual');
    assert.ok(p.closedAt && p.exitPrice > 0);
    assert.ok(Math.abs(p.realizedPnl - (p.shares * p.exitPrice - p.stake)) < 0.01);
    assert.ok(Math.abs(store.getValue('wallet').cash - (cashBefore + p.value)) < 0.01);
    assert.equal((await call('POST', `/api/positions/${position.id}/close`)).status, 409);
    const { summary } = await ok('GET', '/api/positions?status=all');
    assert.equal(summary.closedCount, 1);
    assert.ok(summary.winRate === 0 || summary.winRate === 1);
    assert.ok(Math.abs(summary.totalPnl - (summary.realizedPnl + summary.unrealizedPnl)) < 0.02);
  });

  await t.test('control room stats', async () => {
    const { stats } = await ok('GET', '/api/stats');
    assert.deepEqual(stats.map((s) => s.key), ['equity', 'pnlToday', 'openPositions', 'exposure', 'winRate', 'watching', 'whales', 'trades']);
    for (const s of stats) {
      assert.ok(s.label && typeof s.value === 'string' && typeof s.delta === 'string', s.key);
      assert.equal(s.bars.length, 7, `${s.key} bars`);
      assert.ok(s.bars.every((b) => typeof b === 'number' && Number.isFinite(b)), `${s.key} bars are numbers`);
    }
    const tile = (key) => stats.find((s) => s.key === key);
    assert.match(tile('equity').value, /^\$[\d,]+\.\d\d$/);
    assert.match(tile('equity').delta, /all time$/);
    assert.match(tile('pnlToday').value, /^([+−]\$[\d,]+\.\d\d|\$0\.00)$/);
    assert.match(tile('winRate').value, /^(\d+%|—)$/);
    assert.equal(tile('trades').value, '1');
    assert.ok(Number(tile('whales').value) > 0);
  });

  assert.deepEqual(errors, []);
  assert.equal(store.count('runs', { status: 'error' }), 0, JSON.stringify(store.list('runs', { status: 'error' }).map((r) => r.summary)));
});

test('markets: autopilot opens positions and resolved markets settle', async (t) => {
  const { app, ok, errors } = await start();
  const { store } = app;
  t.after(() => app.close());

  await demoWorkspace(ok, { autonomy: 'autopilot', maxWatched: 2 });
  await ok('POST', '/api/agents/scanner/run');
  await idle(app);
  assert.equal(store.count('approvals'), 0, 'autopilot skips review');
  const opened = store.list('positions', { status: 'open' });
  assert.ok(opened.length >= 1, 'trader opened positions on its own');
  assert.ok(store.find('activity', (a) => a.tag === 'opened' && a.agentId === 'trader'));

  // A short-lived demo market that closed a couple of cycles ago has resolved by now.
  const market = store.insert('markets', {
    externalId: pastDemoMarketId('btc-up-hour', 2),
    question: 'Will Bitcoin close this hour higher than it opened?',
    slug: 'btc-up-hour-test',
    url: null,
    category: 'Crypto',
    endDate: new Date().toISOString(),
    yesPrice: 0.5,
    priceHistory: [],
    volume24h: 1,
    liquidity: 1,
    status: 'watching',
    outcome: null,
    estimate: null,
    confidence: null,
    edge: null,
    brief: null,
    lastAnalyzedAt: null,
    watchedAt: new Date().toISOString(),
    foundBy: 'scanner',
    lastActivity: null,
  });
  const { position, error } = openPosition(store, { market, side: 'yes', stake: 20, agentId: 'trader' });
  assert.equal(error, undefined);
  assert.equal(openPosition(store, { market, side: 'yes', stake: 20 }).error, 'Already holding YES on this market.');
  const cashBefore = store.getValue('wallet').cash;

  await ok('POST', '/api/agents/bookkeeper/run');
  await idle(app);
  const settled = store.get('positions', position.id);
  const resolved = store.get('markets', market.id);
  assert.equal(resolved.status, 'resolved');
  assert.ok(['yes', 'no'].includes(resolved.outcome));
  assert.equal(settled.status, 'closed');
  assert.equal(settled.closeReason, 'resolved');
  assert.equal(settled.exitPrice, resolved.outcome === 'yes' ? 1 : 0);
  assert.equal(settled.value, resolved.outcome === 'yes' ? Math.round(settled.shares * 100) / 100 : 0);
  assert.equal(settled.realizedPnl, Math.round((settled.value - settled.stake) * 100) / 100);
  assert.ok(Math.abs(store.getValue('wallet').cash - (cashBefore + settled.value)) < 0.01);
  assert.ok(store.find('activity', (a) => a.tag === 'settled' && a.link === market.question));
  assert.equal((await ok('GET', '/api/markets?status=resolved')).counts.resolved, 1);

  assert.deepEqual(errors, []);
});
