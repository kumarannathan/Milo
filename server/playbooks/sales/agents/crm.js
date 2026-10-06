import { eachTask, optionalCall, providerName, touchAccount } from '../util.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function ensureCompany(ctx, account, totals) {
  if (account.crm?.companyId) return { id: account.crm.companyId, url: account.crm.url ?? null };
  const found = await optionalCall(ctx, 'crm.read', { domain: account.domain });
  if (found?.company?.id) return { id: found.company.id, url: found.company.url ?? null };
  if (!ctx.config.createCompanies) return { id: null, url: null };
  const res = await ctx.call('crm.write', {
    op: 'upsert_company',
    company: {
      name: account.name,
      domain: account.domain,
      industry: account.industry,
      employees: account.employees,
      location: account.location,
      linkedin: account.linkedin,
      revenue: account.revenue,
      description: account.description,
    },
  });
  totals.companies++;
  return { id: res?.id ?? null, url: res?.url ?? null };
}

async function ensureContact(ctx, contact, companyId, totals) {
  if (contact.crmId) return contact.crmId;
  const found = await optionalCall(ctx, 'crm.read', { email: contact.email });
  let id = found?.contact?.id ?? null;
  if (!id) {
    const res = await ctx.call('crm.write', {
      op: 'upsert_contact',
      companyId,
      contact: {
        name: contact.name,
        firstName: contact.firstName,
        lastName: contact.lastName,
        title: contact.title,
        email: contact.email,
        linkedin: contact.linkedin,
        location: contact.location,
      },
    });
    id = res?.id ?? null;
    totals.contacts++;
  }
  if (id) ctx.store.update('contacts', contact.id, { crmId: id });
  return id;
}

async function logEmail(ctx, { companyId, contactId, email }) {
  const asNote = ctx.config.logEmailsAs === 'notes';
  await ctx.call('crm.write', asNote
    ? { op: 'note', companyId, contactId, note: `${email.direction === 'inbound' ? `Reply from ${email.from}` : `Email to ${email.to}`}\nSubject: ${email.subject}\n\n${email.body}` }
    : { op: 'log_email', companyId, contactId, email });
}

async function sync(ctx, payload, totals, system) {
  const { store, settings } = ctx;
  const account = store.get('accounts', payload.accountId);
  if (!account) return;
  ctx.progress(`Syncing ${account.name} to ${system}`);

  const company = await ensureCompany(ctx, account, totals);
  const contacts = payload.contactId
    ? [store.get('contacts', payload.contactId)].filter(Boolean)
    : store.list('contacts', (c) => c.accountId === account.id && !['skipped', 'unsubscribed'].includes(c.stage));
  const ids = new Map();
  for (const c of contacts) if (c.email) ids.set(c.id, await ensureContact(ctx, c, company.id, totals));

  let logged = 0;
  const approval = payload.approvalId ? store.get('approvals', payload.approvalId) : null;
  if (approval?.status === 'sent' && !approval.crmLogged) {
    const contact = store.get('contacts', approval.contactId);
    await logEmail(ctx, {
      companyId: company.id,
      contactId: ids.get(approval.contactId) ?? contact?.crmId ?? null,
      email: { direction: 'outbound', subject: approval.subject, body: approval.body, from: settings.senderEmail, to: contact?.email, at: approval.sentAt },
    });
    store.update('approvals', approval.id, { crmLogged: true });
    logged++;
  }

  const thread = payload.threadId ? store.get('threads', payload.threadId) : null;
  const message = thread?.messages.find((m) => m.id === payload.messageId);
  if (message && !message.crmLogged) {
    const contact = store.get('contacts', thread.contactId);
    await logEmail(ctx, {
      companyId: company.id,
      contactId: ids.get(thread.contactId) ?? contact?.crmId ?? null,
      email: {
        direction: message.direction === 'in' ? 'inbound' : 'outbound',
        subject: thread.subject,
        body: message.body,
        from: message.direction === 'in' ? message.fromEmail : settings.senderEmail,
        to: message.direction === 'in' ? settings.senderEmail : contact?.email,
        at: message.at,
      },
    });
    store.update('threads', thread.id, (t) => ({ messages: t.messages.map((m) => (m.id === message.id ? { ...m, crmLogged: true } : m)) }));
    logged++;
  }

  const meeting = payload.meetingId ? store.get('meetings', payload.meetingId) : null;
  if (meeting?.status === 'booked' && !meeting.crmLogged) {
    const contact = store.get('contacts', meeting.contactId);
    await ctx.call('crm.write', {
      op: 'note',
      companyId: company.id,
      contactId: contact?.crmId ?? null,
      note: `Meeting booked: ${meeting.title}, ${meeting.start}${meeting.link ? `\n${meeting.link}` : ''}`,
    });
    store.update('meetings', meeting.id, { crmLogged: true });
    logged++;
  }
  totals.activities += logged;

  const fresh = store.get('accounts', account.id);
  store.update('accounts', account.id, {
    crm: {
      system,
      companyId: company.id,
      url: company.url,
      syncedAt: new Date().toISOString(),
      contactsSynced: store.count('contacts', (c) => c.accountId === account.id && c.crmId),
      activitiesLogged: (fresh.crm?.activitiesLogged ?? 0) + logged,
    },
  });
  touchAccount(store, account.id, 'crm', `CRM Agent synced to ${system}`);
}

export default {
  id: 'crm',
  name: 'CRM Agent',
  mono: 'CR',
  job: 'Keeps your CRM in sync with everything the team does',
  consumes: ['sync_crm'],
  produces: [],
  schedule: { type: 'event' },
  batch: 20,
  capabilities: [
    { key: 'crm.write', required: true },
    { key: 'crm.read', required: false },
  ],
  config: [
    { key: 'createCompanies', label: 'Create companies', type: 'boolean', default: true },
    { key: 'logEmailsAs', label: 'Log emails as', type: 'select', default: 'activities', options: [{ value: 'activities', label: 'Activities' }, { value: 'notes', label: 'Notes' }] },
  ],

  async run(ctx) {
    const conn = ctx.connection('crm.write');
    const system = conn?.provider === 'demo' ? 'Sample CRM' : providerName(conn) ?? 'your CRM';
    const totals = { companies: 0, contacts: 0, activities: 0 };
    const tasks = ctx.tasks.filter((t) => t.type === 'sync_crm');
    await eachTask(ctx, tasks, (task) => sync(ctx, task.payload ?? {}, totals, system));

    const records = totals.companies + totals.contacts + totals.activities;
    if (!records) return { summary: 'CRM already up to date' };
    const detail = [
      totals.companies && plural(totals.companies, 'company').replace('companys', 'companies'),
      totals.contacts && plural(totals.contacts, 'contact'),
      totals.activities && plural(totals.activities, 'activity').replace('activitys', 'activities'),
    ].filter(Boolean);
    ctx.activity({
      pre: `synced ${plural(records, 'record')} to`,
      link: system,
      href: '#/connections',
      post: `· ${detail.join(', ')}`,
      tag: 'crm',
    });
    return { summary: `${plural(records, 'record')} synced` };
  },
};
