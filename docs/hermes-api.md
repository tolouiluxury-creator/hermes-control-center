# Hermes Agent endpoint map

Everything the control center reads or writes, and where it comes from. Sourced from the official
Hermes documentation ([API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server),
[Web dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard),
[Webhooks](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks)).

Hermes exposes **two independent HTTP servers**. Neither alone is enough for a full cockpit.

| Surface | Started by | Default | Auth |
| --- | --- | --- | --- |
| API server | `hermes gateway` with `API_SERVER_ENABLED=true` | `127.0.0.1:8642` | `Authorization: Bearer $API_SERVER_KEY` (required) |
| Dashboard backend | `hermes dashboard` (needs the `[web]` extra) | `127.0.0.1:9119` | none on loopback; OAuth/basic/OIDC when bound wider |

All dashboard endpoints accept `?profile=<name>` to scope reads and writes to a Hermes profile. Our
client appends it automatically when `--profile` is set.

## API server (:8642)

### Conversation

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/chat/completions` | OpenAI-compatible. SSE emits `chat.completion.chunk` plus `hermes.tool.progress` |
| POST | `/v1/responses` | Server-side state via `previous_response_id` or a named `conversation`; keeps tool history |
| GET/DELETE | `/v1/responses/{id}` | Stored responses, max 100 (LRU) |
| GET | `/v1/models` | Minimal OpenAI discovery; the profile name is the model id |
| GET | `/v1/capabilities` | Feature flags — **used for graceful degradation on older Hermes builds** |

Headers: `X-Hermes-Session-Key` (stable per-user identity, ≤256 chars), `X-Hermes-Session-Id`
(transcript id, rotates on `/new`), `Idempotency-Key` (responses cached 5 min).

### Runs (streaming alternative)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/runs` | Async run, returns `run_id` |
| GET | `/v1/runs/{id}` | Poll state: `started`, `completed`, `failed`, `cancelled`, `stopping` |
| GET | `/v1/runs/{id}/events` | SSE: tool progress, token deltas, lifecycle. **Buffers expire after 5 min** |
| POST | `/v1/runs/{id}/stop` | Returns immediately; run settles as `cancelled` |
| POST | `/v1/runs/{id}/approval` | Resolves human-approval gates on tool calls |

There is **no endpoint that lists active runs**. Live-task counts come from `/health/detailed`
(`active_runs`), and detail only for runs this control center started itself.

### Sessions

`GET|POST /api/sessions` · `GET|PATCH|DELETE /api/sessions/{id}` · `/{id}/messages` · `/{id}/fork` ·
`/{id}/chat` · `/{id}/chat/stream` (SSE: `assistant.delta`, `tool.started`, `tool.completed`,
`run.completed`).

### Jobs

`GET|POST /api/jobs` · `GET|PATCH|DELETE /api/jobs/{id}` · `/{id}/pause` · `/{id}/resume` · `/{id}/run`.

### Inventory and health

`GET /v1/skills` · `GET /v1/toolsets` · `GET /health` (open) · `GET /health/detailed` (auth;
`readiness.checks`, `active_runs`, `pending_processes`, `delegations`).

## Dashboard backend (:9119)

| Area | Endpoints |
| --- | --- |
| Status | `GET /api/status`, `GET /api/system/stats`, `GET /api/logs`, `GET /api/analytics/usage?days=` |
| Config | `GET/PUT /api/config`, `GET /api/config/defaults`, `GET /api/config/schema` |
| Env / keys | `GET/PUT/DELETE /api/env` (values redacted) |
| Sessions | `GET /api/sessions`, `/{id}`, `/{id}/messages`, `/search?q=`, `/{id}/export`, `POST /prune`, `GET /stats` |
| Skills | `GET /api/skills`, `PUT /api/skills/toggle`, `/hub/{search,install,uninstall,update}` |
| Tools | `GET /api/tools/toolsets` |
| Models | `GET /api/model/{info,options,auxiliary}`, `PUT /api/model/{info,options,auxiliary,set}` |
| MCP | `GET/POST /api/mcp/servers`, `POST /{name}/test`, `PUT /{name}/enabled`, `DELETE /{name}`, `GET /api/mcp/catalog`, `POST /api/mcp/catalog/install` |
| Cron | `GET/POST /api/cron/jobs`, `PUT/DELETE /{id}`, `POST /{id}/{pause,resume,trigger}` |
| Memory | `GET /api/memory`, `PUT /api/memory/provider`, `POST /api/memory/reset` |
| Messaging | `GET /api/messaging/platforms`, `PUT /{id}`, `POST /{id}/test` |
| Webhooks | `GET/POST /api/webhooks`, `DELETE /{name}`, `PUT /{name}/enabled` |
| Pairing | `GET /api/pairing`, `POST /api/pairing/{approve,revoke,clear-pending}` |
| Gateway | `POST /api/gateway/{start,stop,restart}` |
| Credentials | `GET/POST /api/credentials/pool`, `DELETE /{provider}/{index}` |
| Ops | `POST /api/ops/{doctor,security-audit,backup,import,prompt-size,dump,config-migrate}`, `GET/POST/DELETE /api/ops/hooks`, `GET/POST /api/ops/checkpoints` |
| Curator | `GET /api/curator`, `PUT /api/curator/paused`, `POST /api/curator/run` |
| Update | `GET /api/hermes/update/check` (git installs only) |
| WebSocket | `/api/ws` (live chat), `/api/pty` (embedded TUI, needs the `pty` extra) |

## Consequences for this project

**No outbound events.** Hermes' webhooks are *inbound* (GitHub, Stripe, … → Hermes). Freshness comes
from SSE on chat/runs plus polling everything else. The server polls once and fans out to all
browsers over a single `/api/stream` SSE channel, so ten open tabs cost one upstream request.

**Two clients, one snapshot.** `/api/status` in this project merges API-server health, dashboard
status and host stats. Each sub-request fails independently: a dead dashboard must not hide a healthy
API server.

**Lenient parsing.** Field names differ across Hermes versions (`cpu_percent` vs `cpu: { percent }`,
numbers vs strings). Schemas in `src/hermes/schemas.ts` keep unknown keys and make nearly everything
optional; `src/hermes/normalize.ts` reduces the variants to one shape and returns `null` — never a
guess — when a value is absent.

**Unit ambiguity is not guessed.** Byte counts are only displayed when the key says `*_bytes` or the
value is large enough that no other unit is plausible. Otherwise the UI shows `—`.

## Gaps with no Hermes API

These have no upstream equivalent and live in our own SQLite (`~/.hermes-cc/cc.db`):

| Feature | How it is backed |
| --- | --- |
| Dashboard layouts | `dashboards` table |
| Prompt library | `prompts` table |
| Workflows | `workflows` / `workflow_steps` / `workflow_runs`, mapped onto Hermes cron jobs and runs |
| Named agent presets | `agents` table (model + toolset + skills + system prompt) |
| Notifications | `notifications`, filled from poller diffs |
| AI insights | `insights`, produced by deterministic rules over real metrics |
| Metric history / sparklines | `metrics_samples` ring buffer (Hermes reports instantaneous values only) |
| GPU metrics | Not available from Hermes. Optional local sensor; the tile stays greyed out otherwise |
