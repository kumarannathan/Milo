# Milo

[![CI](https://github.com/kumarannathan/milo/actions/workflows/ci.yml/badge.svg)](https://github.com/kumarannathan/milo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-0f172a.svg)

A control room for autonomous agent teams. Pick a playbook, bring your own keys, and watch your agents work.

Milo runs on your machine as a single Node process. You choose a team of agents, connect the services they need, and review everything they want to send or trade before it goes out. Every run, tool call, token and dollar is visible.

## Playbooks

You pick one when you first open Milo.

**Sales development.** Seven agents hand work down a pipeline:

| Agent | Job |
| --- | --- |
| Scout | Finds companies that match your ICP |
| Researcher | Writes an account brief: why now, pains, angles, with sources |
| Prospector | Finds and verifies the right people at each account |
| Qualifier | Scores each lead and decides: outreach, research more, or skip |
| Personalizer | Writes outreach from the research brief |
| SDR | Sends approved outreach, reads replies, books meetings, escalates |
| CRM Agent | Keeps your CRM in sync with everything the team does |

**Markets.** Five agents work prediction markets with paper money:

| Agent | Job |
| --- | --- |
| Scanner | Finds active markets worth watching |
| Whale Watch | Follows large trades on the markets you watch |
| Analyst | Writes a brief and estimates the odds for each market |
| Trader | Sizes and places paper trades when the edge is big enough |
| Bookkeeper | Marks positions to market and settles resolved ones |

No real money moves in the Markets playbook.

## What you get

- **Approvals.** Emails, replies, meeting invites and trades wait in an inbox until you approve them. Edit a draft before it goes out, or reject it with a note and the writer uses your note next time. Raise the autonomy level when you trust it.
- **Your own connections.** Agents ask for actions such as "Find companies" or "Verify emails", and you choose which connection does each one. Nothing points at anyone else's account.
- **Per-agent control.** Turn agents on and off, change schedules (cron or "when work arrives"), pick a model per agent, edit each agent's settings, and give it standing instructions that ride along with every prompt.
- **Full visibility.** Every run with duration, tokens and cost. Every tool call with its status code and latency. A live activity feed and a pause button for the whole team.
- **Sample data mode.** Try the full pipeline with made-up companies or markets and a built-in sample model. No keys needed.
- **Keyboard first.** Press ⌘K (Ctrl+K) to jump anywhere, run an agent, or search accounts and markets. The approvals inbox works with J, K, X, E, R and ⌘Enter.
- **Your data stays yours.** One JSON file on disk, and an export from Settings that leaves keys out.

## Quick start

Requires Node 20 or later.

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

Keys are added in the app, not in files. The server itself reads a few optional environment variables (copy `.env.example` to `.env`):

| Variable | Default | |
| --- | --- | --- |
| `MILO_PORT` | `4400` | Port to listen on |
| `MILO_HOST` | `127.0.0.1` | Address to bind. Use `0.0.0.0` to expose it on your network. |
| `MILO_DATA_DIR` | `data` | Where `milo.json` is stored |
| `MILO_PASSWORD` | | Require this password (HTTP basic auth) for every request |

## How it works

Agents hand work to each other through a task queue. A scheduler runs each agent on its cron schedule or as soon as work arrives, up to a set number at once. Agents never call vendors directly: they ask for a capability, and Milo routes the call to the connection you picked. Read more in [docs/architecture.md](docs/architecture.md).

```
server/
  runner/      scheduler, run context, capability routing
  playbooks/   sales/ and markets/ agents and routes
  providers/   one file per service
  api/         REST routes
src/           React app
site/          landing page
```

## Data and privacy

Everything is stored in `data/milo.json` on your machine, including connection keys (the file is created with owner-only permissions). Keys are only sent to the service they belong to and are never returned to the browser in full. Milo binds to localhost by default; set `MILO_PASSWORD` before exposing it.

## Development

```bash
npm run dev        # API on :4400 with restart on change, web app on :5173
npm test           # node:test suite
npm run build      # build the web app into dist/
npm run dev:site   # landing page on :5180
```

Set `MILO_DEMO_FAST=1` to make the sample-data provider respond instantly, which the tests use.

## Known gaps

- Email works over SMTP and IMAP with a password or app password. Microsoft 365 and Outlook.com need OAuth and are not supported yet.
- Calendar booking uses Cal.com. Without it, the SDR offers your booking link instead.
- The Markets playbook reads Polymarket's public data and trades on paper only. There is no live trading.

## License

[MIT](LICENSE)
