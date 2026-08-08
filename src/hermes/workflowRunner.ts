import { describeError, log } from '../log.js';
import type { WorkflowsRepo } from '../store/workflows.js';
import type {
  WorkflowRunsRepo,
  WorkflowRunStep,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
} from '../store/workflowRuns.js';
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
  constructor(
    message: string,
    readonly code:
      | 'workflow_not_found'
      | 'workflow_disabled'
      | 'no_steps'
      | 'prompt_unsupported'
      | 'run_in_progress',
  ) {
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
    if (workflow.steps.some((step) => step.kind === 'prompt')) {
      throw new WorkflowRunnerValidationError(
        'Prompt steps aren’t runnable yet — support is coming in a future update.',
        'prompt_unsupported',
      );
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
      const result = await this.runStep(step);
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

  private async runStep(step: WorkflowRunStep): Promise<StepResult> {
    switch (step.kind) {
      case 'note':
        return { status: 'succeeded', output: '', error: null };
      case 'cron':
        return this.runCronStep(step);
      case 'prompt':
        return {
          status: 'failed',
          output: '',
          error: 'Prompt steps aren’t runnable yet — support is coming in a future update.',
        };
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
}
