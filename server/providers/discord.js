import { ProviderError } from './io.js';

const WEBHOOK = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+$/;
const PREFIX = { warn: '**Warning:** ', error: '**Error:** ' };

export function validDiscordWebhook(url) {
  return WEBHOOK.test(String(url ?? '').trim());
}

export function discordContent(text, level) {
  return `${PREFIX[level] ?? ''}${String(text ?? '')}`.slice(0, 2000);
}

function webhookUrl(conn, op) {
  const url = String(conn.values.webhookUrl ?? '').trim();
  if (!validDiscordWebhook(url)) {
    throw new ProviderError('That is not a Discord webhook URL. It should look like https://discord.com/api/webhooks/<id>/<token>.', { code: 'bad_request', op });
  }
  return url;
}

// A deleted webhook answers 404 "Unknown Webhook": treat it like a revoked key.
async function discord(io, op, url, init) {
  try {
    return await io.http(op, url, { ...init, timeoutMs: 15_000 });
  } catch (err) {
    if (err instanceof ProviderError && err.status === 404) {
      throw new ProviderError('Discord no longer knows this webhook. Create a new one.', { status: 404, code: 'auth', op });
    }
    throw err;
  }
}

async function post(args, { conn, io }) {
  const url = webhookUrl(conn, 'discord.webhook');
  // allowed_mentions with no parse list keeps alerts from pinging @everyone or roles.
  await discord(io, 'discord.webhook', url, { json: { content: discordContent(args.text, args.level), allowed_mentions: { parse: [] } } });
  return { ok: true };
}

export default {
  id: 'discord',
  name: 'Discord',
  category: 'Alerts',
  site: 'discord.com',
  description: 'Posts alerts to a Discord channel through a webhook.',
  playbooks: ['sales', 'markets'],
  fields: [
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      secret: true,
      required: true,
      placeholder: 'https://discord.com/api/webhooks/...',
      help: 'Channel settings → Integrations → Webhooks → New webhook → Copy webhook URL.',
    },
  ],
  handlers: {
    'notify.post': post,
  },
  async test({ conn, io }) {
    const url = webhookUrl(conn, 'discord.webhook_info');
    const info = await discord(io, 'discord.webhook_info', url, {});
    return { account: info?.name ? `#${info.name}` : 'webhook' };
  },
};
