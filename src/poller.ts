import type { AppContext } from './context.js';
import { describeError, log } from './log.js';

export interface PollTask {
  name: string;
  intervalMs: number;
  /** Keep polling even when no browser is connected. */
  always?: boolean;
  run: (ctx: AppContext) => Promise<void>;
}

/** Backoff ceiling after repeated upstream failures. */
const MAX_BACKOFF_MULTIPLIER = 8;

/**
 * Hermes offers no outbound events, so freshness comes from polling. Two rules
 * keep that cheap: nothing polls while no browser is connected, and a failing
 * task backs off exponentially instead of hammering a dead upstream.
 */
export class Poller {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly failures = new Map<string, number>();
  private running = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly tasks: readonly PollTask[],
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const task of this.tasks) this.schedule(task, 0);
    log.debug(`Poller started with ${this.tasks.length} task(s)`);
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(task: PollTask, delayMs: number): void {
    if (!this.running) return;

    const timer = setTimeout(() => {
      void this.execute(task);
    }, delayMs);
    // Never hold the process open just to poll.
    timer.unref?.();
    this.timers.set(task.name, timer);
  }

  private async execute(task: PollTask): Promise<void> {
    if (!this.running) return;

    // Idle when nobody is watching; upstream data is fetched on demand anyway.
    if (!task.always && this.ctx.bus.subscriberCount === 0) {
      this.schedule(task, task.intervalMs);
      return;
    }

    try {
      await task.run(this.ctx);
      this.failures.delete(task.name);
      this.schedule(task, task.intervalMs);
    } catch (error) {
      const failures = (this.failures.get(task.name) ?? 0) + 1;
      this.failures.set(task.name, failures);
      const multiplier = Math.min(2 ** (failures - 1), MAX_BACKOFF_MULTIPLIER);

      // Only the first failure is noisy; an offline Hermes is a normal state.
      if (failures === 1) {
        log.debug(`Poll task "${task.name}" failed: ${describeError(error)}`);
      }
      this.schedule(task, task.intervalMs * multiplier);
    }
  }
}

/**
 * M1 baseline: one status round trip that also feeds the metrics ring buffer.
 * Later milestones add slower tasks (jobs, inventory, analytics).
 */
export function defaultPollTasks(): PollTask[] {
  return [
    {
      name: 'status',
      intervalMs: 3000,
      run: async (ctx) => {
        await ctx.refreshStatus();
      },
    },
  ];
}
