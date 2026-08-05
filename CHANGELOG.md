# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/).

## [0.1.0] — 2026-08-05

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
- **File attachments in chat**, uploaded via Hermes's own `file.attach`, shown as the file name with
  an image thumbnail (for images attached this session) or a plain file chip — never the raw
  server-side path.
- **A collapsible chat sidebar** with two tabs: a **ToDos panel** (add from the sidebar or from a
  hover action on any message, pin, complete, delete) and a **Workspace browser** in the same compact
  space used for full file management (below).
- **Conversation list improvements:** search, date grouping with a leading pinned bucket, pin/select/
  delete, and an auto-scroll lock that only follows new output when you were already at the bottom
  (otherwise a "jump to latest" pill appears).
- **Model and profile switchable per conversation**, including mid-conversation model switches with
  Hermes's own expensive-model confirmation, without ever mutating the profile's persisted default.
- **A dedicated Profiles page:** create (optionally cloned from an existing profile, with or without
  its conversations/memory/skills), rename, describe, edit `SOUL.md`, set the sticky profile, delete
  — with deletion blocked for the default profile, the profile this instance runs as, and any profile
  with a running gateway.
- **Management pages, all with real write actions:** skills (create, edit, toggle, searchable across
  100+ entries), MCP servers (add, edit, delete, test), models (main model, the eleven auxiliary-task
  slots, and a model override per profile), logs with level filters and follow mode, analytics with
  per-day, per-model and per-tool breakdowns, scheduled tasks (create, edit, pause/resume/trigger/
  delete), knowledge/RAG (memory providers and built-in note files), workspace (browse, create, edit
  and delete files and folders on the Hermes host, confined to one configured root), API &
  integrations (messaging platforms, incoming webhooks with a one-time signing secret, paired users),
  and settings (environment variables scoped per profile, raw configuration, toolsets, memory
  curator). Every write action sits behind an inline confirmation that names the consequence rather
  than a bare button.
- **A Telegram area**, scoped to the profile actually running the gateway: connection status
  including whether a gateway is really running (not just "enabled"), every conversation the bot has
  had, and the ability to continue a conversation from the control center itself.
- **Self-service password change** in Settings, and a **Logout button** in the sidebar — both apply
  immediately, no server restart needed.
- **A Donate page** with EVM, Solana (USDC/USDT) and TON addresses, each with a client-side-generated
  QR code and a copy button; addresses never leave the browser via a third-party API.
- **Workflows**, stored locally: ordered chains of prompts and scheduled jobs, with full CRUD,
  reordering and enable/disable.
- **Prompt library** with variables, tags, duplication and a copy button, and **rule-based insights**
  derived from real metrics (no model involved).
- **Three interface languages — English, German and Persian**, switchable per device, with
  right-to-left layout for Persian. English is the default; over 800 keys translated in lockstep
  across all three dictionaries.
- **Password protection.** Salted scrypt hashing, stateless HMAC-signed session cookies, per-client
  exponential login throttling, and one request guard covering every API route including the SSE
  stream. The server refuses to bind beyond loopback until a password is set.
- **Remote Hermes support** via `~/.hermes-cc/config.json`, created by `--init-config`, so no secret
  needs to be passed on a command line.
- **`--doctor`**, which reports exactly which Hermes surface is missing and the command that fixes it.
- **Light and dark themes**, a command palette (`Ctrl`/`Cmd` + `K`) with fuzzy matching, toasts,
  skeleton loading states, and a responsive layout with a mobile drawer.

### Removed

- **Terminal area.** Built as a terminal-styled way to chat with the agent, then removed once it was
  clear the regular chat already covers the same conversation — a second entry point for the same
  thing was not worth keeping. Hermes's real PTY endpoint was never wired up (that would be a root
  shell over the browser, deliberately out of scope).
- **Agents (presets) area.** Superseded by the Profiles page.
- **Documents, browser automation and file-management nav entries** planned early on. Hermes 0.19
  exposes no data for the first two; file management shipped instead as the Workspace page and the
  chat sidebar's Workspace tab.

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
- A missing API server is not reported at all in the interface. Nothing in the control center
  depends on it — chat included — because everything runs over the dashboard backend, so a warning
  would be a false alarm. `--doctor` still lists it, which is where a diagnostic belongs.
- The interface language is a per-device browser preference, so the server never picks the wording.
  Rule-based insights travel as a key plus the values that triggered them, and the browser phrases
  them; numbers are grouped in the reader's locale rather than pre-formatted on the server.

### Not yet built

- Executing a workflow as a chain. Workflows can be defined, enabled and ordered here; running one
  end to end needs the Hermes API server and will follow.
- Documents and browser automation. Hermes 0.19 exposes no data for either, so rather than ship two
  empty shells the navigation entries were removed.
- Component and end-to-end tests. Server normalizers, stores and pure functions are unit-tested;
  React components rely on type-checking and manual verification against a live Hermes instance.
