import { capabilityLabel } from '../capabilities.js';
import { getProvider } from '../providers/index.js';
import { ProviderError, createIo } from '../providers/io.js';
import { resolveBinding, resolveModel } from './bindings.js';

export class CapabilityMissingError extends Error {
  constructor(capability) {
    super(`No connection can ${capabilityLabel(capability).toLowerCase()} (${capability}). Add one under Connections.`);
    this.capability = capability;
    this.code = 'missing_capability';
  }
}

// Pull the first JSON object or array out of a model response.
export function parseJsonLoose(text) {
  if (text == null) return null;
  const s = String(text).trim();
  try {
    return JSON.parse(s);
  } catch {}
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {}
  }
  return null;
}

/**
 * Everything an agent's run(ctx) can use. Agents should never import providers directly.
 */
export function createRunContext({ store, playbook, def, state, run, tasks, enqueue }) {
  const workspace = store.getValue('workspace');
  const config = { ...Object.fromEntries((def.config ?? []).map((f) => [f.key, f.default])), ...(state.config ?? {}) };
  const done = new Set();
  const failed = new Map();
  const deferred = new Map();

  const io = createIo({
    onCall: ({ op, status, ms }) => {
      store.insert('toolCalls', { runId: run.id, agentId: def.id, op, status, ms, at: new Date().toISOString() });
    },
  });

  function connectionFor(capability) {
    return resolveBinding(store, state, capability);
  }

  async function call(capability, args = {}, extra = {}) {
    const conn = connectionFor(capability);
    if (!conn) throw new CapabilityMissingError(capability);
    const provider = getProvider(conn.provider);
    const handler = provider?.handlers?.[capability];
    if (!handler) throw new CapabilityMissingError(capability);
    try {
      const result = await handler(args, { conn, io, workspace, ...extra });
      if (conn.status !== 'ok') {
        store.update('connections', conn.id, { status: 'ok', lastError: null, lastCheckedAt: new Date().toISOString() });
      }
      return result;
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'auth') {
        store.update('connections', conn.id, {
          status: 'expired',
          lastError: { message: err.message, op: err.op, status: err.status, at: new Date().toISOString() },
          lastCheckedAt: new Date().toISOString(),
        });
      }
      if (err instanceof ProviderError) err.connectionId = conn.id;
      throw err;
    }
  }

  const ctx = {
    agent: def,
    playbook,
    workspace,
    settings: workspace?.settings ?? {},
    config,
    tasks,
    store,
    run,
    demo: !!workspace?.demo,

    now: () => new Date(),

    has(capability) {
      return !!connectionFor(capability);
    },

    connection(capability) {
      return connectionFor(capability);
    },

    call,

    /**
     * Ask the agent's model for text or JSON.
     * @param {{ system?: string, prompt: string, json?: boolean, maxTokens?: number, purpose?: string, input?: any }} opts
     *   `purpose` and `input` let the demo provider return a realistic answer without a model.
     */
    async llm(opts) {
      const model = resolveModel(store, state);
      if (!model) throw new CapabilityMissingError('llm.complete');
      const conn = store.get('connections', model.connectionId);
      const provider = getProvider(conn.provider);
      const prompt = opts.json
        ? `${opts.prompt}\n\nRespond with a single JSON object and nothing else.`
        : opts.prompt;
      // Instructions the user wrote for this agent ride along with every prompt.
      const extra = String(state.instructions ?? '').trim();
      const system = extra ? [opts.system, `Instructions from the person running this team:\n${extra}`].filter(Boolean).join('\n\n') : opts.system;
      const result = await call('llm.complete', { ...opts, system, prompt, model: model.model }, {});
      const tokensIn = result.tokensIn ?? 0;
      const tokensOut = result.tokensOut ?? 0;
      const price = provider?.pricing?.(model.model);
      run.tokensIn = (run.tokensIn ?? 0) + tokensIn;
      run.tokensOut = (run.tokensOut ?? 0) + tokensOut;
      if (price) run.costUsd = (run.costUsd ?? 0) + (tokensIn * price.in + tokensOut * price.out) / 1e6;
      const data = opts.json ? (result.data ?? parseJsonLoose(result.text)) : undefined;
      if (opts.json && (data === null || typeof data !== 'object')) {
        throw new ProviderError('The model did not return valid JSON.', { code: 'bad_response', op: 'llm.complete' });
      }
      return { text: result.text, data, model: result.model ?? model.model };
    },

    /** Queue work for whichever agent consumes `type`. */
    emit(type, payload = {}, opts = {}) {
      return enqueue(type, payload, { ...opts, createdBy: def.id });
    },

    /** Mark a claimed task finished so it is not retried if the run later fails. */
    complete(task) {
      done.add(task.id);
      store.update('tasks', task.id, { status: 'done', finishedAt: new Date().toISOString() });
    },

    /** Give up on a task without failing the run. */
    fail(task, message) {
      failed.set(task.id, message);
      store.update('tasks', task.id, { status: 'failed', error: message, finishedAt: new Date().toISOString() });
    },

    /** Put a task back to be picked up later (e.g. outside the sending window). */
    defer(task, availableAt) {
      deferred.set(task.id, availableAt);
      store.update('tasks', task.id, { status: 'queued', availableAt: new Date(availableAt).toISOString() });
    },

    /** One line in the activity feed: "<agent> <pre> <link> <post>". */
    activity({ pre = '', link = '', href = null, post = '', tag = null, level = 'info' }) {
      return store.insert('activity', {
        agentId: def.id,
        at: new Date().toISOString(),
        pre,
        link,
        href,
        post,
        tag,
        level,
      });
    },

    /** What the agent is doing right now; shown on the control room. */
    progress(text) {
      store.update('agents', def.id, { now: text });
    },

    summary(text) {
      run.summary = text;
    },

    /** Best-effort alert through notify.post; never fails the run. */
    async notify(text, level = 'info') {
      if (!connectionFor('notify.post')) return false;
      try {
        await call('notify.post', { text, level });
        return true;
      } catch {
        return false;
      }
    },

    _outcome: { done, failed, deferred },
  };

  return ctx;
}
