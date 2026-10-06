// Control-room tiles for the markets playbook. Each tile carries seven daily values
// (oldest first, today last) for its sparkline.

import { money, pct, round2, signedMoney, signedPct } from './format.js';
import { portfolio } from './ledger.js';

const DAYS = 7;
const MINUS = '−';

function dayWindows(now) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const starts = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (DAYS - 1 - i));
    return d.getTime();
  });
  return starts.map((start, i) => ({ start, end: i < DAYS - 1 ? starts[i + 1] : now }));
}

function versus(today, yesterday) {
  const diff = today - yesterday;
  if (!diff) return 'same';
  return `${diff > 0 ? '+' : MINUS}${Math.abs(diff)} vs yesterday`;
}

const time = (iso) => (iso ? Date.parse(iso) : NaN);
const within = (iso, { start, end }) => time(iso) >= start && time(iso) < end;

export function marketsStats(store) {
  const now = Date.now();
  const days = dayWindows(now);
  const last = DAYS - 1;
  const { equity, exposure, startingBalance, open } = portfolio(store);
  const points = store.list('equity');
  const positions = store.list('positions');
  const markets = store.list('markets');

  // Last equity point before `t`; the live portfolio stands in for "now".
  const pointBefore = (t) => {
    for (let i = points.length - 1; i >= 0; i--) if (time(points[i].at) < t) return points[i];
    return null;
  };
  const equityBars = days.map((d, i) => round2(i === last ? equity : pointBefore(d.end)?.value ?? startingBalance));
  const dayOpenEquity = days.map((d) => pointBefore(d.start)?.value ?? startingBalance);
  const pnlBars = days.map((d, i) => round2(equityBars[i] - dayOpenEquity[i]));
  const pnlToday = pnlBars[last];

  const openAt = (t) => positions.filter((p) => time(p.openedAt) < t && (!p.closedAt || time(p.closedAt) >= t)).length;
  const openBars = days.map((d, i) => (i === last ? open.length : openAt(d.end)));
  const exposureBars = days.map((d, i) => round2(i === last ? exposure : pointBefore(d.end)?.exposure ?? 0));

  const closedBy = (t) => positions.filter((p) => p.status === 'closed' && time(p.closedAt) < t);
  const winRate = (list) => (list.length ? list.filter((p) => p.realizedPnl > 0).length / list.length : null);
  const closed = positions.filter((p) => p.status === 'closed');
  const wins = closed.filter((p) => p.realizedPnl > 0).length;
  const winBars = days.map((d) => Math.round((winRate(closedBy(d.end)) ?? 0) * 100));

  const ended = (m, t) => [m.closedAt, m.resolvedAt, m.ignoredAt].some((x) => x && time(x) < t);
  const watchingAt = (t) => markets.filter((m) => m.watchedAt && time(m.watchedAt) < t && !ended(m, t)).length;
  const watching = markets.filter((m) => m.status === 'watching').length;
  const watchBars = days.map((d, i) => (i === last ? watching : watchingAt(d.end)));

  const whales = store.list('signals', { kind: 'whale' });
  const whaleBars = days.map((d) => whales.filter((s) => within(s.at, d)).length);
  const tradeBars = days.map((d) => positions.filter((p) => within(p.openedAt, d)).length);

  const totalPct = startingBalance ? ((equity - startingBalance) / startingBalance) * 100 : 0;
  const todayPct = dayOpenEquity[last] ? (pnlToday / dayOpenEquity[last]) * 100 : 0;

  return [
    { key: 'equity', label: 'Equity', value: money(equity), delta: `${signedPct(totalPct)} all time`, bars: equityBars },
    { key: 'pnlToday', label: 'P/L today', value: signedMoney(pnlToday), delta: todayPct ? `${signedPct(todayPct)} today` : 'flat today', bars: pnlBars },
    { key: 'openPositions', label: 'Open positions', value: String(open.length), delta: versus(open.length, openBars[last - 1]), bars: openBars },
    { key: 'exposure', label: 'Exposure', value: money(exposure, { cents: false }), delta: equity > 0 ? `${Math.round((exposure / equity) * 100)}% of equity` : '—', bars: exposureBars },
    { key: 'winRate', label: 'Win rate', value: closed.length ? pct(wins / closed.length) : '—', delta: closed.length ? `${wins} of ${closed.length} won` : 'no closed trades yet', bars: winBars },
    { key: 'watching', label: 'Watching', value: String(watching), delta: versus(watching, watchBars[last - 1]), bars: watchBars },
    { key: 'whales', label: 'Whale trades today', value: String(whaleBars[last]), delta: versus(whaleBars[last], whaleBars[last - 1]), bars: whaleBars },
    { key: 'trades', label: 'Trades today', value: String(tradeBars[last]), delta: versus(tradeBars[last], tradeBars[last - 1]), bars: tradeBars },
  ];
}
