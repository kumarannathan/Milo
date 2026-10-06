import { newContact } from '../records.js';
import { eachTask, optionalCall, splitList, touchAccount } from '../util.js';

const STATUSES = new Set(['verified', 'likely', 'invalid', 'unknown']);

function statusFromConfidence(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return 'unknown';
  return c >= 90 ? 'likely' : 'unknown';
}

function breakdown(counts) {
  const parts = [];
  if (counts.verified) parts.push(`${counts.verified} verified`);
  if (counts.likely) parts.push(`${counts.likely} likely`);
  if (counts.unknown) parts.push(`${counts.unknown} unverified`);
  if (counts.invalid) parts.push(`${counts.invalid} invalid skipped`);
  if (counts.catchAll) parts.push(`${counts.catchAll} catch-all skipped`);
  if (counts.noEmail) parts.push(`${counts.noEmail} without an email`);
  return parts.join(', ');
}

async function prospect(ctx, account) {
  const { store, config } = ctx;
  const want = Number(config.contactsPerAccount) || 3;
  const existing = store.list('contacts', (c) => c.accountId === account.id);
  const known = new Set(existing.flatMap((c) => [c.email?.toLowerCase(), c.name?.toLowerCase()]).filter(Boolean));
  const room = Math.max(0, want - existing.filter((c) => c.stage !== 'skipped').length);

  ctx.progress(`Finding people at ${account.name}`);
  const result = room
    ? await ctx.call('contacts.search', {
        domain: account.domain,
        accountName: account.name,
        titles: splitList(ctx.settings.titles),
        seniorities: splitList(config.seniority),
        limit: want,
      })
    : { contacts: [] };

  const people = (result?.contacts ?? [])
    .filter((p) => p?.name && !known.has(p.name.toLowerCase()) && !(p.email && known.has(p.email.toLowerCase())))
    .slice(0, room);

  const counts = { verified: 0, likely: 0, unknown: 0, invalid: 0, catchAll: 0, noEmail: 0 };
  const candidates = [];
  for (let person of people) {
    if (ctx.has('contacts.enrich') && (!person.email || !person.linkedin || !person.location)) {
      const enriched = await optionalCall(ctx, 'contacts.enrich', { contact: person });
      if (enriched?.contact) person = { ...person, ...Object.fromEntries(Object.entries(enriched.contact).filter(([, v]) => v != null && v !== '')) };
    }
    let email = person.email ? String(person.email).trim().toLowerCase() : null;
    let status = STATUSES.has(person.emailStatus) ? person.emailStatus : null;
    if (!email && ctx.has('email.find')) {
      const [first, ...rest] = String(person.name).trim().split(/\s+/);
      ctx.progress(`Finding an email for ${person.name} at ${account.name}`);
      const found = await optionalCall(ctx, 'email.find', {
        domain: account.domain,
        firstName: person.firstName || first,
        lastName: person.lastName || rest.join(' '),
      });
      if (found?.email) {
        email = String(found.email).trim().toLowerCase();
        status = statusFromConfidence(found.confidence);
      }
    }
    if (!email || known.has(email)) {
      if (!email) counts.noEmail++;
      continue;
    }
    known.add(email);
    candidates.push({ person, email, status });
  }

  if (ctx.has('email.verify') && candidates.length) {
    ctx.progress(`Verifying ${candidates.length} email${candidates.length === 1 ? '' : 's'} at ${account.name}`);
    for (const c of candidates) {
      const verdict = await optionalCall(ctx, 'email.verify', { email: c.email });
      if (STATUSES.has(verdict?.status)) c.status = verdict.status;
    }
  }

  const usable = [];
  for (const { person, email, status: raw } of candidates) {
    const status = raw ?? 'unknown';
    let skipReason = null;
    if (status === 'invalid') skipReason = 'Email failed verification';
    else if (config.skipCatchAll && status === 'likely') skipReason = 'Catch-all domain';
    if (skipReason === 'Catch-all domain') counts.catchAll++;
    else counts[status]++;
    const contact = store.insert('contacts', newContact(person, account, { email, emailStatus: status, stage: skipReason ? 'skipped' : 'new', skipReason }));
    if (!skipReason) usable.push(contact);
  }

  const allUsable = store.list('contacts', (c) => c.accountId === account.id && !['skipped', 'unsubscribed'].includes(c.stage));
  if (allUsable.length) {
    ctx.emit('score_lead', { accountId: account.id, contactIds: allUsable.map((c) => c.id) }, { dedupeKey: `score:${account.id}` });
  } else {
    store.update('accounts', account.id, { decisionNote: 'No reachable contacts found yet.' });
  }

  const n = usable.length;
  const detail = breakdown(counts);
  touchAccount(store, account.id, 'prospector', n ? `Prospector found ${n} contact${n === 1 ? '' : 's'}` : 'Prospector found no reachable contacts');
  ctx.activity({
    pre: n ? `found ${n} contact${n === 1 ? '' : 's'} at` : 'found no reachable contacts at',
    link: account.name,
    href: `#/accounts/${account.id}`,
    post: detail ? `· ${detail}` : '',
    tag: 'contacts',
  });
  return n;
}

export default {
  id: 'prospector',
  name: 'Prospector',
  mono: 'Pr',
  job: 'Finds and verifies the right people at each account',
  consumes: ['find_contacts'],
  produces: ['score_lead'],
  schedule: { type: 'event' },
  batch: 5,
  capabilities: [
    { key: 'contacts.search', required: true },
    { key: 'contacts.enrich', required: false },
    { key: 'email.find', required: false },
    { key: 'email.verify', required: false },
  ],
  config: [
    { key: 'contactsPerAccount', label: 'Contacts per account', type: 'number', default: 3, min: 1, max: 10 },
    { key: 'seniority', label: 'Seniority', type: 'text', default: 'VP, Director, C-suite' },
    { key: 'skipCatchAll', label: 'Skip catch-all', type: 'boolean', default: false },
  ],

  async run(ctx) {
    let people = 0;
    let accounts = 0;
    const tasks = ctx.tasks.filter((t) => t.type === 'find_contacts');
    await eachTask(ctx, tasks, async (task) => {
      const account = ctx.store.get('accounts', task.payload?.accountId);
      if (!account || account.stage === 'disqualified') return;
      people += await prospect(ctx, account);
      accounts++;
    });
    if (!accounts) return { summary: 'No accounts to prospect' };
    return { summary: `${people} contact${people === 1 ? '' : 's'} at ${accounts} account${accounts === 1 ? '' : 's'}` };
  },
};
