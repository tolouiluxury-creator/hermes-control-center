# Hermes Control Center

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

> **Status: early development.** Milestones M0 (scaffold) and M1 (Hermes integration layer) are the
> current focus. The widget grid and pages land in M2–M7. Nothing here fakes data: a panel with no
> real source shows an explicit empty state instead of a plausible-looking number.

## Requirements

- **Node.js ≥ 22.5** — the built-in `node:sqlite` module is used for local state, so there is
  nothing to compile at install time.
- **A local Hermes Agent installation.** Hermes exposes two HTTP surfaces and the control center
  uses both:

  | Surface | Start it with | Default | Provides |
  | --- | --- | --- | --- |
  | API server | `hermes gateway` (with `API_SERVER_ENABLED=true`) | `127.0.0.1:8642` | chat, sessions, runs, jobs |
  | Dashboard backend | `hermes dashboard --no-open` | `127.0.0.1:9119` | config, skills, MCP, models, cron, logs, metrics |

  Neither is required to *start* the control center — it will show a setup screen telling you exactly
  what is missing and how to enable it.

To enable the API server, add this to `~/.hermes/.env` (`%LOCALAPPDATA%\hermes\.env` on Windows):

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

## Security

- Binds to `127.0.0.1` by default. Exposing it further prints a warning; do that only behind an
  authenticating reverse proxy.
- The Hermes API key never reaches the browser. Secrets are redacted in every response.
- Strict CSP, no inline scripts, no external CDN requests, no telemetry.
- Every write that touches your Hermes installation (config, env, gateway restart, memory reset, job
  deletion) is behind a confirmation dialog that spells out the consequence.

## Development

```bash
git clone https://github.com/<owner>/hermes-control-center.git
cd hermes-control-center
npm install
npm run dev          # server on :7777, Vite on :5174 (open this one)
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

`npm audit` reports a DoS advisory in `brace-expansion`, reached only through ESLint's glob handling.
It is a lint-time dev dependency and is not part of the published package — `npm audit --omit=dev`
is clean.

## Not affiliated with Nous Research

Hermes Agent is a project of [Nous Research](https://github.com/NousResearch). This is an
independent community front end. Related projects worth knowing:
[`nesquena/hermes-webui`](https://github.com/nesquena/hermes-webui) and
[`EKKOLearnAI/hermes-studio`](https://github.com/EKKOLearnAI/hermes-studio) — both chat-first, where
this one is dashboard-first.

## License

[MIT](./LICENSE)
