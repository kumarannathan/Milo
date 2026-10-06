import { ProviderError, maskSecret } from './io.js';

const API = 'https://api.apollo.io/api/v1';

const US_STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'puerto rico': 'PR',
};
const US_NAMES = new Set(['united states', 'united states of america', 'us', 'usa']);

export function normalizeDomain(value) {
  if (!value) return null;
  const s = String(value).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  return s.split(/[/?#]/)[0] || null;
}

// "San Francisco, CA" for US locations, "Berlin, Germany" elsewhere.
export function formatLocation(city, state, country) {
  const c = (city ?? '').trim();
  const s = (state ?? '').trim();
  const n = (country ?? '').trim();
  const abbr = US_STATES[s.toLowerCase()] ?? (/^[A-Z]{2}$/.test(s) ? s : null);
  const isUS = US_NAMES.has(n.toLowerCase()) || (!n && abbr);
  const parts = isUS ? [c, abbr ?? s] : [c || s, n];
  const out = parts.filter(Boolean).join(', ');
  return out || null;
}

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function mapApolloOrganization(o) {
  if (!o) return null;
  const tech = o.technology_names?.length ? o.technology_names : (o.current_technologies ?? []).map((t) => t.name).filter(Boolean);
  return {
    name: o.name ?? null,
    domain: normalizeDomain(o.primary_domain ?? o.domain ?? o.website_url),
    industry: o.industry ?? null,
    employees: toNumber(o.estimated_num_employees),
    location: formatLocation(o.city, o.state, o.country),
    linkedin: o.linkedin_url ?? null,
    revenue: toNumber(o.annual_revenue ?? o.organization_revenue),
    tech: tech.length ? tech : undefined,
    description: o.short_description ?? o.seo_description ?? undefined,
    externalId: o.organization_id ?? o.id ?? undefined,
    source: 'apollo',
  };
}

const SENIORITY = {
  owner: 'owner', founder: 'founder', 'co-founder': 'founder', cofounder: 'founder',
  'c-suite': 'c_suite', 'c suite': 'c_suite', c_suite: 'c_suite', csuite: 'c_suite', cxo: 'c_suite', executive: 'c_suite', chief: 'c_suite',
  partner: 'partner', vp: 'vp', 'vice president': 'vp', svp: 'vp', evp: 'vp', head: 'head',
  director: 'director', manager: 'manager', senior: 'senior', entry: 'entry', intern: 'intern',
};

export function mapSeniorities(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(',');
  const out = new Set();
  for (const raw of list) {
    const key = String(raw).trim().toLowerCase().replace(/s$/, '');
    const hit = SENIORITY[key] ?? SENIORITY[key.replace(/[-_]/g, ' ')];
    if (hit) out.add(hit);
  }
  return [...out];
}

export function mapApolloEmailStatus(status) {
  switch (String(status ?? '').toLowerCase()) {
    case 'verified':
      return 'verified';
    case 'likely to engage':
    case 'likely_to_engage':
    case 'guessed':
    case 'extrapolated':
      return 'likely';
    case 'bounced':
    case 'invalid':
      return 'invalid';
    default:
      return status ? 'unknown' : undefined;
  }
}

const realEmail = (email) => (email && /@/.test(email) && !/not_unlocked|@domain\.com$/i.test(email) ? email : undefined);
const obfuscated = (s) => !s || /\*/.test(s);

export function mapApolloPerson(p) {
  if (!p) return null;
  const firstName = p.first_name ?? null;
  const lastName = obfuscated(p.last_name) ? null : p.last_name;
  const email = realEmail(p.email);
  return {
    name: p.name && !obfuscated(p.name) ? p.name : [firstName, lastName].filter(Boolean).join(' '),
    firstName,
    lastName,
    title: p.title ?? null,
    email,
    emailStatus: email ? mapApolloEmailStatus(p.email_status) : undefined,
    linkedin: p.linkedin_url ?? undefined,
    location: formatLocation(p.city, p.state, p.country) ?? undefined,
    seniority: p.seniority ?? undefined,
    externalId: p.id ?? undefined,
  };
}

export function buildAccountsQuery(args) {
  const icp = args.icp ?? {};
  const tags = [...(icp.industries ?? []), ...(icp.keywords ?? [])].map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const query = {
    'q_organization_keyword_tags[]': tags.length ? [...new Set(tags)] : undefined,
    'organization_locations[]': icp.locations?.length ? icp.locations : undefined,
    per_page: Math.min(Math.max(Number(args.limit) || 25, 1), 100),
    page: Math.max(Number(args.page) || 1, 1),
  };
  const min = toNumber(icp.employeesMin);
  const max = toNumber(icp.employeesMax);
  if (min || max) query['organization_num_employees_ranges[]'] = [`${min ?? 1},${max ?? 1000000}`];
  const exclude = (args.excludeDomains ?? []).map(normalizeDomain).filter(Boolean).slice(0, 200);
  if (exclude.length) query['not_organization_websites_list[]'] = exclude;
  return query;
}

// 401 means a bad key. Apollo uses 403 for endpoints the plan or key type can't use,
// which should not mark the connection as expired.
async function apollo(io, conn, op, path, init = {}) {
  const headers = { 'X-Api-Key': conn.values.apiKey, 'Cache-Control': 'no-cache' };
  try {
    return await io.http(op, `${API}${path}`, { ...init, headers, timeoutMs: init.timeoutMs ?? 30_000 });
  } catch (err) {
    if (err instanceof ProviderError && err.status === 403) {
      throw new ProviderError(`Apollo does not allow this with your plan or key: ${err.message}`, { status: 403, code: 'bad_request', op });
    }
    if (err instanceof ProviderError && err.code === 'auth') {
      throw new ProviderError('Apollo rejected the API key.', { status: err.status, code: 'auth', op });
    }
    throw err;
  }
}

async function searchAccounts(args, { conn, io }) {
  const res = await apollo(io, conn, 'apollo.org_search', '/mixed_companies/search', {
    method: 'POST',
    query: buildAccountsQuery(args),
    json: {},
  });
  const exclude = new Set((args.excludeDomains ?? []).map(normalizeDomain));
  const seen = new Set();
  const accounts = [];
  for (const o of [...(res?.accounts ?? []), ...(res?.organizations ?? [])]) {
    const a = mapApolloOrganization(o);
    if (!a?.domain || exclude.has(a.domain) || seen.has(a.domain)) continue;
    seen.add(a.domain);
    accounts.push(a);
  }
  return { accounts: accounts.slice(0, Number(args.limit) || accounts.length) };
}

async function enrichAccount(args, { conn, io }) {
  const domain = normalizeDomain(args.domain);
  if (!domain) throw new ProviderError('A domain is needed to look up a company.', { code: 'bad_request', op: 'apollo.org_enrich' });
  const res = await apollo(io, conn, 'apollo.org_enrich', '/organizations/enrich', { query: { domain } });
  return { account: mapApolloOrganization(res?.organization) };
}

async function searchContacts(args, { conn, io }) {
  const domain = normalizeDomain(args.domain);
  if (!domain) throw new ProviderError('A domain is needed to find people.', { code: 'bad_request', op: 'apollo.people_search' });
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 100);
  const seniorities = mapSeniorities(args.seniorities);
  const found = await apollo(io, conn, 'apollo.people_search', '/mixed_people/api_search', {
    method: 'POST',
    query: {
      'q_organization_domains_list[]': [domain],
      'person_titles[]': args.titles?.length ? args.titles : undefined,
      'person_seniorities[]': seniorities.length ? seniorities : undefined,
      per_page: limit,
      page: 1,
    },
    json: {},
  });
  const people = (found?.people ?? []).slice(0, limit);
  if (!people.length) return { contacts: [] };

  // Search hides last names and emails; enrichment by id reveals them (1 credit per match).
  const enriched = new Map();
  for (let i = 0; i < people.length; i += 10) {
    const batch = people.slice(i, i + 10);
    const res = await apollo(io, conn, 'apollo.people_match', '/people/bulk_match', {
      json: { details: batch.map((p) => ({ id: p.id })), reveal_personal_emails: false, reveal_phone_number: false },
    });
    for (const m of res?.matches ?? []) if (m?.id) enriched.set(m.id, m);
  }
  const contacts = people
    .map((p) => mapApolloPerson({ ...p, ...(enriched.get(p.id) ?? {}) }))
    .filter((c) => c?.firstName && c.lastName);
  return { contacts };
}

async function enrichContact(args, { conn, io }) {
  const c = args.contact ?? {};
  const domain = normalizeDomain(c.domain ?? (c.email ? c.email.split('@')[1] : null));
  // Apollo ids are 24 hex characters; ids from other sources are ignored.
  const query = /^[a-f0-9]{24}$/i.test(c.externalId ?? '')
    ? { id: c.externalId }
    : {
        first_name: c.firstName,
        last_name: c.lastName,
        name: c.firstName ? undefined : c.name,
        email: c.email,
        domain: domain ?? undefined,
        organization_name: c.accountName ?? c.company ?? undefined,
        linkedin_url: c.linkedin,
      };
  const res = await apollo(io, conn, 'apollo.people_match', '/people/match', {
    method: 'POST',
    query: { ...query, reveal_personal_emails: false, reveal_phone_number: false },
    json: {},
  });
  const mapped = mapApolloPerson(res?.person);
  if (!mapped) return { contact: c };
  const merged = { ...c };
  for (const [k, v] of Object.entries(mapped)) if (v != null && v !== '') merged[k] = v;
  return { contact: merged };
}

export function mapJobPostings(postings, total) {
  const items = (postings ?? [])
    .map((j) => {
      const at = Date.parse(j.posted_at ?? j.last_seen_at ?? '');
      const where = formatLocation(j.city, j.state, j.country);
      return {
        type: 'Hiring',
        date: Number.isNaN(at) ? null : new Date(at).toISOString(),
        title: where ? `${j.title} (${where})` : j.title,
        url: j.url ?? null,
      };
    })
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  return { openRoles: Number(total) || items.length, items: items.slice(0, 10) };
}

async function hiring(args, { conn, io }) {
  const domain = normalizeDomain(args.domain);
  if (!domain) return { openRoles: 0, items: [] };
  const org = await apollo(io, conn, 'apollo.org_enrich', '/organizations/enrich', { query: { domain } });
  const id = org?.organization?.id;
  if (!id) return { openRoles: 0, items: [] };
  const res = await apollo(io, conn, 'apollo.job_postings', `/organizations/${encodeURIComponent(id)}/job_postings`, {
    query: { page: 1, per_page: 50 },
  });
  return mapJobPostings(res?.organization_job_postings, res?.pagination?.total_entries);
}

export default {
  id: 'apollo',
  name: 'Apollo',
  category: 'Data',
  site: 'apollo.io',
  description: 'Company and contact search, enrichment and job postings.',
  playbooks: ['sales'],
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      secret: true,
      required: true,
      help: 'Settings → Integrations → API in Apollo. A master key covers every endpoint.',
    },
  ],
  handlers: {
    'accounts.search': searchAccounts,
    'accounts.enrich': enrichAccount,
    'contacts.search': searchContacts,
    'contacts.enrich': enrichContact,
    'signals.hiring': hiring,
  },
  async test({ conn, io }) {
    const res = await apollo(io, conn, 'apollo.health', '/auth/health', { timeoutMs: 15_000 });
    if (!res?.is_logged_in) throw new ProviderError('Apollo rejected the API key.', { status: 401, code: 'auth', op: 'apollo.health' });
    return { account: `key ${maskSecret(conn.values.apiKey)}` };
  },
};
