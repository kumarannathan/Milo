import { getPlaybook } from '../playbooks/index.js';
import { nextCronDate } from '../lib/cron.js';
import { CapabilityMissingError, createRunContext } from './context.js';
import { ProviderError } from '../providers/io.js';
import { resolveBinding } from './bindings.js';

const TICK_MS = 2000;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export function agentSchedule(def, state, workspace) {
  if (state?.schedule) return state.schedule;
  if (workspace?.demo && def.demoSchedule) return def.demoSchedule;
  return def.schedule;
}

function errorInfo(err) {
  const at = new Date().toISOString();
  if (err instanceof CapabilityMissingError) {
    return { message: err.message, code: 'missing_capability', capability: err.capability, at };
  }
  if (err instanceof ProviderError) {
    return { message: err.message, code: err.code, op: err.op, status: err.status, connectionId: err.connectionId ?? null, at };
  }
  return { message: err?.message ?? String(err), code: 'agent_error', at };
}

export function createRunner({ store, log = console }) {
  const running = new Map(); // agentId -> promise
  let timer = null;

  function workspace() {
    return store.getValue('workspace');
  }

  function playbook() {
    const ws = workspace();
    return ws ? getPlaybook(ws.playbook) : null;
  }

  function consumerOf(type) {
    return playbook()?.agents.find((a) => (a.consumes ?? []).includes(type)) ?? null;
  }

  function enqueue(type, payload = {}, { availableAt = null, createdBy = 'user', dedupeKey = null } = {}) {
    const consumer = consumerOf(type);
    if (!consumer) throw new Error(`No agent handles "${type}" tasks.`);
    if (dedupeKey) {
      const existing = store.find('tasks', (t) => t.dedupeKey === dedupeKey && ['queued', 'running'].includes(t.status));
      if (existing) return existing;
    }
    return store.insert('tasks', {
      type,
      agentId: consumer.id,
      payload,
      status: 'queued',
      attempts: 0,
      availableAt: availableAt ? new Date(availableAt).toISOString() : null,
      createdBy,
      dedupeKey,
    });
  }

  function readyTasks(agentId, now = Date.now()) {
    return store.list(
      'tasks',
      (t) => t.agentId === agentId && t.status === 'queued' && (!t.availableAt || Date.parse(t.availableAt) <= now),
    );
  }

  // Bring agent state records in line with the playbook (new agents, cron times).
  function syncAgents() {
    const ws = workspace();
    const pb = playbook();
    if (!ws || !pb) return;
    for (const def of pb.agents) {
      let state = store.get('agents', def.id);
      if (!state) {
        state = store.insert('agents', {
          id: def.id,
          enabled: false,
          schedule: null,
          model: null,
          config: {},
          bindings: {},
          status: 'idle',
          now: '',
          lastRunAt: null,
          lastError: null,
          consecutiveFailures: 0,
          nextRunAt: null,
          runRequested: false,
        });
      }
      const schedule = agentSchedule(def, state, ws);
      if (schedule.type === 'cron' && !state.nextRunAt) {
        store.update('agents', def.id, { nextRunAt: nextCronDate(schedule.cron)?.toISOString() ?? null });
      }
      if (schedule.type !== 'cron' && state.nextRunAt) {
        store.update('agents', def.id, { nextRunAt: null });
      }
    }
  }

  function workerLimit() {
    return Math.max(1, Number(workspace()?.settings?.workers ?? 3));
  }

  function shouldRun(def, state, ws, now) {
    if (state.runRequested) return 'manual';
    if (!state.enabled || ws.paused) return null;
    const schedule = agentSchedule(def, state, ws);
    const backoff = state.backoffUntil && Date.parse(state.backoffUntil) > now;
    const hasWork = readyTasks(def.id, now).length > 0;
    if (schedule.type === 'cron' && state.nextRunAt && Date.parse(state.nextRunAt) <= now) return 'schedule';
    if (hasWork && !backoff && (schedule.type === 'event' || def.wakeOnTasks)) return 'tasks';
    return null;
  }

  async function execute(def, trigger) {
    const ws = workspace();
    const pb = playbook();
    const state = store.get('agents', def.id);
    const schedule = agentSchedule(def, state, ws);
    const startedAt = new Date();

    const claimLimit = Number(state.config?.batchSize ?? def.batch ?? 10);
    const tasks = readyTasks(def.id).slice(0, claimLimit);
    for (const t of tasks) {
      store.update('tasks', t.id, { status: 'running', startedAt: startedAt.toISOString(), attempts: (t.attempts ?? 0) + 1 });
    }

    const run = store.insert('runs', {
      agentId: def.id,
      trigger,
      taskIds: tasks.map((t) => t.id),
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      status: 'running',
      durationMs: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: null,
      summary: '',
      error: null,
    });

    store.update('agents', def.id, {
      status: 'running',
      runRequested: false,
      lastRunAt: startedAt.toISOString(),
      nextRunAt: schedule.type === 'cron' ? nextCronDate(schedule.cron, startedAt)?.toISOString() ?? null : null,
    });

    // Required capabilities are checked up front so a missing key fails fast and clearly.
    const missing = (def.capabilities ?? []).find((c) => c.required && !resolveBinding(store, state, c.key));

    const ctx = createRunContext({ store, playbook: pb, def, state, run, tasks, enqueue });
    let error = null;
    let result = null;
    try {
      if (missing) throw new CapabilityMissingError(missing.key);
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Run took longer than ${RUN_TIMEOUT_MS / 60000} minutes and was stopped.`)), RUN_TIMEOUT_MS);
      });
      try {
        result = await Promise.race([def.run(ctx), timeout]);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      error = err;
    }

    const finishedAt = new Date();
    const { done, failed, deferred } = ctx._outcome;
    for (const t of tasks) {
      if (done.has(t.id) || failed.has(t.id) || deferred.has(t.id)) continue;
      const current = store.get('tasks', t.id);
      if (!current || current.status !== 'running') continue;
      if (!error) {
        store.update('tasks', t.id, { status: 'done', finishedAt: finishedAt.toISOString() });
      } else if ((current.attempts ?? 1) >= MAX_ATTEMPTS && !(error instanceof CapabilityMissingError) && error?.code !== 'auth') {
        store.update('tasks', t.id, { status: 'failed', error: error.message, finishedAt: finishedAt.toISOString() });
      } else {
        // Missing or expired connections hold work instead of burning retries.
        const hold = error instanceof CapabilityMissingError || error?.code === 'auth';
        store.update('tasks', t.id, { status: 'queued', attempts: hold ? (current.attempts ?? 1) - 1 : current.attempts });
      }
    }

    const info = error ? errorInfo(error) : null;
    store.update('runs', run.id, {
      finishedAt: finishedAt.toISOString(),
      status: error ? 'error' : 'ok',
      durationMs: finishedAt - startedAt,
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      costUsd: run.costUsd,
      summary: error ? info.message : (result?.summary ?? run.summary ?? ''),
      error: info,
    });

    const prev = store.get('agents', def.id);
    const failures = error ? (prev.consecutiveFailures ?? 0) + 1 : 0;
    store.update('agents', def.id, {
      status: error ? 'error' : 'idle',
      now: error ? info.message : (result?.now ?? ''),
      lastError: error ? { ...info, failures, since: prev.lastError?.since ?? info.at } : null,
      lastOkAt: error ? prev.lastOkAt ?? null : finishedAt.toISOString(),
      consecutiveFailures: failures,
      backoffUntil: error ? new Date(Date.now() + Math.min(2 ** failures, 30) * 60_000).toISOString() : null,
    });

    if (error && failures === 1) {
      ctx.activity({ pre: 'stopped:', link: '', post: info.message, tag: 'error', level: 'error' });
      ctx.notify(`${def.name} stopped: ${info.message}`, 'error');
    }
    if (error && !(error instanceof CapabilityMissingError) && !(error instanceof ProviderError)) {
      log.error?.(`[${def.id}]`, error);
    }
  }

  function start(def, trigger) {
    const p = execute(def, trigger)
      .catch((err) => log.error?.(`[runner] ${def.id} crashed`, err))
      .finally(() => running.delete(def.id));
    running.set(def.id, p);
  }

  function tick() {
    const ws = workspace();
    const pb = playbook();
    if (!ws || !pb) return;
    syncAgents();
    const now = Date.now();
    for (const def of pb.agents) {
      if (running.size >= workerLimit()) break;
      if (running.has(def.id)) continue;
      const state = store.get('agents', def.id);
      const trigger = shouldRun(def, state, ws, now);
      if (trigger) start(def, trigger);
    }
  }

  // A run that was in flight when the process stopped is marked as interrupted.
  function recover() {
    for (const r of store.list('runs', { status: 'running' })) {
      store.update('runs', r.id, { status: 'error', finishedAt: new Date().toISOString(), summary: 'Interrupted: Milo was stopped mid-run.', error: { message: 'Interrupted', code: 'interrupted' } });
    }
    for (const t of store.list('tasks', { status: 'running' })) store.update('tasks', t.id, { status: 'queued' });
    for (const a of store.list('agents', { status: 'running' })) store.update('agents', a.id, { status: 'idle', now: '' });
  }

  return {
    enqueue,
    consumerOf,
    readyTasks,
    syncAgents,
    isRunning: (id) => running.has(id),
    activeCount: () => running.size,
    workerLimit,

    requestRun(agentId) {
      store.update('agents', agentId, { runRequested: true, backoffUntil: null });
      setImmediate(tick);
    },

    start() {
      recover();
      syncAgents();
      timer = setInterval(tick, TICK_MS);
      setImmediate(tick);
    },

    async stop() {
      clearInterval(timer);
      await Promise.allSettled(running.values());
    },

    tick,
  };
}
