import { describeError, log } from '../log.js';
import type { WorkflowsRepo } from '../store/workflows.js';
import type {
  WorkflowRunsRepo,
  WorkflowRunMode,
  WorkflowRunStep,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
  WorkflowRunTrigger,
} from '../store/workflowRuns.js';
import type { CronJobSummary } from './inventory.js';
import type { GatewayEvent, GatewayEventListener } from './gateway.js';

/**
 * The slice of `DashboardClient` the runner needs, kept structural so tests
 * pass a plain object instead of constructing a real HTTP-backed client.
 */
export interface CronExecutor {
  cronJobs(): Promise<CronJobSummary[]>;
  cronAction(id: string, action: 'trigger', profile: string): Promise<unknown>;
}

/**
 * The slice of `GatewayClient` a prompt step needs — same chat mechanism the
 * Chat page uses (`session.create` + `prompt.submit` + the shared event bus),
 * kept structural so tests never construct a real WebSocket-backed client.
 */
export interface PromptExecutor {
  request<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  onEvent(listener: GatewayEventListener): () => void;
}

/** The slice of `PromptsRepo` a prompt step needs to resolve its body. */
export interface PromptLookup {
  get(id: string): { body: string; variables: string[] } | null;
}

export class WorkflowRunnerValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'workflow_not_found'
      | 'workflow_disabled'
      | 'no_steps'
      | 'run_in_progress'
      | 'run_not_found'
      | 'run_not_waiting',
  ) {
    super(message);
    this.name = 'WorkflowRunnerValidationError';
  }
}

/** What a paused run's next `resume()` call decides. */
export type WorkflowRunResumeAction = 'continue' | 'stop';

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

interface StepResult {
  status: 'succeeded' | 'failed';
  output: string;
  error: string | null;
}

export type WorkflowRunnerEvent =
  | { type: 'run.started'; runId: string; workflowId: string; mode: WorkflowRunMode }
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
  | { type: 'run.waiting_for_user'; runId: string }
  | { type: 'run.finished'; runId: string; status: WorkflowRunStatus };

export type WorkflowRunnerEventListener = (event: WorkflowRunnerEvent) => void;

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 10 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a workflow's steps in order, persisting progress into
 * `workflow_runs` as it goes. Knows `note`, `cron`, and `prompt` steps —
 * a `prompt` step sends its library prompt's body through a fresh Hermes
 * chat session, the same `session.create` + `prompt.submit` mechanism the
 * Chat page uses, and accumulates the streamed reply. A run always stops at
 * the first failed step: the manual continue/stop dialog and the
 * unattended/scheduled path are later stages, not this one.
 */
export class WorkflowRunner {
  private readonly active = new Set<string>();
  private readonly listeners = new Set<WorkflowRunnerEventListener>();
  /** One resolver per currently-paused run, fed by `resume()`. */
  private readonly pausedResumers = new Map<string, (action: WorkflowRunResumeAction) => void>();
  /** Runs whose in-flight step should stop at its next opportunity to notice. */
  private readonly abortRequested = new Set<string>();
  /**
   * One "wake up now" callback per run currently inside a step that can be
   * nudged early (right now: only a prompt step waiting on Hermes) — lets
   * `abort()` end that step immediately instead of waiting for its next poll
   * tick or timeout.
   */
  private readonly activeStepAborts = new Map<string, () => void>();

  constructor(private readonly options: WorkflowRunnerOptions) {}

  onEvent(listener: WorkflowRunnerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(event: WorkflowRunnerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        log.warn(`workflow event listener threw on ${event.type}: ${describeError(error)}`);
      }
    }
  }

  /**
   * Validates synchronously, then runs the chain in the background.
   * `trigger` defaults to `'manual'` — only `WorkflowScheduler` ever passes
   * `'scheduled'`, which changes how a failed step is handled (§ `execute`).
   */
  start(
    workflowId: string,
    mode: WorkflowRunMode,
    trigger: WorkflowRunTrigger = 'manual',
  ): { runId: string } {
    const { workflows, runs } = this.options;
    const workflow = workflows.get(workflowId);
    if (!workflow)
      throw new WorkflowRunnerValidationError('Workflow not found.', 'workflow_not_found');
    if (!workflow.enabled) {
      throw new WorkflowRunnerValidationError('Workflow is disabled.', 'workflow_disabled');
    }
    if (workflow.steps.length === 0) {
      throw new WorkflowRunnerValidationError('Workflow has no steps.', 'no_steps');
    }
    if (this.active.has(workflowId) || runs.hasActiveRun(workflowId)) {
      throw new WorkflowRunnerValidationError(
        'This workflow already has a run in progress.',
        'run_in_progress',
      );
    }

    const run = runs.create(workflowId, trigger, mode, workflow.steps);
    this.publish({ type: 'run.started', runId: run.id, workflowId, mode });
    this.active.add(workflowId);
    void this.execute(workflowId, run.id)
      .catch((error: unknown) =>
        log.warn(`workflow run ${run.id} crashed: ${describeError(error)}`),
      )
      .finally(() => {
        this.active.delete(workflowId);
        this.pausedResumers.delete(run.id);
      });
    return { runId: run.id };
  }

  /**
   * Answers a paused run: `advance` and a `resolve` "continue" both mean the
   * same thing to the runner (move on to the next step) — the two routes
   * exist only because the frontend shows different UI for "nothing to
   * decide, just go" (single-step mode after a success) versus "a step
   * failed, pick continue or stop".
   */
  resume(runId: string, action: WorkflowRunResumeAction): void {
    const resolve = this.pausedResumers.get(runId);
    if (!resolve) {
      if (!this.options.runs.get(runId)) {
        throw new WorkflowRunnerValidationError('Run not found.', 'run_not_found');
      }
      throw new WorkflowRunnerValidationError(
        'This run is not waiting for a decision.',
        'run_not_waiting',
      );
    }
    this.pausedResumers.delete(runId);
    resolve(action);
  }

  /**
   * Stops a run right now, whichever state it's in: already paused (same as
   * `resume(runId, 'stop')`), waiting on a prompt reply (interrupts the
   * Hermes session immediately), or mid cron-poll (noticed within one poll
   * tick — there's no way to cancel a cron job Hermes already triggered, only
   * to stop tracking it).
   */
  abort(runId: string): void {
    if (this.pausedResumers.has(runId)) {
      this.resume(runId, 'stop');
      return;
    }
    if (!this.options.runs.get(runId)) {
      throw new WorkflowRunnerValidationError('Run not found.', 'run_not_found');
    }
    this.abortRequested.add(runId);
    this.activeStepAborts.get(runId)?.();
  }

  private awaitResume(runId: string): Promise<WorkflowRunResumeAction> {
    return new Promise((resolve) => {
      this.pausedResumers.set(runId, resolve);
    });
  }

  /** Marks every not-yet-started step from `fromIndex` on as `skipped`, e.g. after a manual stop. */
  private skipRemaining(runId: string, steps: readonly WorkflowRunStep[], fromIndex: number): void {
    const { runs } = this.options;
    for (let i = fromIndex; i < steps.length; i++) {
      const step = steps[i]!;
      runs.updateStep(runId, step.id, { status: 'skipped', finishedAt: Date.now() });
      this.publish({
        type: 'step.finished',
        runId,
        stepId: step.id,
        status: 'skipped',
        output: '',
        error: null,
      });
    }
  }

  private async execute(workflowId: string, runId: string): Promise<void> {
    const { runs, workflows } = this.options;
    const run = runs.get(runId);
    if (!run) return;
    // Captured once, before the loop: the mid-run "was it deleted" guard
    // below already stops the run before any code past it can read this, so
    // a later deletion can never leave it stale mid-use.
    const workflowName = workflows.get(workflowId)?.name ?? run.workflowId;

    for (let i = 0; i < run.steps.length; i++) {
      const step = run.steps[i]!;
      if (!workflows.get(workflowId)) {
        log.debug(`workflow run ${runId}: workflow ${workflowId} was deleted mid-run, stopping`);
        return;
      }
      runs.updateStep(runId, step.id, { status: 'running', startedAt: Date.now() });
      this.publish({ type: 'step.started', runId, stepId: step.id });
      const result = await this.runStep(runId, step);

      if (this.abortRequested.has(runId)) {
        this.abortRequested.delete(runId);
        this.activeStepAborts.delete(runId);
        runs.updateStep(runId, step.id, {
          status: 'skipped',
          output: result.output,
          error: null,
          finishedAt: Date.now(),
        });
        this.publish({
          type: 'step.finished',
          runId,
          stepId: step.id,
          status: 'skipped',
          output: result.output,
          error: null,
        });
        this.skipRemaining(runId, run.steps, i + 1);
        runs.finish(runId, 'stopped');
        this.publish({ type: 'run.finished', runId, status: 'stopped' });
        runs.prune(workflowId);
        return;
      }

      runs.updateStep(runId, step.id, {
        status: result.status,
        output: result.output,
        error: result.error,
        finishedAt: Date.now(),
      });
      this.publish({
        type: 'step.finished',
        runId,
        stepId: step.id,
        status: result.status,
        output: result.output,
        error: result.error,
      });

      if (result.status === 'failed' && run.trigger === 'scheduled') {
        // Nobody is present to answer a pause on an unattended run — stop
        // right here instead, and tell the agent to notify the user, the
        // same way a failed cron job would surface.
        this.sendTelegramFailureNotice(runId, workflowName, i, step.label, result.error);
        runs.finish(runId, 'failed');
        this.publish({ type: 'run.finished', runId, status: 'failed' });
        runs.prune(workflowId);
        return;
      }

      const isLastStep = i === run.steps.length - 1;
      // A failed step always pauses for a continue/stop decision on a manual
      // run. Single-step mode additionally pauses after every successful,
      // non-final step, waiting for an explicit "next" — scheduled runs are
      // always `chain` (§ WorkflowScheduler), so this branch is manual-only
      // in practice, but the mode check stays explicit rather than assumed.
      const needsPause =
        run.trigger === 'manual' &&
        (result.status === 'failed' || (run.mode === 'single_step' && !isLastStep));
      if (needsPause) {
        runs.setWaiting(runId);
        this.publish({ type: 'run.waiting_for_user', runId });
        const action = await this.awaitResume(runId);
        if (action === 'stop') {
          this.skipRemaining(runId, run.steps, i + 1);
          runs.finish(runId, 'stopped');
          this.publish({ type: 'run.finished', runId, status: 'stopped' });
          runs.prune(workflowId);
          return;
        }
        // 'continue': the loop naturally moves on to the next step, whether
        // this pause was a failure being waved past or a single-step "next".
      }
    }
    runs.finish(runId, 'completed');
    this.publish({ type: 'run.finished', runId, status: 'completed' });
    runs.prune(workflowId);
  }

  /**
   * A scheduled run has nobody watching it fail, so it tells the agent to
   * notify the user itself — the same chat-session mechanism a prompt step
   * uses, but a second, throwaway session, and not recorded as a step of the
   * run. Fire-and-forget: the run's own lifecycle (finish/publish/prune)
   * must not wait on whether this notice, or Hermes' own delivery of it,
   * succeeds.
   */
  private sendTelegramFailureNotice(
    runId: string,
    workflowName: string,
    stepIndex: number,
    stepLabel: string,
    error: string | null,
  ): void {
    const { gateway } = this.options;
    void (async () => {
      const created = await gateway.request<{ session_id?: string }>('session.create', {
        cols: 80,
        source: 'workflow',
      });
      const sessionId = created.session_id;
      if (!sessionId) return;
      const text =
        `Scheduled workflow '${workflowName}' failed at step ${stepIndex + 1} (${stepLabel}): ` +
        `${error ?? 'Unknown error.'} Please notify the user about this via Telegram.`;
      await gateway.request('prompt.submit', { session_id: sessionId, text });
    })().catch((err: unknown) =>
      log.debug(
        `workflow run ${runId}: failed to send the Telegram failure notice: ${describeError(err)}`,
      ),
    );
  }

  private async runStep(runId: string, step: WorkflowRunStep): Promise<StepResult> {
    switch (step.kind) {
      case 'note':
        return { status: 'succeeded', output: '', error: null };
      case 'cron':
        return this.runCronStep(step, runId);
      case 'prompt':
        return this.runPromptStep(runId, step);
    }
  }

  private async runCronStep(step: WorkflowRunStep, runId: string): Promise<StepResult> {
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
      // Noticed within one poll tick — Hermes already triggered the cron job
      // and it'll run to completion on its own regardless; this only stops
      // this workflow run from waiting on it any longer.
      if (this.abortRequested.has(runId)) {
        return { status: 'failed', output: '', error: null };
      }
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
      error: `No result from Hermes after ${Math.max(1, Math.round(pollTimeoutMs / 60_000))} minutes — check the cron job’s status directly.`,
    };
  }

  private async runPromptStep(runId: string, step: WorkflowRunStep): Promise<StepResult> {
    const { gateway, prompts } = this.options;
    const promptTimeoutMs = this.options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;

    if (!step.ref) {
      return { status: 'failed', output: '', error: 'No prompt is selected for this step.' };
    }
    const prompt = prompts.get(step.ref);
    if (!prompt) {
      return {
        status: 'failed',
        output: '',
        error: 'This prompt no longer exists in the library.',
      };
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

      const interruptSession = (reason: string): void => {
        gateway
          .request('session.interrupt', { session_id: sessionId })
          .catch((error: unknown) =>
            log.warn(
              `workflow run ${runId}: failed to interrupt ${reason} session ${sessionId}: ${describeError(error)}`,
            ),
          );
      };

      const settleOnce = (result: StepResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        this.activeStepAborts.delete(runId);
        resolve(result);
      };

      // Lets abort() end this step immediately instead of waiting for the
      // timeout — same reasoning as /api/chat/interrupt: a dropped connection
      // leaves the turn running server-side, so it has to be told to stop.
      this.activeStepAborts.set(runId, () => {
        interruptSession('an aborted');
        settleOnce({ status: 'failed', output, error: null });
      });

      const timer = setTimeout(() => {
        interruptSession('a timed-out');
        settleOnce({
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
          const payload = event.payload ?? {};
          const status = payload.status;
          const finalText = typeof payload.text === 'string' ? payload.text : output;
          if (status === 'error' || status === 'interrupted') {
            const error =
              typeof payload.error === 'string' && payload.error
                ? payload.error
                : finalText || 'Hermes reported an error without a message.';
            settleOnce({ status: 'failed', output, error });
            return;
          }
          settleOnce({ status: 'succeeded', output: finalText, error: null });
        }
      });

      gateway
        .request('prompt.submit', { session_id: sessionId, text: prompt.body })
        .catch((error: unknown) =>
          settleOnce({ status: 'failed', output, error: describeError(error) }),
        );
    });
  }
}
