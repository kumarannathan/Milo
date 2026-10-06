import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { CAPABILITIES } from '../server/capabilities.js';
import { loadProviders } from '../server/providers/index.js';
import { ProviderError, createIo } from '../server/providers/io.js';
import anthropic, { buildAnthropicRequest, mapAnthropicResponse, anthropicPricing } from '../server/providers/anthropic.js';
import openai, { buildChatRequest, mapChatResponse, resolveOpenAIModel, baseUrl } from '../server/providers/openai.js';
import ollama, { buildOllamaRequest, mapOllamaResponse, resolveOllamaModel, ollamaHost } from '../server/providers/ollama.js';
import tavily, { buildSearchBody, mapTavilyResults, mapTavilyExtract, timeRangeForDays } from '../server/providers/tavily.js';
import apollo, {
  mapApolloOrganization,
  mapApolloPerson,
  mapSeniorities,
  mapApolloEmailStatus,
  buildAccountsQuery,
  formatLocation,
  mapJobPostings,
} from '../server/providers/apollo.js';
import hunter, { mapHunterStatus, mapHunterFinder } from '../server/providers/hunter.js';
import hubspot, { companyProperties, contactProperties, emailProperties, recordUrl } from '../server/providers/hubspot.js';
import email, { stripQuotedReply, buildMessage, mapParsedMessage, filterThreads, normalizeId, mailError, mailSettings } from '../server/providers/email.js';
import slack, { validSlackWebhook, slackText } from '../server/providers/slack.js';
import discord, { validDiscordWebhook, discordContent } from '../server/providers/discord.js';
import cal, { mapCalSlots, buildCalBooking, mapCalBooking } from '../server/providers/cal.js';

const OURS = [anthropic, openai, ollama, tavily, apollo, hunter, hubspot, email, slack, discord, cal];
const CATEGORIES = new Set(['Models', 'Research', 'Data', 'Email', 'CRM', 'Calendar', 'Alerts']);

// A stand-in for io that answers HTTP calls from a route function and records them.
function fakeIo(route) {
  const calls = [];
  return {
    calls,
    async http(op, url, init = {}) {
      calls.push({ op, url, init });
      const out = await route(op, url, init, calls.length);
      if (out instanceof Error) throw out;
      return out;
    },
    async track(op, fn) {
      calls.push({ op });
      return fn();
    },
  };
}

// ── Shape ──────────────────────────────────────────────────────

test('providers: every registered provider has a valid shape', async () => {
  const registry = await loadProviders();
  for (const p of OURS) assert.ok(registry.has(p.id), `${p.id} is registered`);
  for (const p of registry.values()) {
    assert.equal(typeof p.id, 'string', 'id');
    assert.equal(typeof p.name, 'string', `${p.id} name`);
    assert.ok(p.handlers && typeof p.handlers === 'object', `${p.id} handlers`);
    for (const [key, fn] of Object.entries(p.handlers)) {
      assert.ok(CAPABILITIES[key], `${p.id} handler ${key} is a known capability`);
      assert.equal(typeof fn, 'function', `${p.id} ${key} is a function`);
    }
    for (const f of p.fields ?? []) {
      assert.ok(f.key, `${p.id} field has a key`);
      if (f.required) assert.ok(f.label?.trim(), `${p.id}.${f.key} is required and has a label`);
    }
    if (p.test) assert.equal(typeof p.test, 'function', `${p.id} test`);
  }
});

test('providers: the real integrations are complete and consistent', () => {
  const ids = new Set();
  for (const p of OURS) {
    assert.ok(!ids.has(p.id), `${p.id} is unique`);
    ids.add(p.id);
    assert.ok(CATEGORIES.has(p.category), `${p.id} category ${p.category}`);
    assert.equal(typeof p.description, 'string');
    assert.ok(p.description.length < 120 && /\.$/.test(p.description), `${p.id} description is one short sentence`);
    assert.ok(!/!/.test(p.description), `${p.id} description has no exclamation mark`);
    assert.ok(Array.isArray(p.playbooks) && p.playbooks.length, `${p.id} playbooks`);
    assert.ok(Array.isArray(p.fields), `${p.id} fields`);
    assert.equal(typeof p.test, 'function', `${p.id} test`);
    assert.ok(Object.keys(p.handlers).length > 0, `${p.id} serves something`);
    for (const f of p.fields) {
      assert.ok(f.label?.trim(), `${p.id}.${f.key} label`);
      if (f.help) assert.ok(!/!/.test(f.help), `${p.id}.${f.key} help has no exclamation mark`);
    }
    const llm = 'llm.complete' in p.handlers;
    if (llm) {
      assert.ok(p.defaultModel, `${p.id} defaultModel`);
      assert.ok(p.models.includes(p.defaultModel), `${p.id} models include the default`);
      assert.equal(typeof p.pricing, 'function', `${p.id} pricing`);
      assert.deepEqual(p.playbooks, ['sales', 'markets']);
    }
  }
  for (const p of [tavily, slack, discord]) assert.deepEqual(p.playbooks, ['sales', 'markets']);
  for (const p of [apollo, hunter, hubspot, email, cal]) assert.deepEqual(p.playbooks, ['sales']);
});

// ── Anthropic ──────────────────────────────────────────────────

test('anthropic: request maps system, prompt, tokens and model', () => {
  const { body, headers } = buildAnthropicRequest({ system: 'Be brief.', prompt: 'Hello', model: 'claude-haiku-4-5' });
  assert.equal(body.model, 'claude-haiku-4-5');
  assert.equal(body.max_tokens, 1500);
  assert.equal(body.system, 'Be brief.');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello' }]);
  assert.equal(body.output_config, undefined);
  assert.deepEqual(headers, {});

  const opus = buildAnthropicRequest({ prompt: 'Hi', maxTokens: 400 });
  assert.equal(opus.body.model, anthropic.defaultModel);
  assert.ok(opus.body.max_tokens > 400, 'room for thinking on models that always think');
  assert.equal(opus.body.output_config.effort, 'medium');
  assert.equal(opus.body.fallbacks, 'default');
  assert.equal(opus.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
});

test('anthropic: response maps to text and usage, refusals become errors', () => {
  const out = mapAnthropicResponse({
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":' }, { type: 'text', text: 'true}' }],
    usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 5 },
  });
  assert.deepEqual(out, { text: '{"ok":true}', tokensIn: 125, tokensOut: 30, model: 'claude-opus-5-5' });
  assert.throws(() => mapAnthropicResponse({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }), /declined.*cyber/);
  assert.throws(() => mapAnthropicResponse({ stop_reason: 'max_tokens', content: [] }), ProviderError);
  assert.deepEqual(anthropicPricing('claude-opus-5-5'), { in: 4, out: 20 });
  assert.equal(anthropicPricing('some-unknown-model'), null);
});

test('anthropic: handler sends key and version headers', async () => {
  const io = fakeIo(() => ({ model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Hi' }], usage: { input_tokens: 3, output_tokens: 1 } }));
  const res = await anthropic.handlers['llm.complete']({ prompt: 'Hi', model: 'claude-sonnet-5-5' }, { conn: { values: { apiKey: 'sk-ant-test' } }, io });
  assert.equal(res.text, 'Hi');
  const call = io.calls[0];
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(call.init.headers['anthropic-version'], '2023-06-01');
  const t = await anthropic.test({ conn: { values: { apiKey: 'sk-ant-abcd1234' } }, io: fakeIo(() => ({ data: [] })) });
  assert.equal(t.account, 'key ••••1234');
});

// ── OpenAI ─────────────────────────────────────────────────────

test('openai: request and response mapping', () => {
  const body = buildChatRequest({ system: 'S', prompt: 'P', json: true, maxTokens: 300 }, { model: 'gpt-4.1', base: 'https://api.openai.com/v1' });
  assert.deepEqual(body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'P' }]);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.max_completion_tokens, 300);
  const compat = buildChatRequest({ prompt: 'P' }, { model: 'meta-llama/llama-3.1-70b', base: 'https://openrouter.ai/api/v1' });
  assert.equal(compat.max_tokens, 1500);
  assert.equal(compat.response_format, undefined);

  assert.deepEqual(
    mapChatResponse({ model: 'gpt-4.1-2025', choices: [{ message: { content: ' {"a":1} ' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4 } }),
    { text: '{"a":1}', tokensIn: 10, tokensOut: 4, model: 'gpt-4.1-2025' },
  );
  assert.throws(() => mapChatResponse({ choices: [{ message: { content: null, refusal: 'No.' } }] }), /declined/);
  assert.equal(resolveOpenAIModel({ model: 'gpt-4.1' }, { model: 'openai/gpt-4o' }), 'openai/gpt-4o');
  assert.equal(resolveOpenAIModel({ model: 'gpt-4o-mini' }, { model: 'openai/gpt-4o' }), 'gpt-4o-mini');
  assert.equal(baseUrl({ baseUrl: 'https://api.groq.com/openai/v1/' }), 'https://api.groq.com/openai/v1');
  assert.throws(() => baseUrl({ baseUrl: 'not a url' }), ProviderError);
});

test('openai: retries without json mode when a compatible server rejects it', async () => {
  const io = fakeIo((op, url, init) =>
    init.json.response_format
      ? new ProviderError("'response_format.type' must be 'json_schema'", { status: 400, code: 'bad_request' })
      : { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
  );
  const res = await openai.handlers['llm.complete']({ prompt: 'x', json: true }, { conn: { values: { apiKey: 'k', baseUrl: 'http://localhost:1234/v1', model: 'qwen' } }, io });
  assert.equal(res.text, '{"ok":true}');
  assert.equal(io.calls.length, 2);
  assert.equal(io.calls[0].url, 'http://localhost:1234/v1/chat/completions');
  assert.equal(io.calls[1].init.json.model, 'qwen');
});

// ── Ollama ─────────────────────────────────────────────────────

test('ollama: request and response mapping', () => {
  const body = buildOllamaRequest({ system: 'S', prompt: 'P', json: true, maxTokens: 200 }, 'llama3.1');
  assert.equal(body.stream, false);
  assert.equal(body.format, 'json');
  assert.equal(body.options.num_predict, 200);
  assert.deepEqual(mapOllamaResponse({ model: 'llama3.1', message: { content: 'hi ' }, prompt_eval_count: 12, eval_count: 3 }), {
    text: 'hi',
    tokensIn: 12,
    tokensOut: 3,
    model: 'llama3.1',
  });
  assert.equal(resolveOllamaModel({ model: 'llama3.1' }, { model: 'qwen2.5:14b' }), 'qwen2.5:14b');
  assert.equal(ollamaHost({}), 'http://localhost:11434');
  assert.equal(ollamaHost({ host: '192.168.1.5:11434/' }), 'http://192.168.1.5:11434');
  assert.deepEqual(ollama.pricing('anything'), { in: 0, out: 0 });
});

test('ollama: test checks the model is pulled', async () => {
  const io = fakeIo(() => ({ models: [{ name: 'llama3.1:latest' }] }));
  assert.deepEqual(await ollama.test({ conn: { values: {} }, io }), { account: 'http://localhost:11434' });
  await assert.rejects(ollama.test({ conn: { values: { model: 'mistral' } }, io }), /not pulled/);
});

// ── Tavily ─────────────────────────────────────────────────────

test('tavily: search body, days and topic', () => {
  assert.equal(timeRangeForDays(1), 'day');
  assert.equal(timeRangeForDays(7), 'week');
  assert.equal(timeRangeForDays(30), 'month');
  assert.equal(timeRangeForDays(90), 'year');
  assert.equal(timeRangeForDays(undefined), undefined);
  const body = buildSearchBody({ query: 'acme funding', maxResults: 50, days: 14 });
  assert.equal(body.topic, 'general');
  assert.equal(body.max_results, 20);
  assert.equal(body.time_range, 'month');
  assert.equal(buildSearchBody({ query: 'fed rates', topic: 'market' }).topic, 'news');
  assert.equal(buildSearchBody({ query: 'acme' }, { news: true }).topic, 'news');
});

test('tavily: results, extract and the exact day window', () => {
  const now = Date.now();
  const res = {
    results: [
      { title: 'New', url: 'https://a.com/1', content: 'Fresh ', published_date: new Date(now - 2 * 86_400_000).toUTCString() },
      { title: 'Old', url: 'https://a.com/2', content: 'Stale', published_date: new Date(now - 20 * 86_400_000).toUTCString() },
      { title: 'Undated', url: 'https://a.com/3', content: 'No date' },
    ],
  };
  const out = mapTavilyResults(res, 7);
  assert.deepEqual(out.map((r) => r.title), ['New', 'Undated']);
  assert.equal(out[0].snippet, 'Fresh');
  assert.ok(out[0].publishedAt.endsWith('Z'));
  assert.equal(out[1].publishedAt, null);

  const page = mapTavilyExtract({ results: [{ url: 'https://acme.com/about', raw_content: '# About Acme\n\nWe make anvils.' }] }, 'https://acme.com/about');
  assert.deepEqual(page, { url: 'https://acme.com/about', title: 'About Acme', text: '# About Acme\n\nWe make anvils.' });
  assert.throws(() => mapTavilyExtract({ results: [], failed_results: [{ url: 'x', error: 'blocked' }] }, 'x'), /blocked/);
});

test('tavily: news handler and readable auth errors', async () => {
  const io = fakeIo(() => ({ results: [{ title: 'T', url: 'https://n.com', content: 'Summary', published_date: new Date().toISOString() }] }));
  const out = await tavily.handlers['signals.news']({ query: 'acme', days: 7 }, { conn: { values: { apiKey: 'tvly-x' } }, io });
  assert.equal(out.items[0].summary, 'Summary');
  assert.equal(io.calls[0].init.json.topic, 'news');
  assert.equal(io.calls[0].init.headers.Authorization, 'Bearer tvly-x');

  const bad = fakeIo(() => new ProviderError('[object Object]', { status: 401, code: 'auth' }));
  await assert.rejects(tavily.test({ conn: { values: { apiKey: 'tvly-x' } }, io: bad }), (err) => err.code === 'auth' && /rejected/.test(err.message));
});

// ── Apollo ─────────────────────────────────────────────────────

test('apollo: organization mapping', () => {
  const a = mapApolloOrganization({
    id: '5f1',
    name: 'Acme',
    primary_domain: 'acme.com',
    website_url: 'http://www.acme.com',
    industry: 'computer software',
    estimated_num_employees: '850',
    city: 'Austin',
    state: 'Texas',
    country: 'United States',
    linkedin_url: 'http://www.linkedin.com/company/acme',
    annual_revenue: 120000000,
    technology_names: ['Salesforce', 'Segment'],
    short_description: 'Anvils.',
  });
  assert.deepEqual(a, {
    name: 'Acme',
    domain: 'acme.com',
    industry: 'computer software',
    employees: 850,
    location: 'Austin, TX',
    linkedin: 'http://www.linkedin.com/company/acme',
    revenue: 120000000,
    tech: ['Salesforce', 'Segment'],
    description: 'Anvils.',
    externalId: '5f1',
    source: 'apollo',
  });
  assert.equal(mapApolloOrganization({ name: 'B', website_url: 'https://www.b.io/home' }).domain, 'b.io');
  assert.equal(formatLocation('Berlin', 'Berlin', 'Germany'), 'Berlin, Germany');
  assert.equal(formatLocation(null, null, 'Germany'), 'Germany');
  assert.equal(formatLocation('Boston', 'MA', null), 'Boston, MA');
});

test('apollo: search query and seniorities', () => {
  const q = buildAccountsQuery({
    icp: { industries: ['Software'], keywords: ['payments'], employeesMin: 500, employeesMax: 5000, locations: ['United States'] },
    limit: 25,
    page: 2,
    excludeDomains: ['https://www.known.com'],
  });
  assert.deepEqual(q['q_organization_keyword_tags[]'], ['software', 'payments']);
  assert.deepEqual(q['organization_num_employees_ranges[]'], ['500,5000']);
  assert.deepEqual(q['organization_locations[]'], ['United States']);
  assert.deepEqual(q['not_organization_websites_list[]'], ['known.com']);
  assert.equal(q.per_page, 25);
  assert.equal(q.page, 2);
  assert.deepEqual(mapSeniorities('VP, Director, C-suite'), ['vp', 'director', 'c_suite']);
  assert.deepEqual(mapSeniorities(['Vice President', 'Founders', 'nonsense']), ['vp', 'founder']);
  assert.equal(mapApolloEmailStatus('verified'), 'verified');
  assert.equal(mapApolloEmailStatus('likely to engage'), 'likely');
});

test('apollo: person mapping hides obfuscated names and locked emails', () => {
  const p = mapApolloPerson({ id: 'p1', first_name: 'Dana', last_name: 'Ng', name: 'Dana Ng', title: 'VP Sales', email: 'dana@acme.com', email_status: 'verified', city: 'Denver', state: 'Colorado', country: 'United States', seniority: 'vp', linkedin_url: 'https://linkedin.com/in/dana' });
  assert.deepEqual(p, { name: 'Dana Ng', firstName: 'Dana', lastName: 'Ng', title: 'VP Sales', email: 'dana@acme.com', emailStatus: 'verified', linkedin: 'https://linkedin.com/in/dana', location: 'Denver, CO', seniority: 'vp', externalId: 'p1' });
  const hidden = mapApolloPerson({ id: 'p2', first_name: 'Lee', last_name: 'Ch***n', email: 'email_not_unlocked@domain.com' });
  assert.equal(hidden.lastName, null);
  assert.equal(hidden.email, undefined);
});

test('apollo: contacts.search enriches search hits by id', async () => {
  const io = fakeIo((op) => {
    if (op === 'apollo.people_search') return { people: [{ id: 'a', first_name: 'Ana', last_name_obfuscated: 'Ro***z', title: 'VP Sales' }, { id: 'b', first_name: 'Bo', last_name_obfuscated: 'K***' }] };
    if (op === 'apollo.people_match') return { matches: [{ id: 'a', first_name: 'Ana', last_name: 'Ruiz', title: 'VP Sales', email: 'ana@acme.com', email_status: 'verified' }, null] };
    throw new Error(`unexpected ${op}`);
  });
  const out = await apollo.handlers['contacts.search']({ domain: 'www.acme.com', titles: ['VP Sales'], seniorities: ['VP'], limit: 2 }, { conn: { values: { apiKey: 'k' } }, io });
  assert.deepEqual(out.contacts.map((c) => c.name), ['Ana Ruiz']);
  const search = io.calls[0];
  assert.equal(search.url, 'https://api.apollo.io/api/v1/mixed_people/api_search');
  assert.equal(search.init.method, 'POST');
  assert.deepEqual(search.init.query['q_organization_domains_list[]'], ['acme.com']);
  assert.deepEqual(search.init.query['person_seniorities[]'], ['vp']);
  assert.equal(search.init.headers['X-Api-Key'], 'k');
  assert.deepEqual(io.calls[1].init.json.details, [{ id: 'a' }, { id: 'b' }]);
});

test('apollo: 403 does not mark the key as expired', async () => {
  const io = fakeIo(() => new ProviderError('not accessible on your plan', { status: 403, code: 'auth' }));
  await assert.rejects(apollo.handlers['accounts.enrich']({ domain: 'acme.com' }, { conn: { values: { apiKey: 'k' } }, io }), (err) => err.code === 'bad_request');
  const out = mapJobPostings([{ title: 'AE', url: 'https://j/1', city: 'Austin', state: 'Texas', country: 'United States', posted_at: '2026-09-01T00:00:00Z' }], 14);
  assert.equal(out.openRoles, 14);
  assert.deepEqual(out.items[0], { type: 'Hiring', date: '2026-09-01T00:00:00.000Z', title: 'AE (Austin, TX)', url: 'https://j/1' });
});

// ── Hunter ─────────────────────────────────────────────────────

test('hunter: status and finder mapping', () => {
  assert.equal(mapHunterStatus('valid'), 'verified');
  assert.equal(mapHunterStatus('accept_all'), 'likely');
  assert.equal(mapHunterStatus('webmail'), 'likely');
  assert.equal(mapHunterStatus('invalid'), 'invalid');
  assert.equal(mapHunterStatus('disposable'), 'invalid');
  assert.equal(mapHunterStatus('unknown'), 'unknown');
  assert.equal(mapHunterStatus(undefined, 'deliverable'), 'verified');
  assert.equal(mapHunterStatus(undefined, undefined), 'unknown');
  assert.deepEqual(mapHunterFinder({ email: 'dana@acme.com', score: 91 }), { email: 'dana@acme.com', confidence: 91 });
  assert.deepEqual(mapHunterFinder({ email: null, score: null }), { email: null, confidence: 0 });
});

test('hunter: handlers use the header key and the account email', async () => {
  const io = fakeIo((op, url) => (url.endsWith('/account') ? { data: { email: 'owner@acme.com' } } : { status: 200, body: { data: { status: 'accept_all' } } }));
  const conn = { values: { apiKey: 'hk' } };
  assert.deepEqual(await hunter.handlers['email.verify']({ email: 'x@acme.com' }, { conn, io }), { status: 'likely' });
  assert.equal(io.calls[0].init.headers['X-API-KEY'], 'hk');
  assert.equal(io.calls[0].init.query.email, 'x@acme.com');
  assert.deepEqual(await hunter.test({ conn, io }), { account: 'owner@acme.com' });
  assert.deepEqual(await hunter.handlers['email.verify']({ email: 'not-an-email' }, { conn, io }), { status: 'invalid' });
});

// ── HubSpot ────────────────────────────────────────────────────

test('hubspot: property mapping and record links', () => {
  assert.deepEqual(companyProperties({ name: 'Acme', domain: 'https://www.acme.com', employees: 850, location: 'Austin, TX', linkedin: 'https://linkedin.com/company/acme', industry: 'Software' }), {
    name: 'Acme',
    domain: 'acme.com',
    website: 'https://acme.com',
    numberofemployees: '850',
    linkedin_company_page: 'https://linkedin.com/company/acme',
    city: 'Austin',
    state: 'TX',
    country: 'United States',
  });
  assert.deepEqual(contactProperties({ name: 'Dana Ng', email: 'Dana@Acme.com', title: 'VP Sales', accountName: 'Acme' }), {
    email: 'dana@acme.com',
    firstname: 'Dana',
    lastname: 'Ng',
    jobtitle: 'VP Sales',
    company: 'Acme',
  });
  const e = emailProperties({ subject: 'Hi', body: 'Hello', to: 'dana@acme.com', from: 'me@us.com', at: '2026-10-06T10:00:00Z' });
  assert.equal(e.hs_email_direction, 'EMAIL');
  assert.equal(e.hs_timestamp, '2026-10-06T10:00:00.000Z');
  assert.deepEqual(JSON.parse(e.hs_email_headers).to, [{ email: 'dana@acme.com' }]);
  assert.equal(emailProperties({ direction: 'inbound' }).hs_email_direction, 'INCOMING_EMAIL');
  assert.equal(recordUrl({ portalId: 123, uiDomain: 'app-eu1.hubspot.com' }, 'company', '9'), 'https://app-eu1.hubspot.com/contacts/123/record/0-2/9');
  assert.equal(recordUrl({ portalId: 123 }, 'contact', '5'), 'https://app.hubspot.com/contacts/123/record/0-1/5');
  assert.equal(recordUrl(null, 'contact', '5'), undefined);
});

test('hubspot: crm.read finds the company and flags customers', async () => {
  const io = fakeIo((op, url, init) => {
    if (op === 'hubspot.companies_search') {
      assert.deepEqual(init.json.filterGroups[0].filters[0], { propertyName: 'domain', operator: 'EQ', value: 'acme.com' });
      return { results: [{ id: '42', properties: { lifecyclestage: 'customer' } }] };
    }
    if (op === 'hubspot.account') return { portalId: 777, uiDomain: 'app.hubspot.com' };
    throw new Error(`unexpected ${op}`);
  });
  const out = await hubspot.handlers['crm.read']({ domain: 'www.acme.com' }, { conn: { values: { token: 'pat-read-test' } }, io });
  assert.deepEqual(out, { company: { id: '42', url: 'https://app.hubspot.com/contacts/777/record/0-2/42' }, contact: null, isCustomer: true });
  assert.equal(io.calls[0].init.headers.Authorization, 'Bearer pat-read-test');
});

test('hubspot: log_email associates the email with contact and company', async () => {
  const io = fakeIo((op, url, init) => {
    if (op === 'hubspot.email_create') {
      assert.deepEqual(init.json.associations.map((a) => a.types[0].associationTypeId), [198, 186]);
      return { id: 'e1' };
    }
    if (op === 'hubspot.account') return { portalId: 1 };
    throw new Error(`unexpected ${op}`);
  });
  const out = await hubspot.handlers['crm.write']({ op: 'log_email', contactId: '5', companyId: '9', email: { subject: 'Hi', body: 'Hello' } }, { conn: { values: { token: 'pat-log-test' } }, io });
  assert.equal(out.id, 'e1');
  assert.equal(out.url, 'https://app.hubspot.com/contacts/1/record/0-1/5');
});

// ── Email ──────────────────────────────────────────────────────

test('email: strips quoted replies in common formats', () => {
  const gmail = 'Sounds good, Tuesday works.\n\nDana\n\nOn Mon, Oct 6, 2026 at 9:14 AM Sam Lee <sam@us.com> wrote:\n> Hi Dana,\n> Would a quick call help?';
  assert.equal(stripQuotedReply(gmail), 'Sounds good, Tuesday works.\n\nDana');
  const wrapped = 'Yes please.\r\n\r\nOn Mon, Oct 6, 2026 at 9:14 AM Sam Lee <\r\nsam@us.com> wrote:\r\n\r\n> earlier';
  assert.equal(stripQuotedReply(wrapped), 'Yes please.');
  const outlook = 'Not interested, thanks.\n\n________________________________\nFrom: Sam Lee <sam@us.com>\nSent: Monday, October 6, 2026 9:14 AM\nTo: Dana\nSubject: Quick question';
  assert.equal(stripQuotedReply(outlook), 'Not interested, thanks.');
  const outlookPlain = 'Call me.\nFrom: Sam Lee\nSent: Monday\nSubject: Hi\n\nOld text';
  assert.equal(stripQuotedReply(outlookPlain), 'Call me.');
  const interleaved = '> question one?\nAnswer one.\n> question two?\nAnswer two.\n\nSent from my iPhone';
  assert.equal(stripQuotedReply(interleaved), 'Answer one.\nAnswer two.');
  const french = 'Merci.\n\nLe lun. 6 oct. 2026 à 09:14, Sam Lee <sam@us.com> a écrit :\n> Bonjour';
  assert.equal(stripQuotedReply(french), 'Merci.');
  assert.equal(stripQuotedReply('On second thought, Thursday is better.'), 'On second thought, Thursday is better.');
  assert.equal(stripQuotedReply('Thanks\n-- \nDana Ng\nVP Sales'), 'Thanks');
});

test('email: outgoing messages carry ids and thread headers', () => {
  const s = mailSettings({ email: 'sam@us.com', password: 'x', fromName: 'Sam Lee' });
  assert.equal(s.smtpHost, 'smtp.gmail.com');
  assert.equal(s.imapPort, 993);
  const first = buildMessage({ to: 'dana@acme.com', toName: 'Dana', subject: 'Quick question', body: 'Hi Dana' }, s, { id: 'm1' });
  assert.equal(first.messageId, '<m1@us.com>');
  assert.equal(first.threadId, '<m1@us.com>');
  assert.deepEqual(first.mail.from, { name: 'Sam Lee', address: 'sam@us.com' });
  assert.equal(first.mail.inReplyTo, undefined);
  const reply = buildMessage({ to: 'dana@acme.com', subject: 'Quick question', body: 'Following up', threadId: '<m1@us.com>', inReplyTo: 'r1@acme.com' }, s, { id: 'm2' });
  assert.equal(reply.threadId, '<m1@us.com>');
  assert.equal(reply.mail.inReplyTo, '<r1@acme.com>');
  assert.deepEqual(reply.mail.references, ['<m1@us.com>', '<r1@acme.com>']);
  assert.equal(reply.mail.subject, 'Re: Quick question');
  assert.equal(normalizeId(' <a@b> '), '<a@b>');
  assert.equal(normalizeId('a@b'), '<a@b>');
});

test('email: parsed replies map to the thread they answer', () => {
  const parsed = {
    messageId: '<r1@acme.com>',
    inReplyTo: '<m2@us.com>',
    references: ['<m1@us.com>', '<m2@us.com>'],
    from: { value: [{ address: 'Dana@Acme.com', name: 'Dana Ng' }] },
    to: { value: [{ address: 'sam@us.com', name: '' }] },
    subject: 'Re: Quick question',
    text: 'Tuesday works.\n\nOn Mon, Oct 6, 2026 at 9:14 AM Sam <sam@us.com> wrote:\n> Hi',
    date: new Date('2026-10-06T15:00:00Z'),
  };
  const m = mapParsedMessage(parsed);
  assert.equal(m.threadId, '<m1@us.com>');
  assert.equal(m.inReplyTo, '<m2@us.com>');
  assert.equal(m.from, 'dana@acme.com');
  assert.equal(m.fromName, 'Dana Ng');
  assert.equal(m.to, 'sam@us.com');
  assert.equal(m.body, 'Tuesday works.');
  assert.equal(m.at, '2026-10-06T15:00:00.000Z');

  // A client that only kept In-Reply-To still lands in the right thread.
  const sparse = mapParsedMessage({ ...parsed, references: undefined, inReplyTo: '<m1@us.com>' });
  assert.deepEqual(filterThreads([sparse], ['<m1@us.com>']).map((x) => x.threadId), ['<m1@us.com>']);
  assert.equal(filterThreads([m], ['<other@us.com>']).length, 0);
  assert.equal(filterThreads([m], []).length, 1);
});

test('email: login failures become auth errors', () => {
  assert.equal(mailError(Object.assign(new Error('Invalid login: 535'), { code: 'EAUTH', responseCode: 535 }), 'smtp.send', 'smtp.gmail.com').code, 'auth');
  assert.equal(mailError(Object.assign(new Error('Command failed'), { authenticationFailed: true }), 'imap.fetch', 'imap.gmail.com').code, 'auth');
  assert.equal(mailError(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }), 'smtp.send', 'smtp.nope.test').code, 'network');
  assert.equal(mailError(Object.assign(new Error('Recipient rejected'), { code: 'EENVELOPE', responseCode: 550 }), 'smtp.send', 'smtp.gmail.com').code, 'bad_request');
});

// ── Alerts ─────────────────────────────────────────────────────

test('slack: validates webhooks without posting on test', async () => {
  assert.ok(validSlackWebhook('https://hooks.slack.com/services/T000/B000/abcdEFGH1234'));
  assert.ok(!validSlackWebhook('https://example.com/services/T000'));
  assert.equal(slackText('Score < 50 & falling', 'warn'), 'Warning: Score &lt; 50 &amp; falling');
  const io = fakeIo(() => 'ok');
  const t = await slack.test({ conn: { values: { webhookUrl: 'https://hooks.slack.com/services/T000/B000/abcdEFGH1234' } }, io });
  assert.equal(t.account, 'webhook ••••1234');
  assert.equal(io.calls.length, 0);
  await assert.rejects(slack.test({ conn: { values: { webhookUrl: 'https://example.com/hook' } }, io }), /Slack incoming webhook/);
  const gone = fakeIo(() => new ProviderError('no_team', { status: 404, code: 'not_found' }));
  await assert.rejects(
    slack.handlers['notify.post']({ text: 'hi' }, { conn: { values: { webhookUrl: 'https://hooks.slack.com/services/T000/B000/abcd' } }, io: gone }),
    (err) => err.code === 'auth',
  );
});

test('discord: posts without mentions and names the webhook', async () => {
  const url = 'https://discord.com/api/webhooks/123456/abc-DEF_9';
  assert.ok(validDiscordWebhook(url));
  assert.ok(!validDiscordWebhook('https://discord.com/channels/1/2'));
  assert.equal(discordContent('x'.repeat(2500)).length, 2000);
  const io = fakeIo((op) => (op === 'discord.webhook_info' ? { name: 'milo-alerts', channel_id: '1' } : ''));
  assert.deepEqual(await discord.test({ conn: { values: { webhookUrl: url } }, io }), { account: '#milo-alerts' });
  await discord.handlers['notify.post']({ text: 'Run failed', level: 'error' }, { conn: { values: { webhookUrl: url } }, io });
  assert.deepEqual(io.calls[1].init.json, { content: '**Error:** Run failed', allowed_mentions: { parse: [] } });
});

// ── Cal.com ────────────────────────────────────────────────────

test('cal: slots and bookings', () => {
  const slots = mapCalSlots({
    '2026-10-08': [{ start: '2026-10-08T15:00:00.000Z', end: '2026-10-08T15:30:00.000Z' }],
    '2026-10-07': [{ start: '2026-10-07T14:30:00.000Z' }],
  }, 30);
  assert.deepEqual(slots, [
    { start: '2026-10-07T14:30:00.000Z', end: '2026-10-07T15:00:00.000Z' },
    { start: '2026-10-08T15:00:00.000Z', end: '2026-10-08T15:30:00.000Z' },
  ]);
  const body = buildCalBooking(
    { title: 'Intro', start: '2026-10-07T14:30:00Z', durationMin: 30, attendees: [{ email: 'dana@acme.com', name: 'Dana' }, { email: 'cto@acme.com' }], description: 'Context' },
    { eventTypeId: 42, timeZone: 'America/Chicago' },
  );
  assert.deepEqual(body.attendee, { name: 'Dana', email: 'dana@acme.com', timeZone: 'America/Chicago' });
  assert.deepEqual(body.guests, ['cto@acme.com']);
  assert.equal(body.eventTypeId, 42);
  assert.throws(() => buildCalBooking({ start: '2026-10-07T14:30:00Z', attendees: [] }, { eventTypeId: 1 }), ProviderError);
  assert.deepEqual(mapCalBooking({ id: 9, uid: 'bk_1', meetingUrl: 'https://cal.com/video/x' }), { eventId: 'bk_1', link: 'https://cal.com/video/x' });
  assert.deepEqual(mapCalBooking({ id: 9, uid: 'bk_2', location: 'Phone' }), { eventId: 'bk_2', link: 'https://cal.com/booking/bk_2' });
});

// ── Email, end to end against local SMTP and IMAP stand-ins ────

function lineServer(greeting, onLine) {
  return net.createServer((sock) => {
    sock.on('error', () => {});
    sock.write(greeting);
    let buf = '';
    const state = {};
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        onLine(line, sock, state);
      }
    });
  });
}

const PASS = 'app-pass';

function smtpStandIn(sent) {
  return lineServer('220 mock ESMTP\r\n', (line, sock, st) => {
    if (st.data) {
      if (line === '.') {
        st.data = false;
        sent.push(st.mail);
        st.mail = '';
        sock.write('250 queued\r\n');
      } else st.mail = (st.mail ?? '') + line + '\r\n';
      return;
    }
    const [cmd, method, initial] = line.split(' ');
    switch (cmd.toUpperCase()) {
      case 'EHLO':
        return sock.write('250-mock\r\n250 AUTH PLAIN\r\n');
      case 'AUTH': {
        const pass = Buffer.from(initial ?? '', 'base64').toString().split('\0')[2];
        return sock.write(method.toUpperCase() === 'PLAIN' && pass === PASS ? '235 ok\r\n' : '535 5.7.8 Username and Password not accepted\r\n');
      }
      case 'DATA':
        st.data = true;
        return sock.write('354 go\r\n');
      case 'QUIT':
        sock.write('221 bye\r\n');
        return sock.end();
      default:
        return sock.write('250 ok\r\n');
    }
  });
}

function imapStandIn(messages, log) {
  return lineServer('* OK [CAPABILITY IMAP4rev1] mock ready\r\n', (line, sock) => {
    log.push(line);
    const [tag, ...rest] = line.split(' ');
    const cmd = rest.join(' ').toUpperCase();
    if (cmd.startsWith('CAPABILITY')) sock.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`);
    else if (cmd.startsWith('LOGIN')) sock.write(line.includes(PASS) ? `${tag} OK logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
    else if (cmd.startsWith('LIST')) sock.write(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK done\r\n`);
    else if (cmd.startsWith('SELECT')) sock.write(`* ${messages.length} EXISTS\r\n* OK [UIDVALIDITY 1] ok\r\n${tag} OK [READ-WRITE] selected\r\n`);
    else if (cmd.startsWith('UID SEARCH')) sock.write(`* SEARCH ${messages.map((_, n) => n + 1).join(' ')}\r\n${tag} OK done\r\n`);
    else if (cmd.startsWith('UID FETCH')) {
      messages.forEach((m, n) => {
        const bytes = Buffer.from(m);
        sock.write(`* ${n + 1} FETCH (UID ${n + 1} INTERNALDATE "06-Oct-2026 15:00:00 +0000" BODY[]<0> {${bytes.length}}\r\n`);
        sock.write(bytes);
        sock.write(')\r\n');
      });
      sock.write(`${tag} OK done\r\n`);
    } else if (cmd.startsWith('LOGOUT')) {
      sock.write(`* BYE\r\n${tag} OK bye\r\n`);
      sock.end();
    } else sock.write(`${tag} OK done\r\n`);
  });
}

test('email: sends with thread headers and reads replies over SMTP and IMAP', async () => {
  const reply = [
    'Message-ID: <r1@acme.test>',
    'In-Reply-To: <m1@us.test>',
    'References: <m1@us.test>',
    'From: Dana Ng <dana@acme.test>',
    'To: sam@us.test',
    'Subject: Re: Quick question',
    'Date: Mon, 06 Oct 2026 15:00:00 +0000',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Tuesday at 10 works.',
    '',
    'On Mon, Oct 6, 2026 at 9:14 AM Sam Lee <sam@us.test> wrote:',
    '> Would a quick call help?',
    '',
  ].join('\r\n');
  const digest = ['Message-ID: <n1@news.test>', 'From: News <news@news.test>', 'To: sam@us.test', 'Subject: Digest', 'Date: Mon, 06 Oct 2026 16:00:00 +0000', 'Content-Type: text/html', '', '<p>Hello <b>world</b></p>', ''].join('\r\n');
  const sent = [];
  const log = [];
  const smtp = smtpStandIn(sent);
  const imap = imapStandIn([reply, digest], log);
  const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  const values = { email: 'sam@us.test', password: PASS, fromName: 'Sam Lee', smtpHost: '127.0.0.1', smtpPort: String(await listen(smtp)), imapHost: '127.0.0.1', imapPort: String(await listen(imap)) };
  const ops = [];
  const io = createIo({ onCall: (c) => ops.push(`${c.op}:${c.status}`) });
  const conn = { values };
  try {
    assert.deepEqual(await email.test({ conn, io }), { account: 'sam@us.test' });

    const first = await email.handlers['email.send']({ to: 'dana@acme.test', toName: 'Dana Ng', subject: 'Quick question', body: 'Hi Dana' }, { conn, io });
    assert.match(first.messageId, /^<[0-9a-f-]+@us\.test>$/);
    assert.equal(first.threadId, first.messageId);
    const second = await email.handlers['email.send']({ to: 'dana@acme.test', subject: 'Quick question', body: 'Following up', threadId: first.threadId, inReplyTo: first.messageId }, { conn, io });
    assert.equal(second.threadId, first.messageId);
    assert.ok(sent[0].includes('From: Sam Lee <sam@us.test>'));
    assert.ok(sent[1].includes(`Message-ID: ${second.messageId}`));
    assert.ok(sent[1].includes(`In-Reply-To: ${first.messageId}`));
    assert.ok(sent[1].includes(`References: ${first.messageId}`));
    assert.ok(sent[1].includes('Subject: Re: Quick question'));

    const all = await email.handlers['email.read']({ since: '2026-10-01T00:00:00Z' }, { conn, io });
    assert.deepEqual(all.messages[0], {
      messageId: '<r1@acme.test>',
      threadId: '<m1@us.test>',
      inReplyTo: '<m1@us.test>',
      from: 'dana@acme.test',
      fromName: 'Dana Ng',
      to: 'sam@us.test',
      subject: 'Re: Quick question',
      body: 'Tuesday at 10 works.',
      at: '2026-10-06T15:00:00.000Z',
    });
    assert.equal(all.messages[1].body, 'Hello world');
    const threaded = await email.handlers['email.read']({ since: '2026-10-01T00:00:00Z', threadIds: ['<m1@us.test>'] }, { conn, io });
    assert.deepEqual(threaded.messages.map((m) => m.messageId), ['<r1@acme.test>']);
    assert.equal((await email.handlers['email.read']({ since: '2026-10-07T00:00:00Z' }, { conn, io })).messages.length, 0);
    assert.ok(log.some((l) => /UID FETCH .*BODY\.PEEK\[\]/i.test(l)), 'reads without marking messages as seen');

    const bad = { values: { ...values, password: 'wrong' } };
    await assert.rejects(email.handlers['email.send']({ to: 'x@y.test', subject: 's', body: 'b' }, { conn: bad, io }), (e) => e.code === 'auth');
    await assert.rejects(email.handlers['email.read']({ since: '2026-10-01' }, { conn: bad, io }), (e) => e.code === 'auth');
    assert.ok(ops.includes('smtp.send:401') && ops.includes('imap.fetch:401'));
  } finally {
    smtp.close();
    imap.close();
  }
});
