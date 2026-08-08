# Workflow Execution — Stage 2 (prompt steps + live SSE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prompt steps become runnable (a workflow's prompt step sends the referenced library prompt's body through a fresh Hermes chat session, the same mechanism the Chat page already uses), and the whole run — both prompt and cron steps — pushes live progress to the browser over SSE instead of 1.5s polling.

**Architecture:** `WorkflowRunner` gains a `PromptExecutor` dependency (a structural subset of `GatewayClient` — `request`/`onEvent`) and a `PromptLookup` dependency (a structural subset of `PromptsRepo` — `get`). A prompt step opens a session (`session.create`), submits the prompt body (`prompt.submit`), and listens on the shared gateway event bus for `message.delta` (accumulate text) and `message.complete` (`payload.status`: `'complete'` → succeeded, `'error'`/`'interrupted'` → failed, verified against the Hermes gateway source at `tui_gateway/server.py:9913,9943-9949`). The runner also gains its own lifecycle event emitter (`run.started`/`step.started`/`step.delta`/`step.finished`/`run.finished`), fed to a new SSE route mirroring the existing `/api/chat/events`. The frontend drops its polling `useQuery` for the run status and instead opens one `EventSource`, rendering the run purely from the workflow's already-known step list plus incoming events — no new fetch needed to seed it.

**Tech Stack:** TypeScript, Fastify, the existing `GatewayClient` (`src/hermes/gateway.ts`), Vitest, React 19.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-08-08-workflow-execution-design.md`. Full Stage 1 plan/history: `docs/superpowers/plans/2026-08-08-workflow-execution-stage1.md`. This plan is Stage 2 of the spec's §7 rollout.
- Gate before every commit that touches `src/` or `web/src/`: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` (run `npx prettier --write <files>` first on a format failure).
- i18n key parity check after any `en.ts`/`de.ts`/`fa.ts` edit:
  ```
  node -e "const f=p=>require('fs').readFileSync(p,'utf8');const k=s=>new Set([...s.matchAll(/^\s{2}'([^']+)':/gm)].map(m=>m[1]));const a=k(f('web/src/lib/i18n/en.ts')),b=k(f('web/src/lib/i18n/de.ts')),c=k(f('web/src/lib/i18n/fa.ts'));console.log(a.size,b.size,c.size);const d=(x,y,n)=>[...x].filter(z=>!y.has(z)).forEach(z=>console.log('fehlt in '+n+':',z));d(a,b,'de');d(a,c,'fa');d(b,a,'en');d(c,a,'en');"
  ```
- Commit messages: `type(scope): summary`, body explains why, **no `Co-Authored-By` trailer**.
- **Do not `git push`.** Local commits only until the full 5-stage rollout is signed off.
- Never fake data: a prompt step's output/error must come from what the gateway actually reported.
- **New, explicit scope decision for this stage:** a prompt with unresolved `{{variable}}` placeholders (`Prompt.variables.length > 0`) cannot be run automatically — there's no interactive user to fill them in. The step fails immediately with a clear message rather than sending the literal `{{placeholder}}` text to the agent. This was not asked of the user because it's a correctness default (silently sending broken text would violate "never fake data"), not a preference trade-off — flag it to the user when this stage ships in case they'd rather see it handled differently later.
- Code and comments in English; UI copy through `web/src/lib/i18n/{en,de,fa}.ts`.

---

### Task 1: `WorkflowRunner` lifecycle event emitter

**Files:**
- Modify: `src/hermes/workflowRunner.ts`
- Modify: `src/hermes/workflowRunner.test.ts`

**Interfaces:**
- Produces (used by Task 4's route): `export type WorkflowRunnerEvent = { type: 'run.started'; runId: string; workflowId: string } | { type: 'step.started'; runId: string; stepId: string } | { type: 'step.delta'; runId: string; stepId: string; text: string } | { type: 'step.finished'; runId: string; stepId: string; status: WorkflowRunStepStatus; output: string; error: string | null } | { type: 'run.finished'; runId: string; status: WorkflowRunStatus };` and `WorkflowRunner.onEvent(listener: (event: WorkflowRunnerEvent) => void): () => void`.

- [ ] **Step 1: Write the failing test**

Add to `src/hermes/workflowRunner.test.ts` (new `describe` block or alongside the existing one — it needs the same `cronJob()`/`CronExecutor` fixtures already in the file):

```ts
describe('WorkflowRunner events', () => {
  it('publishes run/step lifecycle events in order for a successful chain', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [{ kind: 'note', label: 'A' }],
    });
    const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
    const runner = new WorkflowRunner({ dashboard, workflows, runs });

    const events: WorkflowRunnerEvent[] = [];
    const unsubscribe = runner.onEvent((event) => events.push(event));

    const { runId } = runner.start(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();

    const stepId = workflow.steps[0]!.id;
    expect(events).toEqual([
      { type: 'run.started', runId, workflowId: workflow.id },
      { type: 'step.started', runId, stepId },
      { type: 'step.finished', runId, stepId, status: 'succeeded', output: '', error: null },
      { type: 'run.finished', runId, status: 'completed' },
    ]);
  });

  it('stops publishing to an unsubscribed listener', async () => {
    const workflow = workflows.create({ name: 'W', steps: [{ kind: 'note', label: 'A' }] });
    const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
    const runner = new WorkflowRunner({ dashboard, workflows, runs });

    const events: WorkflowRunnerEvent[] = [];
    const unsubscribe = runner.onEvent((event) => events.push(event));
    unsubscribe();

    runner.start(workflow.id);
    await vi.advanceTimersByTimeAsync(0);

    expect(events).toEqual([]);
  });
});
```

Add `WorkflowRunnerEvent` to the existing import from `./workflowRunner.js` at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- workflowRunner.test.ts`
Expected: FAIL — `WorkflowRunnerEvent` is not exported / `runner.onEvent` is not a function.

- [ ] **Step 3: Implement the emitter and wire it into `start()`/`execute()`**

In `src/hermes/workflowRunner.ts`, change the top import from `'../store/workflowRuns.js'` to also bring in `WorkflowRunStatus` and `WorkflowRunStepStatus`:

```ts
import type {
  WorkflowRunsRepo,
  WorkflowRunStep,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
} from '../store/workflowRuns.js';
```

Then add, after the `StepResult` interface:

```ts
export type WorkflowRunnerEvent =
  | { type: 'run.started'; runId: string; workflowId: string }
  | { type: 'step.started'; runId: string; stepId: string }
  | { type: 'step.delta'; runId: string; stepId: string; text: string }
  | {
      type: 'step.finished';
      runId: string;
      stepId: string;
      status: WorkflowRunStepStatus;
      output: string;
      error: string | null;
    }
  | { type: 'run.finished'; runId: string; status: WorkflowRunStatus };

export type WorkflowRunnerEventListener = (event: WorkflowRunnerEvent) => void;
```

Add the emitter to the class and wire it into the existing control flow:

```ts
export class WorkflowRunner {
  private readonly active = new Set<string>();
  private readonly listeners = new Set<WorkflowRunnerEventListener>();

  constructor(private readonly options: WorkflowRunnerOptions) {}

  onEvent(listener: WorkflowRunnerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(event: WorkflowRunnerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
```

In `start()`, right after `const run = runs.create(...)` and before `this.active.add(workflowId)`, add:

```ts
    this.publish({ type: 'run.started', runId: run.id, workflowId });
```

In `execute()`, right after the existing `runs.updateStep(runId, step.id, { status: 'running', startedAt: Date.now() });` line, add:

```ts
      this.publish({ type: 'step.started', runId, stepId: step.id });
```

Right after the existing `runs.updateStep(runId, step.id, { status: result.status, output: result.output, error: result.error, finishedAt: Date.now() });` line, add:

```ts
      this.publish({
        type: 'step.finished',
        runId,
        stepId: step.id,
        status: result.status,
        output: result.output,
        error: result.error,
      });
```

At both places `runs.finish(runId, 'failed')` and `runs.finish(runId, 'completed')` currently appear, add the matching publish call right after each:

```ts
        this.publish({ type: 'run.finished', runId, status: 'failed' });
```
```ts
    this.publish({ type: 'run.finished', runId, status: 'completed' });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- workflowRunner.test.ts`
Expected: PASS (all previous tests plus the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/hermes/workflowRunner.ts src/hermes/workflowRunner.test.ts
git commit -m "feat(workflows): add a lifecycle event emitter to WorkflowRunner

Needed for Stage 2's SSE route — the run/step lifecycle is now
observable from outside the runner without polling the store."
```

---

### Task 2: Prompt-step execution

**Files:**
- Modify: `src/hermes/workflowRunner.ts`
- Modify: `src/hermes/workflowRunner.test.ts`

**Interfaces:**
- Consumes: `GatewayEvent`, `GatewayEventListener` types from `src/hermes/gateway.ts` (`{ type: string; sessionId: string | null; payload: Record<string, unknown> | null }`). `Prompt` type shape from `src/store/prompts.ts` (`{ id, title, body, variables: string[], ... }`).
- Produces: `export interface PromptExecutor { request<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>; onEvent(listener: GatewayEventListener): () => void }`, `export interface PromptLookup { get(id: string): { body: string; variables: string[] } | null }`. `WorkflowRunnerOptions` gains `gateway: PromptExecutor; prompts: PromptLookup;` (both required — Task 3 wires the real ones in).
- The blanket up-front rejection of any workflow containing a `prompt` step is **removed** — prompt steps are now executable. `WorkflowRunnerValidationError`'s `'prompt_unsupported'` code is removed from the type union (no call site produces it anymore after this task).

**Design (verified against the real Hermes gateway source, `tui_gateway/server.py`):**
- `session.create` params: `{ cols: 80, source: 'workflow' }` → result `{ session_id }`. `source: 'workflow'` is a free-form label Hermes stores on the session for display/filtering (confirmed at `server.py:3535-3545`, `_resolve_session_source`: any non-empty string is accepted verbatim, no allowlist) — distinguishes workflow-originated sessions from `'desktop'` chat sessions in Hermes' own session list.
- `prompt.submit` params: `{ session_id, text }` — the RPC resolves as soon as Hermes *accepts* the prompt, not when the agent finishes (confirmed by how `src/routes/chat.ts`'s `/api/chat/prompt` uses it: it returns immediately, and the frontend gets the actual reply via SSE separately).
- Progress arrives as gateway events on the *same* connection every other gateway call shares (`ctx.gateway.onEvent`), filtered by `event.sessionId === ourSessionId`: `message.delta` → `payload.text` is an incremental chunk to append (confirmed `server.py:9701`, `_emit("message.delta", sid, payload)` with `payload = {"text": text}` — check `payload.text` specifically, not `payload.delta`). `message.complete` → `payload.status` is `'complete'` | `'error'` | `'interrupted'` (confirmed `server.py:9880-9913`: `payload = {"text": raw, "usage": ..., "status": status}`, and on error `payload.error` is also set, `server.py:9943-9947`).

- [ ] **Step 1: Write the failing tests**

Add to `src/hermes/workflowRunner.test.ts`:

```ts
function makeGateway(): PromptExecutor & { emit: (event: GatewayEvent) => void; request: ReturnType<typeof vi.fn> } {
  const listeners = new Set<GatewayEventListener>();
  return {
    request: vi.fn(),
    onEvent: (listener: GatewayEventListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (event: GatewayEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
}

describe('WorkflowRunner prompt steps', () => {
  it('rejects a prompt step whose prompt has unresolved variables', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [{ kind: 'prompt', ref: 'p-1', label: 'Has vars' }],
    });
    const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
    const gateway = makeGateway();
    const prompts: PromptLookup = { get: () => ({ body: 'Hello {{name}}', variables: ['name'] }) };
    const runner = new WorkflowRunner({ dashboard, workflows, runs, gateway, prompts });

    const { runId } = runner.start(workflow.id);
    await vi.advanceTimersByTimeAsync(0);

    const run = runs.get(runId);
    expect(run?.status).toBe('failed');
    expect(run?.steps[0]?.error).toMatch(/placeholder/i);
    expect(gateway.request).not.toHaveBeenCalled();
  });

  it('rejects a prompt step whose prompt no longer exists', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [{ kind: 'prompt', ref: 'missing', label: 'Gone' }],
    });
    const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
    const gateway = makeGateway();
    const prompts: PromptLookup = { get: () => null };
    const runner = new WorkflowRunner({ dashboard, workflows, runs, gateway, prompts });

    const { runId } = runner.start(workflow.id);
    await vi.advanceTimersByTimeAsync(0);

    expect(runs.get(runId)?.steps[0]).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/no longer exists/i),
    });
  });

  it('runs a prompt step: creates a session, submits the body, accumulates deltas, succeeds on message.complete', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [{ kind: 'prompt', ref: 'p-1', label: 'Summarize' }],
    });
    const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
    const gateway = makeGateway();
    gateway.request.mockImplementation((method: string) => {
      if (method === 'session.create') return Promise.resolve({ session_id: 'live-1' });
      if (method === 'prompt.submit') return Promise.resolve({ ok: true });
      throw new Error(`unexpected method ${method}`);
    });
    const prompts: PromptLookup = { get: () => ({ body: 'Summarize the week', variables: [] }) };
    const runner = new WorkflowRunner({ dashboard, workflows, runs, gateway, prompts });

    const { runId } = runner.start(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    gateway.emit({ type: 'message.delta', sessionId: 'live-1', payload: { text: 'Hello ' } });
    gateway.emit({ type: 'message.delta', sessionId: 'live-1', payload: { text: 'world' } });
    gateway.emit({
      type: 'message.complete',
      sessionId: 'live-1',
      payload: { text: 'Hello world', status: 'complete' },
    });
    await vi.advanceTimersByTimeAsync(0);

    const run = runs.get(runId);
    expect(run?.status).toBe('completed');
    expect(run?.steps[0]).toMatchObject({ status: 'succeeded', output: 'Hello world' });
    expect(gateway.request).toHaveBeenCalledWith('session.create', { cols: 80, source: 'workflow' });
    expect(gateway.request).toHaveBeenCalledWith('prompt.submit', {
      session_id: 'live-1',
      text: 'Summarize the week',
    });
  });

  it('fails a prompt step when message.complete reports an error status', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [{ kind: 'prompt', ref: 'p-1', label: 'Summarize' }],
    });
    const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
    const gateway = makeGateway();
    gateway.request.mockImplementation((method: string) =>
      method === 'session.create'
        ? Promise.resolve({ session_id: 'live-1' })
        : Promise.resolve({ ok: true }),
    );
    const prompts: PromptLookup = { get: () => ({ body: 'Do a thing', variables: [] }) };
    const runner = new WorkflowRunner({ dashboard, workflows, runs, gateway, prompts });

    const { runId } = runner.start(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    gateway.emit({
      type: 'message.complete',
      sessionId: 'live-1',
      payload: { text: 'Error: model unavailable', status: 'error', error: 'model unavailable' },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(runs.get(runId)?.steps[0]).toMatchObject({
      status: 'failed',
      error: 'model unavailable',
    });
  });

  it('ignores gateway events for a different session id', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [{ kind: 'prompt', ref: 'p-1', label: 'Summarize' }],
    });
    const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
    const gateway = makeGateway();
    gateway.request.mockImplementation((method: string) =>
      Promise.resolve(method === 'session.create' ? { session_id: 'live-1' } : { ok: true }),
    );
    const prompts: PromptLookup = { get: () => ({ body: 'Hi', variables: [] }) };
    const runner = new WorkflowRunner({ dashboard, workflows, runs, gateway, prompts });

    runner.start(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    gateway.emit({ type: 'message.delta', sessionId: 'someone-elses-session', payload: { text: 'noise' } });
    // Still running: proves the foreign-session delta was ignored, not appended.
    const runId = runs.listByWorkflow(workflow.id)[0]!.id;
    expect(runs.get(runId)?.steps[0]?.output).toBe('');
  });

  it('fails a prompt step if no session id comes back from session.create', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [{ kind: 'prompt', ref: 'p-1', label: 'Summarize' }],
    });
    const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
    const gateway = makeGateway();
    gateway.request.mockResolvedValue({});
    const prompts: PromptLookup = { get: () => ({ body: 'Hi', variables: [] }) };
    const runner = new WorkflowRunner({ dashboard, workflows, runs, gateway, prompts });

    const { runId } = runner.start(workflow.id);
    await vi.advanceTimersByTimeAsync(0);

    expect(runs.get(runId)?.steps[0]).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/session/i),
    });
  });
});
```

Add `PromptExecutor`, `PromptLookup`, `GatewayEvent`, `GatewayEventListener` to the test file's imports (`GatewayEvent`/`GatewayEventListener` come from `../hermes/gateway.js`, the other two from `./workflowRunner.js`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- workflowRunner.test.ts`
Expected: FAIL — `PromptExecutor`/`PromptLookup` not exported, `WorkflowRunnerOptions` doesn't accept `gateway`/`prompts`.

- [ ] **Step 3: Implement prompt-step execution**

In `src/hermes/workflowRunner.ts`, add the import and new interfaces near the top (after the existing `CronExecutor` interface):

```ts
import type { GatewayEvent, GatewayEventListener } from './gateway.js';

/**
 * The slice of `GatewayClient` a prompt step needs — same chat mechanism the
 * Chat page uses (`session.create` + `prompt.submit` + the shared event bus),
 * kept structural so tests never construct a real WebSocket-backed client.
 */
export interface PromptExecutor {
  request<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent(listener: GatewayEventListener): () => void;
}

/** The slice of `PromptsRepo` a prompt step needs to resolve its body. */
export interface PromptLookup {
  get(id: string): { body: string; variables: string[] } | null;
}
```

Update `WorkflowRunnerValidationError`'s code union — remove `'prompt_unsupported'`:

```ts
export class WorkflowRunnerValidationError extends Error {
  constructor(
    message: string,
    readonly code: 'workflow_not_found' | 'workflow_disabled' | 'no_steps' | 'run_in_progress',
  ) {
    super(message);
    this.name = 'WorkflowRunnerValidationError';
  }
}
```

Update `WorkflowRunnerOptions` to require the two new dependencies:

```ts
export interface WorkflowRunnerOptions {
  dashboard: CronExecutor;
  gateway: PromptExecutor;
  prompts: PromptLookup;
  workflows: WorkflowsRepo;
  runs: WorkflowRunsRepo;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** Overridable for tests; production default gives a full agent turn room to work. */
  promptTimeoutMs?: number;
}
```

Add the default timeout constant near the other defaults:

```ts
const DEFAULT_PROMPT_TIMEOUT_MS = 10 * 60_000;
```

Remove the up-front prompt-step rejection in `start()` — delete this block entirely:

```ts
    if (workflow.steps.some((step) => step.kind === 'prompt')) {
      throw new WorkflowRunnerValidationError(
        'Prompt steps aren’t runnable yet — support is coming in a future update.',
        'prompt_unsupported',
      );
    }
```

`runStep`, `runCronStep`, and the new `runPromptStep` all need to know which run they belong to, because `step.delta` events must carry a `runId`. Thread it through as a parameter rather than looking it up: change `runStep`'s and `runCronStep`'s signatures to take `runId` first, update `execute()`'s one call site, and give `runPromptStep` the same shape from the start.

In `execute()`, change:
```ts
      const result = await this.runStep(step);
```
to:
```ts
      const result = await this.runStep(runId, step);
```

Change `runStep` and `runCronStep`'s signatures and the `prompt` case:

```ts
  private async runStep(runId: string, step: WorkflowRunStep): Promise<StepResult> {
    switch (step.kind) {
      case 'note':
        return { status: 'succeeded', output: '', error: null };
      case 'cron':
        return this.runCronStep(step);
      case 'prompt':
        return this.runPromptStep(runId, step);
    }
  }

  private async runCronStep(step: WorkflowRunStep): Promise<StepResult> {
```

(`runCronStep`'s own signature and body are unchanged — it doesn't need `runId`, only `runPromptStep` does, since only prompt steps emit `step.delta`.)

Add the new `runPromptStep` method after `runCronStep`:

```ts
  private async runPromptStep(runId: string, step: WorkflowRunStep): Promise<StepResult> {
    const { gateway, prompts } = this.options;
    const promptTimeoutMs = this.options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;

    if (!step.ref) {
      return { status: 'failed', output: '', error: 'No prompt is selected for this step.' };
    }
    const prompt = prompts.get(step.ref);
    if (!prompt) {
      return { status: 'failed', output: '', error: 'This prompt no longer exists in the library.' };
    }
    if (prompt.variables.length > 0) {
      return {
        status: 'failed',
        output: '',
        error: `This prompt has placeholders (${prompt.variables.map((v) => `{{${v}}}`).join(', ')}) that can't be filled in automatically in a workflow.`,
      };
    }

    let sessionId: string | undefined;
    try {
      const created = await gateway.request<{ session_id?: string }>('session.create', {
        cols: 80,
        source: 'workflow',
      });
      sessionId = created.session_id;
    } catch (error) {
      return { status: 'failed', output: '', error: describeError(error) };
    }
    if (!sessionId) {
      return { status: 'failed', output: '', error: 'Hermes did not return a session id.' };
    }

    return new Promise<StepResult>((resolve) => {
      let output = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve({
          status: 'failed',
          output,
          error: `No response from Hermes after ${Math.max(1, Math.round(promptTimeoutMs / 60_000))} minutes.`,
        });
      }, promptTimeoutMs);

      const unsubscribe = gateway.onEvent((event: GatewayEvent) => {
        if (settled || event.sessionId !== sessionId) return;
        if (event.type === 'message.delta') {
          const text = event.payload?.text;
          if (typeof text === 'string' && text) {
            output += text;
            this.publish({ type: 'step.delta', runId, stepId: step.id, text });
          }
          return;
        }
        if (event.type === 'message.complete') {
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          const payload = event.payload ?? {};
          const status = payload.status;
          const finalText = typeof payload.text === 'string' ? payload.text : output;
          if (status === 'error' || status === 'interrupted') {
            const error =
              typeof payload.error === 'string' && payload.error
                ? payload.error
                : finalText || 'Hermes reported an error without a message.';
            resolve({ status: 'failed', output, error });
            return;
          }
          resolve({ status: 'succeeded', output: finalText, error: null });
        }
      });

      gateway.request('prompt.submit', { session_id: sessionId, text: prompt.body }).catch((error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve({ status: 'failed', output, error: describeError(error) });
      });
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- workflowRunner.test.ts`
Expected: PASS (all previous tests plus the 6 new ones — 13 total in this file)

- [ ] **Step 5: Commit**

```bash
git add src/hermes/workflowRunner.ts src/hermes/workflowRunner.test.ts
git commit -m "feat(workflows): execute prompt steps via the chat gateway

Same session.create + prompt.submit mechanism the Chat page uses.
Prompts with unresolved {{placeholders}} are rejected per-step rather
than sent with the literal template text — there's no interactive
user in a workflow run to fill them in."
```

---

### Task 3: Wire `gateway`/`prompts` into `WorkflowRunner`'s construction

**Files:**
- Modify: `src/context.ts`

**Interfaces:**
- Consumes: `ctx.gateway` (already built earlier in `buildContext`, satisfies `PromptExecutor` structurally — same relationship `ctx.dashboard` already has with `CronExecutor`). New `PromptsRepo` instance from `src/store/prompts.ts`.

- [ ] **Step 1: Add the import**

In `src/context.ts`, add alongside the other store imports:

```ts
import { PromptsRepo } from './store/prompts.js';
```

- [ ] **Step 2: Construct a `PromptsRepo` and pass both new dependencies**

Find the existing `const workflowRunner = new WorkflowRunner({ dashboard, workflows, runs: workflowRuns });` line and replace it with:

```ts
  const prompts = new PromptsRepo(store);
  const workflowRunner = new WorkflowRunner({
    dashboard,
    gateway,
    prompts,
    workflows,
    runs: workflowRuns,
  });
```

(`gateway` is already an in-scope local variable from earlier in `buildContext` — this task does not construct a new one. `prompts` here is a second `PromptsRepo` instance alongside whatever `src/routes/workspace.ts` already builds for prompt-library CRUD — same harmless duplication pattern Stage 1's Task 3 already established for `WorkflowsRepo`, both are stateless wrappers over the same `store`.)

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/context.ts
git commit -m "feat(workflows): wire the gateway and prompt library into WorkflowRunner"
```

---

### Task 4: SSE route for live run events

**Files:**
- Create: `src/routes/workflowEvents.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `ctx.workflowRunner.onEvent` (Task 1).
- Produces: `GET /api/workflows/events` — one shared SSE stream, named events matching `WorkflowRunnerEvent['type']`, each frame's `data` is the JSON-stringified event object. Consumed by Task 5's frontend.

- [ ] **Step 1: Create the route module**

Create `src/routes/workflowEvents.ts` (mirrors `/api/chat/events` in `src/routes/chat.ts:448-481` exactly, adapted to the workflow runner's own event bus instead of the gateway's):

```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { log } from '../log.js';

const KEEPALIVE_MS = 20_000;

/**
 * Streams workflow run progress. One shared connection for the whole app
 * (same pattern as `/api/chat/events`) — the browser filters by `runId` and
 * only acts on the event types it knows, so new event types never break it.
 */
export async function registerWorkflowEventRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/api/workflows/events', (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.hijack();
    reply.raw.write(': connected\n\n');

    const unsubscribe = ctx.workflowRunner.onEvent((event) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const keepalive = setInterval(() => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(': keepalive\n\n');
    }, KEEPALIVE_MS);
    keepalive.unref?.();

    const cleanup = (): void => {
      clearInterval(keepalive);
      unsubscribe();
      log.debug('Workflow events SSE client disconnected');
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}
```

- [ ] **Step 2: Register the route**

In `src/server.ts`, add the import after `import { registerWorkflowRunRoutes } from './routes/workflowRuns.js';`:

```ts
import { registerWorkflowEventRoutes } from './routes/workflowEvents.js';
```

Add the registration right after `await registerWorkflowRunRoutes(app, ctx);`:

```ts
  await registerWorkflowEventRoutes(app, ctx);
```

- [ ] **Step 3: Verify it compiles and boots**

Run: `npm run typecheck && npm run build`
Expected: no errors. (No route-level test — same established pattern as every other SSE/route module in this codebase; verified live in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add src/routes/workflowEvents.ts src/server.ts
git commit -m "feat(workflows): add an SSE route for live run progress"
```

---

### Task 5: Frontend — replace polling with SSE, render prompt-step live text

**Files:**
- Modify: `web/src/pages/WorkflowsPage.tsx`

**Interfaces:**
- Consumes: `GET /api/workflows/events` (Task 4), the already-existing `startWorkflowRun` (Stage 1), `Workflow`/`WorkflowStepKind`/`WorkflowRunStatus`/`WorkflowRunStepStatus` types.
- Removes: `getWorkflowRuns`, `queryKeys.workflowRuns`, and the `runsQuery` `useQuery`/polling from Stage 1 are no longer used by this page (leave the API functions themselves in `web/src/lib/api.ts` — Stage 4's history UI will use `getWorkflowRuns` again for the "recent runs" list; only this page's *live* view changes).

- [ ] **Step 1: Replace the run-state hooks**

In `web/src/pages/WorkflowsPage.tsx`, replace the whole block from `const [activeRunWorkflowId, setActiveRunWorkflowId] = useState<string | null>(null);` through `const currentRun = activeRunWorkflowId ? runsQuery.data?.runs[0] : undefined;` (currently lines 280–315) with:

```ts
  interface LiveStep {
    status: WorkflowRunStepStatus;
    output: string;
    error: string | null;
  }
  interface LiveRun {
    workflowId: string;
    runId: string;
    status: WorkflowRunStatus;
    steps: Record<string, LiveStep>;
  }

  const [liveRun, setLiveRun] = useState<LiveRun | null>(null);

  const patchStep = (run: LiveRun, stepId: string, patch: Partial<LiveStep>): LiveRun => ({
    ...run,
    steps: { ...run.steps, [stepId]: { ...run.steps[stepId]!, ...patch } },
  });

  useEffect(() => {
    const source = new EventSource('/api/workflows/events');

    const on = <T extends { runId: string }>(type: string, handler: (data: T) => void) => {
      source.addEventListener(type, (event: MessageEvent) => {
        try {
          handler(JSON.parse(event.data as string) as T);
        } catch {
          // Malformed frame: ignore rather than crash the stream handler.
        }
      });
    };

    on<{ runId: string; stepId: string }>('step.started', (data) =>
      setLiveRun((run) =>
        run && run.runId === data.runId ? patchStep(run, data.stepId, { status: 'running' }) : run,
      ),
    );
    on<{ runId: string; stepId: string; text: string }>('step.delta', (data) =>
      setLiveRun((run) =>
        run && run.runId === data.runId
          ? patchStep(run, data.stepId, { output: (run.steps[data.stepId]?.output ?? '') + data.text })
          : run,
      ),
    );
    on<{
      runId: string;
      stepId: string;
      status: WorkflowRunStepStatus;
      output: string;
      error: string | null;
    }>('step.finished', (data) =>
      setLiveRun((run) =>
        run && run.runId === data.runId
          ? patchStep(run, data.stepId, { status: data.status, output: data.output, error: data.error })
          : run,
      ),
    );
    on<{ runId: string; status: WorkflowRunStatus }>('run.finished', (data) =>
      setLiveRun((run) => (run && run.runId === data.runId ? { ...run, status: data.status } : run)),
    );

    return () => source.close();
  }, []);

  const startRun = useMutation({
    mutationFn: (workflowId: string) => startWorkflowRun(workflowId, 'chain'),
    onSuccess: (data, workflowId) => {
      const workflow = workflows.find((w) => w.id === workflowId);
      setLiveRun({
        workflowId,
        runId: data.runId,
        status: 'running',
        steps: Object.fromEntries(
          (workflow?.steps ?? []).map((s) => [s.id, { status: 'pending' as const, output: '', error: null }]),
        ),
      });
    },
    onError: (e: Error) => {
      const code = e instanceof ApiError ? e.code : undefined;
      const key =
        code === 'workflow_disabled'
          ? 'workflowRuns.reason.disabled'
          : code === 'no_steps'
            ? 'workflowRuns.reason.noSteps'
            : code === 'run_in_progress'
              ? 'workflowRuns.reason.alreadyActive'
              : null;
      toast.push({
        tone: 'error',
        title: t('workflowRuns.startFailed'),
        description: key ? t(key) : e.message,
      });
    },
  });
```

Note: `onError`'s code-to-key map drops the `prompt_unsupported` branch — that rejection code no longer exists server-side after Task 2 (prompt steps are runnable now), so it can never be returned. Leave the `workflowRuns.promptNotSupported` i18n key in place (still used elsewhere, e.g. any leftover disabled-button tooltip logic checked in the next step) rather than deleting it — check Step 2 below.

`useEffect` needs importing: add `useEffect` to the existing `import { useState } from 'react';` line, making it `import { useEffect, useState } from 'react';`. `ApiError`, `WorkflowRunStatus`, `WorkflowRunStepStatus` types need adding to the existing `@/lib/hermesTypes` type import if not already present (`WorkflowRunStatus`/`WorkflowRunStepStatus` were added in Stage 1 Task 5 — confirm they're already imported; `ApiError` already is, from Stage 1's error-mapping work).

`workflows` in the `onSuccess` handler above refers to the page's existing `const workflows = data?.workflows ?? [];` line (currently defined further down in the component, after the second `useQuery` call). Referencing it from inside `startRun`'s `onSuccess` callback — defined earlier in the component's source order — works correctly despite the textual ordering: the callback's body only executes later, on a button click, by which point the whole component function (and `workflows`'s assignment) has already run. This is the same pattern the file already relies on elsewhere; no reordering needed.

- [ ] **Step 2: Update the run button's disabled condition**

Find the run-button `disabled={...}` block (previously referenced `workflow.steps.some((s) => s.kind === 'prompt')` to disable the button and show `workflowRuns.promptNotSupported` as a `title` tooltip). Remove that condition and its `title` — prompt steps are runnable now, so a workflow containing one should no longer be blocked client-side. The remaining disabled conditions (workflow disabled, no steps, a start already pending for this workflow, or `liveRun?.workflowId === workflow.id && liveRun.status === 'running'`) stay, adjusted to read from `liveRun` instead of the removed `currentRun`.

- [ ] **Step 3: Update the status panel render**

Replace the status-panel JSX block (the one gated on `activeRunWorkflowId === workflow.id && currentRun && (...)`, added in Stage 1 and given a spinner in the follow-up fix) to read from `liveRun` and iterate over `workflow.steps` (for label/kind, which `liveRun` no longer duplicates) joined with `liveRun.steps[step.id]` (for live status/output/error):

```tsx
              {liveRun?.workflowId === workflow.id && (
                <div className="mt-3 rounded-xl border border-[var(--color-hairline)] p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    {liveRun.status === 'running' && (
                      <Loader2
                        size={12}
                        className="animate-spin text-[var(--color-accent)]"
                        aria-hidden
                      />
                    )}
                    {t('workflowRuns.statusLabel', {
                      status: t(`workflowRuns.status.${liveRun.status}`),
                    })}
                  </p>
                  <ol className="mt-2 space-y-1">
                    {workflow.steps.map((step) => {
                      const live = liveRun.steps[step.id];
                      if (!live) return null;
                      return (
                        <li key={step.id} className="text-xs">
                          <div className="flex items-center gap-1.5">
                            {live.status === 'running' && (
                              <Loader2
                                size={11}
                                className="animate-spin text-[var(--color-accent)]"
                                aria-hidden
                              />
                            )}
                            <span className="text-[var(--color-ink-muted)]">
                              {t(`workflowRuns.stepStatus.${live.status}`)}
                            </span>
                            <span>{step.label}</span>
                          </div>
                          {live.status === 'running' && step.kind === 'cron' && (
                            <p className="mt-0.5 text-[0.65rem] text-[var(--color-ink-faint)]">
                              {t('workflowRuns.cronRunningHint')}
                            </p>
                          )}
                          {live.status === 'running' && step.kind === 'prompt' && live.output && (
                            <p className="mt-0.5 whitespace-pre-wrap text-[var(--color-ink-muted)]">
                              {live.output}
                            </p>
                          )}
                          {live.status === 'failed' && live.error && (
                            <p className="mt-0.5 text-[var(--color-danger)]">{live.error}</p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
```

Add `Loader2` if it isn't already imported (it was added in the post-Stage-1 loading-indicator fix — check before re-adding).

- [ ] **Step 4: Add one new i18n key**

A prompt step's live text has no equivalent to the cron hint yet. Add to `en.ts`/`de.ts`/`fa.ts`, right after `workflowRuns.cronRunningHint`:
- en: `'workflowRuns.promptRunningHint': 'The agent is answering — this can take a while for longer replies.'`
- de: `'workflowRuns.promptRunningHint': 'Der Agent antwortet gerade — das kann bei längeren Antworten dauern.'`
- fa: `'workflowRuns.promptRunningHint': 'دستیار در حال پاسخ‌گویی است — برای پاسخ‌های طولانی‌تر ممکن است طول بکشد.'`

This key isn't referenced by the JSX above (the growing `live.output` text is itself the live-progress signal for a prompt step, unlike the opaque cron wait) — skip wiring it in unless, while implementing Step 3, it becomes clear the growing text alone doesn't read as "still going" (e.g. right after the session opens, before the first delta arrives, there's a `running` status with empty `output` and no hint at all — in that gap specifically, render `t('workflowRuns.promptRunningHint')` in place of the empty output paragraph). Use judgment matching Stage 1's loading-indicator fix (a spinner plus this hint text is what closed that exact gap for cron steps).

- [ ] **Step 5: Run the i18n parity check**

```
node -e "const f=p=>require('fs').readFileSync(p,'utf8');const k=s=>new Set([...s.matchAll(/^\s{2}'([^']+)':/gm)].map(m=>m[1]));const a=k(f('web/src/lib/i18n/en.ts')),b=k(f('web/src/lib/i18n/de.ts')),c=k(f('web/src/lib/i18n/fa.ts'));console.log(a.size,b.size,c.size);const d=(x,y,n)=>[...x].filter(z=>!y.has(z)).forEach(z=>console.log('fehlt in '+n+':',z));d(a,b,'de');d(a,c,'fa');d(b,a,'en');d(c,a,'en');"
```
Expected: three equal numbers, no "fehlt in" lines.

- [ ] **Step 6: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors. (No component test setup in this repo — verified live in Task 7.)

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/WorkflowsPage.tsx web/src/lib/i18n/en.ts web/src/lib/i18n/de.ts web/src/lib/i18n/fa.ts
git commit -m "feat(workflows): stream run progress over SSE instead of polling

Also lets prompt steps' answer text grow live, the same way chat
already does, and drops the now-obsolete client-side prompt-step
block on the run button (the server accepts them now)."
```

---

### Task 6: Full gate, deploy, handoff for live testing

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```
Expected: all green. Fix any `format:check` failure with `npx prettier --write <files>` and re-run.

- [ ] **Step 2: Deploy to the production server**

Same tar-deploy mechanism as Stage 1 (`docs/HANDOFF.md` §31.6 / §35.4): back up `dist` on the server (`rm -rf dist.bak && mv dist dist.bak`), tar the tracked-file working tree (`tar -czf - $(git ls-files) | ssh ... tar -xzf -`) — **not** `git archive`, which would drop the still-uncommitted `beta.3` UI changes already live on the server — run `npm run build` on the server, confirm the asset hash matches the local build, `systemctl restart hermes-control-center.service`, verify `journalctl` is clean and `curl` returns 200.

- [ ] **Step 3: Hand off for live testing**

Ask the user to run a workflow containing a prompt step (referencing an existing prompt in the library with no `{{placeholders}}`) end to end, and to watch the answer text grow live rather than only seeing a static "Running…" label. Also worth a spot check: a workflow mixing a `note` → `prompt` → `cron` step, to confirm the SSE-driven panel now updates step-by-step without the 1.5s polling delay that Stage 1 had.

- [ ] **Step 4: Record the outcome**

Once confirmed, this stage is done. Stage 3 (single-step mode + the manual continue/stop dialog on failure) gets its own plan per the spec's §7 rollout order.
