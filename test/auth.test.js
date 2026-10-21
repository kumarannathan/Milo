import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

async function start() {
  const app = await createApp({ dataDir: null, auth: 'local', staticDir: null, log: { error() {}, warn() {}, log() {} } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  // A tiny cookie jar per "browser".
  const browser = () => {
    let cookie = '';
    return async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  return { app, browser };
}

test('auth: sign up, sign in, sign out and the gate', async () => {
  const { app, browser } = await start();
  try {
    const a = browser();
    assert.equal((await a('GET', '/api/workspace')).status, 401);
    assert.equal((await a('GET', '/api/auth/me')).body.user, null);

    assert.equal((await a('POST', '/api/auth/signup', { email: 'bad', password: 'longenough' })).status, 400);
    assert.equal((await a('POST', '/api/auth/signup', { email: 'ana@example.com', password: 'short' })).status, 400);
    const up = await a('POST', '/api/auth/signup', { email: 'Ana@Example.com', name: 'Ana', password: 'longenough' });
    assert.equal(up.status, 200);
    assert.equal(up.body.user.email, 'ana@example.com');
    assert.equal((await a('POST', '/api/auth/signup', { email: 'ana@example.com', password: 'longenough' })).status, 409);

    assert.equal((await a('GET', '/api/auth/me')).body.user.name, 'Ana');
    assert.equal((await a('GET', '/api/workspace')).body.workspace, null);

    await a('POST', '/api/auth/signout');
    assert.equal((await a('GET', '/api/workspace')).status, 401);

    assert.equal((await a('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'wrong' })).status, 401);
    assert.equal((await a('POST', '/api/auth/signin', { email: 'ana@example.com', password: 'longenough' })).status, 200);
    assert.equal((await a('GET', '/api/auth/me')).body.user.id, up.body.user.id);

    const renamed = await a('PATCH', '/api/auth/me', { name: 'Ana R.' });
    assert.equal(renamed.body.user.name, 'Ana R.');
    assert.equal((await a('PATCH', '/api/auth/me', { currentPassword: 'nope', newPassword: 'anotherlong' })).status, 400);
    assert.equal((await a('PATCH', '/api/auth/me', { currentPassword: 'longenough', newPassword: 'anotherlong' })).status, 200);
    assert.equal((await a('GET', '/api/auth/me')).body.user.name, 'Ana R.');
  } finally {
    await app.close();
  }
});

test('auth: each account gets its own workspace', async () => {
  const { app, browser } = await start();
  try {
    const a = browser();
    const b = browser();
    await a('POST', '/api/auth/signup', { email: 'a@example.com', name: 'A', password: 'longenough' });
    await b('POST', '/api/auth/signup', { email: 'b@example.com', name: 'B', password: 'longenough' });

    const setup = await a('POST', '/api/setup', { playbook: 'sales', demo: true });
    assert.equal(setup.status, 200);
    assert.equal(setup.body.workspace.owner.name, 'A');
    assert.equal(setup.body.workspace.owner.email, 'a@example.com');

    assert.equal((await b('GET', '/api/workspace')).body.workspace, null);
    assert.equal((await b('GET', '/api/connections')).body.connections.length, 0);
    assert.ok((await a('GET', '/api/connections')).body.connections.length > 0);
    assert.equal(app.tenants.size(), 2);
  } finally {
    await app.close();
  }
});
