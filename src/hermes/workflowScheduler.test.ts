import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../store/db.js';
import { WorkflowsRepo } from '../store/workflows.js';
import { WorkflowRunsRepo } from '../store/workflowRuns.js';
import type { CronExecutor, PromptExecutor, PromptLookup } from './workflowRunner.js';
import { WorkflowRunner } from './workflowRunner.js';
import { WorkflowScheduler } from './workflowScheduler.js';

let store: Store;
let workflows: WorkflowsRepo;
let runs: WorkflowRunsRepo;
let runner: WorkflowRunner;

const noPrompts: PromptLookup = { get: () => null };
const dashboard: CronExecutor = { cronJobs: vi.fn(), cronAction: vi.fn() };
const gateway: PromptExecutor = { request: vi.fn().mockResolvedValue({}), onEvent: () => () => {} };

beforeEach(() => {
  store = Store.open(':memory:');
  workflows = new WorkflowsRepo(store);
  runs = new WorkflowRunsRepo(store);
  runner = new WorkflowRunner({ dashboard, workflows, runs, gateway, prompts: noPrompts });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  store.close();
});

describe('WorkflowScheduler', () => {
  it('starts a run for a due, enabled, scheduled workflow and reschedules a recurring one', async () => {
    const now = Date.now();
    const workflow = workflows.create(
      { name: 'Due', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 30m' },
      now - 30 * 60_000 - 1, // created 30m+1ms ago, so its next_run_at is already due
    );
    const scheduler = new WorkflowScheduler({ workflows, runner, tickIntervalMs: 10 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);
    scheduler.stop();

    const runsForWorkflow = runs.listByWorkflow(workflow.id);
    expect(runsForWorkflow).toHaveLength(1);
    expect(runsForWorkflow[0]).toMatchObject({ trigger: 'scheduled', mode: 'chain' });

    // Rescheduled for another 30 minutes out from when it fired, not from
    // when it was originally due.
    const after = workflows.get(workflow.id);
    expect(after?.nextRunAt).toBeGreaterThan(now);
    expect(after?.schedule).toBe('every 30m');
  });

  it('ignores a disabled workflow even if its schedule is due', async () => {
    const now = Date.now();
    const workflow = workflows.create(
      { name: 'Disabled', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 30m' },
      now - 30 * 60_000 - 1,
    );
    workflows.setEnabled(workflow.id, false);
    const scheduler = new WorkflowScheduler({ workflows, runner, tickIntervalMs: 10 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);
    scheduler.stop();

    expect(runs.listByWorkflow(workflow.id)).toHaveLength(0);
  });

  it('skips a tick without error when the workflow already has an active run', async () => {
    const now = Date.now();
    // A cron step that never resolves its poll keeps the run "active" across
    // the second tick, without needing real timers.
    const stuckDashboard: CronExecutor = {
      cronJobs: vi.fn(() => new Promise(() => {})),
      cronAction: vi.fn().mockResolvedValue({ ok: true }),
    };
    const stuckRunner = new WorkflowRunner({
      dashboard: stuckDashboard,
      workflows,
      runs,
      gateway,
      prompts: noPrompts,
    });
    const workflow = workflows.create(
      {
        name: 'Slow',
        steps: [{ kind: 'cron', ref: 'job-1', label: 'Report' }],
        schedule: 'every 1m',
      },
      now - 60_000 - 1,
    );
    const scheduler = new WorkflowScheduler({
      workflows,
      runner: stuckRunner,
      tickIntervalMs: 10,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10); // first tick: starts the run, it gets stuck polling
    // Force next_run_at due again immediately, simulating the tick landing
    // while the first run is still active.
    workflows.rescheduleAfterFire(workflow.id, now - 60_000 - 1);
    await vi.advanceTimersByTimeAsync(10); // second tick: must skip, not throw or double-start
    scheduler.stop();

    expect(runs.listByWorkflow(workflow.id)).toHaveLength(1);
  });

  it('retires a one-off schedule after it fires, so it is never picked up again', async () => {
    const now = Date.now();
    const workflow = workflows.create(
      { name: 'OneOff', steps: [{ kind: 'note', label: 'A' }], schedule: '1m' },
      now - 2 * 60_000, // already due
    );
    const scheduler = new WorkflowScheduler({ workflows, runner, tickIntervalMs: 10 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);
    scheduler.stop();

    expect(runs.listByWorkflow(workflow.id)).toHaveLength(1);
    const after = workflows.get(workflow.id);
    expect(after?.schedule).toBeNull();
    expect(after?.nextRunAt).toBeNull();
  });
});
