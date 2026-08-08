import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../store/db.js';
import { WorkflowsRepo } from '../store/workflows.js';
import { WorkflowRunsRepo } from '../store/workflowRuns.js';
import type { CronJobSummary } from './inventory.js';
import {
  WorkflowRunner,
  WorkflowRunnerValidationError,
  type CronExecutor,
} from './workflowRunner.js';

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

  it('stops before the next step and does not trigger it when the workflow is deleted mid-run', async () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [
        { kind: 'cron', ref: 'job-1', label: 'First' },
        { kind: 'cron', ref: 'job-2', label: 'Second' },
      ],
    });

    const before1 = cronJob({ id: 'job-1', lastRun: 1000 });
    const after1 = cronJob({ id: 'job-1', lastRun: 2000, lastStatus: 'ok' });
    const cronJobsMock = vi
      .fn()
      .mockResolvedValueOnce([before1]) // step 1: read before triggering
      .mockImplementationOnce(async () => {
        // Step 1's poll just saw the job finish (lastRun changed). Delete the
        // workflow at exactly this moment, before the runner's loop gets a
        // chance to start step 2 — this is the scenario the mid-run guard in
        // execute() exists for.
        workflows.delete(workflow.id);
        return [after1];
      });
    const cronAction = vi.fn().mockResolvedValue({ ok: true });
    const dashboard: CronExecutor = { cronJobs: cronJobsMock, cronAction };
    const runner = new WorkflowRunner({
      dashboard,
      workflows,
      runs,
      pollIntervalMs: 10,
      pollTimeoutMs: 1000,
    });

    runner.start(workflow.id);
    await flushPolls(5);

    expect(cronAction).toHaveBeenCalledTimes(1);
    expect(cronAction).toHaveBeenCalledWith('job-1', 'trigger', 'sunrise');
    // Without the mid-run deletion guard, execute() would proceed to step 2 and
    // call cronJobs() a third time (to read job-2's "before" state), which would
    // return undefined (only two resolved values are queued above) and throw
    // inside .find() — failing step 2 without ever reaching cronAction, but only
    // this call-count assertion actually catches that the guard ran.
    expect(cronJobsMock).toHaveBeenCalledTimes(2);
  });
});
