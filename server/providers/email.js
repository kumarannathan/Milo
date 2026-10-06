import { randomUUID } from 'node:crypto';
import { ProviderError } from './io.js';

// nodemailer, imapflow and mailparser are loaded on first use so a missing install
// only affects this provider, not the whole registry.

const DEFAULTS = { smtpHost: 'smtp.gmail.com', smtpPort: 465, imapHost: 'imap.gmail.com', imapPort: 993 };
const MAX_MESSAGES = 200;
const MAX_BYTES = 512 * 1024;

export function mailSettings(values = {}) {
  return {
    email: String(values.email ?? '').trim(),
    password: values.password ?? '',
    fromName: String(values.fromName ?? '').trim(),
    smtpHost: String(values.smtpHost || DEFAULTS.smtpHost).trim(),
    smtpPort: Number(values.smtpPort) || DEFAULTS.smtpPort,
    imapHost: String(values.imapHost || DEFAULTS.imapHost).trim(),
    imapPort: Number(values.imapPort) || DEFAULTS.imapPort,
  };
}

// Message-IDs are compared with their angle brackets: "<abc@example.com>".
export function normalizeId(id) {
  if (!id) return null;
  const s = String(id).trim();
  if (!s) return null;
  const m = s.match(/<[^<>\s]+>/);
  return m ? m[0] : `<${s.replace(/^<|>$/g, '')}>`;
}

function idList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/\s+/);
  return list.map(normalizeId).filter(Boolean);
}

export function buildMessage(args, settings, { id = randomUUID() } = {}) {
  const domain = settings.email.split('@')[1] || 'localhost';
  const messageId = `<${id}@${domain}>`;
  const replyTo = normalizeId(args.inReplyTo);
  const root = normalizeId(args.threadId);
  const references = [...new Set([root, replyTo].filter(Boolean))];
  let subject = String(args.subject ?? '').trim();
  if (replyTo && subject && !/^re:/i.test(subject)) subject = `Re: ${subject}`;
  return {
    messageId,
    threadId: root ?? replyTo ?? messageId,
    mail: {
      from: settings.fromName ? { name: settings.fromName, address: settings.email } : settings.email,
      to: args.toName ? { name: String(args.toName), address: String(args.to) } : String(args.to),
      subject,
      text: String(args.body ?? ''),
      messageId,
      inReplyTo: replyTo ?? undefined,
      references: references.length ? references : undefined,
    },
  };
}

const QUOTE_START = /^\s*(On|Le|Am|El|Il|Op|Em|Den|På)\s/i;
const QUOTE_HEADER = /\s(wrote|a écrit|schrieb|escribió|ha scritto|schreef|escreveu|skrev)\s*:\s*$/i;
const ORIGINAL = /^\s*(-{2,}\s*(original message|forwarded message|ursprüngliche nachricht|message d'origine)\s*-{2,}|_{10,})\s*$/i;
const OUTLOOK_FROM = /^\s*\**(From|De|Von|Van):\**\s/i;
const OUTLOOK_NEXT = /^\s*\**(Sent|Date|Envoyé|Gesendet|To|Subject|Objet|Betreff):\**/i;
const MOBILE_FOOTER = /^\s*(Sent from my |Sent from Outlook|Get Outlook for )/i;

// Keep only what the sender wrote: drop quoted lines, the "On … wrote:" block and
// everything after it, forwarded or Outlook-style headers, and the signature delimiter.
export function stripQuotedReply(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ORIGINAL.test(line)) break;
    if (QUOTE_START.test(line)) {
      // The attribution line often wraps: "On Mon, Oct 6, 2026 at 9:14 AM Jane <\njane@x.com> wrote:"
      let joined = '';
      let isHeader = false;
      for (let j = i; j < Math.min(i + 3, lines.length); j++) {
        joined += ` ${lines[j].trim()}`;
        if (QUOTE_HEADER.test(joined)) {
          isHeader = true;
          break;
        }
      }
      if (isHeader) break;
    }
    if (OUTLOOK_FROM.test(line) && lines.slice(i + 1, i + 5).some((l) => OUTLOOK_NEXT.test(l))) break;
    if (/^\s*>/.test(line)) continue;
    if (/^-- ?$/.test(line)) break;
    out.push(line.replace(/\s+$/, ''));
  }
  while (out.length && (!out[out.length - 1].trim() || MOBILE_FOOTER.test(out[out.length - 1]))) out.pop();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const addresses = (field) =>
  (Array.isArray(field) ? field : field ? [field] : []).flatMap((a) => a?.value ?? []).filter((v) => v?.address);

export function mapParsedMessage(parsed, { internalDate } = {}) {
  const messageId = normalizeId(parsed.messageId);
  const references = idList(parsed.references);
  const inReplyTo = idList(parsed.inReplyTo)[0] ?? null;
  const from = addresses(parsed.from)[0] ?? {};
  const date = parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : internalDate ? new Date(internalDate) : new Date();
  return {
    messageId,
    threadId: references[0] ?? inReplyTo ?? messageId,
    inReplyTo: inReplyTo ?? undefined,
    from: String(from.address ?? '').toLowerCase(),
    fromName: from.name || undefined,
    to: addresses(parsed.to).map((a) => a.address).join(', '),
    subject: parsed.subject ?? '',
    body: stripQuotedReply(parsed.text ?? ''),
    at: date.toISOString(),
    references,
  };
}

// Keep messages that belong to one of the threads, and report them under that thread id.
export function filterThreads(messages, threadIds) {
  if (!threadIds?.length) return messages;
  const wanted = new Set(threadIds.map(normalizeId).filter(Boolean));
  const out = [];
  for (const m of messages) {
    const hit = [m.threadId, m.inReplyTo, ...(m.references ?? [])].find((id) => id && wanted.has(id));
    if (hit) out.push({ ...m, threadId: hit });
  }
  return out;
}

const NETWORK = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EDNS', 'EHOSTUNREACH', 'ETLS', 'NoConnection']);

export function mailError(err, op, server) {
  if (err instanceof ProviderError) return err;
  const auth =
    err?.code === 'EAUTH' ||
    err?.authenticationFailed ||
    err?.responseCode === 535 ||
    err?.serverResponseCode === 'AUTHENTICATIONFAILED';
  if (auth) {
    return new ProviderError(`${server} rejected the email address or password. For Gmail, use an app password.`, { status: 401, code: 'auth', op });
  }
  if (NETWORK.has(err?.code)) {
    return new ProviderError(`Could not reach ${server}: ${err.message}`, { code: 'network', op });
  }
  if (err?.code === 'EENVELOPE' || (err?.responseCode >= 500 && err?.responseCode < 600)) {
    return new ProviderError(`${server} refused the message: ${err.message}`, { status: err.responseCode ?? 'error', code: 'bad_request', op });
  }
  return new ProviderError(err?.message ?? String(err), { code: 'unavailable', op });
}

async function smtpTransport(s) {
  const { default: nodemailer } = await import('nodemailer');
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpPort === 465,
    requireTLS: s.smtpPort === 587,
    auth: { user: s.email, pass: s.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

async function withImap(s, op, fn) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: s.imapHost,
    port: s.imapPort,
    secure: s.imapPort === 993,
    auth: { user: s.email, pass: s.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  // ImapFlow emits socket errors as events; without a listener they would crash the process.
  client.on('error', () => {});
  try {
    await client.connect();
  } catch (err) {
    client.close();
    throw mailError(err, op, s.imapHost);
  }
  try {
    return await fn(client);
  } catch (err) {
    throw mailError(err, op, s.imapHost);
  } finally {
    await client.logout().catch(() => client.close?.());
  }
}

function requireSettings(s, op) {
  if (!s.email || !s.password) throw new ProviderError('Add the email address and password for this connection.', { code: 'auth', status: 401, op });
}

async function send(args, { conn, io }) {
  const s = mailSettings(conn.values);
  requireSettings(s, 'smtp.send');
  if (!args.to) throw new ProviderError('No recipient for this email.', { code: 'bad_request', op: 'smtp.send' });
  const { messageId, threadId, mail } = buildMessage(args, s);
  return io.track('smtp.send', async () => {
    const transporter = await smtpTransport(s);
    try {
      await transporter.sendMail(mail);
    } catch (err) {
      throw mailError(err, 'smtp.send', s.smtpHost);
    } finally {
      transporter.close();
    }
    return { messageId, threadId };
  });
}

async function read(args, { conn, io }) {
  const s = mailSettings(conn.values);
  requireSettings(s, 'imap.fetch');
  let since = args.since ? new Date(args.since) : new Date(Date.now() - 7 * 86_400_000);
  if (Number.isNaN(since.getTime())) since = new Date(Date.now() - 7 * 86_400_000);

  const raw = await io.track('imap.fetch', () =>
    withImap(s, 'imap.fetch', async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // IMAP SINCE matches by day; the exact time is checked after parsing.
        const uids = await client.search({ since }, { uid: true });
        if (!uids?.length) return [];
        const out = [];
        for await (const msg of client.fetch(uids.slice(-MAX_MESSAGES), { uid: true, internalDate: true, source: { maxLength: MAX_BYTES } }, { uid: true })) {
          if (msg.source) out.push({ internalDate: msg.internalDate, source: msg.source });
        }
        return out;
      } finally {
        lock.release();
      }
    }),
  );

  const { simpleParser } = await import('mailparser');
  const self = s.email.toLowerCase();
  const messages = [];
  for (const { internalDate, source } of raw) {
    let parsed;
    try {
      parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
    } catch {
      continue;
    }
    const received = internalDate ? new Date(internalDate) : parsed.date;
    if (received instanceof Date && received < since) continue;
    const m = mapParsedMessage(parsed, { internalDate });
    if (!m.messageId || m.from === self) continue;
    messages.push(m);
  }
  const result = filterThreads(messages, args.threadIds)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ references, ...m }) => m);
  return { messages: result };
}

export default {
  id: 'email',
  name: 'Email (SMTP + IMAP)',
  category: 'Email',
  description: 'Sends from your own mailbox and reads replies, using an app password.',
  playbooks: ['sales'],
  fields: [
    { key: 'email', label: 'Email address', type: 'email', required: true, placeholder: 'you@company.com' },
    {
      key: 'password',
      label: 'Password or app password',
      secret: true,
      required: true,
      help: 'For Gmail, create an app password under Google Account → Security → App passwords.',
    },
    { key: 'fromName', label: 'From name', placeholder: 'Jane Doe', help: 'Shown to recipients. Leave empty to send from the address alone.' },
    { key: 'smtpHost', label: 'SMTP host', placeholder: DEFAULTS.smtpHost, help: 'Fastmail: smtp.fastmail.com. iCloud: smtp.mail.me.com on port 587.' },
    { key: 'smtpPort', label: 'SMTP port', type: 'number', placeholder: String(DEFAULTS.smtpPort) },
    { key: 'imapHost', label: 'IMAP host', placeholder: DEFAULTS.imapHost, help: 'Fastmail: imap.fastmail.com. iCloud: imap.mail.me.com.' },
    { key: 'imapPort', label: 'IMAP port', type: 'number', placeholder: String(DEFAULTS.imapPort) },
  ],
  handlers: {
    'email.send': send,
    'email.read': read,
  },
  async test({ conn, io }) {
    const s = mailSettings(conn.values);
    requireSettings(s, 'smtp.verify');
    await io.track('smtp.verify', async () => {
      const transporter = await smtpTransport(s);
      try {
        await transporter.verify();
      } catch (err) {
        throw mailError(err, 'smtp.verify', s.smtpHost);
      } finally {
        transporter.close();
      }
    });
    await io.track('imap.login', () => withImap(s, 'imap.login', async () => true));
    return { account: s.email };
  },
};
