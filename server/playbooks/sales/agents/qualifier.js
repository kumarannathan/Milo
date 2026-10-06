import { leadScorePrompt } from '../prompts.js';
import { SCORE_PARTS, agentEnabled, eachTask, touchAccount } from '../util.js';

const ALIASES = {
  icp_fit: ['icp_fit', 'icpFit', 'icp'],
  company_growth: ['company_growth', 'companyGrowth', 'growth'],
  buying_signal: ['buying_signal', 'buyingSignal', 'signal'],
  role_relevance: ['role_relevance', 'roleRelevance', 'role'],
  contact_quality: ['contact_quality', 'contactQuality', 'quality'],
};

function clampScore(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

function read(obj, key) {
  for (const k of ALIASES[key]) if (obj?.[k] != null) return clampScore(obj[k]);
  return null;
}

// Fallbacks when the model leaves a per-contact part out.
function roleGuess(title = '') {
  const t = title.toLowerCase();
  if (/revenue cycle|rev ?ops|patient access|billing/.test(t)) return 90;
  if (/\b(cfo|coo|finance|operations)\b/.test(t)) return 82;
  return 70;
}
const qualityGuess = (status) => ({ verified: 92, likely: 82, unknown: 70, invalid: 20 })[status] ?? 70;

/** Turn model output into per-contact breakdowns and totals. */
export function scoreLead(data, contacts) {
  let scores = data?.scores ?? data?.breakdown ?? data ?? {};
  if (Array.isArray(scores)) scores = Object.fromEntries(scores.map((p) => [p?.key, p?.value]));
  const account = {
    icp_fit: read(scores, 'icp_fit'),
    company_growth: read(scores, 'company_growth'),
    buying_signal: read(scores, 'buying_signal'),
  };
  if (Object.values(account).every((v) => v == null)) throw new Error('The model did not return lead scores.');
  for (const k of Object.keys(account)) account[k] ??= 50;

  const perContact = new Map((Array.isArray(data?.contacts) ? data.contacts : []).map((c) => [c?.id, c]));
  const scored = contacts.map((c) => {
    const own = perContact.get(c.id);
    const parts = {
      ...account,
      role_relevance: read(own, 'role_relevance') ?? (contacts.length === 1 ? read(scores, 'role_relevance') : null) ?? roleGuess(c.title),
      contact_quality: read(own, 'contact_quality') ?? (contacts.length === 1 ? read(scores, 'contact_quality') : null) ?? qualityGuess(c.emailStatus),
    };
    const breakdown = SCORE_PARTS.map((p) => ({ key: p.key, label: p.label, weight: p.weight, value: parts[p.key] }));
    const total = Math.round(breakdown.reduce((sum, p) => sum + p.weight * p.value, 0));
    return { contact: c, breakdown, total };
  });

  const named = scored.find((s) => s.contact.id === data?.bestContactId);
  const best = named ?? scored.reduce((a, b) => (b.total > a.total ? b : a));
  return {
    scored,
    best,
    rationale: String(data?.rationale ?? '').trim(),
    skipReason: String(data?.skipReason ?? '').trim(),
  };
}

async function qualify(ctx, account, contactIds) {
  const { store, config } = ctx;
  const ids = Array.isArray(contactIds) && contactIds.length ? new Set(contactIds) : null;
  const contacts = store.list(
    'contacts',
    (c) => c.accountId === account.id && (!ids || ids.has(c.id)) && !['skipped', 'unsubscribed'].includes(c.stage),
  );
  if (!contacts.length) return null;

  ctx.progress(`Scoring ${account.name}`);
  const input = { account, contacts, brief: account.brief, settings: ctx.settings, researchCount: account.researchCount ?? 0 };
  const { data } = await ctx.llm({ purpose: 'lead_score', json: true, input, ...leadScorePrompt(input) });
  const { scored, best, rationale, skipReason } = scoreLead(data, contacts);

  const total = best.total;
  const outreachAt = Number(config.outreachAt) || 91;
  const researchAt = Number(config.researchAt) || 70;
  const rounds = account.researchCount ?? 0;
  let decision;
  let stage;
  let note = rationale;
  let label;
  if (total >= outreachAt) {
    decision = 'outreach';
    stage = 'qualified';
    label = 'outreach';
  } else if (total >= researchAt) {
    decision = 'research';
    stage = 'researched';
    if (rounds < 2) label = 'more research';
    else {
      label = 'held for review';
      note = `Scored ${total} after ${rounds} rounds of research. Left for you to review.${rationale ? ` ${rationale}` : ''}`;
    }
  } else {
    decision = 'skip';
    stage = 'disqualified';
    label = 'skip';
  }

  const now = new Date().toISOString();
  for (const s of scored) {
    const c = s.contact;
    store.update('contacts', c.id, {
      score: s.total,
      scoreBreakdown: s.breakdown,
      decision: c.id === best.contact.id ? decision : decision === 'outreach' ? null : decision,
      stage: ['new', 'scored'].includes(c.stage) ? 'scored' : c.stage,
    });
  }
  store.update('accounts', account.id, {
    score: total,
    scoreBreakdown: best.breakdown,
    decision,
    decisionNote: note || null,
    scoredAt: now,
    stage,
    disqualifiedReason: decision === 'skip' ? skipReason || rationale || `Scored ${total}, below ${researchAt}.` : null,
  });

  if (decision === 'outreach') {
    const c = best.contact;
    ctx.emit('write_outreach', { accountId: account.id, contactId: c.id, step: 1 }, { dedupeKey: `outreach:${c.id}:1` });
    if (agentEnabled(store, 'crm')) ctx.emit('sync_crm', { accountId: account.id }, { dedupeKey: `crm:account:${account.id}` });
  } else if (decision === 'research' && rounds < 2) {
    ctx.emit('research_account', { accountId: account.id }, { dedupeKey: `research:${account.id}` });
  }

  touchAccount(store, account.id, 'qualifier', `Qualifier scored ${total} → ${label}`);
  ctx.activity({
    pre: 'scored',
    link: account.name,
    href: `#/accounts/${account.id}`,
    post: `${total}/100 → ${label}`,
    tag: 'score',
  });
  return total;
}

export default {
  id: 'qualifier',
  name: 'Qualifier',
  mono: 'Qu',
  job: 'Scores each lead and decides: outreach, research more, or skip',
  consumes: ['score_lead'],
  produces: ['write_outreach', 'research_account'],
  schedule: { type: 'event' },
  batch: 5,
  capabilities: [
    { key: 'llm.complete', required: true },
  ],
  config: [
    { key: 'outreachAt', label: 'Outreach at', type: 'number', default: 91, min: 1, max: 100, suffix: '+' },
    { key: 'researchAt', label: 'Research again at', type: 'number', default: 70, min: 1, max: 100, suffix: '+' },
  ],

  async run(ctx) {
    let scored = 0;
    const tasks = ctx.tasks.filter((t) => t.type === 'score_lead');
    await eachTask(ctx, tasks, async (task) => {
      const account = ctx.store.get('accounts', task.payload?.accountId);
      if (!account) return;
      // Accounts already in a conversation keep their score; disqualified ones stay out.
      if (['in_outreach', 'engaged', 'meeting', 'disqualified'].includes(account.stage)) return;
      if ((await qualify(ctx, account, task.payload?.contactIds)) != null) scored++;
    });
    return { summary: scored ? `Scored ${scored} lead${scored === 1 ? '' : 's'}` : 'Nothing to score' };
  },
};
