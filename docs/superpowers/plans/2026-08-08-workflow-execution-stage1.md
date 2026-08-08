# Workflow Execution — Stage 1 (cron/note chain runs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a workflow made only of `cron`/`note` steps actually runnable end-to-end — a "Run chain" button on `WorkflowsPage.tsx` starts it, the server executes the steps in order against the already-running Hermes dashboard, and the browser can watch it finish (by polling; live SSE streaming is a later stage).

**Architecture:** A new `WorkflowRunsRepo` persists run state into the `workflow_runs` table that already exists in the schema (created in migration 1, never used until now — no new migration needed for this stage). A new `WorkflowRunner` executes steps sequentially: `note` resolves instantly, `cron` triggers the job via the dashboard's existing `cronAction` and polls the cron list until `last_run_at` changes. Both live on `AppContext` so the Stage-5 scheduler can reuse them later without rework. A new route module exposes start/list endpoints; the frontend adds a button and a polling status panel.

**Tech Stack:** TypeScript, Fastify, `node:sqlite` (existing `Store`), Zod, React 19 + `@tanstack/react-query` v5, Vitest.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-08-08-workflow-execution-design.md`. This plan covers only its Stage 1 (§7, item 1).
- Gate before every commit that touches `src/` or `web/src/`: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` (run `npx prettier --write <files>` first if `format:check` fails).
- i18n key parity check (must show identical key counts, no "fehlt in de/fa/en" lines) after any `en.ts`/`de.ts`/`fa.ts` edit:
  ```
  node -e "const f=p=>require('fs').readFileSync(p,'utf8');const k=s=>new Set([...s.matchAll(/^\s{2}'([^']+)':/gm)].map(m=>m[1]));const a=k(f('web/src/lib/i18n/en.ts')),b=k(f('web/src/lib/i18n/de.ts')),c=k(f('web/src/lib/i18n/fa.ts'));console.log(a.size,b.size,c.size);const d=(x,y,n)=>[...x].filter(z=>!y.has(z)).forEach(z=>console.log('fehlt in '+n+':',z));d(a,b,'de');d(a,c,'fa');d(b,a,'en');d(c,a,'en');"
  ```
- Commit messages: `type(scope): summary` (e.g. `feat(workflows): ...`), body explains why, **no `Co-Authored-By` trailer** (hard rule since 2026-08-04).
- **Do not `git push`.** Local commits only, per this project's current no-GitHub-push instruction — the push happens once all 5 stages of the spec are signed off.
- Never fake data: a step's `output`/`error` must come from what Hermes actually reported, never invented text.
- I do not click write actions against the live server myself — after each stage is deployed, the user clicks "Run chain" and reports what they see; I read logs/network traffic to diagnose.
- Code and comments in English; UI copy goes through `web/src/lib/i18n/{en,de,fa}.ts`.

---

### Task 1: `WorkflowRunsRepo` — persistence for run state

**Files:**
- Create: `src/store/workflowRuns.ts`
- Test: `src/store/workflowRuns.test.ts`

**Interfaces:**
- Consumes: `Store` (`src/store/db.ts`) — `.get`, `.all`, `.run`; `WorkflowStep`, `WorkflowStepKind` types from `src/store/workflows.ts`.
- Produces (used by Task 2 and Task 4):
  - `type WorkflowRunTrigger = 'manual' | 'scheduled'`
  - `type WorkflowRunMode = 'chain' | 'single_step'`
  - `type WorkflowRunStatus = 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'stopped'`
  - `type WorkflowRunStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'`
  - `interface WorkflowRunStep { id, kind, ref, label, status, output, error, startedAt, finishedAt }`
  - `interface WorkflowRun { id, workflowId, status, trigger, mode, steps, startedAt, finishedAt }`
  - `class WorkflowRunsRepo { get(id): WorkflowRun | null; listByWorkflow(workflowId, limit?): WorkflowRun[]; hasActiveRun(workflowId): boolean; create(workflowId, trigger, mode, steps, now?): WorkflowRun; updateStep(runId, stepId, patch): void; finish(runId, status, now?): void; prune(workflowId): void }`

- [ ] **Step 1: Write the failing tests**

Create `src/store/workflowRuns.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from './db.js';
import { WorkflowsRepo } from './workflows.js';
import { WorkflowRunsRepo } from './workflowRuns.js';

let store: Store;
let workflows: WorkflowsRepo;
let runs: WorkflowRunsRepo;

beforeEach(() => {
  store = Store.open(':memory:');
  workflows = new WorkflowsRepo(store);
  runs = new WorkflowRunsRepo(store);
});

afterEach(() => {
  store.close();
});

describe('WorkflowRunsRepo', () => {
  it('creates a run with pending steps snapshotted from the workflow', () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [
        { kind: 'cron', ref: 'job-1', label: 'Report' },
        { kind: 'note', label: 'Done' },
      ],
    });

    const run = runs.create(workflow.id, 'manual', 'chain', workflow.steps);

    expect(run.workflowId).toBe(workflow.id);
    expect(run.status).toBe('running');
    expect(run.trigger).toBe('manual');
    expect(run.mode).toBe('chain');
    expect(run.steps).toHaveLength(2);
    expect(run.steps[0]).toMatchObject({ kind: 'cron', ref: 'job-1', status: 'pending', output: '' });
    expect(run.finishedAt).toBeNull();
  });

  it('updates a single step by id without touching the others', () => {
    const workflow = workflows.create({ name: 'W', steps: [{ kind: 'note', label: 'A' }] });
    const run = runs.create(workflow.id, 'manual', 'chain', workflow.steps);
    const stepId = run.steps[0]!.id;

    runs.updateStep(run.id, stepId, { status: 'succeeded', output: 'ok', finishedAt: 123 });

    const reloaded = runs.get(run.id);
    expect(reloaded?.steps[0]).toMatchObject({ status: 'succeeded', output: 'ok', finishedAt: 123 });
  });

  it('finishes a run, setting status and finishedAt', () => {
    const workflow = workflows.create({ name: 'W', steps: [{ kind: 'note', label: 'A' }] });
    const run = runs.create(workflow.id, 'manual', 'chain', workflow.steps);

    runs.finish(run.id, 'completed', 999);

    expect(runs.get(run.id)).toMatchObject({ status: 'completed', finishedAt: 999 });
  });

  it('reports an active run only while running or waiting_for_user', () => {
    const workflow = workflows.create({ name: 'W', steps: [{ kind: 'note', label: 'A' }] });
    const run = runs.create(workflow.id, 'manual', 'chain', workflow.steps);

    expect(runs.hasActiveRun(workflow.id)).toBe(true);

    runs.finish(run.id, 'completed');
    expect(runs.hasActiveRun(workflow.id)).toBe(false);
  });

  it('keeps only the 5 most recent runs per workflow', () => {
    const workflow = workflows.create({ name: 'W', steps: [{ kind: 'note', label: 'A' }] });
    for (let i = 0; i < 7; i++) {
      const run = runs.create(workflow.id, 'manual', 'chain', workflow.steps, 1000 + i);
      runs.finish(run.id, 'completed', 1000 + i);
    }

    runs.prune(workflow.id);

    const remaining = runs.listByWorkflow(workflow.id, 50);
    expect(remaining).toHaveLength(5);
    expect(remaining.map((r) => r.startedAt)).toEqual([1006, 1005, 1004, 1003, 1002]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- workflowRuns.test.ts`
Expected: FAIL — `Cannot find module './workflowRuns.js'`

- [ ] **Step 3: Implement `WorkflowRunsRepo`**

Create `src/store/workflowRuns.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';
import type { WorkflowStep, WorkflowStepKind } from './workflows.js';

/**
 * Run history for workflows, stored in `workflow_runs` — a table the very
 * first schema migration already created but nothing ever populated. Reused
 * as-is: `status` stays a plain queryable column, everything else (which
 * trigger started it, which mode, and the per-step outcomes) lives as JSON in
 * `detail`, the same pattern `workflow_steps.config` already uses.
 */

export type WorkflowRunTrigger = 'manual' | 'scheduled';
export type WorkflowRunMode = 'chain' | 'single_step';
export type WorkflowRunStatus = 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'stopped';
export type WorkflowRunStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface WorkflowRunStep {
  id: string;
  kind: WorkflowStepKind;
  ref: string | null;
  label: string;
  status: WorkflowRunStepStatus;
  output: string;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  trigger: WorkflowRunTrigger;
  mode: WorkflowRunMode;
  steps: WorkflowRunStep[];
  startedAt: number;
  finishedAt: number | null;
}

interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  detail: string;
}

interface RunDetail {
  trigger: WorkflowRunTrigger;
  mode: WorkflowRunMode;
  steps: WorkflowRunStep[];
}

const MAX_RUNS_PER_WORKFLOW = 5;

function toRun(row: WorkflowRunRow): WorkflowRun {
  const detail = JSON.parse(row.detail) as RunDetail;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as WorkflowRunStatus,
    trigger: detail.trigger,
    mode: detail.mode,
    steps: detail.steps,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export class WorkflowRunsRepo {
  constructor(private readonly store: Store) {}

  get(id: string): WorkflowRun | null {
    const row = this.store.get<WorkflowRunRow>('SELECT * FROM workflow_runs WHERE id = ?', id);
    return row ? toRun(row) : null;
  }

  listByWorkflow(workflowId: string, limit = MAX_RUNS_PER_WORKFLOW): WorkflowRun[] {
    return this.store
      .all<WorkflowRunRow>(
        'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?',
        workflowId,
        limit,
      )
      .map(toRun);
  }

  /** True while this workflow has a run that hasn't reached a terminal state. */
  hasActiveRun(workflowId: string): boolean {
    const row = this.store.get<{ id: string }>(
      `SELECT id FROM workflow_runs
       WHERE workflow_id = ? AND status IN ('running', 'waiting_for_user') LIMIT 1`,
      workflowId,
    );
    return row !== undefined;
  }

  create(
    workflowId: string,
    trigger: WorkflowRunTrigger,
    mode: WorkflowRunMode,
    steps: readonly WorkflowStep[],
    now = Date.now(),
  ): WorkflowRun {
    const id = randomUUID();
    const detail: RunDetail = {
      trigger,
      mode,
      steps: steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        ref: step.ref,
        label: step.label,
        status: 'pending',
        output: '',
        error: null,
        startedAt: null,
        finishedAt: null,
      })),
    };
    this.store.run(
      'INSERT INTO workflow_runs (id, workflow_id, status, started_at, finished_at, detail) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      workflowId,
      'running',
      now,
      null,
      JSON.stringify(detail),
    );
    return this.get(id) as WorkflowRun;
  }

  /** Patches one step by id inside a run's JSON detail. No-ops on an unknown run or step. */
  updateStep(runId: string, stepId: string, patch: Partial<WorkflowRunStep>): void {
    const row = this.store.get<WorkflowRunRow>('SELECT * FROM workflow_runs WHERE id = ?', runId);
    if (!row) return;
    const detail = JSON.parse(row.detail) as RunDetail;
    const index = detail.steps.findIndex((step) => step.id === stepId);
    if (index === -1) return;
    detail.steps[index] = { ...detail.steps[index]!, ...patch };
    this.store.run('UPDATE workflow_runs SET detail = ? WHERE id = ?', JSON.stringify(detail), runId);
  }

  finish(runId: string, status: WorkflowRunStatus, now = Date.now()): void {
    this.store.run(
      'UPDATE workflow_runs SET status = ?, finished_at = ? WHERE id = ?',
      status,
      now,
      runId,
    );
  }

  /** Keeps only the most recent `MAX_RUNS_PER_WORKFLOW` runs for a workflow. */
  prune(workflowId: string): void {
    this.store.run(
      `DELETE FROM workflow_runs
       WHERE workflow_id = ?
         AND id NOT IN (
           SELECT id FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?
         )`,
      workflowId,
      workflowId,
      MAX_RUNS_PER_WORKFLOW,
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- workflowRuns.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/workflowRuns.ts src/store/workflowRuns.test.ts
git commit -m "feat(workflows): add run-history persistence

Reuses the workflow_runs table the initial schema migration already
created but nothing ever populated."
```

---

### Task 2: `WorkflowRunner` — cron/note step execution

**Files:**
- Create: `src/hermes/workflowRunner.ts`
- Test: `src/hermes/workflowRunner.test.ts`

**Interfaces:**
- Consumes:
  - `WorkflowsRepo` (`src/store/workflows.ts`) — `.get(id): Workflow | null`, where `Workflow.steps: WorkflowStep[]` (`{id, kind, ref, label}`).
  - `WorkflowRunsRepo`, `WorkflowRun`, `WorkflowRunStep` from Task 1.
  - `CronJobSummary` from `src/hermes/inventory.ts` (`{id, lastRun, lastStatus, lastError, profile, ...}`).
  - `log`, `describeError` from `src/log.ts`.
- Produces (used by Task 3 and Task 4):
  - `interface CronExecutor { cronJobs(): Promise<CronJobSummary[]>; cronAction(id: string, action: 'trigger', profile: string): Promise<unknown> }` — the structural slice of `DashboardClient` the runner needs, so tests never construct a real one.
  - `class WorkflowRunnerValidationError extends Error {}`
  - `class WorkflowRunner { constructor(options: { dashboard: CronExecutor; workflows: WorkflowsRepo; runs: WorkflowRunsRepo; pollIntervalMs?: number; pollTimeoutMs?: number }); start(workflowId: string): { runId: string } }` — `start` validates synchronously (throwing `WorkflowRunnerValidationError`) and returns immediately; execution continues in the background.

**Design notes carried over from the spec's "open questions":**
- The spec's §2 sketched `cronAction(ref, 'trigger', profile)` with one ambient profile. Checking `src/routes/actions.ts`'s existing cron-trigger route shows every real call site sources `profile` per request, never from a single app-wide default — cron jobs "span all profiles by default" (`CronJobSummary` doc comment). This runner therefore reads the **job's own** `profile` (from the `cronJobs()` entry matching `step.ref`) instead of taking a profile at construction time — the correct, not just simpler, choice, since guessing wrong silently targets another profile's cron store.
- `GET /api/cron/jobs/{id}/runs` is documented in `dashboard.ts` as unreliable (always empty on the real server) — confirms polling the full `cronJobs()` list and comparing `lastRun` is the only working way to detect completion.

- [ ] **Step 1: Write the failing tests**

Create `src/hermes/workflowRunner.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../store/db.js';
import { WorkflowsRepo } from '../store/workflows.js';
import { WorkflowRunsRepo } from '../store/workflowRuns.js';
import type { CronJobSummary } from './inventory.js';
import { WorkflowRunner, WorkflowRunnerValidationError, type CronExecutor } from './workflowRunner.js';

function cronJob(overrides: Partial<CronJobSummary> = {}): CronJobSummary {
  return {
    id: 'job-1',
    name: 'Report',
    schedule: 'every 1h',
    paused: false,
    nextRun: null,
    lastRun: 1000,
    lastStatus: 'ok',
    lastError: null,
    profile: 'sunrise',
    prompt: null,
    deliver: 'local',
    ...overrides,
  };
}

async function flushPolls(times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
}

let store: Store;
let workflows: WorkflowsRepo;
let runs: WorkflowRunsRepo;

beforeEach(() => {
  store = Store.open(':memory:');
  workflows = new WorkflowsRepo(store);
  runs = new WorkflowRunsRepo(store);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  store.close();
});

describe('WorkflowRunner', () => {
  it('rejects a workflow with a prompt step', () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [{ kind: 'prompt', ref: 'p-1', label: 'Summarize' }],
    });
    const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
    const runner = new WorkflowRunner({ dashboard, workflows, runs });

    expect(() => runner.start(workflow.id)).toThrow(WorkflowRunnerValidationError);
  });

  it('rejects starting a second run while one is active', async () => {
    const workflow = workflows.create({ name: 'W', steps: [{ kind: 'note', label: 'A' }] });
    const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
    const runner = new WorkflowRunner({ dashboard, workflows, runs });

    runner.start(workflow.id);

    expect(() => runner.start(workflow.id)).toThrow(WorkflowRunnerValidationError);

    // Let the first run's background note-step execution settle before the
    // store closes in afterEach — it only needs microtasks, no real timers.
    await vi.advanceTimersByTimeAsync(0);
  });

  it('runs a note step immediately and a cron step by triggering and polling', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [
        { kind: 'note', label: 'Start' },
        { kind: 'cron', ref: 'job-1', label: 'Report' },
      ],
    });

    const before = cronJob({ lastRun: 1000 });
    const after = cronJob({ lastRun: 2000, lastStatus: 'ok' });
    const cronJobsMock = vi
      .fn()
      .mockResolvedValueOnce([before]) // read before triggering
      .mockResolvedValueOnce([before]) // first poll: unchanged
      .mockResolvedValueOnce([after]); // second poll: finished
    const cronAction = vi.fn().mockResolvedValue({ ok: true });
    const dashboard: CronExecutor = { cronJobs: cronJobsMock, cronAction };
    const runner = new WorkflowRunner({
      dashboard,
      workflows,
      runs,
      pollIntervalMs: 10,
      pollTimeoutMs: 1000,
    });

    const { runId } = runner.start(workflow.id);
    await flushPolls(5);

    const run = runs.get(runId);
    expect(run?.status).toBe('completed');
    expect(run?.steps[0]).toMatchObject({ kind: 'note', status: 'succeeded' });
    expect(run?.steps[1]).toMatchObject({ kind: 'cron', status: 'succeeded' });
    expect(cronAction).toHaveBeenCalledWith('job-1', 'trigger', 'sunrise');
  });

  it('fails the run and skips nothing further when the cron job errors', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [{ kind: 'cron', ref: 'job-1', label: 'Report' }],
    });

    const before = cronJob({ lastRun: 1000 });
    const after = cronJob({ lastRun: 2000, lastStatus: 'error', lastError: 'ImportError: boom' });
    const dashboard: CronExecutor = {
      cronJobs: vi.fn().mockResolvedValueOnce([before]).mockResolvedValueOnce([after]),
      cronAction: vi.fn().mockResolvedValue({ ok: true }),
    };
    const runner = new WorkflowRunner({
      dashboard,
      workflows,
      runs,
      pollIntervalMs: 10,
      pollTimeoutMs: 1000,
    });

    const { runId } = runner.start(workflow.id);
    await flushPolls(5);

    const run = runs.get(runId);
    expect(run?.status).toBe('failed');
    expect(run?.steps[0]).toMatchObject({ status: 'failed', error: 'ImportError: boom' });
  });

  it('fails the step when no result arrives before the poll timeout', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [{ kind: 'cron', ref: 'job-1', label: 'Report' }],
    });

    const before = cronJob({ lastRun: 1000 });
    const dashboard: CronExecutor = {
      cronJobs: vi.fn().mockResolvedValue([before]), // lastRun never changes
      cronAction: vi.fn().mockResolvedValue({ ok: true }),
    };
    const runner = new WorkflowRunner({
      dashboard,
      workflows,
      runs,
      pollIntervalMs: 10,
      pollTimeoutMs: 25,
    });

    const { runId } = runner.start(workflow.id);
    await flushPolls(10);

    const run = runs.get(runId);
    expect(run?.status).toBe('failed');
    expect(run?.steps[0]?.error).toMatch(/no result/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- workflowRunner.test.ts`
Expected: FAIL — `Cannot find module './workflowRunner.js'`

- [ ] **Step 3: Implement `WorkflowRunner`**

Create `src/hermes/workflowRunner.ts`:

```ts
import { describeError, log } from '../log.js';
import type { WorkflowsRepo } from '../store/workflows.js';
import type { WorkflowRunsRepo, WorkflowRunStep } from '../store/workflowRuns.js';
import type { CronJobSummary } from './inventory.js';

/**
 * The slice of `DashboardClient` the runner needs, kept structural so tests
 * pass a plain object instead of constructing a real HTTP-backed client.
 */
export interface CronExecutor {
  cronJobs(): Promise<CronJobSummary[]>;
  cronAction(id: string, action: 'trigger', profile: string): Promise<unknown>;
}

export class WorkflowRunnerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowRunnerValidationError';
  }
}

export interface WorkflowRunnerOptions {
  dashboard: CronExecutor;
  workflows: WorkflowsRepo;
  runs: WorkflowRunsRepo;
  /** Overridable for tests; production defaults poll every 3s for up to 5 minutes. */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

interface StepResult {
  status: 'succeeded' | 'failed';
  output: string;
  error: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a workflow's steps in order, persisting progress into
 * `workflow_runs` as it goes. This stage only knows `cron` and `note` steps —
 * `prompt` steps are rejected up front until the chat-streaming stage lands.
 * A run always stops at the first failed step: the manual continue/stop
 * dialog and the unattended/scheduled path are later stages, not this one.
 */
export class WorkflowRunner {
  private readonly active = new Set<string>();

  constructor(private readonly options: WorkflowRunnerOptions) {}

  /** Validates synchronously, then runs the chain in the background. */
  start(workflowId: string): { runId: string } {
    const { workflows, runs } = this.options;
    const workflow = workflows.get(workflowId);
    if (!workflow) throw new WorkflowRunnerValidationError('Workflow not found.');
    if (!workflow.enabled) throw new WorkflowRunnerValidationError('Workflow is disabled.');
    if (workflow.steps.length === 0) {
      throw new WorkflowRunnerValidationError('Workflow has no steps.');
    }
    if (workflow.steps.some((step) => step.kind === 'prompt')) {
      throw new WorkflowRunnerValidationError(
        'Prompt steps aren’t runnable yet — support is coming in a future update.',
      );
    }
    if (this.active.has(workflowId) || runs.hasActiveRun(workflowId)) {
      throw new WorkflowRunnerValidationError('This workflow already has a run in progress.');
    }

    const run = runs.create(workflowId, 'manual', 'chain', workflow.steps);
    this.active.add(workflowId);
    void this.execute(workflowId, run.id).finally(() => this.active.delete(workflowId));
    return { runId: run.id };
  }

  private async execute(workflowId: string, runId: string): Promise<void> {
    const { runs } = this.options;
    const run = runs.get(runId);
    if (!run) return;

    for (const step of run.steps) {
      runs.updateStep(runId, step.id, { status: 'running', startedAt: Date.now() });
      const result = await this.runStep(step);
      runs.updateStep(runId, step.id, {
        status: result.status,
        output: result.output,
        error: result.error,
        finishedAt: Date.now(),
      });
      if (result.status === 'failed') {
        runs.finish(runId, 'failed');
        runs.prune(workflowId);
        return;
      }
    }
    runs.finish(runId, 'completed');
    runs.prune(workflowId);
  }

  private async runStep(step: WorkflowRunStep): Promise<StepResult> {
    if (step.kind === 'note') return { status: 'succeeded', output: '', error: null };
    return this.runCronStep(step);
  }

  private async runCronStep(step: WorkflowRunStep): Promise<StepResult> {
    const { dashboard } = this.options;
    const pollIntervalMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const pollTimeoutMs = this.options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;

    if (!step.ref) {
      return { status: 'failed', output: '', error: 'No cron job is selected for this step.' };
    }

    let before: CronJobSummary | undefined;
    try {
      before = (await dashboard.cronJobs()).find((job) => job.id === step.ref);
    } catch (error) {
      return { status: 'failed', output: '', error: describeError(error) };
    }
    if (!before) {
      return { status: 'failed', output: '', error: 'This cron job no longer exists in Hermes.' };
    }
    if (!before.profile) {
      return {
        status: 'failed',
        output: '',
        error: 'This cron job has no profile on record — refusing to guess which one to trigger.',
      };
    }

    try {
      await dashboard.cronAction(step.ref, 'trigger', before.profile);
    } catch (error) {
      return { status: 'failed', output: '', error: describeError(error) };
    }

    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      let jobs: CronJobSummary[];
      try {
        jobs = await dashboard.cronJobs();
      } catch (error) {
        log.debug(`workflow runner: poll failed, retrying: ${describeError(error)}`);
        continue;
      }
      const job = jobs.find((j) => j.id === step.ref);
      if (!job) {
        return { status: 'failed', output: '', error: 'This cron job no longer exists in Hermes.' };
      }
      if (job.lastRun !== before.lastRun) {
        if (job.lastStatus === 'error') {
          return {
            status: 'failed',
            output: '',
            error: job.lastError ?? 'Hermes reported an error without a message.',
          };
        }
        return {
          status: 'succeeded',
          output: `Finished (status: ${job.lastStatus ?? 'ok'}).`,
          error: null,
        };
      }
    }
    return {
      status: 'failed',
      output: '',
      error: 'No result from Hermes after 5 minutes — check the Aufgaben page directly.',
    };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- workflowRunner.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hermes/workflowRunner.ts src/hermes/workflowRunner.test.ts
git commit -m "feat(workflows): add WorkflowRunner for cron/note step chains

Triggers cron steps through the existing dashboard cronAction and
polls the cron list for completion (the per-job /runs endpoint is
documented elsewhere as unreliable). Prompt steps are rejected for
now — that lands with the chat-streaming stage."
```

---

### Task 3: Wire `WorkflowRunner` into `AppContext`

**Files:**
- Modify: `src/context.ts`

**Interfaces:**
- Consumes: `WorkflowsRepo` (`src/store/workflows.ts`), `WorkflowRunsRepo` (Task 1), `WorkflowRunner` (Task 2), existing `dashboard` and `store` already built in `buildContext`.
- Produces: `ctx.workflowRuns: WorkflowRunsRepo` and `ctx.workflowRunner: WorkflowRunner`, consumed by Task 4's routes.

- [ ] **Step 1: Add the imports**

In `src/context.ts`, add alongside the existing store/hermes imports (after the `Store` import on line 11):

```ts
import { WorkflowsRepo } from './store/workflows.js';
import { WorkflowRunsRepo } from './store/workflowRuns.js';
import { WorkflowRunner } from './hermes/workflowRunner.js';
```

- [ ] **Step 2: Extend the `AppContext` interface**

In `src/context.ts`, add two fields to the `AppContext` interface (after `store: Store;` on line 32):

```ts
  workflowRuns: WorkflowRunsRepo;
  workflowRunner: WorkflowRunner;
```

- [ ] **Step 3: Construct the repo and runner**

In `src/context.ts`, right after `const store = Store.open(controlCenterDatabasePath(env));` (line 114), add:

```ts
  const workflows = new WorkflowsRepo(store);
  const workflowRuns = new WorkflowRunsRepo(store);
  const workflowRunner = new WorkflowRunner({ dashboard, workflows, runs: workflowRuns });
```

- [ ] **Step 4: Return the new fields**

In the object returned from `buildContext` (the `return { options: resolved, connection, auth, api, dashboard, gateway, store, settings, metrics, bus, ... }` block, currently ending its first group at line 147), add after `bus,`:

```ts
    workflowRuns,
    workflowRunner,
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors. (No new automated test for this task — it's pure wiring; Task 4's route addition is what exercises it.)

- [ ] **Step 6: Commit**

```bash
git add src/context.ts
git commit -m "feat(workflows): expose WorkflowRunner on AppContext

Lives on the shared context (not built ad hoc per route) so the
Stage-5 scheduler can start runs directly without an HTTP round trip."
```

---

### Task 4: Run routes — `POST/GET /api/workflows/:id/runs`

**Files:**
- Create: `src/routes/workflowRuns.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `ctx.workflowRunner.start(workflowId)` and `ctx.workflowRuns.listByWorkflow(workflowId)` (Task 3), `WorkflowRunnerValidationError` (Task 2).
- Produces: `POST /api/workflows/:id/runs` → `201 { runId: string }` or `409 { error: 'cannot_start_run', message }`; `GET /api/workflows/:id/runs` → `200 { runs: WorkflowRun[] }`. Consumed by Task 5's frontend API client.

- [ ] **Step 1: Create the route module**

Create `src/routes/workflowRuns.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { WorkflowRunnerValidationError } from '../hermes/workflowRunner.js';

/**
 * Stage 1 only supports running the whole chain unattended-to-completion;
 * step-by-step mode and the pause/resolve dance arrive in a later stage.
 */
const startRunSchema = z.object({
  mode: z.literal('chain'),
});

export async function registerWorkflowRunRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.post('/api/workflows/:id/runs', async (request, reply) => {
    const parsed = startRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Step-by-step mode isn’t available yet — pass { "mode": "chain" }.',
      });
    }
    const { id } = request.params as { id: string };
    try {
      const { runId } = ctx.workflowRunner.start(id);
      return reply.code(201).send({ runId });
    } catch (error) {
      if (error instanceof WorkflowRunnerValidationError) {
        return reply.code(409).send({ error: 'cannot_start_run', message: error.message });
      }
      throw error;
    }
  });

  app.get('/api/workflows/:id/runs', async (request) => {
    const { id } = request.params as { id: string };
    return { runs: ctx.workflowRuns.listByWorkflow(id) };
  });
}
```

- [ ] **Step 2: Register the route module**

In `src/server.ts`, add the import after `import { registerWorkspaceRoutes } from './routes/workspace.js';` (line 11):

```ts
import { registerWorkflowRunRoutes } from './routes/workflowRuns.js';
```

Then add the registration after `await registerWorkspaceRoutes(app, ctx);` (line 89):

```ts
  await registerWorkflowRunRoutes(app, ctx);
```

- [ ] **Step 3: Verify it compiles and boots**

Run: `npm run typecheck && npm run build`
Expected: no errors.

There is no existing precedent in this codebase for route-level tests (every other route module is verified live against the real dashboard, not with a mocked Fastify instance) — this task is verified in Task 6's manual server check instead, once the frontend can drive it.

- [ ] **Step 4: Commit**

```bash
git add src/routes/workflowRuns.ts src/server.ts
git commit -m "feat(workflows): add run start/history routes

POST starts a chain run in the background and returns its id
immediately; GET lists up to 5 recent runs for a workflow."
```

---

### Task 5: Frontend types and API client

**Files:**
- Modify: `web/src/lib/hermesTypes.ts`
- Modify: `web/src/lib/api.ts`

**Interfaces:**
- Consumes: `WorkflowStepKind` (already exported from `hermesTypes.ts`); the JSON shape Task 4's routes return.
- Produces: `WorkflowRun`, `WorkflowRunStep`, `WorkflowRunStatus`, `WorkflowRunStepStatus` types; `startWorkflowRun(id, mode)`, `getWorkflowRuns(id)`, `queryKeys.workflowRuns(id)` — consumed by Task 6.

- [ ] **Step 1: Add the run types**

In `web/src/lib/hermesTypes.ts`, add directly after the existing `WorkflowInput` interface (after line 267):

```ts
export type WorkflowRunTrigger = 'manual' | 'scheduled';
export type WorkflowRunMode = 'chain' | 'single_step';
export type WorkflowRunStatus = 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'stopped';
export type WorkflowRunStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface WorkflowRunStep {
  id: string;
  kind: WorkflowStepKind;
  ref: string | null;
  label: string;
  status: WorkflowRunStepStatus;
  output: string;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  trigger: WorkflowRunTrigger;
  mode: WorkflowRunMode;
  steps: WorkflowRunStep[];
  startedAt: number;
  finishedAt: number | null;
}
```

- [ ] **Step 2: Add the API functions**

In `web/src/lib/api.ts`, add `WorkflowRun` to the type-only import block from `./hermesTypes` (the block starting at line 3 — add it alphabetically next to `Workflow`/`WorkflowInput` on line 31-32):

```ts
  Workflow,
  WorkflowInput,
  WorkflowRun,
```

Then add, directly after the existing `deleteWorkflow` function (after line 527):

```ts
export const startWorkflowRun = (id: string, mode: 'chain'): Promise<{ runId: string }> =>
  apiRequest<{ runId: string }>(`/workflows/${encodeURIComponent(id)}/runs`, {
    method: 'POST',
    ...jsonBody({ mode }),
  });

export const getWorkflowRuns = (id: string): Promise<{ runs: WorkflowRun[] }> =>
  apiRequest<{ runs: WorkflowRun[] }>(`/workflows/${encodeURIComponent(id)}/runs`);
```

- [ ] **Step 3: Add the query key**

In `web/src/lib/api.ts`, in the `queryKeys` object, add directly after `workflows: ['workflows'] as const,` (line 833):

```ts
  workflowRuns: (id: string) => ['workflows', id, 'runs'] as const,
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hermesTypes.ts web/src/lib/api.ts
git commit -m "feat(workflows): add frontend types and API client for runs"
```

---

### Task 6: "Run chain" button and status panel

**Files:**
- Modify: `web/src/pages/WorkflowsPage.tsx`

**Interfaces:**
- Consumes: `startWorkflowRun`, `getWorkflowRuns`, `queryKeys.workflowRuns` (Task 5); `WorkflowRun` type (Task 5).

- [ ] **Step 1: Import what's needed**

In `web/src/pages/WorkflowsPage.tsx`, add `Play` to the existing `lucide-react` import (the block starting at line 3):

```ts
  Play,
```

Add to the `@/lib/api` import block (after `setWorkflowEnabled,` on line 22):

```ts
  getWorkflowRuns,
  startWorkflowRun,
```

- [ ] **Step 2: Add run state and queries to `WorkflowsPage`**

In `web/src/pages/WorkflowsPage.tsx`, inside `export function WorkflowsPage()`, add after the existing `confirmDelete` state (after line 274):

```ts
  const [activeRunWorkflowId, setActiveRunWorkflowId] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: queryKeys.workflowRuns(activeRunWorkflowId ?? ''),
    queryFn: () => getWorkflowRuns(activeRunWorkflowId as string),
    enabled: activeRunWorkflowId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.runs[0]?.status;
      return status === 'running' || status === 'waiting_for_user' ? 1500 : false;
    },
  });

  const startRun = useMutation({
    mutationFn: (workflowId: string) => startWorkflowRun(workflowId, 'chain'),
    onSuccess: (_data, workflowId) => setActiveRunWorkflowId(workflowId),
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('workflowRuns.startFailed'), description: e.message }),
  });

  const currentRun = activeRunWorkflowId ? runsQuery.data?.runs[0] : undefined;
```

- [ ] **Step 3: Add the button**

In `web/src/pages/WorkflowsPage.tsx`, inside the workflow list `<li>` (the `<div className="flex shrink-0 gap-1">` block around lines 399-416), add a new button before the existing "Pencil" edit button:

```tsx
                  <button
                    type="button"
                    onClick={() => startRun.mutate(workflow.id)}
                    disabled={
                      !workflow.enabled ||
                      workflow.steps.length === 0 ||
                      workflow.steps.some((s) => s.kind === 'prompt') ||
                      (startRun.isPending && startRun.variables === workflow.id) ||
                      (activeRunWorkflowId === workflow.id && currentRun?.status === 'running')
                    }
                    title={
                      workflow.steps.some((s) => s.kind === 'prompt')
                        ? t('workflowRuns.promptNotSupported')
                        : undefined
                    }
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-accent)] disabled:opacity-30"
                    aria-label={t('workflowRuns.runChainAria', { name: workflow.name })}
                  >
                    <Play size={14} aria-hidden />
                  </button>
```

- [ ] **Step 4: Add the run status panel**

In `web/src/pages/WorkflowsPage.tsx`, directly after the existing step list (`{workflow.steps.length > 0 && ( ... )}` block, after line 435), add:

```tsx
              {activeRunWorkflowId === workflow.id && currentRun && (
                <div className="mt-3 rounded-xl border border-[var(--color-hairline)] p-3">
                  <p className="text-xs font-medium">
                    {t('workflowRuns.statusLabel', { status: t(`workflowRuns.status.${currentRun.status}`) })}
                  </p>
                  <ol className="mt-2 space-y-1">
                    {currentRun.steps.map((step) => (
                      <li key={step.id} className="text-xs">
                        <span className="text-[var(--color-ink-muted)]">
                          {t(`workflowRuns.stepStatus.${step.status}`)}
                        </span>{' '}
                        {step.label}
                        {step.status === 'failed' && step.error && (
                          <p className="mt-0.5 text-[var(--color-danger)]">{step.error}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors. (UI behavior itself is verified live in Task 8 — this repo has no component-test setup for pages; every existing page is confirmed by clicking it against the real server.)

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/WorkflowsPage.tsx
git commit -m "feat(workflows): add Run chain button with a polling status panel"
```

---

### Task 7: i18n keys (en/de/fa)

**Files:**
- Modify: `web/src/lib/i18n/en.ts`
- Modify: `web/src/lib/i18n/de.ts`
- Modify: `web/src/lib/i18n/fa.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: every `t('workflowRuns.*')` key Task 6 references.

- [ ] **Step 1: Add the English keys**

In `web/src/lib/i18n/en.ts`, add directly after the existing `'workflows.deleteAria': 'delete {name}',` line (line 629):

```ts
  'workflowRuns.runChainAria': 'run {name}',
  'workflowRuns.startFailed': 'Could not start the run',
  'workflowRuns.promptNotSupported': 'Prompt steps aren’t runnable yet',
  'workflowRuns.statusLabel': 'Status: {status}',
  'workflowRuns.status.running': 'Running',
  'workflowRuns.status.waiting_for_user': 'Waiting for you',
  'workflowRuns.status.completed': 'Completed',
  'workflowRuns.status.failed': 'Failed',
  'workflowRuns.status.stopped': 'Stopped',
  'workflowRuns.stepStatus.pending': 'Pending',
  'workflowRuns.stepStatus.running': 'Running…',
  'workflowRuns.stepStatus.succeeded': 'Done',
  'workflowRuns.stepStatus.failed': 'Failed',
  'workflowRuns.stepStatus.skipped': 'Skipped',
```

- [ ] **Step 2: Add the German keys**

In `web/src/lib/i18n/de.ts`, add the same keys at the equivalent location (after the `'workflows.deleteAria'` line):

```ts
  'workflowRuns.runChainAria': '{name} ausführen',
  'workflowRuns.startFailed': 'Lauf konnte nicht gestartet werden',
  'workflowRuns.promptNotSupported': 'Prompt-Schritte sind noch nicht ausführbar',
  'workflowRuns.statusLabel': 'Status: {status}',
  'workflowRuns.status.running': 'Läuft',
  'workflowRuns.status.waiting_for_user': 'Wartet auf dich',
  'workflowRuns.status.completed': 'Abgeschlossen',
  'workflowRuns.status.failed': 'Fehlgeschlagen',
  'workflowRuns.status.stopped': 'Gestoppt',
  'workflowRuns.stepStatus.pending': 'Wartend',
  'workflowRuns.stepStatus.running': 'Läuft…',
  'workflowRuns.stepStatus.succeeded': 'Fertig',
  'workflowRuns.stepStatus.failed': 'Fehlgeschlagen',
  'workflowRuns.stepStatus.skipped': 'Übersprungen',
```

- [ ] **Step 3: Add the Farsi keys**

In `web/src/lib/i18n/fa.ts`, add the same keys at the equivalent location (after the `'workflows.deleteAria'` line):

```ts
  'workflowRuns.runChainAria': 'اجرای {name}',
  'workflowRuns.startFailed': 'اجرا آغاز نشد',
  'workflowRuns.promptNotSupported': 'مرحله‌های پرامپت هنوز قابل اجرا نیستند',
  'workflowRuns.statusLabel': 'وضعیت: {status}',
  'workflowRuns.status.running': 'در حال اجرا',
  'workflowRuns.status.waiting_for_user': 'در انتظار شما',
  'workflowRuns.status.completed': 'تکمیل‌شده',
  'workflowRuns.status.failed': 'ناموفق',
  'workflowRuns.status.stopped': 'متوقف‌شده',
  'workflowRuns.stepStatus.pending': 'در انتظار',
  'workflowRuns.stepStatus.running': 'در حال اجرا…',
  'workflowRuns.stepStatus.succeeded': 'انجام‌شد',
  'workflowRuns.stepStatus.failed': 'ناموفق',
  'workflowRuns.stepStatus.skipped': 'نادیده گرفته‌شد',
```

Note: the button itself (Task 6, Step 3) uses `t('workflowRuns.runChainAria', ...)` only — there is no separate visible button label in this design (icon-only, matching the existing edit/delete icon buttons on the same row), so no `workflowRuns.runChain` text key is needed.

- [ ] **Step 4: Run the i18n parity check**

Run:
```
node -e "const f=p=>require('fs').readFileSync(p,'utf8');const k=s=>new Set([...s.matchAll(/^\s{2}'([^']+)':/gm)].map(m=>m[1]));const a=k(f('web/src/lib/i18n/en.ts')),b=k(f('web/src/lib/i18n/de.ts')),c=k(f('web/src/lib/i18n/fa.ts'));console.log(a.size,b.size,c.size);const d=(x,y,n)=>[...x].filter(z=>!y.has(z)).forEach(z=>console.log('fehlt in '+n+':',z));d(a,b,'de');d(a,c,'fa');d(b,a,'en');d(c,a,'en');"
```
Expected: three equal numbers printed, no "fehlt in" lines.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/i18n/en.ts web/src/lib/i18n/de.ts web/src/lib/i18n/fa.ts
git commit -m "feat(workflows): add i18n copy for run status (en/de/fa)"
```

---

### Task 8: Full gate, deploy, and live verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```
Expected: all green. If `format:check` fails, run `npx prettier --write <listed files>`, then re-run the full gate.

- [ ] **Step 2: Deploy to the production server**

Follow the tar-deploy steps in `docs/HANDOFF.md` §31.6 (build, transfer, restart the `hermes-control-center` service, verify by asset checksum/hash) — same mechanism used for every prior change, no Hermes-side files touched.

- [ ] **Step 3: Hand off for live testing**

Ask the user to, on a workflow made only of cron/note steps: click the new run (▶) icon, watch the status panel update, and confirm a job that Hermes reports as erroring shows up as `failed` with the real message (not a generic one). I read `agent.log`/network traffic on the server to diagnose anything unexpected — no write action against the live server is clicked by me, per this project's working agreement.

- [ ] **Step 4: Record the outcome**

Once confirmed working, this stage is done; Stage 2 (prompt-step execution + live SSE streaming) gets its own plan per the spec's §7 rollout order. Do not commit or push anything beyond what Tasks 1–7 already committed — this step is verification only.
