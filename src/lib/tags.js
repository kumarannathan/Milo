// Color and label for every status-like value, so tags read the same on every screen.

const MAP = {
  agent: {
    running: ['green', 'Running'],
    idle: ['gray', 'Idle'],
    error: ['red', 'Error'],
    off: ['gray', 'Off'],
    paused: ['amber', 'Paused'],
  },
  stage: {
    found: ['gray', 'Found'],
    researched: ['blue', 'Researched'],
    qualified: ['violet', 'Qualified'],
    in_outreach: ['teal', 'In outreach'],
    engaged: ['amber', 'Engaged'],
    meeting: ['green', 'Meeting booked'],
    disqualified: ['red', 'Disqualified'],
  },
  intent: {
    interested: ['green', 'Interested'],
    question: ['blue', 'Question'],
    referral: ['violet', 'Referral'],
    out_of_office: ['gray', 'Out of office'],
    not_now: ['amber', 'Not now'],
    not_interested: ['gray', 'Not interested'],
    unsubscribe: ['red', 'Unsubscribe'],
  },
  thread: {
    us: ['amber', 'Waiting on us'],
    them: ['gray', 'Waiting on them'],
    escalated: ['violet', 'Escalated'],
    closed: ['gray', 'Closed'],
  },
  approval: {
    first_touch: ['blue', 'First touch'],
    follow_up: ['teal', 'Follow-up'],
    reply: ['violet', 'Reply'],
    meeting: ['green', 'Meeting invite'],
    trade: ['amber', 'Trade'],
  },
  activity: {
    found: ['gray', 'found'],
    brief: ['blue', 'brief'],
    contacts: ['teal', 'contacts'],
    score: ['violet', 'score'],
    draft: ['blue', 'draft'],
    review: ['amber', 'review'],
    sent: ['teal', 'sent'],
    reply: ['violet', 'reply'],
    meeting: ['green', 'meeting'],
    crm: ['gray', 'crm'],
    error: ['red', 'error'],
    watch: ['gray', 'watch'],
    whale: ['violet', 'whale'],
    trade: ['amber', 'trade'],
    opened: ['teal', 'opened'],
    closed: ['gray', 'closed'],
    settled: ['green', 'settled'],
  },
  signal: {
    funding: ['green', 'Funding'],
    hiring: ['blue', 'Hiring'],
    expansion: ['teal', 'Expansion'],
    'exec change': ['violet', 'Exec change'],
    news: ['gray', 'News'],
    'tech install': ['gray', 'Tech install'],
    whale: ['violet', 'Whale'],
    brief: ['blue', 'Brief'],
    price: ['gray', 'Price'],
  },
  email: {
    verified: ['green', 'Verified'],
    likely: ['amber', 'Likely'],
    invalid: ['red', 'Invalid'],
    unknown: ['gray', 'Unknown'],
  },
  connection: {
    connected: ['green', 'Connected'],
    ok: ['green', 'Connected'],
    expired: ['red', 'Expired'],
    error: ['red', 'Error'],
    untested: ['gray', 'Not tested'],
    missing: ['red', 'Missing'],
    skipped: ['gray', 'Skipped'],
  },
  meeting: {
    proposed: ['amber', 'Proposed'],
    booked: ['green', 'Booked'],
    declined: ['gray', 'Declined'],
    cancelled: ['gray', 'Cancelled'],
  },
  market: {
    watching: ['blue', 'Watching'],
    closed: ['gray', 'Closed'],
    resolved: ['green', 'Resolved'],
    ignored: ['gray', 'Ignored'],
  },
  side: {
    yes: ['green', 'YES'],
    no: ['red', 'NO'],
  },
  decision: {
    outreach: ['green', 'Outreach'],
    research: ['amber', 'Research more'],
    skip: ['gray', 'Skip'],
  },
};

export function tagFor(kind, value) {
  const key = String(value ?? '').toLowerCase();
  const hit = MAP[kind]?.[key];
  if (hit) return { color: hit[0], label: hit[1] };
  return { color: 'gray', label: value ? String(value).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—' };
}

export const DOT = {
  green: 'var(--success)',
  red: 'var(--destructive)',
  amber: 'var(--warning)',
  gray: 'var(--idle)',
  blue: 'var(--tag-blue-fg)',
  violet: 'var(--tag-violet-fg)',
  teal: 'var(--tag-teal-fg)',
};

export function agentDot(status) {
  return { running: DOT.green, idle: DOT.gray, error: DOT.red, off: 'var(--off)', paused: DOT.amber }[status] ?? DOT.gray;
}
