// Sales development API routes and control-room stats.
import { createHash } from 'node:crypto';
import { HttpError, badRequest, notFound } from '../../http.js';
import { newAccount, newEvent } from './records.js';
import {
  ACCOUNT_STAGES,
  cancelTasks,
  icpFromSettings,
  icpMatch,
  lastMessage,
  normalizeDomain,
  ownerOf,
  snippetOf,
  startOfDay,
} from './util.js';

const THREAD_STATUSES = ['us', 'them', 'escalated', 'closed'];
const PIPELINE_TASKS = ['research_account', 'find_contacts', 'score_lead', 'write_outreach', 'follow_up'];

function requireSales(store) {
  const ws = store.getValue('workspace');
  if (!ws) throw new HttpError(409, 'Finish setup first.');
  if (ws.playbook !== 'sales') throw new HttpError(409, 'This workspace does not run Sales development.');
  return ws;
}

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Parse CSV text into rows of trimmed cells. Handles quotes, escaped quotes and CRLF. */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = !firstLine.includes(',') && firstLine.includes('\t') ? '\t' : !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

const COLUMNS = {
  name: ['name', 'company', 'company name', 'account', 'account name', 'organization'],
  domain: ['domain', 'website', 'url', 'company domain', 'web', 'site'],
  industry: ['industry', 'vertical'],
  employees: ['employees', 'employee count', 'headcount', 'size', '# employees', 'number of employees'],
  location: ['location', 'city', 'hq', 'headquarters', 'hq location'],
};

export function threadSummary(store, t) {
  const contact = store.get('contacts', t.contactId);
  const account = store.get('accounts', t.accountId);
  const msgs = t.messages.filter((m) => m.kind === 'msg');
  return {
    id: t.id,
    name: contact?.name ?? '',
    company: account?.name ?? '',
    accountId: t.accountId,
    contactId: t.contactId,
    subject: t.subject,
    snippet: snippetOf(msgs[msgs.length - 1]?.body ?? ''),
    intent: t.intent ?? null,
    status: t.status,
    owner: t.owner ?? null,
    updatedAt: t.updatedAt ?? t.startedAt,
    messageCount: msgs.length,
  };
}

function historyItem(a) {
  return {
    at: a.at,
    agentId: a.agentId,
    title: capitalize([a.pre, a.link].filter(Boolean).join(' ').trim()),
    sub: String(a.post ?? '').replace(/^·\s*/, ''),
    tag: a.tag,
  };
}

function rejectPending(store, predicate, reason) {
  for (const a of store.list('approvals', (a) => a.status === 'pending' && predicate(a))) {
    store.update('approvals', a.id, { status: 'rejected', rejectReason: reason, rejectTags: ['auto'], decidedAt: new Date().toISOString() });
    if (a.meetingId) store.update('meetings', a.meetingId, { status: 'cancelled' });
  }
}

export function registerSalesRoutes(router, { store, runner }) {
  const loadAccount = (id) => {
    const a = store.get('accounts', id);
    if (!a) throw notFound('No account with that id.');
    return a;
  };
  const loadThread = (id) => {
    const t = store.get('threads', id);
    if (!t) throw notFound('No conversation with that id.');
    return t;
  };

  // ── Accounts ─────────────────────────────────────────────────
  router.get('/api/accounts', ({ query }) => {
    requireSales(store);
    const q = String(query.q ?? '').trim().toLowerCase();
    const contactCount = new Map();
    for (const c of store.list('contacts')) contactCount.set(c.accountId, (contactCount.get(c.accountId) ?? 0) + 1);

    let rows = store.list('accounts');
    if (q) rows = rows.filter((a) => [a.name, a.domain, a.industry, a.location].some((v) => String(v ?? '').toLowerCase().includes(q)));
    const counts = { all: rows.length };
    for (const s of ACCOUNT_STAGES) counts[s] = rows.filter((a) => a.stage === s).length;

    const stage = query.stage && query.stage !== 'all' ? query.stage : null;
    if (stage && !ACCOUNT_STAGES.includes(stage)) throw badRequest('Unknown stage.');
    if (stage) rows = rows.filter((a) => a.stage === stage);

    const sort = query.sort ?? 'activity';
    const activityAt = (a) => a.lastActivity?.at ?? a.foundAt ?? a.createdAt ?? '';
    if (sort === 'score') rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || activityAt(b).localeCompare(activityAt(a)));
    else if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    else rows.sort((a, b) => activityAt(b).localeCompare(activityAt(a)));

    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const since = startOfDay().getTime();
    return {
      accounts: rows.slice(offset, offset + limit).map((a) => ({ ...a, contactCount: contactCount.get(a.id) ?? 0 })),
      total: rows.length,
      counts,
      foundToday: store.count('accounts', (a) => a.foundAt && Date.parse(a.foundAt) >= since),
    };
  });

  router.post('/api/accounts/import', ({ body }) => {
    const ws = requireSales(store);
    const rows = parseCsv(body.csv);
    if (rows.length < 2) throw badRequest('Paste a CSV with a header row and at least one company: name, domain, industry, employees, location.');
    const header = rows[0].map((h) => h.toLowerCase());
    const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
    if (col.name < 0 || col.domain < 0) throw badRequest('The CSV needs a name column and a domain column.');

    const icp = icpFromSettings(ws.settings);
    const existing = new Set(store.list('accounts').map((a) => a.domain));
    const at = new Date().toISOString();
    let imported = 0;
    let skipped = 0;
    for (const r of rows.slice(1)) {
      const cell = (k) => (col[k] >= 0 ? r[col[k]] ?? '' : '');
      const name = cell('name');
      const domain = normalizeDomain(cell('domain'));
      if (!name || !domain || !domain.includes('.') || existing.has(domain)) {
        skipped++;
        continue;
      }
      existing.add(domain);
      const rec = newAccount(
        { name, domain, industry: cell('industry') || null, employees: cell('employees'), location: cell('location') || null },
        { foundBy: 'import', foundVia: 'CSV' },
      );
      rec.icpMatch = icpMatch(rec, icp);
      rec.lastActivity = { agentId: null, text: 'Imported from CSV', at };
      const account = store.insert('accounts', rec);
      runner.enqueue('research_account', { accountId: account.id }, { dedupeKey: `research:${account.id}`, createdBy: 'user' });
      imported++;
    }
    return { imported, skipped };
  });

  router.get('/api/accounts/:id', ({ params }) => {
    requireSales(store);
    const account = loadAccount(params.id);
    const contacts = store.list('contacts', { accountId: account.id });
    const approvals = store.list('approvals', { accountId: account.id }).reverse();
    const threads = store
      .list('threads', { accountId: account.id })
      .map((t) => threadSummary(store, t))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const meetings = store.list('meetings', { accountId: account.id }).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const hrefs = new Set([
      `#/accounts/${account.id}`,
      ...approvals.map((a) => `#/approvals/${a.id}`),
      ...threads.map((t) => `#/conversations/${t.id}`),
    ]);
    const history = store
      .list('activity', (a) => a.href && hrefs.has(a.href))
      .slice(-30)
      .reverse()
      .map(historyItem);
    return { account: { ...account, contactCount: contacts.length }, contacts, approvals, threads, meetings, history };
  });

  router.post('/api/accounts/:id/disqualify', ({ params, body }) => {
    requireSales(store);
    const account = loadAccount(params.id);
    const reason = String(body.reason ?? '').trim() || 'Disqualified by you.';
    const at = new Date().toISOString();
    store.update('accounts', account.id, {
      stage: 'disqualified',
      decision: 'skip',
      disqualifiedReason: reason,
      lastActivity: { agentId: null, text: `Disqualified by you: ${reason}`, at },
    });
    cancelTasks(store, (t) => t.payload?.accountId === account.id && PIPELINE_TASKS.includes(t.type), 'Account disqualified');
    rejectPending(store, (a) => a.accountId === account.id, 'Not sent: account disqualified.');
    return { account: store.get('accounts', account.id) };
  });

  router.post('/api/accounts/:id/research', ({ params }) => {
    requireSales(store);
    const account = loadAccount(params.id);
    const task = runner.enqueue('research_account', { accountId: account.id, manual: true }, { dedupeKey: `research:${account.id}`, createdBy: 'user' });
    return { ok: true, taskId: task.id };
  });

  // ── Conversations ────────────────────────────────────────────
  router.get('/api/threads', ({ query }) => {
    requireSales(store);
    const status = query.status ?? 'all';
    if (status !== 'all' && !THREAD_STATUSES.includes(status)) throw badRequest('Unknown status.');
    const all = store
      .list('threads')
      .map((t) => threadSummary(store, t))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const counts = { all: all.length, us: 0, them: 0, escalated: 0, closed: 0 };
    for (const t of all) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return { threads: status === 'all' ? all : all.filter((t) => t.status === status), counts };
  });

  router.get('/api/threads/:id', ({ params }) => {
    requireSales(store);
    const thread = loadThread(params.id);
    return {
      thread,
      contact: store.get('contacts', thread.contactId),
      account: store.get('accounts', thread.accountId),
      meetings: store.list('meetings', { threadId: thread.id }),
    };
  });

  router.post('/api/threads/:id/reply', ({ params, body }) => {
    const ws = requireSales(store);
    const thread = loadThread(params.id);
    const text = String(body.body ?? '').trim();
    if (!text) throw badRequest('Write a reply first.');
    const contact = store.get('contacts', thread.contactId);
    if (!contact?.email) throw badRequest('This contact has no email address.');
    if (contact.stage === 'unsubscribed') throw new HttpError(409, `${contact.name} unsubscribed. Milo will not email them again.`);

    // Whoever writes the reply owns the thread; anything SDR drafted is now stale.
    rejectPending(store, (a) => a.threadId === thread.id && ['reply', 'meeting'].includes(a.kind), 'Not sent: you replied yourself.');
    cancelTasks(store, (t) => t.type === 'handle_reply' && t.payload?.threadId === thread.id, 'You replied yourself');
    store.update('threads', thread.id, { owner: thread.owner ?? ownerOf(ws) });
    const hash = createHash('sha1').update(text).digest('hex').slice(0, 12);
    runner.enqueue('send_outreach', { threadId: thread.id, body: text, manual: true }, { dedupeKey: `manual:${thread.id}:${hash}`, createdBy: 'user' });
    return { ok: true };
  });

  router.post('/api/threads/:id/take', ({ params }) => {
    const ws = requireSales(store);
    const thread = loadThread(params.id);
    const owner = ownerOf(ws);
    rejectPending(store, (a) => (a.threadId === thread.id && ['reply', 'meeting'].includes(a.kind)) || (a.contactId === thread.contactId && a.kind === 'follow_up'), 'Not sent: you took over this thread.');
    cancelTasks(store, (t) => (t.type === 'handle_reply' && t.payload?.threadId === thread.id) || (['follow_up', 'write_outreach'].includes(t.type) && t.payload?.contactId === thread.contactId), 'You took over this thread');
    const waitingOnUs = lastMessage(thread)?.direction === 'in';
    const updated = store.update('threads', thread.id, (t) => ({
      owner,
      status: ['closed', 'escalated'].includes(t.status) ? t.status : waitingOnUs ? 'us' : 'them',
      messages: [...t.messages, newEvent(`${owner.name} took over the thread`, { agentId: null })],
    }));
    return { thread: updated };
  });

  router.post('/api/threads/:id/handback', ({ params }) => {
    const ws = requireSales(store);
    const thread = loadThread(params.id);
    const status = thread.status === 'closed' ? 'closed' : lastMessage(thread)?.direction === 'in' ? 'us' : 'them';
    const updated = store.update('threads', thread.id, (t) => ({
      owner: null,
      status,
      escalation: null,
      messages: [...t.messages, newEvent(`${ownerOf(ws).name} handed the thread back to SDR`, { agentId: null })],
    }));
    if (status === 'us') {
      runner.enqueue('handle_reply', { threadId: thread.id, handback: true }, { dedupeKey: `reply:${thread.id}`, createdBy: 'user' });
    }
    return { thread: updated };
  });

  router.post('/api/threads/:id/close', ({ params }) => {
    const ws = requireSales(store);
    const thread = loadThread(params.id);
    rejectPending(store, (a) => a.threadId === thread.id || (a.contactId === thread.contactId && a.kind === 'follow_up'), 'Not sent: conversation closed.');
    cancelTasks(store, (t) => (t.type === 'handle_reply' && t.payload?.threadId === thread.id) || (['follow_up', 'write_outreach'].includes(t.type) && t.payload?.contactId === thread.contactId), 'Conversation closed');
    const updated = store.update('threads', thread.id, (t) => ({
      status: 'closed',
      messages: [...t.messages, newEvent(`${ownerOf(ws).name} closed the thread`, { agentId: null })],
    }));
    return { thread: updated };
  });

  // ── Meetings ─────────────────────────────────────────────────
  router.get('/api/meetings', ({ query }) => {
    requireSales(store);
    let rows = store.list('meetings');
    if (query.upcoming === '1' || query.upcoming === 'true') {
      const now = Date.now();
      rows = rows.filter((m) => ['proposed', 'booked'].includes(m.status) && Date.parse(m.start) + (m.durationMin ?? 30) * 60_000 >= now);
    }
    rows.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    return {
      meetings: rows.map((m) => {
        const contact = store.get('contacts', m.contactId);
        const account = store.get('accounts', m.accountId);
        return {
          ...m,
          contact: contact ? { name: contact.name, title: contact.title } : null,
          account: account ? { id: account.id, name: account.name } : null,
        };
      }),
    };
  });
}

// ── Control-room stats ─────────────────────────────────────────

const TILES = [
  ['found', 'Accounts found', (d) => d.accounts.map((a) => a.foundAt)],
  ['researched', 'Researched', (d) => d.accounts.map((a) => a.brief?.at)],
  ['qualified', 'Qualified', (d) => d.accounts.filter((a) => a.decision === 'outreach').map((a) => a.scoredAt)],
  ['contacts', 'Contacts found', (d) => d.contacts.map((c) => c.createdAt)],
  ['drafts', 'Drafts written', (d) => d.approvals.map((a) => a.createdAt)],
  ['sent', 'Sent', (d) => d.messages.filter((m) => m.direction === 'out').map((m) => m.at)],
  ['replies', 'Replies', (d) => d.messages.filter((m) => m.direction === 'in').map((m) => m.at)],
  ['meetings', 'Meetings booked', (d) => d.meetings.filter((m) => m.status === 'booked').map((m) => m.bookedAt ?? m.createdAt)],
];

export function salesStats(store) {
  const today = startOfDay();
  const bounds = [];
  for (let i = 6; i >= -1; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    bounds.push(d.getTime());
  }
  const bucket = (times) => {
    const bars = Array(7).fill(0);
    for (const iso of times) {
      const t = Date.parse(iso ?? '');
      if (!Number.isFinite(t) || t < bounds[0] || t >= bounds[7]) continue;
      for (let i = 0; i < 7; i++) {
        if (t < bounds[i + 1]) {
          bars[i]++;
          break;
        }
      }
    }
    return bars;
  };

  const data = {
    accounts: store.list('accounts'),
    contacts: store.list('contacts'),
    approvals: store.list('approvals'),
    meetings: store.list('meetings'),
    messages: store.list('threads').flatMap((t) => t.messages.filter((m) => m.kind === 'msg')),
  };

  return TILES.map(([key, label, pickTimes], i) => {
    const bars = bucket(pickTimes(data));
    const diff = bars[6] - bars[5];
    let delta;
    if (diff === 0) delta = i === 0 ? 'same as yesterday' : 'same';
    else delta = `${diff > 0 ? '+' : '−'}${Math.abs(diff)}${i === 0 ? ' vs yesterday' : ''}`;
    return { key, label, value: bars[6], delta, bars };
  });
}
