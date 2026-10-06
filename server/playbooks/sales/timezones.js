// Time zones for contacts: infer an IANA zone from a free-text location and work out
// when a local sending window opens. Uses Intl only, so no tz database dependency.

export const DEFAULT_TZ = 'America/New_York';

const STATE_TZ = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver', PR: 'America/Puerto_Rico',
};

const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR',
};

// Cities that sit in a different zone from most of their state, plus common non-US places.
const PLACE_TZ = {
  knoxville: 'America/New_York', chattanooga: 'America/New_York', 'el paso': 'America/Denver',
  pensacola: 'America/Chicago', louisville: 'America/Kentucky/Louisville', 'coeur d\'alene': 'America/Los_Angeles',
  toronto: 'America/Toronto', ottawa: 'America/Toronto', montreal: 'America/Toronto', vancouver: 'America/Vancouver',
  calgary: 'America/Edmonton', edmonton: 'America/Edmonton', winnipeg: 'America/Winnipeg', canada: 'America/Toronto',
  london: 'Europe/London', 'united kingdom': 'Europe/London', uk: 'Europe/London', england: 'Europe/London',
  dublin: 'Europe/Dublin', ireland: 'Europe/Dublin', paris: 'Europe/Paris', france: 'Europe/Paris',
  berlin: 'Europe/Berlin', germany: 'Europe/Berlin', amsterdam: 'Europe/Amsterdam', netherlands: 'Europe/Amsterdam',
  madrid: 'Europe/Madrid', spain: 'Europe/Madrid', stockholm: 'Europe/Stockholm', sweden: 'Europe/Stockholm',
  zurich: 'Europe/Zurich', switzerland: 'Europe/Zurich', sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne',
  australia: 'Australia/Sydney', singapore: 'Asia/Singapore', india: 'Asia/Kolkata', bangalore: 'Asia/Kolkata',
  bengaluru: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', tokyo: 'Asia/Tokyo', japan: 'Asia/Tokyo',
  'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo',
};

/** Best guess at an IANA zone for "Detroit, MI", "Denver, Colorado, United States", "London, UK". */
export function timezoneFor(location) {
  if (!location) return DEFAULT_TZ;
  const parts = String(location).split(',').map((p) => p.trim()).filter(Boolean);
  const lower = parts.map((p) => p.toLowerCase());
  for (const p of lower) if (PLACE_TZ[p]) return PLACE_TZ[p];
  for (const p of parts) {
    const code = p.toUpperCase();
    if (code.length === 2 && STATE_TZ[code]) return STATE_TZ[code];
    const named = STATE_NAMES[p.toLowerCase()];
    if (named) return STATE_TZ[named];
  }
  return DEFAULT_TZ;
}

export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsFormatters = new Map();

/** Wall-clock parts of `date` in `tz`. weekday: 0 = Sunday. */
export function zonedParts(date, tz) {
  let fmt = partsFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    partsFormatters.set(tz, fmt);
  }
  const out = {};
  for (const { type, value } of fmt.formatToParts(date)) out[type] = value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: weekdays[out.weekday],
  };
}

function offsetMs(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant when the wall clock in `tz` reads the given local time. */
export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0 }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ts = guess - offsetMs(new Date(guess), tz);
  // Second pass settles DST transitions.
  ts = guess - offsetMs(new Date(ts), tz);
  return new Date(ts);
}

const isWeekday = (weekday) => weekday >= 1 && weekday <= 5;

/** True when `at` falls inside [startHour, endHour) on a weekday, local to `tz`. */
export function inWindow(tz, startHour, endHour, at = new Date()) {
  const p = zonedParts(at, tz);
  return isWeekday(p.weekday) && p.hour >= startHour && p.hour < endHour;
}

/**
 * Next moment a cold email may go out: now if the window is open, otherwise the next
 * weekday at `startHour` local time (plus `jitterMin` minutes so sends don't stack up).
 */
export function nextSendTime(tz, startHour, endHour, from = new Date(), { jitterMin = 0 } = {}) {
  const zone = isValidTimezone(tz) ? tz : DEFAULT_TZ;
  const start = Math.max(0, Math.min(23, Number(startHour) || 0));
  const end = Math.max(start + 1, Math.min(24, Number(endHour) || 24));
  if (inWindow(zone, start, end, from)) return new Date(from.getTime());
  const today = zonedParts(from, zone);
  for (let offset = 0; offset <= 8; offset++) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (!isWeekday(d.getUTCDay())) continue;
    const candidate = zonedTimeToUtc(
      { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: start, minute: Math.min(59, jitterMin) },
      zone,
    );
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  return new Date(from.getTime() + 24 * 3600 * 1000);
}

const ZONE_LABELS = {
  'America/New_York': 'ET', 'America/Detroit': 'ET', 'America/Toronto': 'ET', 'America/Kentucky/Louisville': 'ET',
  'America/Indiana/Indianapolis': 'ET', 'America/Chicago': 'CT', 'America/Winnipeg': 'CT', 'America/Denver': 'MT',
  'America/Boise': 'MT', 'America/Phoenix': 'MT', 'America/Edmonton': 'MT', 'America/Los_Angeles': 'PT',
  'America/Vancouver': 'PT', 'America/Anchorage': 'AKT', 'Pacific/Honolulu': 'HT',
};

/** Short zone label the way people write it in email: ET, CT, MT, PT. */
export function zoneLabel(tz, at = new Date()) {
  if (ZONE_LABELS[tz]) return ZONE_LABELS[tz];
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

/** "Thu Oct 8, 10:00 AM ET" */
export function formatLocal(iso, tz, { weekday = 'short', zone = true } = {}) {
  const date = new Date(iso);
  const zoneId = isValidTimezone(tz) ? tz : DEFAULT_TZ;
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zoneId, weekday, month: 'short', day: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zoneId, hour: 'numeric', minute: '2-digit' }).format(date);
  return `${day}, ${time}${zone ? ` ${zoneLabel(zoneId, date)}` : ''}`;
}

/** "Thu 10:00 AM" */
export function formatShort(iso, tz) {
  const date = new Date(iso);
  const zoneId = isValidTimezone(tz) ? tz : DEFAULT_TZ;
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zoneId, weekday: 'short' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zoneId, hour: 'numeric', minute: '2-digit' }).format(date);
  return `${day} ${time}`;
}

/** Long weekday name in the contact's zone, e.g. "Thursday". */
export function weekdayName(iso, tz) {
  const zoneId = isValidTimezone(tz) ? tz : DEFAULT_TZ;
  return new Intl.DateTimeFormat('en-US', { timeZone: zoneId, weekday: 'long' }).format(new Date(iso));
}
