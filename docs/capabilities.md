# Capabilities

Agents never call a vendor directly. They ask for a capability, and Milo routes the call to the connection you picked for that agent (or the first connection that supports it). Adding a provider means implementing some of these handlers.

Every handler has the signature:

```js
async (args, { conn, io, workspace }) => result
```

- `conn.values` holds the fields the user entered (API keys, hosts).
- `io.http(op, url, init)` makes the request and records it under "Recent tool calls". Use it for every outbound call. `init` takes `method`, `headers`, `query`, `json`, `form`, `timeoutMs`.
- `io.track(op, fn)` records a call that is not plain HTTP (SMTP, IMAP).
- Throw `ProviderError` (from `server/providers/io.js`) with `code: 'auth'` when credentials are rejected. Milo marks the connection as expired and holds the agent's work until it is reconnected.

Dates are ISO 8601 strings. Money is US dollars. Prices are probabilities from 0 to 1.

## Shared

| Capability | Args | Result |
| --- | --- | --- |
| `llm.complete` | `{ system?, prompt, json?, maxTokens?, model, purpose?, input? }` | `{ text, data?, tokensIn, tokensOut, model }` |
| `web.search` | `{ query, maxResults?, days?, topic? }` | `{ results: [{ title, url, snippet, publishedAt? }] }` |
| `web.fetch` | `{ url }` | `{ url, title, text }` |
| `signals.news` | `{ query, days?, topic? }` | `{ items: [{ title, url, publishedAt, summary }] }` |
| `notify.post` | `{ text, level?: 'info' \| 'warn' \| 'error' }` | `{ ok: true }` |

`purpose` and `input` on `llm.complete` describe what the agent is asking for (for example `purpose: 'account_brief'`). Real models ignore them and read `prompt`; the sample-data provider uses them to produce realistic output without a model. When `json` is true the handler may return parsed `data`; otherwise Milo parses `text`.

## Sales development

| Capability | Args | Result |
| --- | --- | --- |
| `accounts.search` | `{ icp: { industries[], employeesMin, employeesMax, locations[], keywords[] }, limit, page?, excludeDomains? }` | `{ accounts: [{ name, domain, industry, employees, location, linkedin?, revenue?, tech?, description?, externalId?, source }] }` |
| `accounts.enrich` | `{ domain }` | `{ account: { …same fields, partial } }` |
| `contacts.search` | `{ domain, accountName, titles[], seniorities[], limit }` | `{ contacts: [{ name, firstName, lastName, title, email?, emailStatus?, linkedin?, location?, seniority?, externalId? }] }` |
| `contacts.enrich` | `{ contact }` | `{ contact }` |
| `email.find` | `{ domain, firstName, lastName }` | `{ email \| null, confidence }` (0–100) |
| `email.verify` | `{ email }` | `{ status: 'verified' \| 'likely' \| 'invalid' \| 'unknown' }` |
| `signals.funding` | `{ domain, name }` | `{ items: [{ type: 'Funding', date, title, url }] }` |
| `signals.hiring` | `{ domain, name }` | `{ openRoles, items: [{ type: 'Hiring', date, title, url }] }` |
| `social.search` | `{ query }` | `{ items: [{ title, url, publishedAt, summary }] }` |
| `crm.read` | `{ domain?, email? }` | `{ company: { id, url } \| null, contact: { id, url } \| null, isCustomer }` |
| `crm.write` | `{ op: 'upsert_company' \| 'upsert_contact' \| 'log_email' \| 'note', company?, contact?, email?, note?, companyId?, contactId? }` | `{ id, url? }` |
| `email.send` | `{ to, toName?, subject, body, threadId?, inReplyTo? }` | `{ messageId, threadId }` |
| `email.read` | `{ since, threadIds? }` | `{ messages: [{ messageId, threadId, inReplyTo?, from, fromName?, to, subject, body, at }] }` |
| `calendar.availability` | `{ from, to, durationMin }` | `{ slots: [{ start, end }] }` |
| `calendar.book` | `{ title, start, durationMin, attendees: [{ email, name? }], description? }` | `{ eventId, link? }` |

## Markets

| Capability | Args | Result |
| --- | --- | --- |
| `markets.search` | `{ limit, minVolume?, minLiquidity?, closesWithinDays?, keywords?, slug? }` (`slug` looks up one market or event and skips the filters) | `{ markets: [{ externalId, question, slug, category?, endDate, yesPrice, volume24h, volume?, liquidity, url }] }` |
| `markets.quote` | `{ externalIds[] }` | `{ quotes: [{ externalId, yesPrice, closed, outcome: 'yes' \| 'no' \| null }] }` |
| `markets.trades` | `{ externalIds[], minSize?, since? }` | `{ trades: [{ externalId, wallet, trader?, side: 'yes' \| 'no', action: 'buy' \| 'sell', size, shares?, price, at, txHash? }] }` |
