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
    expect(run.steps[0]).toMatchObject({
      kind: 'cron',
      ref: 'job-1',
      status: 'pending',
      output: '',
    });
    expect(run.finishedAt).toBeNull();
  });

  it('updates a single step by id without touching the others', () => {
    const workflow = workflows.create({ name: 'W', steps: [{ kind: 'note', label: 'A' }] });
    const run = runs.create(workflow.id, 'manual', 'chain', workflow.steps);
    const stepId = run.steps[0]!.id;

    runs.updateStep(run.id, stepId, { status: 'succeeded', output: 'ok', finishedAt: 123 });

    const reloaded = runs.get(run.id);
    expect(reloaded?.steps[0]).toMatchObject({
      status: 'succeeded',
      output: 'ok',
      finishedAt: 123,
    });
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

  it('marks a running step as failed and a never-started step as skipped', () => {
    const workflow = workflows.create({
      name: 'W',
      steps: [
        { kind: 'cron', ref: 'job-1', label: 'A' },
        { kind: 'cron', ref: 'job-2', label: 'B' },
      ],
    });
    const run = runs.create(workflow.id, 'manual', 'chain', workflow.steps);
    runs.updateStep(run.id, run.steps[0]!.id, { status: 'running', startedAt: 1 });
    // run.steps[1] is left at its default 'pending' status — it never got a
    // chance to start before the server restarted.

    runs.reconcileInterrupted(500);

    const reloaded = runs.get(run.id);
    expect(reloaded?.status).toBe('failed');
    expect(reloaded?.finishedAt).toBe(500);
    expect(reloaded?.steps[0]).toMatchObject({
      status: 'failed',
      error: 'Interrupted by a server restart.',
    });
    expect(reloaded?.steps[1]).toMatchObject({
      status: 'skipped',
      error: null,
    });
  });

  it('leaves already-terminal runs untouched', () => {
    const workflow = workflows.create({ name: 'W', steps: [{ kind: 'note', label: 'A' }] });
    const run = runs.create(workflow.id, 'manual', 'chain', workflow.steps);
    runs.finish(run.id, 'completed', 100);

    runs.reconcileInterrupted(999);

    expect(runs.get(run.id)).toMatchObject({ status: 'completed', finishedAt: 100 });
  });
});
