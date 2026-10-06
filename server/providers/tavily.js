import { ProviderError, maskSecret } from './io.js';

const API = 'https://api.tavily.com';

// Tavily filters by a time window rather than a number of days; results are then
// trimmed to the exact window using each result's published date when it has one.
export function timeRangeForDays(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return undefined;
  if (d <= 1) return 'day';
  if (d <= 7) return 'week';
  if (d <= 31) return 'month';
  return 'year';
}

function withinDays(publishedAt, days, now = Date.now()) {
  const d = Number(days);
  if (!publishedAt || !Number.isFinite(d) || d <= 0) return true;
  const t = Date.parse(publishedAt);
  return Number.isNaN(t) || t >= now - d * 86_400_000;
}

const isoDate = (value) => {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export function buildSearchBody(args, { news = false } = {}) {
  const body = {
    query: String(args.query ?? '').trim(),
    topic: news || args.topic === 'market' ? 'news' : 'general',
    max_results: Math.min(Math.max(Number(args.maxResults) || 10, 1), 20),
    search_depth: 'basic',
    include_published_date: true,
  };
  const range = timeRangeForDays(args.days);
  if (range) body.time_range = range;
  return body;
}

export function mapTavilyResults(res, days) {
  return (res?.results ?? [])
    .map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: String(r.content ?? '').trim(),
      publishedAt: isoDate(r.published_date),
    }))
    .filter((r) => r.url && withinDays(r.publishedAt, days));
}

function firstHeading(markdown) {
  const m = String(markdown ?? '').match(/^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/m);
  return m ? m[1].trim() : null;
}

export function mapTavilyExtract(res, url) {
  const hit = (res?.results ?? [])[0];
  if (!hit) {
    const failed = (res?.failed_results ?? [])[0];
    throw new ProviderError(failed?.error ? `Could not read ${url}: ${failed.error}` : `Could not read ${url}.`, {
      code: 'not_found',
      op: 'tavily.extract',
    });
  }
  const text = String(hit.raw_content ?? '').trim();
  let host = url;
  try {
    host = new URL(hit.url ?? url).hostname;
  } catch {}
  return { url: hit.url ?? url, title: firstHeading(text) ?? host, text };
}

// Tavily errors look like { detail: { error } }; give them a readable message.
async function call(io, op, path, apiKey, json) {
  try {
    return await io.http(op, `${API}${path}`, { headers: { Authorization: `Bearer ${apiKey}` }, json, timeoutMs: 45_000 });
  } catch (err) {
    if (!(err instanceof ProviderError) || !/^\[object/.test(err.message)) throw err;
    const message =
      err.code === 'auth' ? 'Tavily rejected the API key.'
      : err.code === 'rate_limit' ? 'Tavily rate limit or plan limit reached.'
      : `Tavily request failed with ${err.status}.`;
    throw new ProviderError(message, { status: err.status, code: err.code, op });
  }
}

async function search(args, { conn, io }) {
  const body = buildSearchBody(args);
  if (body.query.length < 2) return { results: [] };
  const res = await call(io, 'tavily.search', '/search', conn.values.apiKey, body);
  return { results: mapTavilyResults(res, args.days) };
}

async function fetchPage(args, { conn, io }) {
  const url = String(args.url ?? '').trim();
  if (!url) throw new ProviderError('No URL to read.', { code: 'bad_request', op: 'tavily.extract' });
  const res = await call(io, 'tavily.extract', '/extract', conn.values.apiKey, { urls: [url], format: 'markdown', extract_depth: 'basic' });
  return mapTavilyExtract(res, url);
}

async function news(args, { conn, io }) {
  const body = buildSearchBody({ ...args, days: args.days ?? 30 }, { news: true });
  if (body.query.length < 2) return { items: [] };
  const res = await call(io, 'tavily.news', '/search', conn.values.apiKey, body);
  return {
    items: mapTavilyResults(res, args.days ?? 30).map((r) => ({
      title: r.title,
      url: r.url,
      publishedAt: r.publishedAt,
      summary: r.snippet,
    })),
  };
}

export default {
  id: 'tavily',
  name: 'Tavily',
  category: 'Research',
  site: 'tavily.com',
  description: 'Web search, news and page reading built for agents.',
  playbooks: ['sales', 'markets'],
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      secret: true,
      required: true,
      placeholder: 'tvly-...',
      help: 'API keys on the overview page of your Tavily dashboard.',
    },
  ],
  handlers: {
    'web.search': search,
    'web.fetch': fetchPage,
    'signals.news': news,
  },
  async test({ conn, io }) {
    const res = await call(io, 'tavily.usage', '/usage', conn.values.apiKey);
    const plan = res?.account?.current_plan;
    return { account: `key ${maskSecret(conn.values.apiKey)}${plan ? ` · ${plan}` : ''}` };
  },
};
