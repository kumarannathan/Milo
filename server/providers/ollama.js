import { ProviderError } from './io.js';

const DEFAULT_HOST = 'http://localhost:11434';
export const DEFAULT_MODEL = 'llama3.1';

export function ollamaHost(values = {}) {
  const raw = String(values.host || '').trim() || DEFAULT_HOST;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    new URL(withScheme);
  } catch {
    throw new ProviderError(`"${raw}" is not a valid Ollama host.`, { code: 'bad_request', op: 'ollama' });
  }
  return withScheme.replace(/\/+$/, '');
}

// The connection's model wins unless the agent picked a different one.
export function resolveOllamaModel(args, values = {}) {
  const configured = String(values.model || '').trim();
  if (configured && (!args.model || args.model === DEFAULT_MODEL)) return configured;
  return args.model || configured || DEFAULT_MODEL;
}

export function buildOllamaRequest(args, model) {
  const messages = [];
  if (args.system) messages.push({ role: 'system', content: String(args.system) });
  messages.push({ role: 'user', content: String(args.prompt ?? '') });
  const body = { model, messages, stream: false, options: { num_predict: Number(args.maxTokens) > 0 ? Math.floor(Number(args.maxTokens)) : 1500 } };
  if (args.json) body.format = 'json';
  return body;
}

export function mapOllamaResponse(res, requestedModel) {
  return {
    text: String(res?.message?.content ?? '').trim(),
    tokensIn: res?.prompt_eval_count ?? 0,
    tokensOut: res?.eval_count ?? 0,
    model: res?.model ?? requestedModel,
  };
}

const sameModel = (a, b) => a === b || a.replace(/:latest$/, '') === b.replace(/:latest$/, '');

async function reach(io, op, host, init) {
  try {
    return await io.http(op, host + init.path, init);
  } catch (err) {
    if (err instanceof ProviderError && err.code === 'network') {
      throw new ProviderError(`Could not reach Ollama at ${host}. Make sure it is running.`, { code: 'network', op, status: err.status });
    }
    throw err;
  }
}

async function complete(args, { conn, io }) {
  const host = ollamaHost(conn.values);
  const model = resolveOllamaModel(args, conn.values);
  const res = await reach(io, 'ollama.chat', host, { path: '/api/chat', json: buildOllamaRequest(args, model), timeoutMs: 600_000 });
  return mapOllamaResponse(res, model);
}

export default {
  id: 'ollama',
  name: 'Ollama',
  category: 'Models',
  site: 'ollama.com',
  description: 'Open models running on your own machine, with nothing sent to a vendor.',
  playbooks: ['sales', 'markets'],
  fields: [
    {
      key: 'host',
      label: 'Host',
      type: 'url',
      placeholder: DEFAULT_HOST,
      help: 'Where Ollama is listening. Leave empty for this machine.',
    },
    {
      key: 'model',
      label: 'Model',
      placeholder: DEFAULT_MODEL,
      help: 'A model you have pulled, for example llama3.1 or qwen2.5:14b.',
    },
  ],
  models: [DEFAULT_MODEL],
  defaultModel: DEFAULT_MODEL,
  pricing: () => ({ in: 0, out: 0 }),
  handlers: {
    'llm.complete': complete,
  },
  async test({ conn, io }) {
    const host = ollamaHost(conn.values);
    const res = await reach(io, 'ollama.tags', host, { path: '/api/tags', timeoutMs: 10_000 });
    const model = String(conn.values.model || '').trim() || DEFAULT_MODEL;
    const pulled = (res?.models ?? []).map((m) => m.name ?? m.model).filter(Boolean);
    if (!pulled.some((name) => sameModel(name, model))) {
      throw new ProviderError(`Ollama is running but ${model} is not pulled. Run "ollama pull ${model}".`, {
        code: 'not_found',
        op: 'ollama.tags',
      });
    }
    return { account: host };
  },
};
