import { ProviderError } from './io.js';

const API = 'https://api.cal.com/v2';
const SLOTS_VERSION = '2024-09-04';
const BOOKINGS_VERSION = '2026-02-25';

const toIso = (value) => {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export function mapCalSlots(data, durationMin) {
  const minutes = Number(durationMin) || 30;
  const slots = [];
  for (const day of Object.values(data ?? {})) {
    for (const slot of day ?? []) {
      const start = toIso(slot?.start);
      if (!start) continue;
      const end = toIso(slot.end) ?? new Date(Date.parse(start) + minutes * 60_000).toISOString();
      slots.push({ start, end });
    }
  }
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildCalBooking(args, { eventTypeId, timeZone }) {
  const [attendee, ...guests] = (args.attendees ?? []).filter((a) => a?.email);
  if (!attendee) throw new ProviderError('A booking needs at least one attendee with an email.', { code: 'bad_request', op: 'cal.book' });
  const start = toIso(args.start);
  if (!start) throw new ProviderError('The meeting start time is not a valid date.', { code: 'bad_request', op: 'cal.book' });
  const body = {
    start,
    eventTypeId: Number(eventTypeId),
    attendee: { name: attendee.name || attendee.email.split('@')[0], email: attendee.email, timeZone: timeZone || 'UTC' },
  };
  if (guests.length) body.guests = guests.map((g) => g.email);
  if (args.description) body.bookingFieldsResponses = { notes: String(args.description).slice(0, 2000) };
  if (args.title) body.metadata = { title: String(args.title).slice(0, 40) };
  return body;
}

export function mapCalBooking(data) {
  const uid = data?.uid ?? data?.id;
  const location = [data?.meetingUrl, data?.location].find((v) => typeof v === 'string' && /^https?:\/\//.test(v));
  return { eventId: uid != null ? String(uid) : null, link: location ?? (data?.uid ? `https://cal.com/booking/${data.uid}` : undefined) };
}

function settings(conn, op) {
  const eventTypeId = Number(conn.values.eventTypeId);
  if (!Number.isInteger(eventTypeId) || eventTypeId <= 0) {
    throw new ProviderError('Add the numeric event type id for this connection.', { code: 'bad_request', op });
  }
  return { eventTypeId, timeZone: String(conn.values.timeZone || '').trim() || 'UTC' };
}

const auth = (conn, version) => ({ Authorization: `Bearer ${conn.values.apiKey}`, ...(version ? { 'cal-api-version': version } : {}) });

async function availability(args, { conn, io }) {
  const { eventTypeId } = settings(conn, 'cal.slots');
  const start = toIso(args.from) ?? new Date().toISOString();
  const end = toIso(args.to) ?? new Date(Date.now() + 7 * 86_400_000).toISOString();
  const res = await io.http('cal.slots', `${API}/slots`, {
    headers: auth(conn, SLOTS_VERSION),
    query: { eventTypeId, start, end, timeZone: 'UTC', format: 'range' },
  });
  return { slots: mapCalSlots(res?.data, args.durationMin) };
}

async function book(args, { conn, io }) {
  const s = settings(conn, 'cal.book');
  const res = await io.http('cal.book', `${API}/bookings`, {
    headers: auth(conn, BOOKINGS_VERSION),
    json: buildCalBooking(args, s),
  });
  return mapCalBooking(res?.data);
}

export default {
  id: 'cal',
  name: 'Cal.com',
  category: 'Calendar',
  site: 'cal.com',
  description: 'Checks open times and books meetings on one of your Cal.com event types.',
  playbooks: ['sales'],
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      secret: true,
      required: true,
      placeholder: 'cal_live_...',
      help: 'Settings → Developer → API keys in Cal.com.',
    },
    {
      key: 'eventTypeId',
      label: 'Event type id',
      type: 'number',
      required: true,
      help: 'The number at the end of the event type URL when you edit it in Cal.com.',
    },
    {
      key: 'timeZone',
      label: 'Attendee time zone',
      placeholder: 'America/New_York',
      help: 'Used for confirmation emails when the attendee time zone is unknown. Defaults to UTC.',
    },
  ],
  handlers: {
    'calendar.availability': availability,
    'calendar.book': book,
  },
  async test({ conn, io }) {
    settings(conn, 'cal.me');
    const res = await io.http('cal.me', `${API}/me`, { headers: auth(conn), timeoutMs: 15_000 });
    return { account: res?.data?.email ?? res?.data?.username ?? 'connected' };
  },
};
