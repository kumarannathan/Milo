import { ProviderError } from './io.js';

const API = 'https://api.hubapi.com';
// Semantic v3 object endpoints are supported until September 2027. Associations use the
// date-based path because v4 associations are retired first (March 2027).
const OBJECTS = `${API}/crm/v3/objects`;
const ASSOCIATIONS = `${API}/crm/objects/2026-09`;

// HubSpot-defined association type ids.
const ASSOC = {
  noteToContact: 202,
  noteToCompany: 190,
  emailToContact: 198,
  emailToCompany: 186,
};

export function normalizeDomain(value) {
  if (!value) return null;
  const s = String(value).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  return s.split(/[/?#]/)[0] || null;
}

export function recordUrl(account, type, id) {
  if (!account?.portalId || !id) return undefined;
  const objectTypeId = type === 'company' ? '0-2' : '0-1';
  return `https://${account.uiDomain || 'app.hubspot.com'}/contacts/${account.portalId}/record/${objectTypeId}/${id}`;
}

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// "Austin, TX" → city/state; "Berlin, Germany" → city/country.
function splitLocation(location) {
  const parts = String(location ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { city: parts[0] };
  if (parts.length === 2) return /^[A-Z]{2}$/.test(parts[1]) ? { city: parts[0], state: parts[1], country: 'United States' } : { city: parts[0], country: parts[1] };
  return { city: parts[0], state: parts[1], country: parts[2] };
}

export function companyProperties(company = {}) {
  const domain = normalizeDomain(company.domain);
  const employees = Number(company.employees);
  const revenue = Number(company.revenue);
  return clean({
    name: company.name,
    domain,
    website: domain ? `https://${domain}` : undefined,
    numberofemployees: Number.isFinite(employees) && employees > 0 ? String(Math.round(employees)) : undefined,
    annualrevenue: Number.isFinite(revenue) && revenue > 0 ? String(Math.round(revenue)) : undefined,
    description: company.description,
    linkedin_company_page: company.linkedin,
    ...splitLocation(company.location),
  });
}

export function contactProperties(contact = {}) {
  const [first, ...rest] = String(contact.name ?? '').trim().split(/\s+/);
  return clean({
    email: contact.email ? String(contact.email).trim().toLowerCase() : undefined,
    firstname: contact.firstName ?? (first || undefined),
    lastname: contact.lastName ?? (rest.join(' ') || undefined),
    jobtitle: contact.title,
    company: contact.accountName ?? contact.company,
  });
}

export function emailProperties(email = {}, now = new Date()) {
  const incoming = email.direction === 'inbound' || email.direction === 'incoming';
  const headers = clean({
    from: email.from ? { email: email.from, firstName: email.fromName } : undefined,
    to: email.to ? [{ email: email.to, firstName: email.toName }] : undefined,
  });
  return clean({
    hs_timestamp: new Date(email.at ?? now).toISOString(),
    hs_email_direction: incoming ? 'INCOMING_EMAIL' : 'EMAIL',
    hs_email_status: 'SENT',
    hs_email_subject: email.subject,
    hs_email_text: email.body,
    hs_email_headers: Object.keys(headers).length ? JSON.stringify(headers) : undefined,
  });
}

// Note bodies are rich text: escape and keep line breaks.
export function noteHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

const assoc = (id, typeId) => (id ? { to: { id: String(id) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }] } : null);

// Portal id and UI domain, cached per token, to build links to records.
const accounts = new Map();

async function hubspot(io, conn, op, url, init = {}) {
  try {
    return await io.http(op, url, {
      ...init,
      headers: { Authorization: `Bearer ${conn.values.token}` },
      timeoutMs: init.timeoutMs ?? 30_000,
    });
  } catch (err) {
    // 403 keeps HubSpot's message, which names the missing scopes.
    if (err instanceof ProviderError && err.status === 401) {
      throw new ProviderError('HubSpot rejected the private app token.', { status: 401, code: 'auth', op });
    }
    throw err;
  }
}

async function accountInfo(io, conn) {
  const key = conn.values.token;
  if (accounts.has(key)) return accounts.get(key);
  try {
    const res = await hubspot(io, conn, 'hubspot.account', `${API}/account-info/v3/details`, { timeoutMs: 15_000 });
    const info = { portalId: res?.portalId, uiDomain: res?.uiDomain };
    accounts.set(key, info);
    return info;
  } catch (err) {
    // Links are a nicety: only a rejected token is worth failing for.
    if (err instanceof ProviderError && err.status === 401) throw err;
    accounts.set(key, null);
    return null;
  }
}

async function findOne(io, conn, type, property, value, properties) {
  if (!value) return null;
  const res = await hubspot(io, conn, `hubspot.${type}_search`, `${OBJECTS}/${type}/search`, {
    json: {
      filterGroups: [{ filters: [{ propertyName: property, operator: 'EQ', value: String(value) }] }],
      properties,
      limit: 1,
    },
  });
  return res?.results?.[0] ?? null;
}

async function read(args, { conn, io }) {
  const domain = normalizeDomain(args.domain);
  const email = args.email ? String(args.email).trim().toLowerCase() : null;
  const [company, contact] = await Promise.all([
    findOne(io, conn, 'companies', 'domain', domain, ['name', 'domain', 'lifecyclestage']),
    findOne(io, conn, 'contacts', 'email', email, ['email', 'firstname', 'lastname', 'lifecyclestage']),
  ]);
  const account = company || contact ? await accountInfo(io, conn) : null;
  return {
    company: company ? { id: company.id, url: recordUrl(account, 'company', company.id) } : null,
    contact: contact ? { id: contact.id, url: recordUrl(account, 'contact', contact.id) } : null,
    isCustomer: company?.properties?.lifecyclestage === 'customer' || contact?.properties?.lifecyclestage === 'customer',
  };
}

async function upsert(io, conn, type, existingId, properties) {
  if (existingId) {
    const res = await hubspot(io, conn, `hubspot.${type}_update`, `${OBJECTS}/${type}/${existingId}`, { method: 'PATCH', json: { properties } });
    return res?.id ?? existingId;
  }
  const res = await hubspot(io, conn, `hubspot.${type}_create`, `${OBJECTS}/${type}`, { json: { properties } });
  return res?.id;
}

async function upsertCompany(args, io, conn) {
  const properties = companyProperties(args.company);
  if (!properties.domain && !properties.name) throw new ProviderError('A company needs a name or domain.', { code: 'bad_request', op: 'hubspot.companies_create' });
  const existing = args.companyId ?? (await findOne(io, conn, 'companies', 'domain', properties.domain, ['domain']))?.id;
  return { id: await upsert(io, conn, 'companies', existing, properties), type: 'company' };
}

async function upsertContact(args, io, conn) {
  const properties = contactProperties(args.contact);
  if (!properties.email && !properties.lastname) throw new ProviderError('A contact needs an email or a name.', { code: 'bad_request', op: 'hubspot.contacts_create' });
  const existing = args.contactId ?? (await findOne(io, conn, 'contacts', 'email', properties.email, ['email']))?.id;
  const id = await upsert(io, conn, 'contacts', existing, properties);
  if (id && args.companyId) {
    await hubspot(io, conn, 'hubspot.associate', `${ASSOCIATIONS}/contact/${id}/associations/default/company/${args.companyId}`, { method: 'PUT' });
  }
  return { id, type: 'contact' };
}

async function contactIdFor(args, io, conn) {
  if (args.contactId) return args.contactId;
  const inbound = args.email?.direction === 'inbound' || args.email?.direction === 'incoming';
  const email = args.contact?.email ?? (inbound ? args.email?.from : args.email?.to);
  return (await findOne(io, conn, 'contacts', 'email', email ? String(email).toLowerCase() : null, ['email']))?.id ?? null;
}

async function createNote(io, conn, body, contactId, companyId) {
  const res = await hubspot(io, conn, 'hubspot.note_create', `${OBJECTS}/notes`, {
    json: {
      properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteHtml(body) },
      associations: [assoc(contactId, ASSOC.noteToContact), assoc(companyId, ASSOC.noteToCompany)].filter(Boolean),
    },
  });
  return res?.id;
}

async function logEmail(args, io, conn) {
  const contactId = await contactIdFor(args, io, conn);
  const companyId = args.companyId ?? null;
  if (!contactId && !companyId) throw new ProviderError('No HubSpot contact or company to log this email on.', { code: 'bad_request', op: 'hubspot.email_create' });
  try {
    const res = await hubspot(io, conn, 'hubspot.email_create', `${OBJECTS}/emails`, {
      json: {
        properties: emailProperties(args.email),
        associations: [assoc(contactId, ASSOC.emailToContact), assoc(companyId, ASSOC.emailToCompany)].filter(Boolean),
      },
    });
    return { id: res?.id, type: contactId ? 'contact' : 'company', recordId: contactId ?? companyId };
  } catch (err) {
    // Without the sales-email-read scope, log the email as a note instead.
    if (!(err instanceof ProviderError && err.status === 403)) throw err;
    const e = args.email ?? {};
    const id = await createNote(io, conn, `Email: ${e.subject ?? ''}\n\n${e.body ?? ''}`, contactId, companyId);
    return { id, type: contactId ? 'contact' : 'company', recordId: contactId ?? companyId };
  }
}

async function write(args, { conn, io }) {
  let out;
  switch (args.op) {
    case 'upsert_company':
      out = await upsertCompany(args, io, conn);
      out.recordId = out.id;
      break;
    case 'upsert_contact':
      out = await upsertContact(args, io, conn);
      out.recordId = out.id;
      break;
    case 'log_email':
      out = await logEmail(args, io, conn);
      break;
    case 'note': {
      const contactId = await contactIdFor(args, io, conn);
      const companyId = args.companyId ?? null;
      if (!contactId && !companyId) throw new ProviderError('No HubSpot contact or company to add this note to.', { code: 'bad_request', op: 'hubspot.note_create' });
      const text = typeof args.note === 'string' ? args.note : args.note?.body ?? '';
      out = { id: await createNote(io, conn, text, contactId, companyId), type: contactId ? 'contact' : 'company', recordId: contactId ?? companyId };
      break;
    }
    default:
      throw new ProviderError(`Unknown CRM operation "${args.op}".`, { code: 'bad_request', op: 'hubspot' });
  }
  const account = await accountInfo(io, conn);
  return { id: out.id, url: recordUrl(account, out.type, out.recordId) };
}

export default {
  id: 'hubspot',
  name: 'HubSpot',
  category: 'CRM',
  site: 'hubspot.com',
  description: 'Checks for existing customers and logs companies, contacts and emails.',
  playbooks: ['sales'],
  fields: [
    {
      key: 'token',
      label: 'Private app token',
      secret: true,
      required: true,
      placeholder: 'pat-...',
      help: 'Create a private app in HubSpot with crm.objects.companies.read/write, crm.objects.contacts.read/write and sales-email-read.',
    },
  ],
  handlers: {
    'crm.read': read,
    'crm.write': write,
  },
  async test({ conn, io }) {
    // Confirms the token works and can read companies, the scope Milo needs most.
    await hubspot(io, conn, 'hubspot.companies_read', `${OBJECTS}/companies`, { query: { limit: 1 }, timeoutMs: 15_000 });
    accounts.delete(conn.values.token);
    const account = await accountInfo(io, conn);
    return { account: account?.portalId ? `portal ${account.portalId}` : 'connected' };
  },
};
