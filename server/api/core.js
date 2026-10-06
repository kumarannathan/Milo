import { readFileSync } from 'node:fs';
import { CAPABILITIES, capabilityLabel } from '../capabilities.js';
import { describeCron, isValidCron } from '../lib/cron.js';
import { PLAYBOOKS, describeAgent, describePlaybook, getPlaybook } from '../playbooks/index.js';
import { describeProvider, getProvider, providerCapabilities, publicConnection } from '../providers/index.js';
import { createIo } from '../providers/io.js';
import { resolveBinding, resolveModel } from '../runner/bindings.js';
import { agentSchedule } from '../runner/runner.js';
import { HttpError, badRequest, notFound } from '../http.js';

const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

function requireWorkspace(store) {
  const ws = store.getValue('workspace');
  if (!ws) throw new HttpError(409, 'Finish setup first.');
  return ws;
}

function bindingSource(store, state, capability) {
  if (capability === 'llm.complete') return resolveModel(store, state)?.override ? 'agent' : 'workspace';
  const ws = store.getValue('workspace') ?? {};
  const explicit = state?.bindings?.[capability];
  if (explicit === 'none') return 'none';
  if (explicit) return 'agent';
  if (ws.bindings?.[capability]) return 'workspace';
  return 'auto';
}

function capabilityStatus(conn, required, source) {
  if (!conn) return source === 'none' || !required ? 'skipped' : 'missing';
  if (conn.status === 'expired') return 'expired';
  if (conn.status === 'error') return 'error';
  return 'connected';
}

export function describeAgentState(store, def, { runner } = {}) {
  const ws = store.getValue('workspace');
  const state = store.get('agents', def.id) ?? { id: def.id, enabled: false, config: {}, bindings: {} };
  const schedule = agentSchedule(def, state, ws);
  const model = resolveModel(store, state);
  const modelConn = model ? store.get('connections', model.connectionId) : null;
  const usesModel = (def.capabilities ?? []).some((c) => c.key === 'llm.complete');

  let status = state.status ?? 'idle';
  if (!state.enabled && status !== 'running') status = 'off';
  else if (ws?.paused && status !== 'error' && status !== 'running') status = 'paused';

  return {
    ...describeAgent(def),
    enabled: !!state.enabled,
    status,
    now: state.now ?? '',
    lastRunAt: state.lastRunAt ?? null,
    lastOkAt: state.lastOkAt ?? null,
    nextRunAt: state.nextRunAt ?? null,
    lastError: state.lastError ?? null,
    consecutiveFailures: state.consecutiveFailures ?? 0,
    running: runner?.isRunning(def.id) ?? state.status === 'running',
    schedule: {
      ...schedule,
      label: schedule.type === 'cron' ? describeCron(schedule.cron) : 'When work arrives',
      overridden: !!state.schedule,
    },
    queued: store.count('tasks', (t) => t.agentId === def.id && t.status === 'queued'),
    usesModel,
    model: usesModel && model
      ? {
          connectionId: model.connectionId,
          model: model.model,
          override: model.override,
          providerName: getProvider(modelConn?.provider)?.name ?? modelConn?.provider ?? '',
        }
      : null,
    capabilities: (def.capabilities ?? []).map((c) => {
      const conn = resolveBinding(store, state, c.key);
      const source = bindingSource(store, state, c.key);
      return {
        key: c.key,
        label: capabilityLabel(c.key),
        required: !!c.required,
        source,
        connection: conn ? publicConnection(conn) : null,
        status: capabilityStatus(conn, c.required, source),
      };
    }),
    config: (def.config ?? []).map((f) => ({ ...f, value: state.config?.[f.key] ?? f.default })),
    instructions: state.instructions ?? '',
  };
}

function validateConfig(def, patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    const field = (def.config ?? []).find((f) => f.key === key);
    if (!field) throw badRequest(`Unknown setting "${key}" for ${def.name}.`);
    if (field.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw badRequest(`${field.label} must be a number.`);
      if (field.min != null && n < field.min) throw badRequest(`${field.label} must be at least ${field.min}.`);
      if (field.max != null && n > field.max) throw badRequest(`${field.label} must be at most ${field.max}.`);
      out[key] = n;
    } else if (field.type === 'boolean') {
      out[key] = !!value;
    } else if (field.type === 'select') {
      if (!field.options.some((o) => o.value === value)) throw badRequest(`Pick a valid option for ${field.label}.`);
      out[key] = value;
    } else {
      out[key] = String(value ?? '');
    }
  }
  return out;
}

async function testConnection(store, conn) {
  const provider = getProvider(conn.provider);
  const calls = [];
  const io = createIo({ onCall: (c) => calls.push(c) });
  const checkedAt = new Date().toISOString();
  try {
    const result = provider.test ? await provider.test({ conn, io }) : {};
    return store.update('connections', conn.id, {
      status: 'ok',
      account: result?.account ?? conn.account ?? '',
      lastError: null,
      lastCheckedAt: checkedAt,
    });
  } catch (err) {
    return store.update('connections', conn.id, {
      status: err?.code === 'auth' ? 'expired' : 'error',
      lastError: { message: err?.message ?? String(err), op: err?.op ?? null, status: err?.status ?? null, at: checkedAt },
      lastCheckedAt: checkedAt,
    });
  }
}

function cleanValues(provider, values = {}, existing = {}) {
  const out = { ...existing };
  for (const field of provider.fields ?? []) {
    if (!(field.key in values)) continue;
    const v = values[field.key];
    // Secret fields come back masked; an empty or masked value means "keep what is saved".
    if (field.secret && (v === '' || v == null || String(v).startsWith('••••'))) continue;
    out[field.key] = typeof v === 'string' ? v.trim() : v;
  }
  for (const field of provider.fields ?? []) {
    if (field.required && !out[field.key]) throw badRequest(`${field.label} is required for ${provider.name}.`);
  }
  return out;
}

export function registerCoreRoutes(router, { store, runner, bus }) {
  router.get('/api/health', () => ({ ok: true, version: VERSION }));

  router.get('/api/meta', async () => {
    const { loadProviders } = await import('../providers/index.js');
    const providers = await loadProviders();
    return {
      version: VERSION,
      playbooks: Object.values(PLAYBOOKS).map(describePlaybook),
      providers: [...providers.values()].filter((p) => !p.hidden).map(describeProvider),
      capabilities: CAPABILITIES,
    };
  });

  // ── Workspace ────────────────────────────────────────────────
  router.get('/api/workspace', () => {
    const ws = store.getValue('workspace');
    return {
      workspace: ws,
      runner: { online: true, workers: runner.workerLimit(), active: runner.activeCount() },
    };
  });

  router.post('/api/setup', async ({ body }) => {
    if (store.getValue('workspace')) throw new HttpError(409, 'Milo is already set up. Reset the workspace in Settings to start over.');
    const pb = getPlaybook(body.playbook);
    if (!pb) throw badRequest('Pick Sales development or Markets.');
    const demo = !!body.demo;
    const settings = { ...(demo ? pb.demo.settings : {}), ...(body.settings ?? {}) };
    if (!demo) {
      const missing = pb.settings.filter((f) => f.required && (settings[f.key] === undefined || settings[f.key] === ''));
      if (missing.length) throw badRequest(`Fill in ${missing.map((f) => f.label.toLowerCase()).join(', ')}.`);
    }

    store.setValue('workspace', {
      id: 'ws',
      name: String(body.name || (demo ? pb.demo.name : pb.name)).trim(),
      playbook: pb.id,
      demo,
      autonomy: body.autonomy && pb.autonomy.some((a) => a.id === body.autonomy) ? body.autonomy : pb.defaultAutonomy,
      paused: false,
      pausedAt: null,
      owner: { name: body.owner?.name || settings.senderName || 'You', email: body.owner?.email || settings.senderEmail || '' },
      settings: { workers: 3, ...settings },
      defaultModel: null,
      bindings: {},
      createdAt: new Date().toISOString(),
    });

    if (demo) {
      store.insert('connections', { provider: 'demo', label: 'Sample data', values: {}, status: 'ok', account: 'built in', lastCheckedAt: new Date().toISOString() });
    }
    for (const c of body.connections ?? []) {
      const provider = getProvider(c.provider);
      if (!provider) continue;
      const conn = store.insert('connections', { provider: provider.id, label: c.label || provider.name, values: cleanValues(provider, c.values), status: 'untested', account: '' });
      await testConnection(store, conn);
    }

    const enabled = new Set(body.agents ?? pb.agents.map((a) => a.id));
    runner.syncAgents();
    for (const def of pb.agents) store.update('agents', def.id, { enabled: enabled.has(def.id) });
    if (pb.id === 'markets') {
      const bankroll = Number(settings.startingBalance) || 1000;
      store.setValue('wallet', { startingBalance: bankroll, cash: bankroll });
      store.insert('equity', { at: new Date().toISOString(), value: bankroll, cash: bankroll, exposure: 0 });
    }
    if (demo) for (const id of pb.demo.kickoff ?? []) if (enabled.has(id)) runner.requestRun(id);
    return { workspace: store.getValue('workspace') };
  });

  router.patch('/api/workspace', ({ body }) => {
    const ws = requireWorkspace(store);
    const pb = getPlaybook(ws.playbook);
    const patch = {};
    if (body.name !== undefined) {
      if (!String(body.name).trim()) throw badRequest('Give the workspace a name.');
      patch.name = String(body.name).trim();
    }
    if (body.autonomy !== undefined) {
      if (!pb.autonomy.some((a) => a.id === body.autonomy)) throw badRequest('Unknown autonomy level.');
      patch.autonomy = body.autonomy;
    }
    if (body.owner !== undefined) patch.owner = { ...ws.owner, ...body.owner };
    if (body.settings !== undefined) {
      const settings = { ...ws.settings, ...body.settings };
      if (settings.workers !== undefined) {
        const w = Number(settings.workers);
        if (!Number.isInteger(w) || w < 1 || w > 10) throw badRequest('Workers must be between 1 and 10.');
        settings.workers = w;
      }
      patch.settings = settings;
    }
    if (body.defaultModel !== undefined) {
      if (body.defaultModel && !store.get('connections', body.defaultModel.connectionId)) throw badRequest('That model connection no longer exists.');
      patch.defaultModel = body.defaultModel;
    }
    if (body.bindings !== undefined) patch.bindings = { ...ws.bindings, ...body.bindings };
    return { workspace: store.patchValue('workspace', patch) };
  });

  router.post('/api/workspace/pause', () => {
    requireWorkspace(store);
    return { workspace: store.patchValue('workspace', { paused: true, pausedAt: new Date().toISOString() }) };
  });

  router.post('/api/workspace/resume', () => {
    requireWorkspace(store);
    return { workspace: store.patchValue('workspace', { paused: false, pausedAt: null }) };
  });

  router.delete('/api/workspace', async ({ body }) => {
    const ws = requireWorkspace(store);
    if (body.confirm !== ws.name) throw badRequest('Type the workspace name to confirm.');
    await runner.stop();
    store.reset();
    store.flush();
    runner.start();
    return { ok: true };
  });

  // ── Agents ───────────────────────────────────────────────────
  const agentDef = (id) => {
    const ws = requireWorkspace(store);
    const def = getPlaybook(ws.playbook).agents.find((a) => a.id === id);
    if (!def) throw notFound('No agent with that id.');
    return def;
  };

  router.get('/api/agents', () => {
    const ws = store.getValue('workspace');
    if (!ws) return { agents: [] };
    runner.syncAgents();
    return { agents: getPlaybook(ws.playbook).agents.map((def) => describeAgentState(store, def, { runner })) };
  });

  router.get('/api/agents/:id', ({ params, query }) => {
    const def = agentDef(params.id);
    const limit = Math.min(Number(query.limit) || 20, 100);
    const runs = store.list('runs', { agentId: def.id }).slice(-limit).reverse();
    const toolCalls = store.list('toolCalls', { agentId: def.id }).slice(-limit).reverse();
    const queue = store
      .list('tasks', (t) => t.agentId === def.id && t.status === 'queued')
      .slice(0, 20)
      .map(({ id, type, payload, availableAt, attempts, createdAt }) => ({ id, type, payload, availableAt, attempts, createdAt }));
    return { agent: describeAgentState(store, def, { runner }), runs, toolCalls, queue };
  });

  router.patch('/api/agents/:id', ({ params, body }) => {
    const def = agentDef(params.id);
    const state = store.get('agents', def.id);
    const patch = {};
    if (body.enabled !== undefined) patch.enabled = !!body.enabled;
    if (body.schedule !== undefined) {
      if (body.schedule === null) patch.schedule = null;
      else if (body.schedule.type === 'event') patch.schedule = { type: 'event' };
      else if (body.schedule.type === 'cron' && isValidCron(body.schedule.cron)) patch.schedule = { type: 'cron', cron: body.schedule.cron.trim() };
      else throw badRequest('That schedule is not a valid cron expression.');
      patch.nextRunAt = null;
    }
    if (body.model !== undefined) {
      if (body.model && !store.get('connections', body.model.connectionId)) throw badRequest('That model connection no longer exists.');
      patch.model = body.model;
    }
    if (body.config !== undefined) patch.config = { ...state.config, ...validateConfig(def, body.config) };
    if (body.instructions !== undefined) {
      const text = String(body.instructions ?? '').trim();
      if (text.length > 4000) throw badRequest('Keep instructions under 4,000 characters.');
      patch.instructions = text;
    }
    if (body.bindings !== undefined) {
      const bindings = { ...state.bindings };
      for (const [cap, connId] of Object.entries(body.bindings)) {
        if (!def.capabilities.some((c) => c.key === cap)) throw badRequest(`${def.name} does not use ${cap}.`);
        if (connId === null) delete bindings[cap];
        else if (connId === 'none') {
          if (def.capabilities.find((c) => c.key === cap).required) throw badRequest(`${capabilityLabel(cap)} is required for ${def.name}.`);
          bindings[cap] = 'none';
        } else {
          const conn = store.get('connections', connId);
          if (!conn) throw badRequest('That connection no longer exists.');
          if (!providerCapabilities(getProvider(conn.provider)).includes(cap)) throw badRequest(`${conn.label} can't ${capabilityLabel(cap).toLowerCase()}.`);
          bindings[cap] = connId;
        }
      }
      patch.bindings = bindings;
    }
    if (patch.enabled === true && state.lastError) patch.backoffUntil = null;
    store.update('agents', def.id, patch);
    runner.syncAgents();
    return { agent: describeAgentState(store, def, { runner }) };
  });

  router.post('/api/agents/:id/run', ({ params }) => {
    const def = agentDef(params.id);
    if (runner.isRunning(def.id)) throw new HttpError(409, `${def.name} is already running.`);
    runner.requestRun(def.id);
    return { ok: true };
  });

  // ── Connections ──────────────────────────────────────────────
  const usedBy = (connId) => {
    const ws = store.getValue('workspace');
    if (!ws) return [];
    const out = [];
    for (const def of getPlaybook(ws.playbook).agents) {
      const state = store.get('agents', def.id);
      for (const c of def.capabilities ?? []) {
        if (resolveBinding(store, state, c.key)?.id === connId) out.push({ agentId: def.id, agentName: def.name, capability: c.key });
      }
    }
    return out;
  };

  router.get('/api/connections', () => ({
    connections: store.list('connections').map((c) => ({ ...publicConnection(c), usedBy: usedBy(c.id) })),
  }));

  router.post('/api/connections', async ({ body }) => {
    const provider = getProvider(body.provider);
    if (!provider || provider.hidden) throw badRequest('Unknown provider.');
    const conn = store.insert('connections', {
      provider: provider.id,
      label: String(body.label || provider.name).trim(),
      values: cleanValues(provider, body.values),
      status: 'untested',
      account: '',
    });
    const tested = await testConnection(store, conn);
    return { connection: { ...publicConnection(tested), usedBy: usedBy(conn.id) } };
  });

  router.patch('/api/connections/:id', async ({ params, body }) => {
    const conn = store.get('connections', params.id);
    if (!conn) throw notFound('No connection with that id.');
    const provider = getProvider(conn.provider);
    const patch = {};
    if (body.label !== undefined) patch.label = String(body.label).trim() || provider.name;
    if (body.values !== undefined) patch.values = cleanValues(provider, body.values, conn.values);
    store.update('connections', conn.id, patch);
    const tested = body.values !== undefined ? await testConnection(store, conn) : store.get('connections', conn.id);
    return { connection: { ...publicConnection(tested), usedBy: usedBy(conn.id) } };
  });

  router.post('/api/connections/:id/test', async ({ params }) => {
    const conn = store.get('connections', params.id);
    if (!conn) throw notFound('No connection with that id.');
    const tested = await testConnection(store, conn);
    return { connection: { ...publicConnection(tested), usedBy: usedBy(conn.id) } };
  });

  router.delete('/api/connections/:id', ({ params }) => {
    const conn = store.get('connections', params.id);
    if (!conn) throw notFound('No connection with that id.');
    store.remove('connections', conn.id);
    for (const a of store.list('agents')) {
      const bindings = Object.fromEntries(Object.entries(a.bindings ?? {}).filter(([, v]) => v !== conn.id));
      const model = a.model?.connectionId === conn.id ? null : a.model;
      store.update('agents', a.id, { bindings, model });
    }
    const ws = store.getValue('workspace');
    if (ws) {
      store.patchValue('workspace', {
        defaultModel: ws.defaultModel?.connectionId === conn.id ? null : ws.defaultModel,
        bindings: Object.fromEntries(Object.entries(ws.bindings ?? {}).filter(([, v]) => v !== conn.id)),
      });
    }
    return { ok: true };
  });

  // ── Activity, runs, tasks, stats ─────────────────────────────
  router.get('/api/activity', ({ query }) => {
    const limit = Math.min(Number(query.limit) || 50, 200);
    const filter = query.filter ?? 'all';
    const outboundTags = new Set(['sent', 'reply', 'meeting', 'draft', 'trade', 'opened', 'closed', 'settled']);
    let rows = store.list('activity');
    if (filter === 'errors') rows = rows.filter((r) => r.level === 'error');
    else if (filter === 'outbound') rows = rows.filter((r) => outboundTags.has(r.tag));
    if (query.agentId) rows = rows.filter((r) => r.agentId === query.agentId);
    if (query.before) rows = rows.filter((r) => r.at < query.before);
    return { activity: rows.slice(-limit).reverse(), hasMore: rows.length > limit };
  });

  router.get('/api/runs', ({ query }) => {
    const limit = Math.min(Number(query.limit) || 50, 200);
    const rows = query.agentId ? store.list('runs', { agentId: query.agentId }) : store.list('runs');
    return { runs: rows.slice(-limit).reverse() };
  });

  router.get('/api/tasks', ({ query }) => {
    let rows = store.list('tasks');
    if (query.agentId) rows = rows.filter((t) => t.agentId === query.agentId);
    if (query.status) rows = rows.filter((t) => t.status === query.status);
    return { tasks: rows.slice(-200).reverse() };
  });

  router.get('/api/stats', () => {
    const ws = store.getValue('workspace');
    if (!ws) return { stats: [] };
    return { stats: getPlaybook(ws.playbook).stats(store) };
  });

  // Everything Milo stores, without connection keys.
  router.get('/api/export', ({ res }) => {
    const data = { ...store.data, exportedAt: new Date().toISOString(), appVersion: VERSION };
    data.connections = store.list('connections').map((c) => publicConnection(c));
    const body = JSON.stringify(data, null, 2);
    const day = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="milo-export-${day}.json"`,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });

  router.get('/api/events', ({ req, res }) => {
    bus.subscribe(req, res);
  });
}
