import { ProviderError, maskSecret } from './io.js';

const WEBHOOK = /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/[A-Za-z0-9/_-]+$/;
const PREFIX = { warn: 'Warning: ', error: 'Error: ' };

export function validSlackWebhook(url) {
  return WEBHOOK.test(String(url ?? '').trim());
}

// Slack treats &, < and > as control characters in message text.
export function slackText(text, level) {
  const escaped = String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `${PREFIX[level] ?? ''}${escaped}`.slice(0, 3900);
}

function webhookUrl(conn, op) {
  const url = String(conn.values.webhookUrl ?? '').trim();
  if (!validSlackWebhook(url)) {
    throw new ProviderError('That is not a Slack incoming webhook URL. It should start with https://hooks.slack.com/.', { code: 'bad_request', op });
  }
  return url;
}

async function post(args, { conn, io }) {
  const url = webhookUrl(conn, 'slack.webhook');
  try {
    await io.http('slack.webhook', url, { json: { text: slackText(args.text, args.level) }, headers: { Accept: '*/*' }, timeoutMs: 15_000 });
  } catch (err) {
    // 403, 404 and 410 mean the webhook was revoked, or its channel removed or archived.
    if (err instanceof ProviderError && [403, 404, 410].includes(err.status)) {
      throw new ProviderError(`Slack no longer accepts this webhook (${err.message}). Create a new one.`, { status: err.status, code: 'auth', op: 'slack.webhook' });
    }
    throw err;
  }
  return { ok: true };
}

export default {
  id: 'slack',
  name: 'Slack',
  category: 'Alerts',
  site: 'slack.com',
  description: 'Posts alerts to a Slack channel through an incoming webhook.',
  playbooks: ['sales', 'markets'],
  fields: [
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      secret: true,
      required: true,
      placeholder: 'https://hooks.slack.com/services/...',
      help: 'Create a Slack app, turn on Incoming Webhooks and add one for your channel.',
    },
  ],
  handlers: {
    'notify.post': post,
  },
  // Checks the URL without posting, so testing does not send a message to the channel.
  async test({ conn }) {
    const url = webhookUrl(conn, 'slack.webhook');
    return { account: `webhook ${maskSecret(url)}` };
  },
};
