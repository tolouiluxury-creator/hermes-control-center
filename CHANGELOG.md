# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/).

## [0.1.0] — 2026-07-28

First release. Everything below has been verified against a live Hermes Agent 0.19.0, not against
fixtures.

### Added

- **Dashboard with an arrangeable widget grid.** Drag, resize and remove widgets; every widget also
  offers keyboard moves, so the dashboard can be arranged without a pointer. Layouts are stored
  server-side per installation and survive a reload.
- **Twelve widgets:** system performance with history sparklines, mission status, agent facts, live
  logs, scheduled jobs, skills, MCP servers, model, analytics, recent sessions, insights, and
  knowledge.
- **Chat with the agent over the dashboard's own WebSocket.** The control center speaks the same
  JSON-RPC protocol the dashboard's chat UI does, so chatting needs no API server, no gateway
  restart, and leaves the messaging bot online. Previous conversations can be reopened, with their
  history loaded from the dashboard's REST API.
- **Management pages:** skills (searchable and filterable across 100+ entries), MCP servers,
  models with per-provider authentication state, logs with level filters and follow mode, analytics
  with per-day, per-model and per-tool breakdowns, scheduled tasks, knowledge/RAG (memory providers
  and built-in note files), API & integrations (messaging platforms, incoming webhooks and paired
  users), and settings (environment variables, raw configuration, toolsets, memory curator).
- **Write actions across every page** — switching models, pausing and triggering jobs, toggling
  skills and toolsets, enabling platforms, activating memory providers, editing configuration.
  Each one sits behind an inline confirmation that names the consequence rather than a bare button.
- **Agent presets and workflows**, both stored locally: named bundles of model, toolset, skills and
  system prompt, and ordered chains of prompts and scheduled jobs.
- **Prompt library** with variables and tags, and **rule-based insights** derived from real metrics
  (no model involved).
- **Three interface languages — English, German and Persian**, switchable per device, with
  right-to-left layout for Persian. English is the default.
- **Password protection.** Salted scrypt hashing, stateless HMAC-signed session cookies, per-client
  exponential login throttling, and one request guard covering every API route including the SSE
  stream. The server refuses to bind beyond loopback until a password is set.
- **Remote Hermes support** via `~/.hermes-cc/config.json`, created by `--init-config`, so no secret
  needs to be passed on a command line.
- **`--doctor`**, which reports exactly which Hermes surface is missing and the command that fixes it.
- **Light and dark themes**, a command palette (`Ctrl`/`Cmd` + `K`) with fuzzy matching, toasts,
  skeleton loading states, and a responsive layout with a mobile drawer.

### Notes on correctness

These are the details that took the most care, and the ones most likely to be wrong elsewhere:

- The Hermes dashboard guards nearly its whole API with a session token embedded in the HTML it
  serves. Without it, everything except `/api/status` answers 401. The control center bootstraps that
  token the same way the browser does, and refreshes it when the dashboard restarts.
- Hermes reports session timestamps in seconds. They are converted, with a plausibility check so
  millisecond timestamps are not scaled twice.
- Analytics distinguishes billed cost from estimated cost, because most providers only estimate.
- Byte counts are only rendered when the unit is unambiguous; an unlabelled small number is dropped
  rather than guessed at.
- Log lines are only marked as errors when a level word appears near the start of the line.
- A missing API server is a note, not a wall. Nothing in the control center depends on it — chat
  included — because everything runs over the dashboard backend.
- The interface language is a per-device browser preference, so the server never picks the wording.
  Rule-based insights travel as a key plus the values that triggered them, and the browser phrases
  them; numbers are grouped in the reader's locale rather than pre-formatted on the server.

### Not yet built

- Executing a workflow as a chain. Workflows can be defined, enabled and ordered here; running one
  end to end needs the Hermes API server and will follow.
- Documents, browser automation and file management. Hermes 0.19 exposes no data for them, so
  rather than ship three empty shells the navigation entries were removed.
