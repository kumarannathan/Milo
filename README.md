# Milo

[![CI](https://github.com/kumarannathan/milo/actions/workflows/ci.yml/badge.svg)](https://github.com/kumarannathan/milo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-0f172a.svg)

A control room for an autonomous sales development team. Create an account, connect your own keys, and review everything the agents want to send before it goes out.

Milo is one Node process that serves the app, runs the agents and keeps each account's workspace separate. Every run, tool call, token and dollar is visible.

## The team

Seven agents hand work down a pipeline:

| Agent | Job |
| --- | --- |
| Scout | Finds companies that match your ICP |
| Researcher | Writes an account brief: why now, pains, angles, with sources |
| Prospector | Finds and verifies the right people at each account |
| Qualifier | Scores each lead and decides: outreach, research more, or skip |
| Personalizer | Writes outreach from the research brief |
| SDR | Sends approved outreach, reads replies, books meetings, escalates |
| CRM Agent | Keeps your CRM in sync with everything the team does |

## What you get

- **Approvals.** Emails, replies and meeting invites wait in an inbox until you approve them. Edit a draft before it goes out, or reject it with a note and the writer uses your note next time. Raise the autonomy level when you trust it.
- **Your own connections.** Agents ask for actions such as "Find companies" or "Verify emails", and you choose which connection does each one. Nothing points at anyone else's account.
- **Per-agent control.** Turn agents on and off, change schedules (cron or "when work arrives"), pick a model per agent, edit each agent's settings, and give it standing instructions that ride along with every prompt.
- **Full visibility.** Every run with duration, tokens and cost. Every tool call with its status code and latency. A live activity feed and a pause button for the whole team.
- **Sample data.** Try the full pipeline with made-up companies and a built-in sample model. No keys needed.
- **Keyboard first.** Press ⌘K (Ctrl+K) to jump anywhere, run an agent, or search accounts. The approvals inbox works with J, K, X, E, R and ⌘Enter.
- **Your data stays yours.** One JSON file per workspace on disk, and an export from Account that leaves keys out.

## Milo for Mac

Download the latest `.dmg` from [Releases](https://github.com/kumarannathan/Milo/releases/latest), drag Milo to Applications and open it. The app runs the server and the agents inside itself, stores your workspace under `~/Library/Application Support/Milo`, and has no accounts: you are the user. It is not notarized, so the first launch needs **System Settings › Privacy & Security › Open Anyway** (or `xattr -dr com.apple.quarantine /Applications/Milo.app`).

To build it yourself: `npm run dist:mac` writes the `.dmg` files to `release/`. Pushing a `v*` tag builds them on GitHub Actions and attaches them to a draft release.

## Quick start (server)

Requires Node 20 or later. The server version adds accounts, so a team can share one deployment.

```bash
git clone https://github.com/kumarannathan/milo.git
cd milo
npm install
npm run build
npm start
```

Open http://localhost:4400 and follow the setup. Choose **Try it with sample data** to see the whole pipeline run in a couple of minutes without any keys.

For development, `npm run dev` starts the API with auto-restart and the web app with hot reload at http://localhost:5173.

## Connections

| Service | What agents use it for |
| --- | --- |
| Anthropic | Write text |
| OpenAI and compatible APIs | Write text |
| Ollama | Write text with a local model |
| Tavily | Search the web, read pages, track news |
| Apollo | Find companies, find people, fill in details |
| Hunter | Find and verify work emails |
| HubSpot | Read and update the CRM |
| Email (SMTP and IMAP) | Send email and read replies. Works with Gmail and Google Workspace app passwords, Fastmail and most hosts; Microsoft 365 needs OAuth and is not supported yet. |
| Cal.com | Check availability and book meetings |
| Slack, Discord | Post alerts |
| Polymarket | Find markets, read prices and trades (public API, no key) |
| Sample data | Everything, with fake data |

Each connection is tested when you save it. See [docs/providers.md](docs/providers.md) for the fields each one needs and how to add your own.

## Configuration

Keys are added in the app, not in files. The server reads a few optional environment variables (copy `.env.example` to `.env`):

| Variable | Default | |
| --- | --- | --- |
| `MILO_PORT` | `4400` | Port to listen on |
| `MILO_HOST` | `127.0.0.1` | Address to bind. Use `0.0.0.0` to expose it. |
| `MILO_PUBLIC_URL` | | The https URL users open when hosted; turns on Secure cookies |
| `MILO_AUTH` | `local` | `local` (email + password on this machine), `supabase`, or `none` (single user, no sign-in) |
| `MILO_SESSION_SECRET` | generated | Signs session cookies for `local` auth |
| `SUPABASE_URL`, `SUPABASE_JWT_SECRET` | | For `MILO_AUTH=supabase` |
| `MILO_DATA_DIR` | `data` | Where workspaces are stored (`data/tenants/<user>/milo.json`) |
| `MILO_PLAYBOOKS` | `sales` | Playbooks offered. Add `markets` to enable paper trading on prediction markets. |
| `MILO_PASSWORD` | | Optional extra lock (HTTP basic auth) in front of everything |

## How it works

Agents hand work to each other through a task queue. A scheduler runs each agent on its cron schedule or as soon as work arrives, up to a set number at once. Agents never call vendors directly: they ask for a capability, and Milo routes the call to the connection you picked. Read more in [docs/architecture.md](docs/architecture.md).

```
server/
  runner/      scheduler, run context, capability routing
  playbooks/   agents and routes per playbook
  auth/        local and Supabase account adapters
  tenants.js   one store + runner + event bus per account
  providers/   one file per service
  api/         REST routes
src/           React app
site/          landing page
```

## Data and privacy

Each account's workspace is one JSON file under `data/`, including its connection keys (files are created with owner-only permissions). Keys are only sent to the service they belong to and are never returned to the browser in full. Milo binds to localhost by default; set `MILO_PUBLIC_URL` and run behind TLS before exposing it.

## Development

```bash
npm run dev        # API on :4400 with restart on change, web app on :5173
npm run desktop    # build the web app and open it in the Electron shell
npm test           # node:test suite
npm run build      # build the web app into dist/
npm run dev:site   # landing page on :5180
```

Set `MILO_DEMO_FAST=1` to make the sample-data provider respond instantly, which the tests use.

## Known gaps

- Email works over SMTP and IMAP with a password or app password. Microsoft 365 and Outlook.com need OAuth and are not supported yet.
- Calendar booking uses Cal.com. Without it, the SDR offers your booking link instead.
- Password reset emails arrive with the hosted auth provider; `local` accounts can change their password from Account but not reset it.
- Workspaces are JSON files, so run one instance. The Supabase store comes next.

## License

[MIT](LICENSE)
