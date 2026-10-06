// Sales development playbook: helpers, routes and the full demo pipeline.
// Demo calls run ~200x faster and every first email gets an "interested" reply,
// so the whole flow (find -> brief -> contacts -> score -> draft -> send -> reply -> meeting)
// finishes in a few seconds.
process.env.MILO_DEMO_FAST = '1';
process.env.MILO_DEMO_REPLY_RATE = '1';
process.env.MILO_DEMO_REPLY_INTENT = 'interested';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { inWindow, nextSendTime, timezoneFor, zonedParts } from '../server/playbooks/sales/timezones.js';
import { parseCsv, salesStats } from '../server/playbooks/sales/routes.js';
import { escalationRule } from '../server/playbooks/sales/agents/sdr.js';
import { scoreLead } from '../server/playbooks/sales/agents/qualifier.js';
import { icpFromSettings, icpMatch } from '../server/playbooks/sales/util.js';
import { salesDemoState } from '../server/providers/demo/sales.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startApp(setup) {
  const app = await createApp({ dataDir: null, staticDir: null, log: { error() {}, warn() {}, log() {} } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const ok = async (method, path, body) => {
    const res = await api(method, path, body);
    assert.ok(res.status < 300, `${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  await ok('POST', '/api/setup', setup);
  return { app, api, ok };
}

/** Tick the runner until `check()` returns something truthy. `sdr` also asks SDR to poll the inbox. */
async function drive(app, check, { timeout = 60_000, sdr = false, label = 'condition' } = {}) {
  const until = Date.now() + timeout;
  let i = 0;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    if (sdr && i % 8 === 0 && !app.runner.isRunning('sdr')) app.runner.requestRun('sdr');
    app.runner.tick();
    await sleep(25);
    i++;
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// ── Helpers ─────────────────────────────────────────────────────

test('timezoneFor infers zones from free-text locations', () => {
  assert.equal(timezoneFor('Detroit, MI'), 'America/Detroit');
  assert.equal(timezoneFor('Denver, Colorado, United States'), 'America/Denver');
  assert.equal(timezoneFor('Knoxville, TN'), 'America/New_York');
  assert.equal(timezoneFor('Portland, OR'), 'America/Los_Angeles');
  assert.equal(timezoneFor('London, UK'), 'Europe/London');
  assert.equal(timezoneFor(''), 'America/New_York');
  assert.equal(timezoneFor('Somewhere'), 'America/New_York');
});

test('nextSendTime lands inside the window in the contact time zone', () => {
  const tz = 'America/Denver';
  // Saturday Oct 3 2026, noon in Denver -> Monday 8:00 local.
  const saturday = new Date('2026-10-03T18:00:00Z');
  const monday = nextSendTime(tz, 8, 17, saturday);
  const p = zonedParts(monday, tz);
  assert.deepEqual([p.weekday, p.hour, p.minute], [1, 8, 0]);

  // Inside the window: send now.
  const tuesdayMorning = new Date('2026-10-06T16:30:00Z'); // 10:30 MDT
  assert.equal(nextSendTime(tz, 8, 17, tuesdayMorning).getTime(), tuesdayMorning.getTime());

  // After hours on a weekday: next morning, with jitter.
  const evening = new Date('2026-10-07T02:00:00Z'); // Tue 20:00 MDT
  const next = nextSendTime(tz, 8, 17, evening, { jitterMin: 20 });
  const q = zonedParts(next, tz);
  assert.deepEqual([q.weekday, q.hour, q.minute], [3, 8, 20]);
  assert.ok(inWindow(tz, 8, 17, next));
});

test('parseCsv handles quotes, commas and CRLF', () => {
  const rows = parseCsv('Name,Domain,Employees\r\n"Acme, Inc.",acme.com,"1,200"\r\n"Say ""hi"" Co",hi.co,40\r\n');
  assert.deepEqual(rows, [['Name', 'Domain', 'Employees'], ['Acme, Inc.', 'acme.com', '1,200'], ['Say "hi" Co', 'hi.co', '40']]);
});

test('escalation rules follow the SDR config', () => {
  const rules = 'Pricing over $50k, legal, security';
  assert.equal(escalationRule('Can you send your BAA and SOC 2 report?', rules), 'security question');
  assert.equal(escalationRule('Our legal team will need to review the MSA.', rules), 'legal question');
  assert.equal(escalationRule('We were budgeting about $120k for this.', rules), 'large pricing question');
  assert.equal(escalationRule('What does this cost for a group our size?', rules), null);
  assert.equal(escalationRule('Can you send your BAA?', 'Pricing over $50k'), null);
});

test('lead score is the weighted sum of the five parts', () => {
  const contacts = [
    { id: 'c1', title: 'VP Revenue Cycle', emailStatus: 'verified' },
    { id: 'c2', title: 'CFO', emailStatus: 'likely' },
  ];
  const { best, scored } = scoreLead(
    {
      scores: { icp_fit: 95, company_growth: 88, buying_signal: 90 },
      contacts: [{ id: 'c1', role_relevance: 96, contact_quality: 85 }, { id: 'c2', role_relevance: 80, contact_quality: 80 }],
      bestContactId: 'c1',
    },
    contacts,
  );
  assert.equal(best.contact.id, 'c1');
  // 95*.3 + 88*.15 + 96*.25 + 90*.2 + 85*.1 = 92.2
  assert.equal(best.total, 92);
  assert.deepEqual(best.breakdown.map((p) => p.key), ['icp_fit', 'company_growth', 'role_relevance', 'buying_signal', 'contact_quality']);
  assert.equal(scored.length, 2);
  assert.throws(() => scoreLead({ nothing: true }, contacts), /did not return lead scores/);
});

test('icpMatch rewards industry, size and location fit', () => {
  const icp = icpFromSettings({ industries: 'Hospitals, physician groups', employeesMin: 300, employeesMax: 5000, locations: 'United States' });
  const good = icpMatch({ industry: 'Physician group', employees: 1200, location: 'Detroit, MI', domain: 'x.org' }, icp);
  const poor = icpMatch({ industry: 'Software', employees: 40, location: 'Berlin, Germany', domain: 'y.de' }, icp);
  assert.ok(good >= 85, `good fit scored ${good}`);
  assert.ok(poor < 40, `poor fit scored ${poor}`);
});

test('salesStats returns eight tiles with seven daily bars', () => {
  const store = createStore({ dir: null });
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  store.insert('accounts', { name: 'A', foundAt: now.toISOString() });
  store.insert('accounts', { name: 'B', foundAt: yesterday.toISOString() });
  store.insert('accounts', { name: 'C', foundAt: yesterday.toISOString() });
  store.insert('accounts', { name: 'D', foundAt: yesterday.toISOString() });
  const tiles = salesStats(store);
  assert.deepEqual(tiles.map((t) => t.key), ['found', 'researched', 'qualified', 'contacts', 'drafts', 'sent', 'replies', 'meetings']);
  assert.equal(tiles[0].label, 'Accounts found');
  assert.equal(tiles[0].value, 1);
  assert.equal(tiles[0].delta, '−2 vs yesterday');
  assert.equal(tiles[0].bars.length, 7);
  assert.equal(tiles[0].bars[5], 3);
  assert.equal(tiles[1].delta, 'same');
});

// ── Full pipeline on sample data ───────────────────────────────

test('demo pipeline: find, research, score, draft, approve, send, reply, meeting', async () => {
  const { app, api, ok } = await startApp({ playbook: 'sales', demo: true });
  try {
    const store = app.store;

    // Scout -> Researcher -> Prospector -> Qualifier -> Personalizer
    await drive(app, () => store.count('approvals', { status: 'pending' }) >= 3, { label: 'pending drafts' });

    const scoutRun = store.find('runs', (r) => r.agentId === 'scout' && r.status === 'ok');
    assert.match(scoutRun.summary, /accounts? found/);

    const accounts = await ok('GET', '/api/accounts?sort=score');
    assert.ok(accounts.total >= 3);
    assert.deepEqual(Object.keys(accounts.counts).sort(), ['all', 'disqualified', 'engaged', 'found', 'in_outreach', 'meeting', 'qualified', 'researched'].sort());
    assert.ok(accounts.foundToday >= accounts.total);
    const top = accounts.accounts[0];
    assert.ok(top.score >= 91, 'sorted by score');
    for (const key of ['id', 'name', 'domain', 'industry', 'employees', 'location', 'icpMatch', 'stage', 'brief', 'signals', 'foundBy', 'foundVia', 'lastActivity', 'contactCount', 'scoreBreakdown']) {
      assert.ok(key in top, `account has ${key}`);
    }
    assert.equal(top.foundVia, 'Sample data');
    assert.ok(top.brief.summary && top.brief.angles.length && top.brief.sources.length);
    assert.equal(top.scoreBreakdown.length, 5);

    const filtered = await ok('GET', '/api/accounts?stage=in_outreach&q=a&limit=2');
    assert.ok(filtered.accounts.length <= 2);
    assert.ok(filtered.accounts.every((a) => a.stage === 'in_outreach'));

    const detail = await ok('GET', `/api/accounts/${top.id}`);
    for (const key of ['account', 'contacts', 'approvals', 'threads', 'meetings', 'history']) assert.ok(key in detail, `detail has ${key}`);
    assert.ok(detail.contacts.length >= 1);
    assert.ok(detail.contacts.every((c) => c.timezone && c.emailStatus));
    assert.ok(detail.history.length >= 3);
    assert.deepEqual(Object.keys(detail.history[0]).sort(), ['agentId', 'at', 'sub', 'tag', 'title']);

    // Approvals come enriched for the review screen.
    const queue = await ok('GET', '/api/approvals');
    assert.ok(queue.approvals.length >= 3);
    const [first, second] = queue.approvals;
    assert.equal(first.kind, 'first_touch');
    assert.ok(first.contact.name && first.contact.initials && first.contact.timezone);
    assert.ok(first.account.id && first.account.name);
    assert.ok(first.score >= 91);
    assert.equal(first.from.email, 'sales@ledgerline.io');
    assert.ok(first.facts.length && first.angle && first.wordCount > 20);
    assert.ok(!/!/.test(first.body), 'no exclamation marks');

    // Reject with a note: the note is kept for the Personalizer and the contact goes back to scored.
    await ok('POST', `/api/approvals/${second.id}/reject`, { reason: 'Too long, lead with the hiring signal', tags: ['too long'] });
    assert.equal(store.get('contacts', second.contactId).stage, 'scored');
    const note = store.find('notes', (n) => n.approvalId === second.id);
    assert.equal(note.kind, 'rejection');
    assert.equal(note.agentId, 'personalizer');

    // Approve one: SDR sends it and opens a thread.
    await ok('POST', `/api/approvals/${first.id}/approve`);
    const again = await api('POST', `/api/approvals/${first.id}/approve`);
    assert.equal(again.status, 409, 'cannot approve twice');
    const sent = await drive(app, () => (store.get('approvals', first.id).status === 'sent' ? store.get('approvals', first.id) : null), { label: 'send' });
    const thread = store.get('threads', sent.threadId);
    assert.ok(thread, 'thread created');
    assert.equal(thread.messages[0].direction, 'out');
    assert.equal(thread.messages[0].by, 'sent by SDR · approved by you');
    assert.equal(store.get('contacts', first.contactId).stage, 'contacted');
    assert.equal(store.get('contacts', first.contactId).sequenceStep, 1);
    assert.ok(store.find('tasks', (t) => t.type === 'follow_up' && t.payload.contactId === first.contactId), 'follow-up scheduled');

    const threads = await ok('GET', '/api/threads?status=all');
    assert.deepEqual(Object.keys(threads.counts).sort(), ['all', 'closed', 'escalated', 'them', 'us']);
    const summary = threads.threads.find((t) => t.id === thread.id);
    for (const key of ['id', 'name', 'company', 'accountId', 'contactId', 'snippet', 'intent', 'status', 'owner', 'updatedAt', 'messageCount']) {
      assert.ok(key in summary, `thread summary has ${key}`);
    }
    assert.equal(summary.status, 'them');

    // The prospect answers; SDR tags it and drafts a reply with times from the calendar.
    const reply = await drive(
      app,
      () => store.find('approvals', (a) => a.threadId === thread.id && a.kind === 'reply' && a.status === 'pending'),
      { sdr: true, label: 'reply draft' },
    );
    const t1 = store.get('threads', thread.id);
    assert.equal(t1.intent, 'interested');
    assert.equal(t1.status, 'us');
    assert.ok(t1.messages.some((m) => m.direction === 'in'));
    assert.ok(t1.offeredSlots.length >= 1, 'times offered');
    assert.equal(store.get('accounts', sent.accountId).stage, 'engaged');
    assert.equal(store.get('contacts', first.contactId).stage, 'replied');
    assert.ok(!store.find('tasks', (t) => t.type === 'follow_up' && t.payload.contactId === first.contactId && t.status === 'queued'), 'sequence stopped');

    // Approve the reply; they pick a time; SDR prepares the invite; approving it books the meeting.
    await ok('POST', `/api/approvals/${reply.id}/approve`);
    const invite = await drive(
      app,
      () => store.find('approvals', (a) => a.threadId === thread.id && a.kind === 'meeting' && a.status === 'pending'),
      { sdr: true, label: 'meeting invite' },
    );
    assert.ok(invite.meeting.start && invite.meeting.durationMin === 30);
    assert.equal(store.get('meetings', invite.meetingId).status, 'proposed');
    await ok('POST', `/api/approvals/${invite.id}/approve`);
    await drive(app, () => store.get('meetings', invite.meetingId).status === 'booked', { label: 'booking' });
    assert.equal(store.get('accounts', sent.accountId).stage, 'meeting');
    assert.equal(store.get('contacts', first.contactId).stage, 'meeting');

    const meetings = await ok('GET', '/api/meetings?upcoming=1');
    const booked = meetings.meetings.find((m) => m.id === invite.meetingId);
    assert.ok(booked.link && booked.contact.name && booked.account.name);

    const threadDetail = await ok('GET', `/api/threads/${thread.id}`);
    assert.ok(threadDetail.thread && threadDetail.contact && threadDetail.account);
    assert.equal(threadDetail.meetings.length, 1);
    assert.ok(threadDetail.thread.messages.some((m) => m.kind === 'meeting'));
    assert.ok(threadDetail.thread.messages.some((m) => m.kind === 'event'));

    // Users can take a thread, reply themselves, hand it back and close it.
    const taken = await ok('POST', `/api/threads/${thread.id}/take`);
    assert.equal(taken.thread.owner.name, 'Jordan Reyes');
    await ok('POST', `/api/threads/${thread.id}/reply`, { body: 'Looking forward to it. I will send a short agenda the day before.' });
    await drive(app, () => store.get('threads', thread.id).messages.some((m) => m.by === 'sent by you'), { label: 'manual reply' });
    const back = await ok('POST', `/api/threads/${thread.id}/handback`);
    assert.equal(back.thread.owner, null);
    const closed = await ok('POST', `/api/threads/${thread.id}/close`);
    assert.equal(closed.thread.status, 'closed');

    // Nothing was sent twice: every outbound message in the mailbox matches one we recorded.
    const outbound = store.list('threads').flatMap((t) => t.messages.filter((m) => m.kind === 'msg' && m.direction === 'out'));
    const ids = outbound.map((m) => m.externalId);
    assert.equal(new Set(ids).size, ids.length);
    const demoSent = salesDemoState().sent.filter((m) => ids.includes(m.messageId));
    assert.equal(demoSent.length, ids.length);

    // CRM Agent keeps HubSpot-style ids on the account.
    await drive(app, () => store.get('accounts', sent.accountId).crm?.activitiesLogged >= 1, { label: 'crm sync' });
    assert.equal(store.get('accounts', sent.accountId).crm.system, 'Sample CRM');

    const stats = await ok('GET', '/api/stats');
    assert.equal(stats.stats.length, 8);
    assert.ok(stats.stats.find((t) => t.key === 'meetings').value >= 1);
    assert.ok(stats.stats.find((t) => t.key === 'sent').value >= 3);
  } finally {
    await app.close();
  }
});

test('accounts: CSV import, manual research and disqualify', async () => {
  const { app, api, ok } = await startApp({ playbook: 'sales', demo: true });
  try {
    const store = app.store;
    await drive(app, () => !app.runner.isRunning('scout') && store.count('accounts') > 0, { label: 'scout' });

    const csv = [
      'Company Name,Website,Industry,Employees,Location',
      'Harbor Lane Clinics,https://www.harborlane.health/,Physician group,"1,100","Tampa, FL"',
      'Acme Health,acmehealth.org,Hospital,1200,"Detroit, MI"',
      'No Domain Co,,Clinic,300,"Austin, TX"',
    ].join('\n');
    const imported = await ok('POST', '/api/accounts/import', { csv });
    assert.deepEqual(imported, { imported: 1, skipped: 2 });
    const harbor = store.find('accounts', (a) => a.domain === 'harborlane.health');
    assert.equal(harbor.foundBy, 'import');
    assert.equal(harbor.foundVia, 'CSV');
    assert.equal(harbor.employees, 1100);
    assert.ok(harbor.icpMatch > 0);
    assert.ok(store.find('tasks', (t) => t.type === 'research_account' && t.payload.accountId === harbor.id));

    const bad = await api('POST', '/api/accounts/import', { csv: 'foo,bar\n1,2' });
    assert.equal(bad.status, 400);

    // Imported accounts flow through research like any other.
    await drive(app, () => store.get('accounts', harbor.id).brief, { label: 'brief for import' });

    const research = await ok('POST', `/api/accounts/${harbor.id}/research`);
    assert.ok(research.ok && research.taskId);

    const dq = await ok('POST', `/api/accounts/${harbor.id}/disqualify`, { reason: 'Existing vendor contract through 2028' });
    assert.equal(dq.account.stage, 'disqualified');
    assert.equal(dq.account.disqualifiedReason, 'Existing vendor contract through 2028');
    assert.ok(!store.find('tasks', (t) => t.payload?.accountId === harbor.id && t.status === 'queued'), 'queued work cancelled');
    assert.equal((await api('GET', '/api/accounts/acc_nope')).status, 404);
  } finally {
    await app.close();
  }
});

test('autopilot sends without review', async () => {
  const { app } = await startApp({ playbook: 'sales', demo: true, autonomy: 'autopilot' });
  try {
    const store = app.store;
    const sent = await drive(app, () => store.find('approvals', (a) => a.status === 'sent'), { sdr: true, label: 'autopilot send' });
    assert.equal(sent.autoApproved, true);
    assert.equal(store.count('approvals', { status: 'pending' }), 0);
    const thread = store.get('threads', sent.threadId);
    assert.equal(thread.messages[0].by, 'sent by SDR');
  } finally {
    await app.close();
  }
});

test('outside sample data, cold emails wait for the sending window in the contact time zone', async () => {
  const { app } = await startApp({
    playbook: 'sales',
    demo: false,
    settings: { company: 'Ledgerline', product: 'Prior-auth automation. We take over prior-auth submissions and payer follow-up.', senderName: 'Jordan Reyes', senderEmail: 'jordan@ledgerline.io', employeesMin: 300, employeesMax: 5000, locations: 'United States' },
    connections: [{ provider: 'demo', label: 'Sample data' }],
  });
  try {
    const store = app.store;
    app.runner.requestRun('scout');
    const draft = await drive(app, () => store.find('approvals', (a) => a.kind === 'first_touch'), { label: 'draft' });
    const contact = store.get('contacts', draft.contactId);
    assert.ok(inWindow(contact.timezone, 8, 17, new Date(draft.sendAt)), `sendAt ${draft.sendAt} inside 8-17 ${contact.timezone}`);
    assert.ok(Date.parse(draft.sendAt) >= Date.parse(draft.createdAt) - 1000);
  } finally {
    await app.close();
  }
});
