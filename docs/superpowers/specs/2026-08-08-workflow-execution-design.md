# Workflow execution — design

**Status:** approved, pending implementation plan
**Scope:** making existing Workflows (`web/src/pages/WorkflowsPage.tsx`, `src/store/workflows.ts`, `src/routes/workspace.ts`) actually runnable — manually and on a schedule — plus the run history needed to make that trustworthy. CRUD (create/edit/reorder/enable/delete) already exists and is unchanged by this spec.

## Why

Workflows today are a pure organizer: name a chain of prompt/cron/note steps, but there is no way to run one. Users want to actually execute a workflow (to test it and to use it for real), both by hand and unattended on a schedule — the same expectation the Aufgaben (cron) area already sets.

## Out of scope (explicit)

- Hermes' optional API server (port 8642) and any gateway restart. Both step kinds already have a working path through the dashboard that's always running (see §2) — no reason to touch either.
- Branching/parallel steps. Steps stay strictly sequential, matching the existing editor's model (an ordered list, reorder via up/down arrows).
- Editing a workflow while a run is in flight changing that run's behavior. A run snapshots its steps at start time; later edits only affect future runs.
- Any change to Hermes itself (config, cron jobs, delivery targets).
- Pushing to GitHub. Development and testing for this feature happens entirely against the production server via the existing tar-deploy path (`docs/HANDOFF.md` §31.6); local commits are fine for checkpointing, but `git push` to `origin` waits until the full staged rollout in §7 is signed off.

## 1. Data model

`src/store/migrations.ts` (migration 1) already created a `workflow_runs` table that has never been used by any route or store class — dead schema, evidently placed for exactly this feature and never wired up:

```sql
CREATE TABLE workflow_runs (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  detail      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX workflow_runs_workflow_idx ON workflow_runs (workflow_id, started_at DESC);
```

This is reused as-is — no migration needed for the runs table itself. `status` (top-level, queryable) holds the run's own lifecycle: `running` / `waiting_for_user` / `completed` / `failed` / `stopped`. `detail` (JSON, same pattern as `workflow_steps.config` and `dashboards.layout`) holds everything else:

```jsonc
{
  "trigger": "manual" | "scheduled",
  "mode": "chain" | "single_step",
  "steps": [
    {
      "id": "…",          // copied from workflow_steps.id at run start
      "kind": "prompt" | "cron" | "note",
      "ref": "…",
      "label": "…",
      "status": "pending" | "running" | "succeeded" | "failed" | "skipped",
      "output": "…",       // prompt response text, or a short cron result summary
      "error": "…",        // set only when status is "failed" — the exact upstream message
      "startedAt": 0,
      "finishedAt": 0
    }
  ]
}
```

Steps are copied into `detail` when the run starts, not referenced live — editing or deleting the workflow afterward never rewrites history.

**Pruning:** after inserting a new run row, delete anything beyond the 5 most recent per `workflow_id` (the existing `workflow_runs_workflow_idx` index already orders by `started_at DESC`, so this is a plain `id NOT IN (… LIMIT 5)` delete).

**New migration (version 4)** adds scheduling fields to `workflows` itself:

```sql
ALTER TABLE workflows ADD COLUMN schedule TEXT;
ALTER TABLE workflows ADD COLUMN next_run_at INTEGER;
```

`schedule` is `NULL` for a manual-only workflow. Format matches what Aufgaben already teaches users (`docs/HANDOFF.md` §16.4 point 4, Hermes' own `parse_schedule` rules): `"30m"`/`"2h"` (one-off), `"every 30m"` (recurring), a cron expression, or an ISO timestamp. `next_run_at` caches the next due time so a server restart doesn't need to recompute from scratch or double-fire.

## 2. Runner

New server module, `src/hermes/workflowRunner.ts`. One `WorkflowRunner` instance lives on `AppContext` (constructed alongside `gateway`/`dashboard` in `src/context.ts`), holding in-memory state for whatever runs are currently active plus an event emitter for §3. Persisted state in `workflow_runs.detail` is the source of truth; the in-memory map is a cache so multiple browser tabs can attach to the same live run without re-deriving it from JSON on every event.

Per step kind:

- **Prompt step** — identical mechanism to Chat (`src/routes/chat.ts`, `src/hermes/gateway.ts`), because it's the same shared `ctx.gateway` connection: `gateway.request('session.create', { cols: 80 })` → `{ session_id }`, then `gateway.request('prompt.submit', { session_id, text })`. The runner subscribes via `gateway.onEvent`, filters by that `session_id`, appends `message.delta` payload text into the step's `output`, and resolves the step on `message.complete` (or fails it on an error-shaped event, or after a generous timeout — a full agent turn can legitimately take minutes, unlike the gateway's own 30 s per-request RPC timeout).
- **Cron step** — `dashboard.cronAction(ref, 'trigger', ctx.connection.profile)` (already used by the Aufgaben "auslösen" button, `src/hermes/dashboard.ts:404`; `ctx.connection.profile` is the same single configured profile every other write route already scopes its cron calls to), capturing the job's `last_run_at` immediately before triggering. Then poll the cron list every ~3 s until `last_run_at` changes, up to a 5-minute cap. Success/failure and the exact message come from the job's own `last_status`/`last_error` once it changes — never invented.
- **Note step** — resolves immediately as `succeeded`; nothing to call.

**Between steps:** the runner always stops advancing after a failed step, before starting the next one. What happens next depends on `trigger` (§4 covers this in full):
- `manual` → run status becomes `waiting_for_user`; the runner waits, with no timeout, for an explicit continue/stop decision from the API (§5).
- `scheduled` → run status becomes `failed` immediately, remaining steps become `skipped`, and the runner fires the Telegram failure notice described in §4 — a second, separate prompt submitted through the same session mechanism as a prompt step, but not recorded as a workflow step itself.

**`single_step` mode** (manual only — a scheduled run is always `chain`, nobody is present to click "next"): the runner pauses after every step, success or failure, and waits for an explicit "advance" call (§5) before starting the next one.

**Resilience:** on server startup (before the scheduler's first tick, §4), any run row still `running` or `waiting_for_user` from before the restart is marked `failed` with `error: "Interrupted by a server restart"` — consistent with the project's "never fake data" rule; a run that can no longer be observed must not be shown as still in progress.

**Concurrency:** a workflow can only have one active run at a time. Both the manual start endpoint and the scheduler check for an existing `running`/`waiting_for_user` row for that `workflow_id` before starting a new one; the manual endpoint returns 409, the scheduler just skips that tick.

## 3. Live delivery to the browser

New route `GET /api/workflows/events`, one shared SSE stream for the whole app — same shape as the existing `/api/chat/events` (`src/routes/chat.ts:448`): headers, a keepalive comment on an interval, cleanup on `request.raw` close/error. It's fed by `WorkflowRunner`'s own emitter (not the gateway's — that one stays chat's), since a workflow run's lifecycle events (`run.started`, `step.started`, `step.delta`, `step.finished`, `run.waiting_for_user`, `run.finished`) don't exist on the gateway's wire format. The browser connects once when the Workflows page mounts and filters by `runId` client-side, mirroring how chat filters by session id today.

## 4. Scheduler

New module, `src/hermes/workflowScheduler.ts`: a `setInterval` (30 s) started next to the gateway/dashboard clients during `AppContext` bootstrap. Each tick selects workflows where `enabled = 1 AND schedule IS NOT NULL AND (next_run_at IS NULL OR next_run_at <= now)`, and for each due workflow (skipping any already running, §2):

1. Starts a `trigger: 'scheduled'`, `mode: 'chain'` run.
2. Recomputes `next_run_at` from `schedule` (a small pure `nextRunAt(schedule, now)` function, unit-tested against all four accepted formats) — or clears it for a one-off schedule that has now fired.

**On failure, unattended:** immediately after marking the run `failed` (§2), the runner submits one more prompt through the same session mechanism as a prompt step: *"Scheduled workflow '{name}' failed at step {n} ({label}): {exact error}. Please notify the user about this via Telegram."* The agent already has Telegram as a configured platform and its own send-message tool (`tools/send_message_tool.py` in the Hermes source) — no new Hermes-side capability is needed, and no direct "send arbitrary text to Telegram" API exists to call instead. This notice is not stored as a workflow step; it's runner-internal bookkeeping, logged at `debug` level only.

## 5. API surface

New route module `src/routes/workflowRuns.ts`:

- `POST /api/workflows/:id/runs` — body `{ mode: 'chain' | 'single_step' }`. Starts a manual run, returns `{ runId }`. 409 if the workflow is disabled, has no steps, or already has an active run.
- `POST /api/workflows/runs/:runId/advance` — runs the next pending step of a `single_step` run that's waiting.
- `POST /api/workflows/runs/:runId/resolve` — body `{ action: 'continue' | 'stop' }`. Answers a `waiting_for_user` pause after a failed step (manual runs only).
- `GET /api/workflows/:id/runs` — up to 5 most recent runs for the history panel.
- `GET /api/workflows/events` — the SSE stream (§3).

## 6. UI (`WorkflowsPage.tsx`)

- Each workflow card gets two buttons, **Run chain** and **Run step by step**, disabled while a run is active, the workflow is off, or it has no steps.
- Starting a run opens a live panel in the same place the editor opens today: per-step status icon (pending/running/succeeded/failed/skipped), growing text under a running prompt step, a spinner ("triggered, waiting for result…") under a running cron step.
- On a failed step (manual runs): a red box with the exact upstream message, plus **Continue** / **Stop** buttons calling `resolve`.
- In `single_step` mode, a successful step shows a **Run next step** button calling `advance` instead of continuing automatically.
- Editor gains an optional **Schedule** field (same help text style as Aufgaben's schedule field) between description and steps.
- A collapsible **Recent runs** section per card lists up to 5 entries (timestamp, manual/scheduled, status chip); clicking one reopens the same live-panel component in a frozen, read-only state.
- All new copy goes into `en.ts`/`de.ts`/`fa.ts` (existing i18n system), checked for parity like every prior change.

## 7. Testing & rollout

No GitHub push during development — see "Out of scope". Built and verified in stages directly against the production server (tar-deploy, `docs/HANDOFF.md` §31.6), each one gate-checked and clicked by the user before the next starts:

1. Data model + cron-step execution only ("Run chain" works end-to-end for cron/note-only workflows; no streaming, no scheduler yet).
2. Prompt-step execution + live SSE streaming.
3. `single_step` mode + the continue/stop dialog.
4. Recent-runs history UI.
5. Scheduler + the Telegram failure notice (last, as the least supervised and highest-blast-radius piece).

Each stage: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`, plus the i18n key-parity check, before every deploy — same gate as every other change in this repo. Local git commits checkpoint each stable stage; `git push` to `origin` and a version bump happen only once all five stages have been exercised live without open issues.

## Open questions carried into implementation planning

- Exact method/shape on `DashboardClient` for reading a single cron job's current `last_run_at`/`last_status` while polling (confirm against `src/hermes/dashboard.ts` and `src/hermes/inventory.ts` — likely the same call the Aufgaben list already uses).
- Whether the four schedule formats get a small hand-rolled parser or an existing npm dependency for the cron-expression case — a call for the implementation plan, not the design.
