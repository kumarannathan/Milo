import { accountBriefPrompt } from '../prompts.js';
import { eachTask, optionalCall, parseEmployees, touchAccount } from '../util.js';

const SIGNAL_TYPES = ['Expansion', 'Hiring', 'Exec change', 'Funding', 'Tech install', 'News'];
const FILLABLE = ['industry', 'employees', 'location', 'linkedin', 'revenue', 'description'];

const isUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim());
const strings = (list, n) => (Array.isArray(list) ? list.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, n) : []);

function signalType(type) {
  const t = String(type ?? '').trim().toLowerCase();
  return SIGNAL_TYPES.find((s) => s.toLowerCase() === t) ?? (t ? t[0].toUpperCase() + t.slice(1) : 'News');
}

function isoDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

function mergeSignals(...lists) {
  const seen = new Set();
  const out = [];
  for (const s of lists.flat()) {
    if (!s?.title) continue;
    const key = `${String(s.url ?? '').toLowerCase()}|${String(s.title).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: signalType(s.type), date: isoDate(s.date), title: String(s.title).trim(), url: s.url ?? null });
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

function buildBrief(data, { model, previous, fallbackSources, fallbackSummary }) {
  const prevAngles = new Map((previous?.angles ?? []).map((a) => [a.text, a.used]));
  const sources = strings(data.sources, 20).filter(isUrl);
  return {
    summary: String(data.summary ?? '').trim() || fallbackSummary || '',
    whyNow: String(data.whyNow ?? data.why_now ?? '').trim(),
    pains: strings(data.pains, 5),
    angles: strings(data.angles?.map((a) => (typeof a === 'string' ? a : a?.text)), 5).map((text) => ({ text, used: !!prevAngles.get(text) })),
    sources: sources.length ? sources : fallbackSources,
    model: model ?? null,
    at: new Date().toISOString(),
  };
}

async function research(ctx, account) {
  const { store, config } = ctx;
  const days = Number(config.maxSignalAgeDays) || 120;
  const max = Number(config.sourcesPerBrief) || 8;

  ctx.progress(`Researching ${account.name}`);
  const search = await ctx.call('web.search', {
    query: `"${account.name}" ${account.domain} news expansion hiring leadership`,
    maxResults: max,
    days,
  });
  const results = (search?.results ?? []).filter((r) => r?.url).slice(0, max).map((r) => ({ ...r }));

  if (ctx.has('web.fetch')) {
    for (const r of results.slice(0, 2)) {
      ctx.progress(`Reading ${r.url.replace(/^https?:\/\//, '').slice(0, 60)}`);
      const page = await optionalCall(ctx, 'web.fetch', { url: r.url });
      if (page?.text) r.text = String(page.text).slice(0, 4000);
    }
  }

  const fill = {};
  const enriched = await optionalCall(ctx, 'accounts.enrich', { domain: account.domain });
  for (const key of FILLABLE) {
    const v = enriched?.account?.[key];
    if (v != null && v !== '' && (account[key] == null || account[key] === '')) fill[key] = key === 'employees' ? parseEmployees(v) : v;
  }
  if (!account.tech?.length && enriched?.account?.tech?.length) fill.tech = enriched.account.tech;

  const news = (await optionalCall(ctx, 'signals.news', { query: account.name, days }))?.items ?? [];
  const social = (await optionalCall(ctx, 'social.search', { query: account.name }))?.items ?? [];

  ctx.progress(`Writing a brief for ${account.name}`);
  const input = {
    account: { ...account, ...fill },
    results,
    news,
    social,
    settings: ctx.settings,
    tone: config.tone,
    maxSignalAgeDays: days,
  };
  const { data, model } = await ctx.llm({ purpose: 'account_brief', json: true, input, ...accountBriefPrompt(input) });

  const fallbackSources = [...new Set([...results, ...news].map((r) => r.url).filter(isUrl))].slice(0, max);
  const brief = buildBrief(data, { model, previous: account.brief, fallbackSources, fallbackSummary: account.description });
  const modelSignals = Array.isArray(data.signals) ? data.signals : [];
  const cutoff = Date.now() - days * 86_400_000;
  const newsSignals = modelSignals.length
    ? []
    : news
        .filter((n) => !n.publishedAt || Date.parse(n.publishedAt) >= cutoff)
        .slice(0, 3)
        .map((n) => ({ type: 'News', date: n.publishedAt, title: n.title, url: n.url }));
  const signals = mergeSignals(modelSignals, newsSignals, account.signals ?? []);

  // Only accounts still being worked up move back to "researched"; one already in
  // outreach just gets a fresher brief.
  const reopen = ['found', 'researched', 'disqualified'].includes(account.stage);
  const researchCount = (account.researchCount ?? 0) + 1;
  store.update('accounts', account.id, {
    ...fill,
    brief,
    signals,
    researchCount,
    ...(reopen ? { stage: 'researched', disqualifiedReason: null } : {}),
  });
  touchAccount(store, account.id, 'researcher', `Researcher wrote a brief · ${brief.sources.length} sources`);

  if (reopen) {
    const contacts = store.list('contacts', (c) => c.accountId === account.id && !['skipped', 'unsubscribed'].includes(c.stage));
    if (contacts.length) {
      ctx.emit('score_lead', { accountId: account.id, contactIds: contacts.map((c) => c.id) }, { dedupeKey: `score:${account.id}` });
    } else {
      ctx.emit('find_contacts', { accountId: account.id }, { dedupeKey: `contacts:${account.id}` });
    }
  }

  ctx.activity({
    pre: researchCount > 1 ? 'updated the brief for' : 'wrote a brief for',
    link: account.name,
    href: `#/accounts/${account.id}`,
    post: `· ${brief.sources.length} source${brief.sources.length === 1 ? '' : 's'}`,
    tag: 'brief',
  });
}

export default {
  id: 'researcher',
  name: 'Researcher',
  mono: 'Re',
  job: 'Writes an account brief: why now, pains, angles',
  consumes: ['research_account'],
  produces: ['find_contacts'],
  schedule: { type: 'event' },
  batch: 3,
  capabilities: [
    { key: 'web.search', required: true },
    { key: 'web.fetch', required: false },
    { key: 'accounts.enrich', required: false },
    { key: 'signals.news', required: false },
    { key: 'social.search', required: false },
    { key: 'llm.complete', required: true },
  ],
  config: [
    { key: 'sourcesPerBrief', label: 'Sources per brief', type: 'number', default: 8, min: 1, max: 20, prefix: 'Up to' },
    { key: 'maxSignalAgeDays', label: 'Max age of signals', type: 'number', default: 120, min: 7, suffix: 'days' },
    { key: 'tone', label: 'Tone', type: 'text', default: 'Plain, factual' },
  ],

  async run(ctx) {
    const names = [];
    const tasks = ctx.tasks.filter((t) => t.type === 'research_account');
    await eachTask(ctx, tasks, async (task) => {
      const account = ctx.store.get('accounts', task.payload?.accountId);
      if (!account) return;
      // Disqualified accounts are only re-researched when someone asks for it.
      if (account.stage === 'disqualified' && !task.payload?.manual) return;
      await research(ctx, account);
      names.push(account.name);
    });
    if (!names.length) return { summary: 'Nothing to research' };
    return { summary: names.length === 1 ? `Brief for ${names[0]}` : `${names.length} briefs written` };
  },
};
