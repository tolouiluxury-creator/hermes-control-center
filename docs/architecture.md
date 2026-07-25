# Architecture

```
Browser (React SPA)
   │  own REST under /api  +  one SSE channel (/api/stream)
   ▼
Control center server (Fastify, Node ≥22.5)     ← holds the Hermes API key, aggregates, caches, polls
   ├── Upstream A: Hermes API server   :8642    (bearer auth)
   ├── Upstream B: Hermes dashboard    :9119
   └── Own SQLite (~/.hermes-cc/cc.db) for everything Hermes has no API for
```

## Why a server in the middle

A pure browser SPA talking straight to Hermes would have to hold the API key in JavaScript, force
CORS changes in the user's `~/.hermes/.env`, and could not merge the two upstreams. The server also
means one poll serves every open tab.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/cli.ts` | Argument parsing, port selection, banner, browser launch, graceful shutdown |
| `src/options.ts` | Pure argv/env parser (unit-tested), help text |
| `src/paths.ts` | Hermes home and our own state directory, per platform |
| `src/context.ts` | Wires discovery, clients, store and event bus into one `AppContext` |
| `src/server.ts` | Fastify instance, security headers, route registration, SPA fallback |
| `src/status.ts` | Merges both upstreams into one `StatusSnapshot` |
| `src/poller.ts` | Interval tasks with backoff; idles while no browser is connected |
| `src/events.ts` | Typed event bus feeding the SSE fan-out |
| `src/doctor.ts` | `--doctor` report with per-problem fix instructions |
| `src/hermes/` | Upstream clients: discovery, HTTP client, lenient schemas, normalisation |
| `src/routes/` | One module per domain (`meta`, `status`, `stream`, …) |
| `src/store/` | SQLite via `node:sqlite`, forward-only migrations, repositories |
| `web/src/lib/` | API client, SSE hook, formatters, shared types |
| `web/src/components/` | Reusable UI |
| `dev/mock-hermes.ts` | Fake Hermes for offline development and CI (not published) |

## Key decisions

**`node:sqlite`, not `better-sqlite3`.** Native modules are the most common failure mode for
`npx`-installed tools. The built-in driver needs no compiler; the cost is Node ≥22.5.

**Published as one package.** `web/` is a private workspace whose Vite build emits into `dist/web`.
The tarball contains `dist/` only, so `npx hermes-control-center` downloads a ready-to-run server plus
a prebuilt SPA — no build step on the user's machine.

**Lenient upstream schemas, strict internal DTOs.** Hermes payloads are parsed with schemas that keep
unknown keys and treat almost everything as optional, then normalised into fixed internal shapes. A
new field upstream cannot blank a widget; a genuinely absent value becomes `null` and renders as `—`.

**Failures are UI states, not exceptions.** `UpstreamError` carries a machine-readable reason
(`unreachable`, `unauthorized`, `schema_mismatch`, …) that maps to an honest HTTP status and an
explanatory panel. The app always starts, even with no Hermes at all.

**Poll only when watched.** `Poller` skips tasks while `EventBus.subscriberCount` is zero, so a
forgotten background process costs nothing. Failing tasks back off exponentially to a ceiling.

**Secrets never cross to the browser.** `toPublicConnection()` is the only shape sent to the client:
it reports *whether* a key exists and where it came from, never its value.

## Request flow: a live metric

1. `Poller` runs the `status` task every 3 s (only while a browser is connected).
2. `ctx.refreshStatus()` calls `buildStatusSnapshot()`, which fires three requests in parallel
   (`/health`, `/api/status`, `/api/system/stats`) and two more if the API server is up.
3. The snapshot is cached, its metrics are appended to the `metrics_samples` ring buffer, and it is
   published on the event bus.
4. `/api/stream` writes it to every connected browser as `event: status`.
5. `useControlCenterStream()` puts it into the React Query cache under `['status']`, so components
   reading that key re-render — no component-level polling anywhere.

## Local state

`~/.hermes-cc/cc.db` (override with `HERMES_CC_HOME`). Schema and rationale:
[`docs/hermes-api.md`](./hermes-api.md#gaps-with-no-hermes-api). Migrations are forward-only and
tracked in `PRAGMA user_version`; never edit a shipped migration, append a new one.

The user's `~/.hermes` directory is only written through Hermes' own endpoints, and only behind an
explicit confirmation in the UI.

## Development against a fake Hermes

Most contributors will not want to run a real agent to work on a widget:

```bash
npm run mock:hermes    # serves both surfaces with documented payload shapes
npm run dev            # server on :7777, Vite on :5174
```

The mock deliberately returns `404` with an explanatory body for endpoints it has not implemented, so
missing coverage is visible rather than silently faked.
