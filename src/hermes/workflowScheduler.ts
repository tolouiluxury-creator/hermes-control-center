import { describeError, log } from '../log.js';
import type { WorkflowsRepo } from '../store/workflows.js';
import { WorkflowRunnerValidationError } from './workflowRunner.js';
import type { WorkflowRunner } from './workflowRunner.js';

const DEFAULT_TICK_MS = 30_000;

export interface WorkflowSchedulerOptions {
  workflows: WorkflowsRepo;
  runner: WorkflowRunner;
  tickIntervalMs?: number;
}

/**
 * Polls for workflows whose `next_run_at` is due and starts them unattended.
 * The least supervised, highest-blast-radius piece of workflow execution —
 * deliberately the last stage built (see the design spec's rollout order) —
 * so it stays a thin loop over already-hardened pieces: `WorkflowsRepo`
 * decides what's due and computes the next due time, `WorkflowRunner`
 * decides how a run behaves once started (a `'scheduled'` trigger fails
 * immediately instead of pausing, and sends a Telegram notice — see
 * `workflowRunner.ts`). This class only ties the two together on a timer.
 */
export class WorkflowScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: WorkflowSchedulerOptions) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.options.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const { workflows, runner } = this.options;
    const now = Date.now();
    for (const workflow of workflows.dueForSchedule(now)) {
      try {
        runner.start(workflow.id, 'chain', 'scheduled');
      } catch (error) {
        // `run_in_progress` means a manual run is already active for this
        // workflow — the spec's own answer is to just skip the tick, not
        // retry or warn; anything else (workflow disabled/deleted between
        // the query and here) is equally fine to skip silently.
        if (!(error instanceof WorkflowRunnerValidationError) || error.code !== 'run_in_progress') {
          log.warn(`workflow scheduler: could not start ${workflow.id}: ${describeError(error)}`);
        }
        continue;
      }
      // Recomputed right after starting, not after the run finishes — a
      // long-running scheduled workflow must not delay its own next
      // occurrence, and a still-active run is already covered by the
      // run_in_progress skip above if the next tick lands before it's done.
      workflows.rescheduleAfterFire(workflow.id, now);
    }
  }
}
