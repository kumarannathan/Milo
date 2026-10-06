import { autoApprove, isCold, needsReview } from '../approvals.js';
import { replyClassifyPrompt, replyDraftPrompt } from '../prompts.js';
import { newApproval, newEvent, newMessage } from '../records.js';
import { formatLocal, formatShort, inWindow, nextSendTime } from '../timezones.js';
import {
  INTENT_LABELS,
  advanceStage,
  agentConfig,
  agentEnabled,
  cancelTasks,
  cleanCopy,
  dayMs,
  deferTask,
  eachTask,
  firstName,
  hasHumanReply,
  isHoldError,
  lastMessage,
  optionalCall,
  ownerOf,
  providerName,
  replySubject,
  shortName,
  snippetOf,
  startOfDay,
  touchAccount,
  withSignature,
} from '../util.js';

const INTENTS = Object.keys(INTENT_LABELS);
const SYNONYMS = {
  ooo: 'out_of_office', auto_reply: 'out_of_office', autoreply: 'out_of_office', away: 'out_of_office',
  unsubscribed: 'unsubscribe', remove: 'unsubscribe', opt_out: 'unsubscribe', stop: 'unsubscribe',
  positive: 'interested', meeting: 'interested', yes: 'interested', accept: 'interested',
  later: 'not_now', timing: 'not_now', declined: 'not_interested', no: 'not_interested', negative: 'not_interested',
  forward: 'referral', referred: 'referral', objection: 'question',
};
const ENGAGED = new Set(['interested', 'question', 'referral', 'not_now', null]);

const nowIso = () => new Date().toISOString();
// Mail providers differ on whether message ids keep their angle brackets.
const sameId = (a, b) => !!a && !!b && String(a).trim().replace(/^<|>$/g, '').toLowerCase() === String(b).trim().replace(/^<|>$/g, '').toLowerCase();
const emailOf = (from) => String(from ?? '').toLowerCase().match(/<([^>]+)>/)?.[1]?.trim() ?? String(from ?? '').toLowerCase().trim();

/** Escalation rules from the SDR config ("Pricing over $50k, legal, security") applied to a reply. */
export function escalationRule(text, rules) {
  const r = String(rules ?? '').toLowerCase();
  const t = String(text ?? '');
  if (/security/.test(r) && /\b(BAA|SOC ?2|HIPAA|HITRUST|security (review|questionnaire)|pen(etration)? test|data security)\b/i.test(t)) return 'security question';
  if (/legal/.test(r) && /\b(contract|MSA|DPA|legal|indemnif\w*|liability|redlines?|terms and conditions)\b/i.test(t)) return 'legal question';
  const cap = r.match(/pricing over \$?\s*(\d+(?:\.\d+)?)\s*(k|m)?/);
  if (cap) {
    const limit = Number(cap[1]) * (cap[2] === 'm' ? 1e6 : cap[2] === 'k' ? 1e3 : 1);
    for (const m of t.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|million)?\b/gi)) {
      const unit = (m[2] ?? '').toLowerCase();
      const v = Number(m[1].replace(/,/g, '')) * (unit.startsWith('m') ? 1e6 : unit === 'k' ? 1e3 : 1);
      if (v > limit) return 'large pricing question';
    }
  }
  return null;
}

function sentToday(store) {
  const since = startOfDay().getTime();
  return store.count('approvals', (a) => a.status === 'sent' && isCold(a) && a.sentAt && Date.parse(a.sentAt) >= since);
}

function cancelApproval(store, approval, reason) {
  store.update('approvals', approval.id, { status: 'rejected', rejectReason: reason, rejectTags: ['auto'], decidedAt: nowIso() });
  if (approval.meetingId) store.update('meetings', approval.meetingId, { status: 'cancelled' });
}

/** Someone replied: stop the cold sequence for them. */
function stopSequence(store, contactId) {
  cancelTasks(store, (t) => ['follow_up', 'write_outreach'].includes(t.type) && t.payload?.contactId === contactId, 'They replied');
  for (const a of store.list('approvals', (a) => a.contactId === contactId && a.kind === 'follow_up' && a.status === 'pending')) {
    cancelApproval(store, a, 'Not sent: they replied first.');
  }
}

function calendarLabel(ctx) {
  const conn = ctx.connection('calendar.book');
  if (!conn) return null;
  return conn.provider === 'demo' ? 'the sample calendar' : providerName(conn);
}

function failSend(ctx, task, approval, contact, message) {
  if (approval) ctx.store.update('approvals', approval.id, { status: 'failed', error: message });
  ctx.fail(task, message);
  ctx.activity({
    pre: 'could not send to',
    link: contact?.name ?? 'a contact',
    href: approval ? `#/approvals/${approval.id}` : null,
    post: `· ${message}`,
    tag: 'error',
    level: 'error',
  });
}
// ── Sending ─────────────────────────────────────────────────────

async function sendApproval(ctx, task, out) {
  const { store: db, config: cfg, settings } = ctx;
  const approval = db.get('approvals', task.payload?.approvalId);
  // Never send twice: only an approved item that has not gone out yet is sent.
  if (!approval || approval.status !== 'approved') return;
  const contact = db.get('contacts', approval.contactId);
  const account = db.get('accounts', approval.accountId);
  if (!contact?.email || !account) return failSend(ctx, task, approval, contact, 'The contact has no email address.');
  if (contact.stage === 'unsubscribed') return cancelApproval(db, approval, 'Not sent: they unsubscribed.');

  let thread = approval.threadId ? db.get('threads', approval.threadId) : null;
  if (!thread && approval.kind !== 'first_touch') thread = db.find('threads', (t) => t.contactId === contact.id);
  if (approval.kind === 'follow_up' && (hasHumanReply(thread) || thread?.owner || thread?.status === 'closed')) {
    return cancelApproval(db, approval, 'Not sent: they replied first.');
  }
  if (['reply', 'meeting'].includes(approval.kind) && approval.autoApproved && thread?.owner) {
    return cancelApproval(db, approval, 'Not sent: you took over this thread.');
  }

  if (isCold(approval)) {
    if (!ctx.demo && !inWindow(contact.timezone, cfg.windowStart, cfg.windowEnd)) {
      const at = nextSendTime(contact.timezone, cfg.windowStart, cfg.windowEnd);
      deferTask(ctx, task, at);
      db.update('approvals', approval.id, { sendAt: at.toISOString() });
      out.held++;
      return;
    }
    if (sentToday(db) >= Number(cfg.dailyCap)) {
      const tomorrow = startOfDay();
      tomorrow.setDate(tomorrow.getDate() + 1);
      deferTask(ctx, task, tomorrow);
      out.capped = true;
      out.held++;
      return;
    }
  }

  let meeting = approval.meetingId ? db.get('meetings', approval.meetingId) : null;
  let res;
  try {
    if (approval.kind === 'meeting' && meeting && !meeting.eventId && ctx.has('calendar.book')) {
      ctx.progress(`Booking ${meeting.title}`);
      const booked = await ctx.call('calendar.book', {
        title: meeting.title,
        start: meeting.start,
        durationMin: meeting.durationMin,
        attendees: [{ email: contact.email, name: contact.name }],
        description: approval.body,
      });
      meeting = db.update('meetings', meeting.id, { eventId: booked?.eventId ?? null, link: booked?.link ?? meeting.link ?? null });
    }
    ctx.progress(`Sending to ${contact.name}, ${account.name}`);
    res = await ctx.call('email.send', {
      to: contact.email,
      toName: contact.name,
      subject: approval.subject,
      body: approval.body,
      threadId: thread?.externalThreadId ?? undefined,
      inReplyTo: lastMessage(thread)?.externalId ?? undefined,
    });
  } catch (err) {
    if (isHoldError(err) || (task.attempts ?? 1) < 3) throw err;
    return failSend(ctx, task, approval, contact, err.message);
  }

  // The email is out. Record that first so nothing below can cause a second send.
  const at = nowIso();
  db.update('approvals', approval.id, { status: 'sent', sentAt: at, externalMessageId: res?.messageId ?? null });
  ctx.complete(task);
  out.sent++;

  const msg = newMessage({
    direction: 'out',
    from: settings.senderName,
    fromEmail: settings.senderEmail,
    by: approval.autoApproved ? 'sent by SDR' : 'sent by SDR · approved by you',
    at,
    body: approval.body,
    agentId: 'sdr',
    externalId: res?.messageId ?? null,
    approvalId: approval.id,
  });
  const extra = [];
  if (approval.kind === 'meeting' && meeting) {
    meeting = db.update('meetings', meeting.id, { status: 'booked', bookedAt: at });
    const cal = meeting.eventId ? calendarLabel(ctx) : null;
    extra.push(newEvent(cal ? `SDR booked the meeting on ${cal}` : 'SDR confirmed the time by email'));
    extra.push({ ...newEvent(''), kind: 'meeting', text: meeting.title, meetingId: meeting.id });
  }

  if (!thread) {
    thread = db.insert('threads', {
      accountId: account.id,
      contactId: contact.id,
      subject: approval.subject,
      externalThreadId: res?.threadId ?? null,
      intent: null,
      status: 'them',
      owner: null,
      escalation: null,
      offeredSlots: [],
      messages: [msg, ...extra],
      startedAt: at,
      updatedAt: at,
    });
  } else {
    thread = db.update('threads', thread.id, (t) => ({
      messages: [...t.messages, msg, ...extra],
      status: ['escalated', 'closed'].includes(t.status) ? t.status : 'them',
      externalThreadId: t.externalThreadId ?? res?.threadId ?? null,
    }));
  }
  db.update('approvals', approval.id, { threadId: thread.id });
  if (meeting) db.update('meetings', meeting.id, { threadId: thread.id });

  const contactPatch = { lastContactedAt: at };
  if (isCold(approval)) {
    contactPatch.sequenceStep = Math.max(contact.sequenceStep ?? 0, approval.step ?? 1);
    if (['new', 'scored', 'draft'].includes(contact.stage)) contactPatch.stage = 'contacted';
  }
  if (approval.kind === 'meeting') contactPatch.stage = 'meeting';
  db.update('contacts', contact.id, contactPatch);
  db.update('accounts', account.id, { stage: advanceStage(account.stage, approval.kind === 'meeting' ? 'meeting' : 'in_outreach') });

  if (isCold(approval)) {
    const pz = agentConfig(db, ctx.playbook, 'personalizer');
    const step = approval.step ?? 1;
    if (step < (Number(pz.sequenceSteps) || 3)) {
      ctx.emit(
        'follow_up',
        { accountId: account.id, contactId: contact.id, threadId: thread.id, step },
        { availableAt: Date.now() + (Number(pz.daysBetween) || 4) * dayMs(ctx), dedupeKey: `follow_up:${contact.id}:${step + 1}` },
      );
    }
  }
  if (agentEnabled(db, 'crm')) {
    ctx.emit('sync_crm', { accountId: account.id, contactId: contact.id, approvalId: approval.id, meetingId: meeting?.id ?? null }, { dedupeKey: `crm:${approval.id}` });
  }

  const steps = approval.sequenceSteps ?? agentConfig(db, ctx.playbook, 'personalizer').sequenceSteps;
  const href = `#/conversations/${thread.id}`;
  if (approval.kind === 'meeting' && meeting) {
    touchAccount(db, account.id, 'sdr', `SDR booked a meeting for ${formatShort(meeting.start, contact.timezone)}`);
    ctx.activity({ pre: 'booked a meeting with', link: contact.name, href, post: `· ${account.name}, ${formatShort(meeting.start, contact.timezone)}`, tag: 'meeting' });
  } else {
    const what = {
      first_touch: 'sent a first touch to',
      follow_up: `sent follow-up ${approval.step} of ${steps} to`,
      reply: 'replied to',
    }[approval.kind] ?? 'emailed';
    touchAccount(db, account.id, 'sdr', `SDR ${what} ${contact.name}`);
    ctx.activity({ pre: what, link: contact.name, href, post: `· ${account.name}`, tag: 'sent' });
  }
}

async function sendManual(ctx, task, out) {
  const { store: db, settings } = ctx;
  const p = task.payload ?? {};
  if (p.sentAt) return; // went out on an earlier attempt
  const thread = db.get('threads', p.threadId);
  if (!thread) return;
  const contact = db.get('contacts', thread.contactId);
  const account = db.get('accounts', thread.accountId);
  if (!contact?.email) return failSend(ctx, task, null, contact, 'The contact has no email address.');

  let res;
  try {
    ctx.progress(`Sending your reply to ${contact.name}`);
    res = await ctx.call('email.send', {
      to: contact.email,
      toName: contact.name,
      subject: replySubject(thread.subject),
      body: p.body,
      threadId: thread.externalThreadId ?? undefined,
      inReplyTo: lastMessage(thread)?.externalId ?? undefined,
    });
  } catch (err) {
    if (isHoldError(err) || (task.attempts ?? 1) < 3) throw err;
    return failSend(ctx, task, null, contact, err.message);
  }

  const at = nowIso();
  db.update('tasks', task.id, { payload: { ...p, sentAt: at } });
  ctx.complete(task);
  out.sent++;

  const msg = newMessage({
    direction: 'out',
    from: settings.senderName,
    fromEmail: settings.senderEmail,
    by: 'sent by you',
    at,
    body: p.body,
    externalId: res?.messageId ?? null,
  });
  db.update('threads', thread.id, (t) => ({
    messages: [...t.messages, msg],
    status: t.status === 'escalated' ? 'escalated' : 'them',
    owner: t.owner ?? ownerOf(ctx.workspace),
    externalThreadId: t.externalThreadId ?? res?.threadId ?? null,
  }));
  db.update('contacts', contact.id, { lastContactedAt: at });
  if (agentEnabled(db, 'crm')) {
    ctx.emit('sync_crm', { accountId: thread.accountId, contactId: contact.id, threadId: thread.id, messageId: msg.id }, { dedupeKey: `crm:${msg.id}` });
  }
  touchAccount(db, thread.accountId, 'sdr', `You replied to ${contact.name}`);
  ctx.activity({ pre: 'sent your reply to', link: contact.name, href: `#/conversations/${thread.id}`, post: account ? `· ${account.name}` : '', tag: 'sent' });
}

// ── Sequence ────────────────────────────────────────────────────

async function followUp(ctx, task, out) {
  const { store: db } = ctx;
  const { accountId, contactId, threadId, step = 1 } = task.payload ?? {};
  const contact = db.get('contacts', contactId);
  const account = db.get('accounts', accountId);
  if (!contact || !account || account.stage === 'disqualified') return;
  if (['unsubscribed', 'replied', 'meeting', 'skipped'].includes(contact.stage)) return;
  const thread = db.get('threads', threadId) ?? db.find('threads', (t) => t.contactId === contactId);
  if (thread && (thread.owner || ['closed', 'escalated'].includes(thread.status) || hasHumanReply(thread))) return;
  const steps = Number(agentConfig(db, ctx.playbook, 'personalizer').sequenceSteps) || 3;
  if (step >= steps) return;
  ctx.emit('write_outreach', { accountId, contactId, step: step + 1, threadId: thread?.id ?? null }, { dedupeKey: `outreach:${contactId}:${step + 1}` });
  out.followUps++;
}

// ── Replies ─────────────────────────────────────────────────────

async function classify(ctx, thread, message, contact, account) {
  const input = { thread, message, contact, account, settings: ctx.settings, escalate: ctx.config.escalate };
  const { data } = await ctx.llm({ purpose: 'reply_classify', json: true, input, ...replyClassifyPrompt(input) });
  let intent = String(data?.intent ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (!INTENTS.includes(intent)) intent = SYNONYMS[intent] ?? 'question';
  const rule = escalationRule(message.body, ctx.config.escalate);
  const modelEscalates = data?.escalate === true || data?.escalate === 'true';
  const escalate = ['interested', 'question', 'referral'].includes(intent) && (modelEscalates || !!rule);
  const reason = (modelEscalates ? String(data?.reason ?? '').trim() : '') || rule || String(data?.reason ?? '').trim() || null;
  const t = data?.agreedTime ? Date.parse(data.agreedTime) : NaN;
  const agreedTime = Number.isFinite(t) && t > Date.now() ? new Date(t).toISOString() : null;
  return { intent, escalate, reason, agreedTime };
}

async function offerSlots(ctx, contact) {
  const cfg = ctx.config;
  const res = await optionalCall(ctx, 'calendar.availability', {
    from: new Date(Date.now() + 12 * 3600_000).toISOString(),
    to: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    durationMin: 30,
  });
  const lo = Math.max(Number(cfg.windowStart) || 8, 9);
  const hi = Math.min(Number(cfg.windowEnd) || 17, 17);
  const picked = [];
  for (const s of res?.slots ?? []) {
    if (!s?.start || !inWindow(contact.timezone, lo, hi, new Date(s.start))) continue;
    const day = formatLocal(s.start, contact.timezone).split(',')[0];
    if (picked.some((p) => formatLocal(p.start, contact.timezone).split(',')[0] === day)) continue;
    picked.push({ start: new Date(s.start).toISOString(), end: s.end ? new Date(s.end).toISOString() : null });
    if (picked.length === 2) break;
  }
  return picked;
}

async function slotIsFree(ctx, start, durationMin) {
  if (!ctx.has('calendar.availability')) return true;
  const end = new Date(Date.parse(start) + durationMin * 60_000).toISOString();
  const res = await optionalCall(ctx, 'calendar.availability', { from: start, to: end, durationMin });
  if (!res) return true;
  return (res.slots ?? []).some((s) => Date.parse(s.start) <= Date.parse(start) && Date.parse(s.end ?? s.start) >= Date.parse(end));
}

function defaultAngle(contact, cls, { meeting, slots, bookingUrl }) {
  const name = firstName(contact.name);
  if (meeting) return `${name} picked a time. SDR checked your calendar and prepared the invite.`;
  const next = slots.length ? ' and proposed times from your calendar' : bookingUrl ? ' and shared your booking link' : '';
  if (cls.intent === 'question') return `${name} asked a question${cls.reason ? ` (${cls.reason})` : ''}. SDR answered from your notes${next}.`;
  if (cls.intent === 'referral') return `${name} pointed us to someone else. SDR thanked them and asked for an introduction.`;
  return `${name} is interested. SDR replied${next}.`;
}

async function draftReply(ctx, thread, msg, cls, contact, account) {
  const { store: db, settings } = ctx;
  if (!contact?.email || !account) return null;
  // A newer reply makes any pending draft on this thread stale.
  for (const a of db.list('approvals', (a) => a.threadId === thread.id && a.status === 'pending' && ['reply', 'meeting'].includes(a.kind))) {
    cancelApproval(db, a, 'Replaced by a newer draft.');
  }

  const tz = contact.timezone;
  let meeting = null;
  let slots = [];
  if (cls.agreedTime && (await slotIsFree(ctx, cls.agreedTime, 30))) {
    meeting = db.insert('meetings', {
      accountId: account.id,
      contactId: contact.id,
      threadId: thread.id,
      title: `${settings.company || 'Intro'} <> ${shortName(account.name)} · 30 min`,
      start: cls.agreedTime,
      durationMin: 30,
      status: 'proposed',
      link: null,
      eventId: null,
      bookedAt: null,
    });
  } else if (['interested', 'question'].includes(cls.intent)) {
    slots = await offerSlots(ctx, contact);
    if (slots.length) db.update('threads', thread.id, { offeredSlots: slots });
  }
  const bookingUrl = !meeting && !slots.length && ['interested', 'question'].includes(cls.intent) ? settings.bookingUrl || null : null;

  const input = {
    thread: db.get('threads', thread.id),
    message: msg,
    contact,
    account,
    settings,
    intent: cls.intent,
    reason: cls.reason,
    slots: slots.map((s) => ({ ...s, label: formatLocal(s.start, tz) })),
    bookingUrl,
    meeting: meeting ? { start: meeting.start, durationMin: meeting.durationMin, title: meeting.title, label: formatLocal(meeting.start, tz) } : null,
    maxWords: Number(agentConfig(db, ctx.playbook, 'personalizer').maxWords) || 120,
    notes: db.list('notes', (n) => n.kind === 'rejection' && n.agentId === 'sdr').slice(-6).map(({ text, tags }) => ({ text, tags })),
  };

  ctx.progress(`Drafting a reply to ${contact.name}`);
  let data;
  try {
    ({ data } = await ctx.llm({ purpose: 'reply_draft', json: true, input, ...replyDraftPrompt(input) }));
  } catch (err) {
    if (meeting) db.update('meetings', meeting.id, { status: 'cancelled' });
    throw err;
  }
  const body = withSignature(cleanCopy(data?.body ?? ''), settings);
  if (!body) {
    if (meeting) db.update('meetings', meeting.id, { status: 'cancelled' });
    throw new Error('The model returned an empty reply.');
  }

  const kind = meeting ? 'meeting' : 'reply';
  let approval = db.insert('approvals', newApproval({
    kind,
    agentId: 'sdr',
    accountId: account.id,
    contactId: contact.id,
    threadId: thread.id,
    step: contact.sequenceStep ?? null,
    subject: replySubject(thread.subject),
    body,
    angle: String(data?.angle ?? '').trim() || defaultAngle(contact, cls, { meeting, slots, bookingUrl }),
    facts: [{ text: `${cls.intent === 'question' ? 'Asked' : 'Replied'}: “${snippetOf(msg.body, 160)}”`, src: `thread · ${formatLocal(msg.at, tz, { weekday: undefined, zone: false })}` }],
    sendAt: nowIso(),
    meeting: meeting ? { start: meeting.start, durationMin: meeting.durationMin, title: meeting.title } : null,
    meetingId: meeting?.id ?? null,
  }));
  const auto = !needsReview(ctx.workspace, kind);
  if (auto) approval = autoApprove(ctx, approval);

  ctx.activity({
    pre: meeting ? 'prepared a meeting invite for' : 'drafted a reply to',
    link: contact.name,
    href: `#/approvals/${approval.id}`,
    post: `· ${account.name}${meeting ? `, ${formatShort(meeting.start, tz)}` : ''}${auto ? ' · queued to send' : ''}`,
    tag: 'draft',
  });
  return approval;
}

function matchThread(db, m, fromEmail) {
  if (m.threadId) {
    const t = db.find('threads', (t) => sameId(t.externalThreadId, m.threadId));
    if (t) return t;
  }
  if (m.inReplyTo) {
    const t = db.find('threads', (t) => t.messages.some((x) => sameId(x.externalId, m.inReplyTo)));
    if (t) return t;
  }
  if (!fromEmail) return null;
  const contact = db.find('contacts', (c) => c.email?.toLowerCase() === fromEmail);
  if (!contact) return null;
  return db
    .list('threads', (t) => t.contactId === contact.id)
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0] ?? null;
}

async function handleInbound(ctx, m, out) {
  const { store: db } = ctx;
  const fromEmail = emailOf(m?.from);
  if (!m || (!m.body && !m.subject)) return;
  if (fromEmail && fromEmail === String(ctx.settings.senderEmail ?? '').toLowerCase()) return;
  const thread = matchThread(db, m, fromEmail);
  if (!thread) return;
  if (m.messageId && thread.messages.some((x) => sameId(x.externalId, m.messageId))) return;

  const contact = db.get('contacts', thread.contactId);
  const account = db.get('accounts', thread.accountId);
  const at = m.at && Number.isFinite(Date.parse(m.at)) ? new Date(m.at).toISOString() : nowIso();
  const msg = newMessage({
    direction: 'in',
    from: m.fromName || contact?.name || fromEmail,
    fromEmail,
    by: fromEmail,
    at,
    body: String(m.body ?? '').trim(),
    externalId: m.messageId ?? null,
  });

  ctx.progress(`Reading a reply from ${msg.from}`);
  let cls;
  try {
    // Classify before saving, so a model outage leaves the message to be read again.
    cls = await classify(ctx, { ...thread, messages: [...thread.messages, msg] }, msg, contact, account);
  } catch (err) {
    if (isHoldError(err)) throw err;
    cls = { intent: null, escalate: false, reason: null, agreedTime: null, error: err.message };
  }
  out.replies++;

  const owner = ownerOf(ctx.workspace);
  const label = INTENT_LABELS[cls.intent] ?? 'Unclear';
  const keep = (s) => (thread.status === 'escalated' ? 'escalated' : s);
  const patch = { intent: cls.intent ?? thread.intent ?? null };
  const events = [];
  let draft = false;
  let escalatedTo = null;

  switch (cls.intent) {
    case 'unsubscribe':
      patch.status = 'closed';
      events.push('SDR tagged Unsubscribe, closed the thread and stopped all outreach to this person');
      break;
    case 'not_interested':
      patch.status = 'closed';
      events.push('SDR tagged Not interested and closed the thread');
      break;
    case 'out_of_office':
      patch.status = keep('them');
      events.push('SDR tagged Out of office and kept the follow-ups scheduled');
      break;
    case 'not_now':
      patch.status = keep('them');
      events.push('SDR tagged Not now and stopped the sequence');
      break;
    case null:
    case undefined:
      patch.status = keep('us');
      events.push(`SDR could not tag this reply${cls.error ? `: ${cls.error}` : ''}`);
      break;
    default:
      if (cls.escalate) {
        escalatedTo = thread.owner ?? owner;
        patch.status = 'escalated';
        patch.owner = escalatedTo;
        patch.escalation = { reason: cls.reason || 'needs a person', at: nowIso() };
        events.push(`SDR tagged ${label} and handed the thread to ${escalatedTo.name}: ${cls.reason || 'needs a person'}`);
      } else if (thread.owner) {
        patch.status = keep('us');
        events.push(`SDR tagged ${label}. ${thread.owner.name} owns this thread, so SDR did not draft a reply`);
      } else {
        patch.status = 'us';
        draft = true;
      }
  }

  db.update('threads', thread.id, (t) => ({ ...patch, messages: [...t.messages, msg, ...events.map((e) => newEvent(e))] }));

  if (contact) {
    if (cls.intent === 'unsubscribe') {
      db.update('contacts', contact.id, { stage: 'unsubscribed' });
      for (const a of db.list('approvals', (a) => a.contactId === contact.id && ['pending', 'approved'].includes(a.status))) {
        cancelApproval(db, a, 'Not sent: they unsubscribed.');
      }
    } else if (cls.intent !== 'out_of_office' && !['meeting', 'unsubscribed'].includes(contact.stage)) {
      db.update('contacts', contact.id, { stage: 'replied' });
    }
    if (cls.intent !== 'out_of_office') stopSequence(db, contact.id);
  }
  if (account && ENGAGED.has(cls.intent ?? null)) db.update('accounts', account.id, { stage: advanceStage(account.stage, 'engaged') });

  if (escalatedTo) await ctx.notify(`${contact?.name ?? msg.from} at ${account?.name ?? 'an account'} needs you: ${cls.reason || 'reply needs a person'}`, 'warn');
  if (agentEnabled(db, 'crm') && account) {
    ctx.emit('sync_crm', { accountId: account.id, contactId: contact?.id ?? null, threadId: thread.id, messageId: msg.id }, { dedupeKey: `crm:${msg.id}` });
  }
  touchAccount(db, thread.accountId, 'sdr', `${contact?.name ?? msg.from} replied · ${label}`);
  ctx.activity({
    pre: 'got a reply from',
    link: contact?.name ?? msg.from,
    href: `#/conversations/${thread.id}`,
    post: `· ${account?.name ?? ''}${cls.intent ? `, ${label}` : ''}${escalatedTo ? ` · handed to ${escalatedTo.name}` : ''}`,
    tag: 'reply',
  });

  if (!draft) return;
  try {
    const approval = await draftReply(ctx, db.get('threads', thread.id), msg, cls, contact, account);
    if (approval) {
      out.drafts++;
      const what = approval.kind === 'meeting' ? `prepared a meeting invite for ${formatLocal(approval.meeting.start, contact.timezone)}` : 'drafted a reply';
      db.update('threads', thread.id, (t) => ({ messages: [...t.messages, newEvent(`SDR tagged ${label} and ${what}`)] }));
    }
  } catch (err) {
    // The reply is saved; try the draft again shortly instead of losing it.
    ctx.emit('handle_reply', { threadId: thread.id }, { availableAt: Date.now() + 2 * 60_000, dedupeKey: `reply:${thread.id}` });
    db.update('threads', thread.id, (t) => ({ messages: [...t.messages, newEvent(`SDR tagged ${label} but could not draft a reply yet: ${err.message}`)] }));
    if (isHoldError(err)) throw err;
  }
}

async function handleReplyTask(ctx, task, out) {
  const { store: db } = ctx;
  const thread = db.get('threads', task.payload?.threadId);
  if (!thread || thread.owner || thread.status === 'closed') return;
  const last = lastMessage(thread);
  if (!last || last.direction !== 'in') return;
  const open = db.find('approvals', (a) => a.threadId === thread.id && ['pending', 'approved'].includes(a.status) && ['reply', 'meeting'].includes(a.kind));
  if (open) return;
  const contact = db.get('contacts', thread.contactId);
  const account = db.get('accounts', thread.accountId);
  const cls = await classify(ctx, thread, last, contact, account);
  // A thread handed back by a person is SDR's to answer, even if it once escalated.
  if (!['interested', 'question', 'referral'].includes(cls.intent)) return;
  if (cls.escalate && !task.payload?.handback) return;
  const approval = await draftReply(ctx, thread, last, { ...cls, escalate: false }, contact, account);
  if (approval) {
    out.drafts++;
    db.update('threads', thread.id, (t) => ({ status: 'us', intent: cls.intent, messages: [...t.messages, newEvent('SDR drafted a reply')] }));
  }
}

async function pollInbox(ctx, out) {
  const { store: db } = ctx;
  const threads = db.list('threads');
  if (!threads.length) return;
  const state = db.get('agents', 'sdr');
  const earliest = threads.reduce((min, t) => (t.startedAt < min ? t.startedAt : min), threads[0].startedAt);
  const since = state?.cursor ?? earliest;
  const pollStart = nowIso();
  const recent = Date.now() - 90 * 86_400_000;
  const threadIds = threads
    .filter((t) => t.externalThreadId && Date.parse(t.updatedAt ?? t.startedAt) >= recent)
    .map((t) => t.externalThreadId);

  ctx.progress(`Reading replies in ${ctx.settings.senderEmail || 'your inbox'}`);
  const res = await ctx.call('email.read', { since, threadIds });
  const messages = (res?.messages ?? []).slice().sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  for (const m of messages) await handleInbound(ctx, m, out);
  db.update('agents', 'sdr', { cursor: pollStart });
}

function summarize(out) {
  const parts = [];
  if (out.sent) parts.push(`${out.sent} sent`);
  if (out.replies) parts.push(`${out.replies} repl${out.replies === 1 ? 'y' : 'ies'} read`);
  if (out.drafts) parts.push(`${out.drafts} repl${out.drafts === 1 ? 'y' : 'ies'} drafted`);
  if (out.followUps) parts.push(`${out.followUps} follow-up${out.followUps === 1 ? '' : 's'} queued`);
  if (out.held) parts.push(out.capped ? `${out.held} held: daily cap reached` : `${out.held} held for the sending window`);
  return parts.join(', ') || 'No new replies';
}

export default {
  id: 'sdr',
  name: 'SDR',
  mono: 'SD',
  job: 'Sends approved outreach, reads replies, books meetings, escalates',
  consumes: ['send_outreach', 'handle_reply', 'follow_up'],
  produces: ['book_meeting', 'sync_crm', 'follow_up'],
  schedule: { type: 'cron', cron: '*/10 * * * *' },
  demoSchedule: { type: 'cron', cron: '*/2 * * * *' },
  wakeOnTasks: true,
  batch: 20,
  capabilities: [
    { key: 'email.send', required: true },
    { key: 'email.read', required: true },
    { key: 'calendar.availability', required: false },
    { key: 'calendar.book', required: false },
    { key: 'notify.post', required: false },
    { key: 'llm.complete', required: true },
  ],
  config: [
    { key: 'windowStart', label: 'Sending window starts', type: 'number', default: 8, min: 0, max: 23, suffix: ':00 their time' },
    { key: 'windowEnd', label: 'Sending window ends', type: 'number', default: 17, min: 1, max: 24, suffix: ':00 their time' },
    { key: 'dailyCap', label: 'Daily cap', type: 'number', default: 50, min: 1, suffix: 'emails' },
    { key: 'escalate', label: 'Escalate', type: 'text', default: 'Pricing over $50k, legal, security' },
  ],

  async run(ctx) {
    const out = { sent: 0, held: 0, capped: false, replies: 0, drafts: 0, followUps: 0 };
    const ofType = (type) =>
      ctx.tasks
        .filter((t) => t.type === type)
        .sort((a, b) => String(a.availableAt ?? a.createdAt).localeCompare(String(b.availableAt ?? b.createdAt)));
    const opts = { throwIfAllFail: false };

    const sends = await eachTask(ctx, ofType('send_outreach'), (t) => (t.payload?.manual ? sendManual(ctx, t, out) : sendApproval(ctx, t, out)), opts);
    await eachTask(ctx, ofType('follow_up'), (t) => followUp(ctx, t, out), opts);
    await eachTask(ctx, ofType('handle_reply'), (t) => handleReplyTask(ctx, t, out), opts);
    await pollInbox(ctx, out);

    // Surface a sending outage on the agent instead of hiding it behind a quiet summary.
    if (sends.error && !sends.ok) throw sends.error;
    return { summary: summarize(out) };
  },
};
