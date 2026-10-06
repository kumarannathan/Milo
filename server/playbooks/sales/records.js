// Factories for sales records, so every writer produces the same field set the UI reads.
import { newId } from '../../lib/ids.js';
import { normalizeDomain, parseEmployees, wordCount } from './util.js';
import { timezoneFor } from './timezones.js';

function linkedinUrl(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^https?:\/\//.test(s)) return s;
  if (s.startsWith('linkedin.com') || s.startsWith('www.linkedin.com')) return `https://${s}`;
  return `https://www.linkedin.com/company/${s.replace(/^\/+/, '')}`;
}

export function newAccount(data, { foundBy, foundVia, signals = [], icpMatch = null }) {
  const now = new Date().toISOString();
  return {
    name: String(data.name).trim(),
    domain: normalizeDomain(data.domain),
    industry: data.industry ?? null,
    employees: parseEmployees(data.employees),
    location: data.location ?? null,
    linkedin: linkedinUrl(data.linkedin),
    revenue: data.revenue ?? null,
    tech: Array.isArray(data.tech) ? data.tech : [],
    description: data.description ?? null,
    externalId: data.externalId ?? null,
    icpMatch,
    stage: 'found',
    score: null,
    scoreBreakdown: [],
    decision: null,
    decisionNote: null,
    scoredAt: null,
    brief: null,
    signals,
    foundBy,
    foundVia,
    foundAt: now,
    lastActivity: null,
    researchCount: 0,
    crm: null,
    disqualifiedReason: null,
  };
}

export function newContact(person, account, { email, emailStatus, stage = 'new', skipReason = null }) {
  const parts = String(person.name ?? '').trim().split(/\s+/);
  const location = person.location || account.location || null;
  return {
    accountId: account.id,
    name: String(person.name).trim(),
    firstName: person.firstName || parts[0] || '',
    lastName: person.lastName || parts.slice(1).join(' ') || '',
    title: person.title ?? '',
    email: email ?? null,
    emailStatus: emailStatus ?? 'unknown',
    linkedin: person.linkedin ?? null,
    location,
    timezone: timezoneFor(location),
    seniority: person.seniority ?? null,
    externalId: person.externalId ?? null,
    stage,
    skipReason,
    score: null,
    scoreBreakdown: [],
    decision: null,
    sequenceStep: 0,
    lastContactedAt: null,
    crmId: null,
  };
}

export function newApproval(fields) {
  const subject = fields.subject ?? '';
  const body = fields.body ?? '';
  return {
    kind: fields.kind,
    status: 'pending',
    agentId: fields.agentId,
    accountId: fields.accountId,
    contactId: fields.contactId,
    threadId: fields.threadId ?? null,
    step: fields.step ?? null,
    subject,
    body,
    original: { subject, body },
    edited: false,
    angle: fields.angle ?? '',
    facts: fields.facts ?? [],
    sendAt: fields.sendAt ?? new Date().toISOString(),
    meeting: fields.meeting ?? null,
    meetingId: fields.meetingId ?? null,
    wordCount: wordCount(body),
    decidedAt: null,
    rejectReason: null,
    rejectTags: [],
  };
}

export function newMessage(fields) {
  return {
    id: newId('msg'),
    kind: 'msg',
    direction: 'out',
    from: null,
    fromEmail: null,
    by: null,
    at: new Date().toISOString(),
    body: '',
    agentId: null,
    externalId: null,
    ...fields,
  };
}

export function newEvent(text, { agentId = 'sdr', at } = {}) {
  return { id: newId('msg'), kind: 'event', agentId, text, at: at ?? new Date().toISOString() };
}
