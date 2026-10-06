import { ProviderError, maskSecret } from './io.js';

const OPENAI = 'https://api.openai.com/v1';

export const MODELS = ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'];
export const DEFAULT_MODEL = 'gpt-4.1';

// Reasoning models spend part of the completion budget thinking.
const REASONING = /^(o\d|gpt-5)/;
const REASONING_HEADROOM = 8000;

export function baseUrl(values = {}) {
  const raw = String(values.baseUrl || '').trim() || OPENAI;
  try {
    new URL(raw);
  } catch {
    throw new ProviderError(`"${raw}" is not a valid base URL.`, { code: 'bad_request', op: 'openai' });
  }
  return raw.replace(/\/+$/, '');
}

const isOpenAI = (base) => new URL(base).host === 'api.openai.com';

// The connection's "Default model" wins unless the agent picked a different model.
export function resolveOpenAIModel(args, values = {}) {
  const configured = String(values.model || '').trim();
  if (configured && (!args.model || args.model === DEFAULT_MODEL)) return configured;
  return args.model || configured || DEFAULT_MODEL;
}

export function buildChatRequest(args, { model, base }) {
  const maxTokens = Number(args.maxTokens) > 0 ? Math.floor(Number(args.maxTokens)) : 1500;
  const messages = [];
  if (args.system) messages.push({ role: 'system', content: String(args.system) });
  messages.push({ role: 'user', content: String(args.prompt ?? '') });
  const body = { model, messages };
  if (isOpenAI(base)) {
    body.max_completion_tokens = REASONING.test(model) ? maxTokens + REASONING_HEADROOM : maxTokens;
  } else {
    // OpenAI-compatible servers (OpenRouter, Groq, LM Studio, vLLM) still use max_tokens.
    body.max_tokens = maxTokens;
  }
  if (args.json) body.response_format = { type: 'json_object' };
  return body;
}

export function mapChatResponse(res, requestedModel) {
  const choice = res?.choices?.[0];
  const message = choice?.message ?? {};
  if (message.refusal) {
    throw new ProviderError(`The model declined this request: ${String(message.refusal).slice(0, 200)}`, {
      code: 'bad_response',
      op: 'openai.chat',
    });
  }
  const text = typeof message.content === 'string'
    ? message.content.trim()
    : Array.isArray(message.content)
      ? message.content.map((p) => p?.text ?? '').join('').trim()
      : '';
  if (!text && choice?.finish_reason === 'length') {
    throw new ProviderError('The model ran out of tokens before answering. Raise the token limit for this agent.', {
      code: 'bad_response',
      op: 'openai.chat',
    });
  }
  return {
    text,
    tokensIn: res?.usage?.prompt_tokens ?? 0,
    tokensOut: res?.usage?.completion_tokens ?? 0,
    model: res?.model ?? requestedModel,
  };
}

const auth = (conn) => ({ Authorization: `Bearer ${conn.values.apiKey}` });

async function complete(args, { conn, io }) {
  const base = baseUrl(conn.values);
  const model = resolveOpenAIModel(args, conn.values);
  const body = buildChatRequest(args, { model, base });
  const send = (json) =>
    io.http('openai.chat', `${base}/chat/completions`, { headers: auth(conn), json, timeoutMs: 300_000 });
  let res;
  try {
    res = await send(body);
  } catch (err) {
    // Some compatible servers reject json_object; Milo parses JSON from the text anyway.
    if (body.response_format && err instanceof ProviderError && err.code === 'bad_request' && /response_format|json/i.test(err.message)) {
      const { response_format, ...rest } = body;
      res = await send(rest);
    } else {
      throw err;
    }
  }
  return mapChatResponse(res, model);
}

export default {
  id: 'openai',
  name: 'OpenAI',
  category: 'Models',
  site: 'openai.com',
  description: 'GPT models, or any OpenAI-compatible endpoint such as OpenRouter, Groq or LM Studio.',
  playbooks: ['sales', 'markets'],
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      secret: true,
      required: true,
      placeholder: 'sk-...',
      help: 'API keys page at platform.openai.com, or the key from your compatible provider.',
    },
    {
      key: 'baseUrl',
      label: 'Base URL',
      type: 'url',
      placeholder: OPENAI,
      help: 'Leave empty for OpenAI. For OpenRouter use https://openrouter.ai/api/v1.',
    },
    {
      key: 'model',
      label: 'Default model',
      placeholder: DEFAULT_MODEL,
      help: 'Any model name your endpoint accepts. Used unless an agent picks another model.',
    },
  ],
  models: MODELS,
  defaultModel: DEFAULT_MODEL,
  // Prices vary by model and by compatible provider, so cost is not estimated.
  pricing: () => null,
  handlers: {
    'llm.complete': complete,
  },
  async test({ conn, io }) {
    const base = baseUrl(conn.values);
    await io.http('openai.models', `${base}/models`, { headers: auth(conn), timeoutMs: 15_000 });
    const key = `key ${maskSecret(conn.values.apiKey)}`;
    return { account: isOpenAI(base) ? key : `${new URL(base).host} · ${key}` };
  },
};
