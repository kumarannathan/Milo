import { ProviderError, maskSecret } from './io.js';

const API = 'https://api.anthropic.com/v1';
const VERSION = '2023-06-01';

export const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'];
export const DEFAULT_MODEL = 'claude-opus-5-5';

// USD per million tokens, Anthropic first-party rates.
const PRICES = {
  'claude-fable-5-1': { in: 10, out: 50 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

export function anthropicPricing(model) {
  return PRICES[model] ?? null;
}

// Models that always think: thinking tokens count toward max_tokens, so the request
// gets headroom on top of the length the agent asked for, and an explicit effort level.
const THINKING = /^claude-(opus-5|sonnet-5|fable-5|opus-4-[678]|sonnet-4-6)/;
// Models that accept `fallbacks: "default"`: a safety-classifier decline is retried
// server-side on the model Anthropic recommends, instead of failing the run.
const FALLBACK = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
const THINKING_HEADROOM = 8000;

export function buildAnthropicRequest(args) {
  const model = args.model || DEFAULT_MODEL;
  const maxTokens = Number(args.maxTokens) > 0 ? Math.floor(Number(args.maxTokens)) : 1500;
  const thinks = THINKING.test(model);
  const body = {
    model,
    max_tokens: thinks ? maxTokens + THINKING_HEADROOM : maxTokens,
    messages: [{ role: 'user', content: String(args.prompt ?? '') }],
  };
  if (args.system) body.system = String(args.system);
  if (thinks) body.output_config = { effort: 'medium' };
  const headers = {};
  if (FALLBACK.has(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  return { body, headers };
}

export function mapAnthropicResponse(res, requestedModel) {
  if (res?.stop_reason === 'refusal') {
    const category = res.stop_details?.category;
    throw new ProviderError(`Claude declined this request${category ? ` (${category})` : ''}.`, {
      code: 'bad_response',
      op: 'anthropic.messages',
    });
  }
  const text = (res?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text && res?.stop_reason === 'max_tokens') {
    throw new ProviderError('Claude ran out of tokens before answering. Raise the token limit for this agent.', {
      code: 'bad_response',
      op: 'anthropic.messages',
    });
  }
  return {
    text,
    tokensIn:
      (res?.usage?.input_tokens ?? 0) +
      (res?.usage?.cache_read_input_tokens ?? 0) +
      (res?.usage?.cache_creation_input_tokens ?? 0),
    tokensOut: res?.usage?.output_tokens ?? 0,
    model: res?.model ?? requestedModel,
  };
}

const auth = (conn) => ({ 'x-api-key': conn.values.apiKey, 'anthropic-version': VERSION });

async function complete(args, { conn, io }) {
  const { body, headers } = buildAnthropicRequest(args);
  const res = await io.http('anthropic.messages', `${API}/messages`, {
    headers: { ...auth(conn), ...headers },
    json: body,
    timeoutMs: 300_000,
  });
  return mapAnthropicResponse(res, body.model);
}

export default {
  id: 'anthropic',
  name: 'Anthropic',
  category: 'Models',
  site: 'anthropic.com',
  description: 'Claude models for writing, research and decisions.',
  playbooks: ['sales', 'markets'],
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      secret: true,
      required: true,
      placeholder: 'sk-ant-...',
      help: 'Settings → API keys in the Claude Console at platform.claude.com.',
    },
  ],
  models: MODELS,
  defaultModel: DEFAULT_MODEL,
  pricing: anthropicPricing,
  handlers: {
    'llm.complete': complete,
  },
  async test({ conn, io }) {
    await io.http('anthropic.models', `${API}/models`, { headers: auth(conn), query: { limit: 1 }, timeoutMs: 15_000 });
    return { account: `key ${maskSecret(conn.values.apiKey)}` };
  },
};
