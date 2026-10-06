# Providers

A provider is a vendor Milo can talk to. You add one as a connection under Connections, with your own key, and Milo routes each capability an agent asks for to a connection that serves it. Argument and result shapes for every capability are in [capabilities.md](capabilities.md).

| Provider | Category | Capabilities | Fields |
| --- | --- | --- | --- |
| Anthropic (`anthropic`) | Models | `llm.complete` | API key |
| OpenAI (`openai`) | Models | `llm.complete` | API key, base URL (optional), default model (optional) |
| Ollama (`ollama`) | Models | `llm.complete` | Host (default `http://localhost:11434`), model (default `llama3.1`) |
| Tavily (`tavily`) | Research | `web.search`, `web.fetch`, `signals.news` | API key |
| Apollo (`apollo`) | Data | `accounts.search`, `accounts.enrich`, `contacts.search`, `contacts.enrich`, `signals.hiring` | API key |
| Hunter (`hunter`) | Data | `email.find`, `email.verify` | API key |
| HubSpot (`hubspot`) | CRM | `crm.read`, `crm.write` | Private app token |
| Email (`email`) | Email | `email.send`, `email.read` | Email address, password or app password, SMTP and IMAP host and port, from name |
| Cal.com (`cal`) | Calendar | `calendar.availability`, `calendar.book` | API key, event type id, attendee time zone |
| Slack (`slack`) | Alerts | `notify.post` | Incoming webhook URL |
| Discord (`discord`) | Alerts | `notify.post` | Webhook URL |
| Polymarket (`polymarket`) | Markets | `markets.search`, `markets.quote`, `markets.trades` | None (public, read only) |
| Sample data (`demo`) | Built in | Sample answers for both playbooks | None |

Notes on specific providers:

- **Anthropic.** Models that always think (Opus 5.5, Sonnet 5.5) get extra token room on top of the agent's `maxTokens`, and an explicit `medium` effort. Requests to models that support it opt into server-side fallback, so a safety-classifier decline is retried on another Claude model instead of failing the run. Cost is tracked from Anthropic's list prices.
- **OpenAI.** The base URL makes it work with any OpenAI-compatible endpoint (OpenRouter, Groq, LM Studio, vLLM). The connection's default model is used unless an agent picks a different one. Cost is not estimated because prices vary by endpoint.
- **Apollo.** People search returns hidden last names and no emails, so `contacts.search` reveals each hit through bulk enrichment, which costs one Apollo credit per match. `signals.hiring` uses company enrichment plus job postings (two credits). A 403 from Apollo means the plan or key type can't use that endpoint; it does not mark the connection as expired.
- **HubSpot.** The private app needs `crm.objects.companies.read`, `crm.objects.companies.write`, `crm.objects.contacts.read`, `crm.objects.contacts.write` and `sales-email-read`. Without `sales-email-read`, `log_email` falls back to a note. `crm.write` accepts `company` in the `accounts.search` shape and `contact` in the `contacts.search` shape; `email` is `{ subject, body, to, from, at, direction: 'outbound' | 'inbound' }`; `note` is a string.
- **Email.** Works with Gmail and Google Workspace (create an app password), Fastmail, iCloud and other mailboxes that allow password login over SMTP and IMAP. Microsoft 365 and Outlook.com require OAuth for IMAP and are not supported yet. Replies are read from INBOX without marking them as read; quoted text is removed. `threadId` is the Message-ID of the first email in the conversation.
- **Slack.** Testing the connection checks the webhook URL without posting to the channel.

## Writing a provider

Create `server/providers/<id>.js` (or a folder with an `index.js`). Every file in that folder whose default export has an `id` and `handlers` is registered at startup; there is no list to update.

```js
import { ProviderError, maskSecret } from './io.js';

export default {
  id: 'acme',
  name: 'Acme Data',
  category: 'Data', // Models, Research, Data, Email, CRM, Calendar or Alerts
  site: 'acme.example',
  description: 'Finds work emails from a name and a domain.',
  playbooks: ['sales'],
  fields: [{ key: 'apiKey', label: 'API key', secret: true, required: true, help: 'Settings → API in your Acme dashboard.' }],
  handlers: {
    async 'email.find'({ domain, firstName, lastName }, { conn, io }) {
      const res = await io.http('acme.find', 'https://api.acme.example/v1/find', {
        headers: { Authorization: `Bearer ${conn.values.apiKey}` },
        query: { domain, first: firstName, last: lastName },
      });
      return { email: res.email ?? null, confidence: res.score ?? 0 };
    },
  },
  async test({ conn, io }) {
    await io.http('acme.me', 'https://api.acme.example/v1/me', { headers: { Authorization: `Bearer ${conn.values.apiKey}` } });
    return { account: `key ${maskSecret(conn.values.apiKey)}` };
  },
};
```

Guidelines:

- Make every outbound call through `io.http` (or `io.track` for SMTP, IMAP and other non-HTTP calls) so it appears under Recent tool calls with its status and latency. Give each call a short `op` such as `acme.find`.
- `io.http` turns 401 and 403 responses into a `ProviderError` with `code: 'auth'`, which marks the connection as expired and holds the agent's work until it is reconnected. If a vendor uses 403 for something else, such as a plan limit, catch it and rethrow with another code.
- Return exactly the result shape in [capabilities.md](capabilities.md). Leave out fields you don't have rather than inventing them.
- `test` should be cheap and must not send messages or spend credits when it can avoid it. Return `{ account }`: an email address, a workspace name, or a masked key.
- LLM providers also set `models`, `defaultModel` and `pricing(model)`, which returns USD per million tokens as `{ in, out }`, or `null` when unknown.
- Export the pure mapping functions as named exports and test them with fixtures in `test/providers.test.js`. Never log `conn.values`.
