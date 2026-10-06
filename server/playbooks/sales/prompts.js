// Prompts for real models. Each builder takes the same `input` the agent passes to
// ctx.llm (the sample-data provider reads `input` directly) and returns { system, prompt }.
// Every prompt asks for the JSON shape documented above its builder.

const clip = (text, n) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

function seller(settings = {}) {
  return [
    `Company: ${settings.company || 'our company'}`,
    `What we sell: ${settings.product || 'not specified'}`,
    settings.proofPoints ? `Proof points (customer results we may cite):\n${settings.proofPoints}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function accountFacts(account = {}) {
  return [
    `Name: ${account.name}`,
    `Domain: ${account.domain}`,
    account.industry && `Industry: ${account.industry}`,
    account.employees && `Employees: ${account.employees}`,
    account.location && `Location: ${account.location}`,
    account.revenue && `Revenue: ${account.revenue}`,
    account.tech?.length && `Tech: ${account.tech.join(', ')}`,
    account.description && `Description: ${clip(account.description, 400)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function briefText(brief) {
  if (!brief) return 'No research brief yet.';
  return [
    `Summary: ${brief.summary}`,
    brief.whyNow && `Why now: ${brief.whyNow}`,
    brief.pains?.length && `Pains: ${brief.pains.join('; ')}`,
    brief.angles?.length && `Angles: ${brief.angles.map((a) => (typeof a === 'string' ? a : a.text)).join('; ')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function signalsText(signals = []) {
  if (!signals.length) return 'None.';
  return signals.map((s) => `- [${s.type}] ${s.date ?? ''} ${s.title} (${s.url})`).join('\n');
}

const COPY_RULES = (settings, maxWords) =>
  [
    `- Under ${maxWords} words, not counting the signature.`,
    '- Plain and specific. Short sentences. No hype, no buzzwords.',
    '- No exclamation marks. No emoji. Never write "I hope this finds you well" or similar openers.',
    '- One clear ask.',
    `- Sign off with exactly:\n${settings.signature || settings.senderName || ''}`,
  ].join('\n');

/**
 * account_brief -> { summary, whyNow, pains: [string], angles: [string],
 *                    signals: [{ type, date, title, url }], sources: [url] }
 */
export function accountBriefPrompt({ account, results = [], news = [], social = [], settings = {}, tone, maxSignalAgeDays }) {
  const sources = [...results, ...news, ...social]
    .map((r, i) => {
      const body = r.text ? clip(r.text, 1500) : clip(r.snippet ?? r.summary, 400);
      return `[${i + 1}] ${r.title}\nURL: ${r.url}${r.publishedAt ? `\nDate: ${r.publishedAt}` : ''}\n${body}`;
    })
    .join('\n\n');

  const system = [
    `You research companies for the sales team at ${settings.company || 'our company'}.`,
    'You write short account briefs an SDR can act on.',
    'Use only facts found in the sources provided. Do not invent numbers, names, dates or events.',
    'Cite the source URL for each signal. If the sources do not support a claim, leave it out.',
    `Tone: ${tone || 'plain, factual'}.`,
  ].join(' ');

  const prompt = `${seller(settings)}

Account:
${accountFacts(account)}

Sources:
${sources || 'No sources were found.'}

Write a brief for this account as JSON:
{
  "summary": "2-3 sentences: who they are, size and footprint, and how billing or the relevant workflow runs, if the sources say",
  "whyNow": "1-2 sentences on the most recent trigger that makes outreach timely, or an empty string",
  "pains": ["up to 3 short phrases, each supported by a source"],
  "angles": ["up to 3 one-line outreach angles, each tied to a specific fact"],
  "signals": [{ "type": "Expansion | Hiring | Exec change | Funding | Tech install | News", "date": "YYYY-MM-DD", "title": "one line", "url": "source URL" }],
  "sources": ["URLs you actually used"]
}
Only include signals from the last ${maxSignalAgeDays || 120} days unless nothing newer exists.`;

  return { system, prompt };
}

/**
 * lead_score -> { scores: { icp_fit, company_growth, buying_signal }, contacts: [{ id, role_relevance, contact_quality }],
 *                 bestContactId, rationale, skipReason }
 */
export function leadScorePrompt({ account, contacts = [], brief, settings = {} }) {
  const people = contacts
    .map((c) => `- id ${c.id}: ${c.name}, ${c.title}${c.seniority ? ` (${c.seniority})` : ''}, email ${c.emailStatus}${c.location ? `, ${c.location}` : ''}`)
    .join('\n');

  const system = [
    `You qualify sales leads for ${settings.company || 'our company'}.`,
    'Score only from the information given. Be strict: a score above 90 means a strong fit with a recent, specific reason to reach out.',
  ].join(' ');

  const prompt = `${seller(settings)}

Ideal customer:
Industries: ${settings.industries || 'any'}
Employees: ${settings.employeesMin || '?'} to ${settings.employeesMax || '?'}
Locations: ${settings.locations || 'any'}
Buyer titles: ${settings.titles || 'any'}

Account:
${accountFacts(account)}

Research brief:
${briefText(brief)}

Signals:
${signalsText(account?.signals)}

Contacts:
${people || 'None.'}

Score each part from 0 to 100:
- icp_fit (weight 0.30): industry, size and location against the ideal customer.
- company_growth (weight 0.15): expansion, hiring, funding, new sites.
- buying_signal (weight 0.20): recent, specific events that create the need we solve.
- role_relevance (weight 0.25, per contact): does this person own the problem or the budget.
- contact_quality (weight 0.10, per contact): email status and how complete the record is.

Respond as JSON:
{
  "scores": { "icp_fit": 0, "company_growth": 0, "buying_signal": 0 },
  "contacts": [{ "id": "contact id", "role_relevance": 0, "contact_quality": 0 }],
  "bestContactId": "id of the one person to email first",
  "rationale": "one or two sentences a teammate can read in five seconds",
  "skipReason": "if this is a poor fit, a short reason; otherwise an empty string"
}`;

  return { system, prompt };
}

/** outreach_draft -> { subject, body, angle, facts: [{ text, src }] } */
export function outreachDraftPrompt({ account, contact, brief, settings = {}, step = 1, sequenceSteps = 3, maxWords = 120, notes = [], previous = [], usedAngles = [] }) {
  const history = previous.length
    ? previous.map((m, i) => `Email ${i + 1} (${m.at}):\nSubject: ${m.subject}\n${m.body}`).join('\n\n')
    : 'None. This is the first email.';
  const feedback = notes.length
    ? notes.map((n) => `- ${n.text || 'Rejected without a note'}${n.tags?.length ? ` [${n.tags.join(', ')}]` : ''}`).join('\n')
    : 'None yet.';

  const system = [
    `You write outbound emails for ${settings.senderName || 'the sender'} at ${settings.company || 'our company'}.`,
    'Write like a thoughtful person who did their homework, not like a marketer.',
    'Use only facts from the research brief and signals below, and cite the source URL for each fact you use.',
  ].join(' ');

  const stepNote =
    step === 1
      ? 'This is the first email. Open with the most specific, recent fact. Connect it to one pain we solve. Cite one proof point. Ask for a short call.'
      : step >= sequenceSteps
        ? `This is the last follow-up (step ${step} of ${sequenceSteps}). Keep it to two or three sentences and make it easy to say no.`
        : `This is follow-up ${step} of ${sequenceSteps}. Do not repeat the first email. Lead with a different proof point or angle.`;

  const prompt = `${seller(settings)}

Recipient: ${contact?.name}, ${contact?.title} at ${account?.name}${contact?.location ? ` (${contact.location})` : ''}

Account:
${accountFacts(account)}

Research brief:
${briefText(brief)}

Signals:
${signalsText(account?.signals)}

Angles already used: ${usedAngles.length ? usedAngles.join('; ') : 'none'}

Earlier emails in this thread:
${history}

Feedback from the reviewer on earlier drafts (follow it):
${feedback}

${stepNote}

Rules:
${COPY_RULES(settings, maxWords)}
${step > 1 ? '- Subject: reuse the first subject with "Re: " in front.' : '- Subject: under 8 words, specific to them, no clickbait.'}

Respond as JSON:
{
  "subject": "...",
  "body": "full email including greeting and signature, with \\n line breaks",
  "angle": "one sentence for the reviewer: why this angle, for this person, now",
  "facts": [{ "text": "a fact the email relies on", "src": "source URL" }]
}`;

  return { system, prompt };
}

/** reply_classify -> { intent, escalate, reason, agreedTime } */
export function replyClassifyPrompt({ thread, message, contact, settings = {}, escalate = '' }) {
  const transcript = (thread?.messages ?? [])
    .filter((m) => m.kind === 'msg')
    .slice(-6)
    .map((m) => `${m.direction === 'out' ? 'Us' : 'Them'} (${m.at}): ${clip(m.body, 800)}`)
    .join('\n\n');
  const slots = (thread?.offeredSlots ?? []).map((s) => `- ${s.start}`).join('\n');

  const system = 'You triage replies to sales emails. Classify the latest reply and decide whether a human must take over.';

  const prompt = `We are ${settings.company || 'the seller'}. The prospect is ${contact?.name}, ${contact?.title}.

Conversation so far:
${transcript || 'No earlier messages.'}

Latest reply from them:
${message?.body}

Times we offered (ISO, UTC):
${slots || 'None.'}

Escalate to a human when the reply involves: ${escalate || 'legal or security questions'}.

Pick one intent:
- interested: wants to talk or learn more, or accepts a time
- question: asks something specific (price, how it works, integrations)
- referral: points us to someone else
- out_of_office: automatic away message
- not_now: open later, not now
- not_interested: declines
- unsubscribe: asks not to be contacted

Respond as JSON:
{
  "intent": "one of the intents above",
  "escalate": true or false,
  "reason": "short reason, e.g. 'security question' or 'pricing question'",
  "agreedTime": "if they accepted one of the offered times, that time as ISO 8601; otherwise null"
}`;

  return { system, prompt };
}

/** reply_draft -> { subject, body, angle } */
export function replyDraftPrompt({ thread, message, contact, account, settings = {}, intent, slots = [], bookingUrl, meeting, maxWords = 120, notes = [] }) {
  const transcript = (thread?.messages ?? [])
    .filter((m) => m.kind === 'msg')
    .slice(-6)
    .map((m) => `${m.direction === 'out' ? 'Us' : 'Them'}: ${clip(m.body, 800)}`)
    .join('\n\n');
  const feedback = notes.length ? notes.map((n) => `- ${n.text || 'Rejected without a note'}`).join('\n') : 'None yet.';

  let task;
  if (meeting) task = `They accepted ${meeting.label}. Confirm the time in one or two sentences and say the invite is on its way.`;
  else if (slots.length) task = `Answer what they asked, then offer these times: ${slots.map((s) => s.label).join(' or ')}.`;
  else if (bookingUrl) task = `Answer what they asked, then share this booking link: ${bookingUrl}`;
  else task = 'Answer what they asked and suggest a short call next week.';

  const system = [
    `You answer replies for ${settings.senderName || 'the sender'} at ${settings.company || 'our company'}.`,
    'Answer the question directly using only the facts given. If you do not know something, say you will find out.',
  ].join(' ');

  const prompt = `${seller(settings)}
${settings.pricingNotes ? `Pricing notes: ${settings.pricingNotes}` : ''}

They are ${contact?.name}, ${contact?.title} at ${account?.name}. Their reply was tagged: ${intent}.

Conversation:
${transcript}

Latest reply:
${message?.body}

Feedback from the reviewer on earlier drafts:
${feedback}

${task}

Rules:
${COPY_RULES(settings, maxWords)}
- Subject: "Re: " plus the thread subject.

Respond as JSON:
{
  "subject": "...",
  "body": "full reply with greeting and signature, with \\n line breaks",
  "angle": "one sentence for the reviewer explaining the reply"
}`;

  return { system, prompt };
}
