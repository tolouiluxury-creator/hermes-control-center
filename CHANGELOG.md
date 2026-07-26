# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

Everything below has been verified against a live Hermes Agent 0.19.0, not against fixtures.

### Added

- **Dashboard with an arrangeable widget grid.** Drag, resize and remove widgets; every widget also
  offers keyboard moves, so the dashboard can be arranged without a pointer. Layouts are stored
  server-side per installation and survive a reload.
- **Eleven widgets:** system performance with history sparklines, mission status, agent facts, live
  logs, scheduled jobs, skills, MCP servers, model, analytics, recent sessions, and knowledge.
- **Management pages:** skills (searchable and filterable across 100+ entries), MCP servers,
  models with per-provider authentication state, logs with level filters and follow mode, analytics
  with per-day, per-model and per-tool breakdowns, scheduled tasks, knowledge/RAG (memory providers
  and built-in note files), and API & integrations (messaging platforms, incoming webhooks and
  paired users).
- **Prompt library** with variables and tags, and **rule-based insights** derived from real metrics
  (no model involved).
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
- A missing API server is a banner, not a wall: the dashboard backend alone powers most of the UI,
  and running without the API server is a legitimate setup.

### Not yet built

- Chat, sessions and agent runs (they need the Hermes API server, which is optional and off by
  default).
- Write actions — switching models, pausing jobs, toggling skills. They change a running agent and
  will ship with confirmation dialogs rather than bare buttons.
- Workflows and named agent presets.
