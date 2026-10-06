import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { describeCron, isValidCron, nextCronDate } from '../server/lib/cron.js';
import { createStore } from '../server/store.js';
import { parseJsonLoose } from '../server/runner/context.js';

async function start() {
  const app = await createApp({ dataDir: null, staticDir: null, log: { error() {} } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return { app, call };
}

test('cron: next run and labels', () => {
  const from = new Date(2026, 9, 6, 14, 47, 30);
  assert.equal(nextCronDate('*/10 * * * *', from).getMinutes(), 50);
  const fourHourly = nextCronDate('0 */4 * * *', from);
  assert.equal(fourHourly.getHours(), 16);
  assert.equal(fourHourly.getMinutes(), 0);
  const weekday = nextCronDate('0 9 * * 1-5', new Date(2026, 9, 10, 12, 0)); // Saturday
  assert.equal(weekday.getDay(), 1);
  assert.equal(describeCron('*/10 * * * *'), 'Every 10 minutes');
  assert.equal(describeCron('0 */4 * * *'), 'Every 4 hours');
  assert.ok(isValidCron('5,35 8-17 * * 1-5'));
  assert.ok(!isValidCron('61 * * * *'));
  assert.ok(!isValidCron('* * *'));
});

test('store: insert, update, retention and change topics', async () => {
  const topics = [];
  const store = createStore({ dir: null, onChange: (t) => topics.push(...t) });
  const row = store.insert('accounts', { name: 'Acme Health' });
  assert.match(row.id, /^acc_[0-9a-f]{8}$/);
  store.update('accounts', row.id, { stage: 'found' });
  assert.equal(store.get('accounts', row.id).stage, 'found');
  assert.equal(store.count('accounts', { stage: 'found' }), 1);
  for (let i = 0; i < 2100; i++) store.insert('runs', { agentId: 'x' });
  assert.equal(store.count('runs'), 2000);
  await new Promise((r) => setImmediate(r));
  assert.ok(topics.includes('accounts'));
});

test('parseJsonLoose reads fenced and embedded JSON', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Here:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseJsonLoose('Sure. {"a":3} Done.'), { a: 3 });
  assert.equal(parseJsonLoose('no json'), null);
});

test('api: setup, agents, connections and validation', async () => {
  const { app, call } = await start();
  try {
    assert.equal((await call('GET', '/api/workspace')).body.workspace, null);
    assert.equal((await call('POST', '/api/setup', { playbook: 'nope' })).status, 400);
    const missing = await call('POST', '/api/setup', { playbook: 'sales', settings: {} });
    assert.equal(missing.status, 400);

    const setup = await call('POST', '/api/setup', { playbook: 'sales', demo: true, agents: ['scout', 'researcher'] });
    assert.equal(setup.status, 200);
    assert.equal(setup.body.workspace.playbook, 'sales');
    assert.equal((await call('POST', '/api/setup', { playbook: 'sales', demo: true })).status, 409);

    const { body } = await call('GET', '/api/agents');
    assert.equal(body.agents.length, 7);
    const scout = body.agents.find((a) => a.id === 'scout');
    assert.equal(scout.enabled, true);
    assert.equal(body.agents.find((a) => a.id === 'crm').status, 'off');

    const conns = (await call('GET', '/api/connections')).body.connections;
    assert.equal(conns[0].provider, 'demo');

    const bad = await call('PATCH', '/api/agents/scout', { config: { batchSize: 0 } });
    assert.equal(bad.status, 400);
    const good = await call('PATCH', '/api/agents/scout', { config: { batchSize: 10 }, schedule: { type: 'cron', cron: '*/5 * * * *' } });
    assert.equal(good.body.agent.config.find((f) => f.key === 'batchSize').value, 10);
    assert.equal(good.body.agent.schedule.label, 'Every 5 minutes');
    assert.equal((await call('PATCH', '/api/agents/scout', { schedule: { type: 'cron', cron: 'bad' } })).status, 400);

    const paused = await call('POST', '/api/workspace/pause');
    assert.equal(paused.body.workspace.paused, true);
    assert.equal((await call('GET', '/api/agents')).body.agents.find((a) => a.id === 'researcher').status, 'paused');

    const meta = (await call('GET', '/api/meta')).body;
    assert.deepEqual(meta.playbooks.map((p) => p.id).sort(), ['markets', 'sales']);
    assert.ok(meta.providers.some((p) => p.id === 'demo'));

    assert.equal((await call('DELETE', '/api/workspace', { confirm: 'wrong' })).status, 400);
    assert.equal((await call('DELETE', '/api/workspace', { confirm: 'Ledgerline outbound' })).status, 200);
    assert.equal((await call('GET', '/api/workspace')).body.workspace, null);
  } finally {
    await app.close();
  }
});

test('api: secrets are never returned', async () => {
  const { app, call } = await start();
  try {
    await call('POST', '/api/setup', { playbook: 'markets', demo: true });
    const added = await call('POST', '/api/connections', { provider: 'demo', label: 'Second', values: {} });
    assert.equal(added.status, 200);
    const text = JSON.stringify((await call('GET', '/api/connections')).body);
    assert.ok(!text.includes('"secrets"'));
  } finally {
    await app.close();
  }
});
