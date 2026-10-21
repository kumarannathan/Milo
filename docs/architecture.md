# Architecture

Milo is one Node process that serves the API, runs the agents, and serves the built web app. Each signed-in account gets its own tenant: a JSON store, a runner and an event bus, created on first request and unloaded when idle.

```
browser ──HTTP/SSE──▶ server/app.js ──▶ auth/*           who is this? (cookie or Supabase JWT)
                                    ──▶ tenants.js       store + runner + bus for that account
                                    ──▶ api/*            REST routes (run against the request's tenant)
                                    ──▶ runner/runner.js  schedules and runs agents
                                    ──▶ store.js          data/tenants/<user>/milo.json
runner ──ctx──▶ agent.run(ctx) ──ctx.call(capability)──▶ providers/<vendor>.js ──▶ vendor API
```

## Pieces

| Path | What it does |
| --- | --- |
| `server/index.js` | Entry point. Reads `.env`, starts the HTTP server and the runner. |
| `server/app.js` | Resolves the user, picks their tenant, and runs the routes inside an `AsyncLocalStorage` scope so handlers see that tenant's store/runner/bus. |
| `server/auth/` | `local` (scrypt passwords in `data/users.json`, signed cookie), `supabase` (verifies Supabase JWTs), `none` (single built-in user). |
| `server/tenants.js` | One store, runner and event bus per user. |
| `server/store.js` | In-memory collections persisted to `data/milo.json` (debounced, atomic writes, file mode 600). Emits the names of changed collections. |
| `server/events.js` | Server-sent events. The UI subscribes once and refetches the collections that changed. |
| `server/runner/` | The scheduler, the per-run context agents receive, and capability routing. |
| `server/playbooks/` | Agent definitions and playbook-specific routes. One folder per playbook. |
| `server/providers/` | One file per vendor. Every file in the folder is loaded automatically. |
| `src/` | React app. Hash routes, one file per screen in `src/pages/`. |
| `site/` | Static landing page. |

## Playbooks and agents

A playbook is a list of agents plus the settings, approval levels and routes they need. An agent is a plain object:

```js
export default {
  id: 'researcher',
  name: 'Researcher',
  consumes: ['research_account'],     // task types it picks up
  produces: ['find_contacts'],        // task types it hands off
  schedule: { type: 'event' },        // or { type: 'cron', cron: '0 */4 * * *' }
  capabilities: [{ key: 'web.search', required: true }, { key: 'llm.complete', required: true }],
  config: [{ key: 'sourcesPerBrief', label: 'Sources per brief', type: 'number', default: 8 }],
  async run(ctx) { /* … */ return { summary: 'Brief for Acme Health' }; },
};
```

Agents hand work to each other through a task queue: `ctx.emit('find_contacts', payload)` queues a task for whichever agent consumes that type. Event-driven agents run as soon as work is queued; cron agents run on their schedule.

## The runner

Every two seconds the runner checks each enabled agent:

- a cron agent runs when its next run time has passed;
- an event-driven agent runs when it has queued tasks;
- any agent runs when someone presses "Run now".

At most `workers` agents run at once (default 3). A run claims up to `batch` tasks, calls `agent.run(ctx)`, and records duration, tokens, cost and every tool call. If a run fails, unfinished tasks go back to the queue (up to three attempts) and the agent backs off. If a connection rejects its credentials, the connection is marked expired and the work is held rather than retried, so nothing is sent twice.

## Capabilities and connections

Agents never call a vendor directly. They ask for a capability (`ctx.call('email.verify', { email })`) and Milo routes it:

1. to the connection chosen for that agent on the Agents screen, otherwise
2. to the workspace default, otherwise
3. to the first connection whose provider implements the capability.

`llm.complete` follows the agent's model setting, then the workspace default model. The capability contracts are in [capabilities.md](capabilities.md) and the providers in [providers.md](providers.md).

## Approvals

Anything that leaves your machine on your behalf (emails, replies, meeting invites) or places a trade becomes an approval first, unless you raise the autonomy level under Account. Approving runs the playbook's `approve` hook, which queues the send or opens the position. Rejecting stores your note, and the writing agent includes recent notes in its next prompts.

## Data

`data/tenants/<user>/milo.json` holds that account's workspace, connections (including keys), agent state, tasks, runs, tool calls, activity and the playbook's records. Old runs, tool calls and activity are trimmed automatically. Delete the file (or use Account → Reset) to start over.
