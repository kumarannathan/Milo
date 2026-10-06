import { autoApprove, needsReview } from '../approvals.js';
import { outreachDraftPrompt } from '../prompts.js';
import { newApproval } from '../records.js';
import { nextSendTime } from '../timezones.js';
import {
  advanceStage,
  agentConfig,
  cleanCopy,
  eachTask,
  hasHumanReply,
  replySubject,
  touchAccount,
  withSignature,
} from '../util.js';

const words = (s) => new Set(String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));

// Which brief angle the draft leaned on, so the next step can pick a different one.
function matchAngle(angles, draftAngle, step) {
  const target = words(draftAngle);
  let best = -1;
  let bestScore = 0;
  angles.forEach((a, i) => {
    const w = words(a.text);
    const overlap = [...w].filter((x) => target.has(x)).length / Math.max(1, Math.min(w.size, target.size));
    if (overlap > bestScore) {
      bestScore = overlap;
      best = i;
    }
  });
  if (bestScore >= 0.3) return best;
  if (step === 1) return angles.findIndex((a) => !a.used);
  return -1;
}

function normalizeDraft(data, { step, thread, settings }) {
  const subject = String(data?.subject ?? '').trim();
  const body = withSignature(cleanCopy(data?.body ?? ''), settings);
  if (!body) throw new Error('The model returned an empty draft.');
  const facts = (Array.isArray(data?.facts) ? data.facts : [])
    .map((f) => (typeof f === 'string' ? { text: f, src: null } : { text: String(f?.text ?? '').trim(), src: f?.src ?? f?.url ?? null }))
    .filter((f) => f.text)
    .slice(0, 5);
  return {
    subject: step > 1 && thread ? replySubject(thread.subject) : cleanCopy(subject) || 'Quick question',
    body,
    angle: String(data?.angle ?? '').trim(),
    facts,
  };
}

async function draft(ctx, payload) {
  const { store, config } = ctx;
  const step = Number(payload.step) || 1;
  const account = store.get('accounts', payload.accountId);
  const contact = store.get('contacts', payload.contactId);
  if (!account || !contact || !contact.email) return null;
  if (account.stage === 'disqualified') return null;
  if (['unsubscribed', 'skipped', 'replied', 'meeting'].includes(contact.stage)) return null;

  const kind = step === 1 ? 'first_touch' : 'follow_up';
  const duplicate = store.find(
    'approvals',
    (a) => a.contactId === contact.id && a.step === step && ['first_touch', 'follow_up'].includes(a.kind) && !['rejected', 'failed'].includes(a.status),
  );
  if (duplicate) return null;

  const thread = step > 1
    ? store.get('threads', payload.threadId) ?? store.find('threads', (t) => t.contactId === contact.id)
    : null;
  if (step > 1 && (!thread || hasHumanReply(thread) || thread.owner || ['closed', 'escalated'].includes(thread.status))) return null;

  const sequenceSteps = Number(config.sequenceSteps) || 3;
  const maxWords = Number(config.maxWords) || 120;
  const notes = store
    .list('notes', (n) => n.kind === 'rejection' && n.agentId === 'personalizer')
    .slice(-8)
    .map(({ text, tags, at }) => ({ text, tags, at }));
  const previous = (thread?.messages ?? [])
    .filter((m) => m.kind === 'msg' && m.direction === 'out')
    .map((m) => ({ subject: thread.subject, body: m.body, at: m.at }));
  const angles = account.brief?.angles ?? [];

  ctx.progress(`Drafting for ${contact.name}, ${account.name}`);
  const input = {
    account,
    contact,
    brief: account.brief,
    settings: ctx.settings,
    step,
    sequenceSteps,
    maxWords,
    notes,
    previous,
    usedAngles: angles.filter((a) => a.used).map((a) => a.text),
  };
  const { data } = await ctx.llm({ purpose: 'outreach_draft', json: true, input, ...outreachDraftPrompt(input) });
  const copy = normalizeDraft(data, { step, thread, settings: ctx.settings });

  const sdr = agentConfig(store, ctx.playbook, 'sdr');
  // Spread sends a little inside the window instead of all landing at 8:00 sharp.
  const jitterMin = (parseInt(contact.id.slice(-2), 16) % 4) * 10;
  const sendAt = ctx.demo ? new Date() : nextSendTime(contact.timezone, sdr.windowStart, sdr.windowEnd, new Date(), { jitterMin });

  let approval = store.insert('approvals', {
    ...newApproval({
      kind,
      agentId: 'personalizer',
      accountId: account.id,
      contactId: contact.id,
      threadId: thread?.id ?? null,
      step,
      ...copy,
      sendAt: sendAt.toISOString(),
    }),
    sequenceSteps,
  });

  const used = matchAngle(angles, copy.angle, step);
  if (used >= 0 && !angles[used].used) {
    store.update('accounts', account.id, {
      brief: { ...account.brief, angles: angles.map((a, i) => (i === used ? { ...a, used: true } : a)) },
    });
  }
  if (['new', 'scored'].includes(contact.stage)) store.update('contacts', contact.id, { stage: 'draft' });
  store.update('accounts', account.id, { stage: advanceStage(store.get('accounts', account.id).stage, 'in_outreach') });

  const auto = !needsReview(ctx.workspace, kind);
  if (auto) approval = autoApprove(ctx, approval);

  const what = step === 1 ? 'a first touch' : `follow-up ${step} of ${sequenceSteps}`;
  touchAccount(store, account.id, 'personalizer', `Personalizer drafted ${what}`);
  ctx.activity({
    pre: `wrote ${what} for`,
    link: contact.name,
    href: `#/approvals/${approval.id}`,
    post: `· ${[contact.title, account.name].filter(Boolean).join(', ')}${auto ? ' · queued to send' : ''}`,
    tag: 'draft',
  });
  return approval;
}

export default {
  id: 'personalizer',
  name: 'Personalizer',
  mono: 'Pe',
  job: 'Writes outreach from the research brief',
  consumes: ['write_outreach'],
  produces: ['send_outreach'],
  schedule: { type: 'event' },
  batch: 3,
  capabilities: [
    { key: 'llm.complete', required: true },
  ],
  config: [
    { key: 'maxWords', label: 'Length', type: 'number', default: 120, min: 40, max: 300, prefix: 'Under', suffix: 'words' },
    { key: 'sequenceSteps', label: 'Sequence', type: 'number', default: 3, min: 1, max: 6, suffix: 'steps' },
    { key: 'daysBetween', label: 'Days between steps', type: 'number', default: 4, min: 1, max: 30 },
  ],

  async run(ctx) {
    let drafts = 0;
    const tasks = ctx.tasks.filter((t) => t.type === 'write_outreach');
    await eachTask(ctx, tasks, async (task) => {
      if (await draft(ctx, task.payload ?? {})) drafts++;
    });
    return { summary: drafts ? `${drafts} draft${drafts === 1 ? '' : 's'} written` : 'Nothing to draft' };
  },
};
