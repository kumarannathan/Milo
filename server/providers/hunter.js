import { ProviderError } from './io.js';

const API = 'https://api.hunter.io/v2';

export function mapHunterStatus(status, result) {
  switch (String(status ?? '').toLowerCase()) {
    case 'valid':
      return 'verified';
    case 'accept_all':
    case 'webmail':
      return 'likely';
    case 'invalid':
    case 'disposable':
      return 'invalid';
    case 'unknown':
      return 'unknown';
  }
  // `result` is the older, coarser field.
  switch (String(result ?? '').toLowerCase()) {
    case 'deliverable':
      return 'verified';
    case 'risky':
      return 'likely';
    case 'undeliverable':
      return 'invalid';
    default:
      return 'unknown';
  }
}

export function mapHunterFinder(data) {
  const email = data?.email || null;
  const score = Number(data?.score);
  return { email, confidence: email && Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hunter(io, conn, op, path, query, extra = {}) {
  return io
    .http(op, `${API}${path}`, { headers: { 'X-API-KEY': conn.values.apiKey }, query, timeoutMs: 30_000, ...extra })
    .catch((err) => {
      if (err instanceof ProviderError && err.code === 'auth') {
        throw new ProviderError('Hunter rejected the API key.', { status: err.status, code: 'auth', op });
      }
      throw err;
    });
}

async function find(args, { conn, io }) {
  const domain = String(args.domain ?? '').trim().toLowerCase().replace(/^www\./, '');
  if (!domain || !args.firstName || !args.lastName) return { email: null, confidence: 0 };
  try {
    const res = await hunter(io, conn, 'hunter.email_finder', '/email-finder', {
      domain,
      first_name: args.firstName,
      last_name: args.lastName,
    });
    return mapHunterFinder(res?.data);
  } catch (err) {
    // 404: nothing found. 451: the person asked Hunter not to process their data.
    if (err instanceof ProviderError && (err.status === 404 || err.status === 451)) return { email: null, confidence: 0 };
    throw err;
  }
}

async function verify(args, { conn, io }) {
  const email = String(args.email ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: 'invalid' };
  // 202 means Hunter is still checking; the same request can be repeated without extra cost.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await hunter(io, conn, 'hunter.email_verifier', '/email-verifier', { email }, { raw: true, timeoutMs: 45_000 });
    if (res.status === 200) return { status: mapHunterStatus(res.body?.data?.status, res.body?.data?.result) };
    if (res.status !== 202) return { status: 'unknown' };
    await sleep(3000);
  }
  return { status: 'unknown' };
}

export default {
  id: 'hunter',
  name: 'Hunter',
  category: 'Data',
  site: 'hunter.io',
  description: 'Finds and verifies work email addresses.',
  playbooks: ['sales'],
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      secret: true,
      required: true,
      help: 'API page under your account settings in Hunter.',
    },
  ],
  handlers: {
    'email.find': find,
    'email.verify': verify,
  },
  async test({ conn, io }) {
    const res = await hunter(io, conn, 'hunter.account', '/account', undefined, { timeoutMs: 15_000 });
    return { account: res?.data?.email ?? 'connected' };
  },
};
