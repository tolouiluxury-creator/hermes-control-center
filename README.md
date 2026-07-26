# Hermes Control Center

[![CI](https://github.com/tolouiluxury-creator/hermes-control-center/actions/workflows/ci.yml/badge.svg)](https://github.com/tolouiluxury-creator/hermes-control-center/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-brightgreen.svg)](https://nodejs.org)

A dashboard-first web cockpit for [Hermes Agent](https://github.com/NousResearch/hermes-agent).

Most Hermes web UIs are chat clients with management bolted on. This one is the other way round: a
dense, dark, widget-based control room — agent health, live runs, model and MCP inventory, cost and
token analytics, scheduled jobs, logs and system load at a glance — with chat as one of many panels.
Think Grafana meets Raycast, for your own agent.

```bash
npx hermes-control-center
```

That is the whole install. No build step, no Python extra, no native compilation, no API key in your
browser.

> Not on npm yet. Until the first release is published, install from a clone — see
> [Development](#development).

> **Status: usable, incomplete.** The dashboard, the widget grid and six management pages work
> against a live agent — everything shown below has been verified against Hermes 0.19.0. Chat and
> write actions are not built yet; see [CHANGELOG.md](./CHANGELOG.md) for the exact line between the
> two. Nothing here fakes data: a panel with no real source shows an explicit empty state instead of
> a plausible-looking number.

## What you get

- **An arrangeable dashboard.** Eleven widgets — system load with history, agent health, live logs,
  scheduled jobs, skills, MCP servers, model, token and cost analytics, recent sessions, knowledge.
  Drag them, resize them, or move them with the keyboard; the layout is saved.
- **Management pages** for skills (searchable across a hundred or more), models with per-provider
  authentication state, logs with level filters and a follow toggle, analytics broken down by day,
  model and tool, scheduled tasks, and MCP servers.
- **A command palette** (`Ctrl`/`Cmd` + `K`) that reaches every page, with fuzzy matching.
- **Light and dark themes**, keyboard shortcuts, and a layout that works on a phone.

## Requirements

- **Node.js ≥ 22.5** — the built-in `node:sqlite` module is used for local state, so there is
  nothing to compile at install time.
- **A Hermes Agent installation**, local or on a server. Hermes exposes two HTTP surfaces:

  | Surface | Start it with | Default | Provides |
  | --- | --- | --- | --- |
  | Dashboard backend | `hermes dashboard --no-open` | `127.0.0.1:9119` | config, skills, MCP, models, cron, logs, metrics, sessions |
  | API server | `hermes gateway` (with `API_SERVER_ENABLED=true`) | `127.0.0.1:8642` | chat, runs, jobs |

  **Only the dashboard backend is load-bearing.** It powers the widgets and every page listed above.
  Running without the API server is a perfectly normal setup: you get a dismissible banner naming
  what is unavailable, not a wall in front of a working cockpit.

  Neither is required to *start* the control center — `--doctor` and the setup screen tell you
  exactly what is missing and which command fixes it.

To enable the API server as well, add this to `~/.hermes/.env` (`%LOCALAPPDATA%\hermes\.env` on
Windows) and restart the gateway:

```
API_SERVER_ENABLED=true
API_SERVER_KEY=replace-with-a-long-random-string
```

The control center reads that key from your Hermes config automatically. It stays on the server side
and is never sent to the browser.

## Usage

```bash
# start on http://127.0.0.1:7777 and open a browser
npx hermes-control-center

# check the Hermes connection without starting anything
npx hermes-control-center --doctor

# a specific Hermes profile, a different port, no browser
npx hermes-control-center --profile alice --port 8080 --no-open
```

Run `npx hermes-control-center --help` for all flags.

### State

Control-center state lives in `~/.hermes-cc/` (override with `HERMES_CC_HOME`): dashboard layouts,
saved prompts, workflow definitions and a metrics ring buffer. Your Hermes directory is only written
to when you explicitly confirm a change in the UI.

## Remote Hermes, and exposing the control center

If Hermes runs on a server rather than on your laptop, forward both ports over SSH and point the
control center at localhost:

```bash
ssh -N -L 8642:127.0.0.1:8642 -L 9119:127.0.0.1:9119 you@your-server
```

Then create a local config file and put the server's `API_SERVER_KEY` into it, so no secret ever
appears on a command line or in shell history:

```bash
npx hermes-control-center --init-config   # writes ~/.hermes-cc/config.json
```

### Password protection

The control center can restart your gateway, write environment variables and chat as you. It
therefore **refuses to listen on anything but localhost until a password is set**:

```bash
npx hermes-control-center --set-password
```

The password is stored as a salted scrypt hash; sessions are stateless, HMAC-signed, HttpOnly cookies
with a 12-hour lifetime. Failed logins are throttled per client address with an exponential backoff.
Changing the password keeps existing sessions valid; delete the `auth` block from
`~/.hermes-cc/config.json` to invalidate everything and start over.

Password protection is the minimum, not the whole story. For an internet-facing deployment, put an
authenticating proxy in front as well — Cloudflare Access, Authelia, or your reverse proxy's own auth.

## Security

- Binds to `127.0.0.1` by default, and will not bind wider without a password.
- The Hermes API key never reaches the browser. Secrets are redacted in every response, and the
  connection payload the UI receives reports only *whether* a key exists.
- Every `/api` route, including the SSE stream, sits behind one `onRequest` guard, so no new endpoint
  can accidentally ship unauthenticated.
- Strict CSP, no inline scripts, no external CDN requests, no telemetry.
- Every write that touches your Hermes installation (config, env, gateway restart, memory reset, job
  deletion) is behind a confirmation dialog that spells out the consequence.

## Development

```bash
git clone https://github.com/tolouiluxury-creator/hermes-control-center.git
cd hermes-control-center
npm install
npm run dev          # server on :7777, Vite on :5174 (open this one)
```

To run the real thing from a clone rather than the dev server:

```bash
npm run build && npm start
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Server + Vite dev server with HMR |
| `npm run build` | Build the SPA into `dist/web`, compile the server into `dist` |
| `npm start` | Run the built server |
| `npm run doctor` | Hermes connection report |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | Type-check server and web |
| `npm run lint` | ESLint |

Architecture, the widget catalogue and the full Hermes endpoint map are documented in
[`docs/`](./docs).

### Known advisory noise

`npm audit` reports six high-severity entries. All of them trace to one `brace-expansion` advisory
reached through `minimatch` in ESLint's glob handling. ESLint is a lint-time dev dependency and is
not part of the published package: `npm audit --omit=dev` reports zero vulnerabilities, and the
published tarball contains no ESLint code.

## Not affiliated with Nous Research

Hermes Agent is a project of [Nous Research](https://github.com/NousResearch). This is an
independent community front end. Related projects worth knowing:
[`nesquena/hermes-webui`](https://github.com/nesquena/hermes-webui) and
[`EKKOLearnAI/hermes-studio`](https://github.com/EKKOLearnAI/hermes-studio) — both chat-first, where
this one is dashboard-first.

## License

[MIT](./LICENSE)
