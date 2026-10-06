// Small helpers shared by the sales agents, approval hooks and routes.
import { getProvider } from '../../providers/index.js';
import { ProviderError } from '../../providers/io.js';
import { CapabilityMissingError } from '../../runner/context.js';

export const SCORE_PARTS = [
  { key: 'icp_fit', label: 'ICP fit', weight: 0.3 },
  { key: 'company_growth', label: 'Company growth', weight: 0.15 },
  { key: 'role_relevance', label: 'Role relevance', weight: 0.25 },
  { key: 'buying_signal', label: 'Buying signal', weight: 0.2 },
  { key: 'contact_quality', label: 'Contact quality', weight: 0.1 },
];

export const ACCOUNT_STAGES = ['found', 'researched', 'qualified', 'in_outreach', 'engaged', 'meeting', 'disqualified'];

const STAGE_RANK = { found: 0, researched: 1, qualified: 2, in_outreach: 3, engaged: 4, meeting: 5 };

export const INTENT_LABELS = {
  interested: 'Interested',
  question: 'Question',
  referral: 'Referral',
  out_of_office: 'Out of office',
  not_now: 'Not now',
  not_interested: 'Not interested',
  unsubscribe: 'Unsubscribe',
};

/** "a, b ,c" or ["a","b"] -> ["a","b","c"] */
export function splitList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value ?? '')
    .split(/[,\n;]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function firstName(name) {
  return String(name ?? '').trim().split(/\s+/)[0] ?? '';
}

const GENERIC_WORDS = new Set([
  'health', 'healthcare', 'medical', 'group', 'groups', 'clinic', 'clinics', 'labs', 'lab', 'dental', 'orthopedics',
  'orthopaedic', 'hospital', 'imaging', 'physicians', 'partners', 'care', 'pediatrics', 'cardiology', 'therapy',
  'physical', 'home', 'behavioral', 'urgent', 'services', 'system', 'network', 'associates', 'center', 'centers',
  'institute', 'inc', 'inc.', 'llc', 'co', 'co.', 'corp', 'corporation', 'company', 'oncology', 'diagnostics', 'surgical',
  'infusion', 'dermatology', 'gastroenterology', 'rehabilitation', 'urology', 'senior', 'sleep', 'hearing', 'wound', 'family',
  'medicine', 'eye', 'spine', 'pain', 'dialysis', 'womens', 'radiology', 'hospice', 'healthcare', 'practice', 'practices',
]);

/** "Corvid Orthopedics" -> "Corvid", "Mercer Valley Hospital" -> "Mercer Valley". */
export function shortName(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const generic = (w) => {
    const bare = w.toLowerCase().replace(/[^a-z.]/g, '');
    return !bare || GENERIC_WORDS.has(bare);
  };
  while (words.length > 1 && generic(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/gu;

/** House style for outbound copy: no emoji, no exclamation marks, tidy whitespace. */
export function cleanCopy(text) {
  return String(text ?? '')
    .replace(EMOJI, '')
    .replace(/!+/g, '.')
    .replace(/\.\.+/g, '.')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Append the signature when a draft forgot it. */
export function withSignature(body, settings = {}) {
  const sig = String(settings.signature || settings.senderName || '').trim();
  if (!sig) return body;
  const firstSigLine = sig.split('\n')[0].trim();
  const tail = body.split('\n').slice(-4).join('\n');
  return tail.includes(firstSigLine) ? body : `${body}\n\n${sig}`;
}

export function replySubject(subject) {
  const s = String(subject ?? '').trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** A real person answered (auto-replies do not count). */
export function hasHumanReply(thread) {
  if (!thread) return false;
  return thread.messages.some((m) => m.kind === 'msg' && m.direction === 'in') && thread.intent !== 'out_of_office';
}

export function lastMessage(thread, direction) {
  const msgs = (thread?.messages ?? []).filter((m) => m.kind === 'msg' && (!direction || m.direction === direction));
  return msgs[msgs.length - 1] ?? null;
}

/** First meaningful line of a message, skipping greetings. */
export function snippetOf(body, max = 140) {
  const lines = String(body ?? '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(hi|hello|hey|dear)\b[^.?]{0,40},?$/i.test(l) && !/^[A-Z][a-z]+,$/.test(l));
  const line = lines[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "just now", "4 min ago", "2 h ago", "3 d ago" */
export function ago(iso, now = Date.now()) {
  if (!iso) return null;
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function normalizeDomain(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

export function parseEmployees(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const m = String(value ?? '').replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

export function ownerOf(workspace) {
  const name = workspace?.owner?.name || workspace?.settings?.senderName || 'You';
  return { name, initials: initials(name) };
}

/** Effective config for any agent: definition defaults overlaid with what the user saved. */
export function agentConfig(store, playbook, id) {
  const def = playbook?.agents?.find((a) => a.id === id);
  const state = store.get('agents', id);
  return { ...Object.fromEntries((def?.config ?? []).map((f) => [f.key, f.default])), ...(state?.config ?? {}) };
}

export function agentEnabled(store, id) {
  return !!store.get('agents', id)?.enabled;
}

export function providerName(conn) {
  if (!conn) return null;
  return getProvider(conn.provider)?.name ?? conn.label ?? conn.provider;
}

/** Move an account forward through the funnel without ever moving it back. */
export function advanceStage(current, next) {
  if (current === 'disqualified') return next;
  if (!(current in STAGE_RANK)) return next;
  return STAGE_RANK[next] > STAGE_RANK[current] ? next : current;
}

export function touchAccount(store, accountId, agentId, text) {
  if (!accountId) return;
  store.update('accounts', accountId, { lastActivity: { agentId, text, at: new Date().toISOString() } });
}

// Errors that mean "stop and hold the work" rather than "this one item is bad".
export function isHoldError(err) {
  if (err instanceof CapabilityMissingError) return true;
  return err instanceof ProviderError && ['auth', 'rate_limit', 'network'].includes(err.code);
}

/** Call an optional capability; any failure (or no connection) just means no data. */
export async function optionalCall(ctx, capability, args) {
  if (!ctx.has(capability)) return null;
  try {
    return await ctx.call(capability, args);
  } catch {
    return null;
  }
}

/** Put a task back for later without counting the wait against its retries. */
export function deferTask(ctx, task, at) {
  ctx.defer(task, at);
  ctx.store.update('tasks', task.id, { attempts: 0 });
}

/**
 * Run `fn` for each claimed task. One bad item is retried later (up to 3 tries) without
 * blocking the rest; auth and rate-limit errors stop the run so the remaining work is held.
 */
export async function eachTask(ctx, tasks, fn, { throwIfAllFail = true } = {}) {
  let ok = 0;
  let failed = 0;
  let firstError = null;
  for (const task of tasks) {
    try {
      await fn(task);
      if (ctx.store.get('tasks', task.id)?.status === 'running') ctx.complete(task);
      ok++;
    } catch (err) {
      if (isHoldError(err)) throw err;
      firstError ??= err;
      failed++;
      if ((task.attempts ?? 1) >= 3) ctx.fail(task, err.message);
      else ctx.defer(task, Date.now() + 60_000 * (task.attempts ?? 1));
    }
  }
  if (throwIfAllFail && !ok && firstError) throw firstError;
  return { ok, failed, error: firstError };
}

/** Mark queued tasks as cancelled (e.g. follow-ups for someone who replied). */
export function cancelTasks(store, predicate, reason = 'Cancelled') {
  let n = 0;
  for (const t of store.list('tasks', (t) => t.status === 'queued' && predicate(t))) {
    store.update('tasks', t.id, { status: 'cancelled', error: reason, finishedAt: new Date().toISOString() });
    n++;
  }
  return n;
}

// In sample-data workspaces a "day" between sequence steps is one minute, so the whole
// sequence plays out while you watch.
export function dayMs(ctx) {
  return ctx.demo ? 60_000 : 86_400_000;
}

// ── ICP ─────────────────────────────────────────────────────────

const STOP = new Set(['and', 'or', 'the', 'of', '&', 'a', 'an', 'for', 'with', 'care', 'services']);

function stems(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, 'y').replace(/s$/, ''));
}

export function icpFromSettings(settings = {}) {
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    industries: splitList(settings.industries),
    employeesMin: num(settings.employeesMin),
    employeesMax: num(settings.employeesMax),
    locations: splitList(settings.locations),
    keywords: splitList(settings.keywords),
  };
}

const US_NAMES = new Set(['united states', 'usa', 'us', 'u.s.', 'u.s.a.', 'america', 'united states of america']);

function locationMatches(location, wanted) {
  const loc = String(location ?? '').toLowerCase();
  if (!loc) return false;
  return wanted.some((w) => {
    const target = w.toLowerCase().trim();
    if (US_NAMES.has(target)) return /,\s*[A-Z]{2}\b/.test(String(location)) || /united states|usa\b/.test(loc);
    return loc.includes(target);
  });
}

/** Heuristic 0-100 fit between an account and the ICP: industry 40, size 30, location 20, data 10. */
export function icpMatch(account, icp) {
  let score = 0;

  if (!icp.industries.length) score += 30;
  else {
    const have = new Set(stems(account.industry));
    const phrase = String(account.industry ?? '').toLowerCase();
    const exact = icp.industries.some((i) => phrase && (phrase.includes(i.toLowerCase()) || i.toLowerCase().includes(phrase)));
    const overlap = icp.industries.some((i) => stems(i).some((s) => have.has(s)));
    score += exact ? 40 : overlap ? 34 : 12;
  }

  const emp = Number(account.employees);
  const { employeesMin: lo, employeesMax: hi } = icp;
  if (!Number.isFinite(emp) || emp <= 0) score += 12;
  else if (lo == null && hi == null) score += 24;
  else {
    const min = lo ?? 0;
    const max = hi ?? Infinity;
    if (emp >= min && emp <= max) {
      // Full marks in the middle of the range, a little less near the edges.
      const span = Math.log((Number.isFinite(max) ? max : min * 10 || 1000) / Math.max(min, 1));
      const pos = span > 0 ? Math.log(emp / Math.max(min, 1)) / span : 0.5;
      score += Math.round(30 - Math.abs(pos - 0.5) * 10);
    } else {
      const off = emp < min ? emp / Math.max(min, 1) : max / emp;
      score += off > 0.75 ? 18 : 6;
    }
  }

  if (!icp.locations.length) score += 16;
  else score += locationMatches(account.location, icp.locations) ? 20 : 4;

  const filled = ['domain', 'linkedin', 'revenue', 'description'].filter((k) => account[k]).length + (account.tech?.length ? 1 : 0);
  score += filled * 2;

  return Math.max(0, Math.min(100, score));
}
