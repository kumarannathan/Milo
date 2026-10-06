// Demo handlers for markets capabilities: a fictional board of prediction markets whose
// prices wander with the wall clock, so every quote is a little different. A handful of
// short-lived markets (games tonight, weather tomorrow) close and resolve every hour or two
// so the Bookkeeper has something to settle. Large trades appear on a fixed schedule per
// market, so repeated reads of the same window return the same trades.

import { fake, pick, seeded } from './util.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TRADE_BUCKET = 2 * MIN;
const RESOLVE_DELAY = 3 * MIN;

// Read at call time so tests can switch it on after import.
const timing = (min, max) => (process.env.MILO_DEMO_FAST === '1' ? { min: 0, max: 0 } : { min, max });

// `drift` is the gap between where the price sits and where the sample Analyst lands,
// so some markets show an edge and others look fairly priced.
const LONG = [
  { key: 'fed-cut-december', q: 'Will the Fed cut rates at the December meeting?', cat: 'Economy', base: 0.62, days: 70, vol: 1_450_000, liq: 420_000, drift: 0.12 },
  { key: 'frontier-model-lmarena', q: 'Will a new frontier AI model top the LMArena leaderboard by year end?', cat: 'Tech', base: 0.71, days: 84, vol: 1_180_000, liq: 310_000, drift: -0.14 },
  { key: 'sp500-7000-year-end', q: 'Will the S&P 500 close the year above 7,000?', cat: 'Economy', base: 0.47, days: 84, vol: 960_000, liq: 280_000, drift: 0.09 },
  { key: 'shutdown-before-dec-15', q: 'Will a federal government shutdown begin before December 15?', cat: 'Politics', base: 0.21, days: 68, vol: 870_000, liq: 240_000, drift: 0.11 },
  { key: 'cpi-october-3pct', q: 'Will October CPI inflation come in at 3.0% or higher?', cat: 'Economy', base: 0.38, days: 38, vol: 740_000, liq: 190_000, drift: -0.1 },
  { key: 'bitcoin-150k-quarter', q: 'Will Bitcoin trade above $150,000 at any point this quarter?', cat: 'Crypto', base: 0.18, days: 84, vol: 690_000, liq: 230_000, drift: -0.07 },
  { key: 'permitting-reform-senate', q: 'Will the Senate pass the permitting reform bill before the holiday recess?', cat: 'Politics', base: 0.34, days: 62, vol: 520_000, liq: 150_000, drift: 0.15 },
  { key: 'named-storms-20', q: 'Will this hurricane season end with 20 or more named storms?', cat: 'Weather', base: 0.39, days: 55, vol: 410_000, liq: 120_000, drift: -0.12 },
  { key: 'unemployment-4-5', q: 'Will the unemployment rate be 4.5% or higher in the November jobs report?', cat: 'Economy', base: 0.31, days: 60, vol: 380_000, liq: 110_000, drift: 0.06 },
  { key: 'midterm-turnout-50', q: 'Will turnout in the November elections exceed 50% of eligible voters?', cat: 'Politics', base: 0.44, days: 33, vol: 350_000, liq: 95_000, drift: -0.05 },
  { key: 'mortgage-below-6', q: 'Will the average 30-year mortgage rate fall below 6% before December?', cat: 'Economy', base: 0.24, days: 54, vol: 300_000, liq: 88_000, drift: 0.08 },
  { key: 'nuclear-datacenter-deal', q: 'Will a large tech company announce a nuclear power deal for data centers this month?', cat: 'Tech', base: 0.52, days: 24, vol: 270_000, liq: 76_000, drift: 0.1 },
  { key: 'eth-beats-btc-month', q: 'Will Ethereum outperform Bitcoin this month?', cat: 'Crypto', base: 0.41, days: 24, vol: 240_000, liq: 70_000, drift: -0.06 },
  { key: 'eu-ai-investigation', q: 'Will the EU open a formal investigation into an AI chatbot provider before December?', cat: 'Tech', base: 0.36, days: 55, vol: 210_000, liq: 64_000, drift: 0.13 },
  { key: 'warmest-december', q: 'Will December be the warmest on record globally?', cat: 'Weather', base: 0.48, days: 84, vol: 180_000, liq: 52_000, drift: -0.09 },
  { key: 'tariff-case-ruling', q: 'Will the Supreme Court rule on the tariff authority case by year end?', cat: 'Politics', base: 0.58, days: 84, vol: 160_000, liq: 48_000, drift: 0.05 },
  { key: 'robotics-1b-round', q: 'Will a humanoid robot startup raise $1B or more in a single round this quarter?', cat: 'Tech', base: 0.33, days: 84, vol: 140_000, liq: 41_000, drift: 0.07 },
  { key: 'film-1-5b', q: 'Will the year’s top-grossing film pass $1.5B worldwide?', cat: 'Culture', base: 0.57, days: 84, vol: 120_000, liq: 36_000, drift: -0.08 },
  { key: 'first-time-major-winner', q: 'Will a first-time winner take the season’s final golf major?', cat: 'Sports', base: 0.4, days: 80, vol: 95_000, liq: 30_000, drift: 0.06 },
  { key: 'crewed-lunar-flyby', q: 'Will a crewed lunar flyby launch before year end?', cat: 'Science', base: 0.14, days: 84, vol: 70_000, liq: 22_000, drift: 0.05 },
  { key: 'foldable-under-800', q: 'Will a major phone maker ship a foldable under $800 this year?', cat: 'Tech', base: 0.29, days: 84, vol: 21_000, liq: 9_000, drift: 0.1 },
  { key: 'unbeaten-season', q: 'Will any pro football team finish the regular season unbeaten?', cat: 'Sports', base: 0.07, days: 95, vol: 64_000, liq: 25_000, drift: 0.04 },
  { key: 'governor-presidential-run', q: 'Will a sitting governor of a top-five state announce a presidential run by March?', cat: 'Politics', base: 0.27, days: 160, vol: 230_000, liq: 70_000, drift: 0.08 },
  { key: 'mvp-favorite-wins', q: 'Will the preseason MVP favorite win the award?', cat: 'Sports', base: 0.31, days: 230, vol: 150_000, liq: 45_000, drift: -0.07 },
];

const TEAMS = ['Harbor City Hawks', 'Ridgefield Rovers', 'Lakeside Comets', 'Northgate Kings', 'Bayview Mariners', 'Summit Peaks', 'Riverton Foxes', 'Westbrook Wolves'];
const CITIES = ['Seattle', 'Denver', 'Chicago', 'Austin', 'Boston', 'Phoenix', 'Atlanta', 'Portland'];

// Markets that close every `period` minutes; each cycle is a new market with its own id.
const SHORT = [
  { key: 'game-tonight', cat: 'Sports', period: 75, vol: 210_000, liq: 70_000, q: (r) => { const [a, b] = twoOf(r, TEAMS); return `Will the ${a} beat the ${b} tonight?`; } },
  { key: 'points-tonight', cat: 'Sports', period: 60, vol: 95_000, liq: 32_000, q: (r) => `Will the ${pick(r, TEAMS)} score 110 or more points tonight?` },
  { key: 'rain-tomorrow', cat: 'Weather', period: 90, vol: 60_000, liq: 21_000, q: (r) => `Will it rain in ${pick(r, CITIES)} tomorrow?` },
  { key: 'high-75-tomorrow', cat: 'Weather', period: 120, vol: 48_000, liq: 18_000, q: (r) => `Will the high in ${pick(r, CITIES)} reach 75°F tomorrow?` },
  { key: 'btc-up-hour', cat: 'Crypto', period: 60, vol: 130_000, liq: 44_000, q: () => 'Will Bitcoin close this hour higher than it opened?' },
  { key: 'ten-year-yield', cat: 'Economy', period: 105, vol: 82_000, liq: 27_000, q: (r) => `Will the 10-year Treasury yield close above ${(4 + Math.floor(r() * 6) / 10).toFixed(1)}% today?` },
];

function twoOf(r, list) {
  const a = Math.floor(r() * list.length);
  let b = Math.floor(r() * (list.length - 1));
  if (b >= a) b += 1;
  return [list[a], list[b]];
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const round4 = (n) => Math.round(n * 10000) / 10000;

// Smooth noise in [-1, 1]: interpolates seeded values at whole numbers.
function valueNoise(seed, x) {
  const i = Math.floor(x);
  const f = x - i;
  const a = seeded(`${seed}:${i}`)() * 2 - 1;
  const b = seeded(`${seed}:${i + 1}`)() * 2 - 1;
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

// End dates hang off the start of the current week so they stay put between calls.
function weekStart(now = Date.now()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}

function humanize(slug) {
  const words = String(slug).replace(/-\d{6,}$/, '').split('-').filter(Boolean);
  if (!words.length) return 'Untitled market?';
  const text = words.join(' ');
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /^(will|is|are|does|do|can|did|has|have)\b/i.test(text) ? `${sentence}?` : `Will ${text}?`;
}

/** A market's fixed traits plus its price path. Returns null for ids the demo doesn't know. */
function demoMarket(externalId) {
  const id = String(externalId ?? '');
  const long = LONG.find((m) => `demo-${m.key}` === id);
  if (long) return longMarket(long);
  const short = SHORT.find((m) => id.startsWith(`demo-${m.key}-`) && /^\d+$/.test(id.slice(m.key.length + 6)));
  if (short) return shortMarket(short, Number(id.slice(short.key.length + 6)));
  if (id.startsWith('demo-x-')) return customMarket(id.slice(7));
  return null;
}

function longMarket(def) {
  const r = seeded(`long:${def.key}`);
  const t1 = (9 + r() * 21) * HOUR;
  const t2 = (40 + r() * 80) * MIN;
  const p1 = r() * Math.PI * 2;
  const p2 = r() * Math.PI * 2;
  const center = logit(def.base);
  return {
    externalId: `demo-${def.key}`,
    slug: def.key,
    question: def.q,
    category: def.cat,
    vol: def.vol,
    liq: def.liq,
    drift: def.drift,
    start: -Infinity,
    endDate: weekStart() + def.days * DAY,
    outcome: null,
    priceAt(t) {
      const x = center + 0.45 * Math.sin((2 * Math.PI * t) / t1 + p1) + 0.2 * Math.sin((2 * Math.PI * t) / t2 + p2) + 0.12 * valueNoise(`n:${def.key}`, t / (4 * MIN));
      return clamp(sigmoid(x), 0.01, 0.99);
    },
  };
}

function shortMarket(def, cycle) {
  const period = def.period * MIN;
  const offset = seeded(`offset:${def.key}`)() * period;
  const start = cycle * period + offset;
  const end = start + period;
  const r = seeded(`short:${def.key}:${cycle}`);
  const question = def.q(r);
  const base = 0.25 + r() * 0.5;
  const wins = r() < base;
  return {
    externalId: `demo-${def.key}-${cycle}`,
    slug: `${def.key}-${cycle}`,
    question,
    category: def.cat,
    vol: def.vol,
    liq: def.liq,
    drift: (wins ? 1 : -1) * 0.1,
    start,
    endDate: end,
    outcome: wins ? 'yes' : 'no',
    priceAt(t) {
      // Leans toward the real result as the close approaches.
      const progress = clamp((t - start) / period, 0, 1);
      const x = logit(base) + (wins ? 1 : -1) * 3.2 * progress * progress + 0.3 * valueNoise(`n:${def.key}:${cycle}`, t / (3 * MIN));
      return clamp(sigmoid(x), 0.01, 0.99);
    },
  };
}

function currentCycle(def, now = Date.now()) {
  const period = def.period * MIN;
  const offset = seeded(`offset:${def.key}`)() * period;
  return Math.floor((now - offset) / period);
}

// A market added by link that isn't in the sample board: invent one from its slug.
function customMarket(slug) {
  const r = seeded(`custom:${slug}`);
  const base = 0.2 + r() * 0.6;
  const p1 = r() * Math.PI * 2;
  return {
    externalId: `demo-x-${slug}`,
    slug,
    question: humanize(slug),
    category: 'Other',
    vol: 40_000 + r() * 200_000,
    liq: 15_000 + r() * 60_000,
    drift: (r() - 0.5) * 0.24,
    start: -Infinity,
    endDate: weekStart() + (30 + Math.floor(r() * 50)) * DAY,
    outcome: null,
    priceAt(t) {
      const x = logit(base) + 0.35 * Math.sin((2 * Math.PI * t) / (14 * HOUR) + p1) + 0.15 * valueNoise(`n:x:${slug}`, t / (4 * MIN));
      return clamp(sigmoid(x), 0.01, 0.99);
    },
  };
}

function priceNow(m, now = Date.now()) {
  if (now >= m.endDate + RESOLVE_DELAY && m.outcome) return m.outcome === 'yes' ? 1 : 0;
  return round4(m.priceAt(Math.min(now, m.endDate)));
}

function history(m, now = Date.now()) {
  const step = Number.isFinite(m.start) ? 2 * MIN : 10 * MIN;
  const from = Math.max(now - 48 * HOUR, Number.isFinite(m.start) ? m.start : -Infinity);
  const points = [];
  for (let t = Math.ceil(from / step) * step; t < now; t += step) points.push({ at: new Date(t).toISOString(), p: round4(m.priceAt(t)) });
  return points.slice(-288);
}

function listing(m, now = Date.now()) {
  const swing = 0.8 + 0.4 * ((valueNoise(`vol:${m.externalId}`, now / (6 * HOUR)) + 1) / 2);
  const volume24h = Math.round(m.vol * swing);
  return {
    externalId: m.externalId,
    question: m.question,
    slug: m.slug,
    category: m.category,
    endDate: new Date(m.endDate).toISOString(),
    yesPrice: priceNow(m, now),
    volume24h,
    volume: Math.round(volume24h * 14.5),
    liquidity: Math.round(m.liq * (0.9 + 0.2 * ((valueNoise(`liq:${m.externalId}`, now / (8 * HOUR)) + 1) / 2))),
    url: null,
    // Not part of the capability contract: lets a fresh watchlist start with a price chart.
    history: history(m, now),
  };
}

function board(now = Date.now()) {
  return [...LONG.map(longMarket), ...SHORT.map((d) => shortMarket(d, currentCycle(d, now)))];
}

function bySlug(slug) {
  const s = String(slug).trim().toLowerCase();
  const long = LONG.find((m) => m.key === s);
  if (long) return longMarket(long);
  for (const d of SHORT) {
    const m = s.match(new RegExp(`^${d.key}-(\\d+)$`));
    if (m) return shortMarket(d, Number(m[1]));
    if (s === d.key) return shortMarket(d, currentCycle(d));
  }
  return customMarket(s.replace(/[^a-z0-9-]/g, '').slice(0, 120) || 'market');
}

function matchesKeywords(m, keywords) {
  const text = `${m.question} ${m.category}`.toLowerCase();
  return keywords.some((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text));
}

function search(args = {}) {
  const now = Date.now();
  if (args.slug) {
    const m = bySlug(args.slug);
    return { markets: now < m.endDate ? [listing(m, now)] : [] };
  }
  const keywords = (Array.isArray(args.keywords) ? args.keywords : String(args.keywords ?? '').split(','))
    .map((k) => String(k).trim().toLowerCase())
    .filter(Boolean);
  const horizon = Number(args.closesWithinDays) > 0 ? now + Number(args.closesWithinDays) * DAY : Infinity;
  const markets = board(now)
    .filter((m) => m.endDate > now && m.endDate <= horizon)
    .filter((m) => !keywords.length || matchesKeywords(m, keywords))
    .map((m) => listing(m, now))
    .filter((m) => m.volume24h >= (Number(args.minVolume) || 0) && m.liquidity >= (Number(args.minLiquidity) || 0))
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, Math.max(1, Number(args.limit) || 50));
  return { markets };
}

function quote(args = {}) {
  const now = Date.now();
  const quotes = [];
  for (const id of new Set(args.externalIds ?? [])) {
    const m = demoMarket(id);
    if (!m) continue;
    const closed = now >= m.endDate;
    quotes.push({ externalId: m.externalId, yesPrice: priceNow(m, now), closed, outcome: closed && now >= m.endDate + RESOLVE_DELAY ? m.outcome : null });
  }
  return { quotes };
}

const WALLETS = Array.from({ length: 24 }, (_, i) => {
  const r = seeded(`wallet:${i}`);
  return `0x${Array.from({ length: 40 }, () => Math.floor(r() * 16).toString(16)).join('')}`;
});
const NAMES = ['Quiet-Heron', 'Patient-Walrus', 'Brisk-Lantern', 'Copper-Finch', 'Gentle-Atlas', 'Hollow-Maple', 'Restless-Otter', 'Amber-Signal', 'Steady-Comet', 'Velvet-Ledger', 'Northern-Kite', 'Cobalt-Badger'];

// Each market rolls for a large trade every two minutes. Sizes are skewed: most trades are a
// few thousand dollars, a few are tens of thousands.
function tradesFor(m, from, to) {
  const out = [];
  const first = Math.max(from, Number.isFinite(m.start) ? m.start : from);
  const last = Math.min(to, m.endDate);
  for (let b = Math.floor(first / TRADE_BUCKET); b * TRADE_BUCKET <= last; b++) {
    const r = seeded(`trade:${m.externalId}:${b}`);
    if (r() >= 0.04) continue;
    const t = Math.round(b * TRADE_BUCKET + r() * TRADE_BUCKET);
    if (t < from || t > last) continue;
    const trend = m.priceAt(t) - m.priceAt(t - 10 * MIN);
    const side = r() < clamp(0.5 + trend * 10 + m.drift, 0.15, 0.85) ? 'yes' : 'no';
    const action = r() < 0.8 ? 'buy' : 'sell';
    const yes = m.priceAt(t);
    const price = round4(side === 'yes' ? yes : 1 - yes);
    const size = Math.round(800 * Math.exp(4.6 * r() ** 2));
    const w = Math.floor(r() * WALLETS.length);
    out.push({
      externalId: m.externalId,
      wallet: WALLETS[w],
      trader: NAMES[w % NAMES.length],
      side,
      action,
      size,
      shares: Math.round((size / price) * 100) / 100,
      price,
      at: new Date(t).toISOString(),
    });
  }
  return out;
}

function trades(args = {}) {
  const now = Date.now();
  const since = Math.max(args.since ? Date.parse(args.since) : now - HOUR, now - DAY);
  const minSize = Number(args.minSize) || 0;
  const out = [];
  for (const id of new Set(args.externalIds ?? [])) {
    const m = demoMarket(id);
    if (m) out.push(...tradesFor(m, since, now).filter((t) => t.size >= minSize));
  }
  out.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { trades: out };
}

// ── Research ─────────────────────────────────────────────────────────

const STORIES = {
  Economy: [
    ['Rate futures shift after a softer inflation print', 'Traders added to bets on easier policy after the monthly release, though officials cautioned against reading too much into one month of data.'],
    ['Central bank officials stress patience in latest remarks', 'Several policymakers said they want more evidence before changing course, keeping the timing of the next move open.'],
    ['Jobs report surprises to the upside', 'Hiring beat forecasts for a second month, a sign the labor market is cooling more slowly than expected.'],
    ['Bond yields drift lower as growth worries build', 'Longer-dated yields fell for a third session as weaker manufacturing data weighed on sentiment.'],
    ['Economists trim recession odds in quarterly survey', 'Forecasters lowered their probability of a downturn over the next year but flagged sticky services inflation.'],
  ],
  Politics: [
    ['Leaders signal a floor vote could come sooner than expected', 'Aides said scheduling talks are under way, though several members have not committed to a position.'],
    ['Whip counts show a narrow path in the Senate', 'Both sides describe the vote count as close, with a handful of members still undecided.'],
    ['New polling shows the race tightening', 'A fresh survey puts the gap within the margin of error, down from a clear lead a month ago.'],
    ['Committee schedules a hearing for later this month', 'The hearing is the next procedural step and could set the timeline for a final decision.'],
    ['Negotiators report progress but no deal yet', 'People familiar with the talks said key sticking points remain on funding levels and timing.'],
  ],
  Tech: [
    ['Lab teases a new model ahead of its developer event', 'Early testers describe gains on reasoning benchmarks, though no release date has been confirmed.'],
    ['Leaderboard shuffles after a surprise release', 'A newly released model moved into the top three on public rankings within days of launch.'],
    ['Regulators send questions to major AI providers', 'The letters ask about data practices and could precede a formal inquiry, according to people briefed on the matter.'],
    ['Chipmaker guidance points to strong data-center demand', 'The company raised its outlook, citing orders from cloud providers expanding capacity.'],
    ['Startup funding round said to be oversubscribed', 'Investors familiar with the deal say demand exceeded the target, which could lift the final size.'],
  ],
  Crypto: [
    ['Fund inflows climb for a third straight week', 'Spot products drew steady inflows as volatility eased and large holders added to positions.'],
    ['Volatility drops to a multi-month low', 'Options markets price smaller moves ahead, a setup that has preceded sharp breakouts in the past.'],
    ['Large holders move coins to exchanges', 'On-chain data shows sizable transfers to trading venues, which some analysts read as a sign of selling.'],
    ['Funding rates turn positive across major venues', 'Leveraged traders are leaning long again after a stretch of neutral positioning.'],
  ],
  Sports: [
    ['Injury report lists a key starter as questionable', 'The team said a decision will come closer to game time, and backups have taken first-team reps.'],
    ['Bettors move the line overnight', 'Sportsbooks adjusted the spread after heavy action on one side, a shift of more than a point.'],
    ['Coach says the roster is healthy and ready', 'The team returns most of its rotation after a week of rest.'],
    ['Road record raises questions ahead of the matchup', 'The visitors have struggled away from home this season, losing four of their last six road games.'],
  ],
  Weather: [
    ['Forecasters raise odds of an active pattern next week', 'Model guidance has trended wetter, though confidence in the exact timing remains low.'],
    ['Models diverge on the timing of the next front', 'The main forecast models disagree by about a day, which matters for tomorrow’s outlook.'],
    ['Seasonal outlook leans warmer than normal', 'The updated outlook favors above-normal temperatures across much of the country.'],
    ['Ocean temperatures remain well above average', 'Warm water continues to support storm development, according to the latest analysis.'],
  ],
  Science: [
    ['Launch window confirmed after a successful engine test', 'The team completed a full-duration test and said hardware is on track for the target window.'],
    ['Agency review delays schedule by several weeks', 'A safety review added time to the schedule, pushing the earliest date later in the quarter.'],
    ['Contractor reports a hardware milestone', 'The capsule completed integration testing, one of the last major steps before shipping to the launch site.'],
  ],
  Culture: [
    ['Box office tracking points to a strong opening', 'Pre-sales are running ahead of comparable releases, according to industry trackers.'],
    ['Holdover titles show unusually small weekly drops', 'Strong word of mouth kept attendance steady in the second and third weekends.'],
    ['International grosses outpace early projections', 'Overseas markets are contributing more than expected, led by strong results in Asia.'],
  ],
  Other: [
    ['Observers say the outcome is still wide open', 'People following the question closely describe the signals so far as mixed.'],
    ['New details emerge that could shift expectations', 'Recent reporting adds context but does not settle the question.'],
    ['Analysts weigh the base rate for similar events', 'Historical comparisons suggest outcomes like this are less common than headlines imply.'],
  ],
};

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function categoryFor(query) {
  const known = board().find((m) => m.question === query);
  if (known) return known.category;
  const q = String(query).toLowerCase();
  if (/\b(fed|rate|inflation|cpi|jobs|unemployment|yield|mortgage|s&p|recession)\b/.test(q)) return 'Economy';
  if (/\b(bitcoin|ethereum|crypto|btc|eth)\b/.test(q)) return 'Crypto';
  if (/\b(ai|model|tech|chip|robot|phone)\b/.test(q)) return 'Tech';
  if (/\b(senate|house|election|vote|governor|president|court|shutdown)\b/.test(q)) return 'Politics';
  if (/\b(rain|storm|hurricane|temperature|warm|weather|°f)\b/.test(q)) return 'Weather';
  if (/\b(win|beat|game|season|team|score|mvp|major)\b/.test(q)) return 'Sports';
  return 'Other';
}

function stories(query, count) {
  const category = categoryFor(query);
  const day = Math.floor(Date.now() / DAY);
  const r = seeded(`news:${query}:${day}`);
  const pool = [...(STORIES[category] ?? STORIES.Other)];
  const out = [];
  while (pool.length && out.length < count) {
    const [title, summary] = pool.splice(Math.floor(r() * pool.length), 1)[0];
    out.push({
      title,
      url: `https://news.example.com/${category.toLowerCase()}/${slugify(title)}`,
      publishedAt: new Date(Date.now() - Math.floor(r() * 6 * DAY + HOUR)).toISOString(),
      summary,
    });
  }
  return out.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

// ── Sample Analyst ──────────────────────────────────────────────────

const FACTORS = {
  Economy: ['Recent data has come in close to consensus', 'Officials have kept their options open in public remarks', 'Futures pricing has moved in the same direction this week', 'Base rates for similar setups favor the status quo'],
  Politics: ['Vote counts remain close with several members undecided', 'Leadership has signaled interest in moving quickly', 'Similar measures have stalled late in the calendar before', 'Public polling has shifted modestly in recent weeks'],
  Tech: ['Release cadence at the leading labs has been fast this year', 'Public benchmarks change quickly after new launches', 'Regulatory timelines tend to slip past initial targets', 'Funding conditions for the sector remain strong'],
  Crypto: ['Fund flows have been steady', 'Volatility is low, which can precede large moves', 'Large holders have been moving coins to exchanges', 'The move needed is large relative to recent ranges'],
  Sports: ['Recent form favors the home side', 'Injury news adds uncertainty to the lineup', 'The betting line has moved in the last day', 'Head-to-head results this season are split'],
  Weather: ['Forecast models disagree on timing', 'Seasonal guidance leans warmer than normal', 'Climatology for this date sets a modest base rate', 'Recent observations have run ahead of forecasts'],
  Science: ['Hardware milestones are on schedule so far', 'Programs like this often slip by weeks or months', 'The launch window is narrow'],
  Culture: ['Early tracking is running ahead of comparable titles', 'Holdover strength suggests a long run', 'International markets are a key swing factor'],
  Other: ['The signals so far are mixed', 'Base rates for similar questions are modest', 'New information could arrive before the close'],
};

/** Analyst brief for `purpose: 'market_brief'`. Input: { market, news, whales }. */
function marketBrief(input = {}) {
  const m = input.market ?? {};
  const price = clamp(Number(m.yesPrice) || 0.5, 0.01, 0.99);
  const known = demoMarket(m.externalId);
  const drift = known?.drift ?? (seeded(`drift:${m.question}`)() - 0.5) * 0.2;
  const r = seeded(`brief:${m.externalId ?? m.question}:${Math.floor(Date.now() / (6 * HOUR))}`);
  const estimate = Math.round(clamp(price + drift + (r() - 0.5) * 0.03, 0.03, 0.97) * 100) / 100;
  const confidence = Math.round((0.55 + seeded(`conf:${m.externalId ?? m.question}`)() * 0.3) * 100) / 100;
  const edge = (estimate - price) * 100;
  const leaning = edge >= 3 ? 'yes' : edge <= -3 ? 'no' : null;
  const verdict = leaning ?? 'pass';

  const category = FACTORS[m.category] ? m.category : 'Other';
  const pool = [...FACTORS[category]];
  const factors = [];
  while (pool.length && factors.length < 3) {
    const text = pool.splice(Math.floor(r() * pool.length), 1)[0];
    const direction = factors.length === 0 && leaning ? leaning : r() < 0.5 ? 'yes' : 'no';
    factors.push({ text, direction, weight: pick(r, ['low', 'medium', 'medium', 'high']) });
  }
  const whales = Array.isArray(input.whales) ? input.whales : [];
  if (whales.length) {
    const yes = whales.filter((w) => (w.side === 'yes') === (w.action !== 'sell')).length;
    const direction = yes >= whales.length / 2 ? 'yes' : 'no';
    factors.push({ text: `${whales.length} large trade${whales.length === 1 ? '' : 's'} recently, mostly backing ${direction.toUpperCase()}`, direction, weight: 'low' });
  }

  const news = Array.isArray(input.news) ? input.news : [];
  const lead = news[0]?.title ? `The most relevant recent report: ${news[0].title.toLowerCase()}.` : 'There is little recent reporting on this question.';
  const stance = leaning === 'yes' ? 'above the market' : leaning === 'no' ? 'below the market' : 'close to the market';
  const conf = confidence >= 0.75 ? 'fairly high' : confidence >= 0.62 ? 'moderate' : 'low';
  return {
    summary: `The market prices YES at ${Math.round(price * 100)}¢. ${lead} Weighing the base rate against recent signals, the estimate is ${Math.round(estimate * 100)}%, ${stance}, with ${conf} confidence.`,
    estimate,
    confidence,
    factors,
    verdict,
    sources: news.slice(0, 3).map((n) => ({ title: n.title, url: n.url })),
  };
}

export const marketsHandlers = {
  'markets.search': (args, { io }) => fake(io, 'polymarket.gamma_markets', () => search(args), timing(300, 900)),
  'markets.quote': (args, { io }) => fake(io, 'polymarket.gamma_markets', () => quote(args), timing(150, 500)),
  'markets.trades': (args, { io }) => fake(io, 'polymarket.data_trades', () => trades(args), timing(200, 700)),
  'web.search': (args, { io }) =>
    fake(io, 'demo.web_search', () => ({
      results: stories(args.query, Math.min(Number(args.maxResults) || 5, 5)).map(({ title, url, summary, publishedAt }) => ({ title, url, snippet: summary, publishedAt })),
    }), timing(300, 900)),
  'signals.news': (args, { io }) => fake(io, 'demo.news', () => ({ items: stories(args.query, 3) }), timing(200, 700)),
};

export const marketsPurposes = {
  market_brief: marketBrief,
};

// For tests: the id of a short-lived market that closed `cyclesAgo` cycles ago (resolved by now).
export function pastDemoMarketId(key = 'btc-up-hour', cyclesAgo = 2) {
  const def = SHORT.find((d) => d.key === key) ?? SHORT[0];
  return `demo-${def.key}-${currentCycle(def) - cyclesAgo}`;
}
