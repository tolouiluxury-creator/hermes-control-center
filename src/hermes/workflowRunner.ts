import { describeError, log } from '../log.js';
import type { WorkflowsRepo } from '../store/workflows.js';
import type {
  WorkflowRunsRepo,
  WorkflowRunStep,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
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
    readonly code: 'workflow_not_found' | 'workflow_disabled' | 'no_steps' | 'run_in_progress',
  ) {
    super(message);
    this.name = 'WorkflowRunnerValidationError';
  }
}

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

  constructor(private readonly options: WorkflowRunnerOptions) {}

  onEvent(listener: WorkflowRunnerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(event: WorkflowRunnerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Validates synchronously, then runs the chain in the background. */
  start(workflowId: string): { runId: string } {
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

    const run = runs.create(workflowId, 'manual', 'chain', workflow.steps);
    this.publish({ type: 'run.started', runId: run.id, workflowId });
    this.active.add(workflowId);
    void this.execute(workflowId, run.id)
      .catch((error: unknown) =>
        log.warn(`workflow run ${run.id} crashed: ${describeError(error)}`),
      )
      .finally(() => this.active.delete(workflowId));
    return { runId: run.id };
  }

  private async execute(workflowId: string, runId: string): Promise<void> {
    const { runs, workflows } = this.options;
    const run = runs.get(runId);
    if (!run) return;

    for (const step of run.steps) {
      if (!workflows.get(workflowId)) {
        log.debug(`workflow run ${runId}: workflow ${workflowId} was deleted mid-run, stopping`);
        return;
      }
      runs.updateStep(runId, step.id, { status: 'running', startedAt: Date.now() });
      this.publish({ type: 'step.started', runId, stepId: step.id });
      const result = await this.runStep(runId, step);
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
      if (result.status === 'failed') {
        runs.finish(runId, 'failed');
        this.publish({ type: 'run.finished', runId, status: 'failed' });
        runs.prune(workflowId);
        return;
      }
    }
    runs.finish(runId, 'completed');
    this.publish({ type: 'run.finished', runId, status: 'completed' });
    runs.prune(workflowId);
  }

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

      gateway
        .request('prompt.submit', { session_id: sessionId, text: prompt.body })
        .catch((error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          resolve({ status: 'failed', output, error: describeError(error) });
        });
    });
  }
}
