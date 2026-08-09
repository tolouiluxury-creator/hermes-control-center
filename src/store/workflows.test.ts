import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from './db.js';
import { WorkflowsRepo } from './workflows.js';

let store: Store;
let repo: WorkflowsRepo;

beforeEach(() => {
  store = Store.open(':memory:');
  repo = new WorkflowsRepo(store);
});

afterEach(() => {
  store.close();
});

describe('WorkflowsRepo', () => {
  it('creates a workflow with ordered steps and drops empty ones', () => {
    const workflow = repo.create({
      name: 'Morgenlauf',
      steps: [
        { kind: 'cron', ref: 'job-1', label: 'Bericht' },
        { kind: 'note', label: '   ' }, // dropped: empty label
        { kind: 'prompt', ref: 'p-1', label: 'Zusammenfassung' },
      ],
    });

    expect(workflow.steps.map((s) => s.label)).toEqual(['Bericht', 'Zusammenfassung']);
    expect(workflow.steps[0]?.kind).toBe('cron');
    expect(workflow.enabled).toBe(true);
  });

  it('replaces steps wholesale on update, preserving order', () => {
    const created = repo.create({ name: 'W', steps: [{ kind: 'note', label: 'A' }] });
    const updated = repo.update(created.id, {
      name: 'W',
      steps: [
        { kind: 'note', label: 'B' },
        { kind: 'note', label: 'C' },
      ],
    });
    expect(updated?.steps.map((s) => s.label)).toEqual(['B', 'C']);
  });

  it('toggles enabled and cascades step deletion on delete', () => {
    const created = repo.create({ name: 'W', steps: [{ kind: 'note', label: 'A' }] });
    expect(repo.setEnabled(created.id, false)?.enabled).toBe(false);

    expect(repo.delete(created.id)).toBe(true);
    expect(
      store.all('SELECT * FROM workflow_steps WHERE workflow_id = ?', created.id),
    ).toHaveLength(0);
    expect(repo.delete(created.id)).toBe(false);
  });
});

describe('WorkflowsRepo scheduling', () => {
  it('computes next_run_at on create, and leaves it null when unscheduled', () => {
    const now = Date.now();
    const scheduled = repo.create(
      { name: 'W', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 30m' },
      now,
    );
    expect(scheduled.schedule).toBe('every 30m');
    expect(scheduled.nextRunAt).toBe(now + 30 * 60_000);

    const unscheduled = repo.create({ name: 'W2', steps: [{ kind: 'note', label: 'A' }] });
    expect(unscheduled.schedule).toBeNull();
    expect(unscheduled.nextRunAt).toBeNull();
  });

  it('keeps the existing next_run_at on update when the schedule text is unchanged', () => {
    const now = Date.now();
    const created = repo.create(
      { name: 'W', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 1h' },
      now,
    );
    const later = now + 999_999;
    const updated = repo.update(
      created.id,
      { name: 'W renamed', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 1h' },
      later,
    );
    expect(updated?.nextRunAt).toBe(created.nextRunAt);
  });

  it('recomputes next_run_at on update when the schedule text changes', () => {
    const now = Date.now();
    const created = repo.create(
      { name: 'W', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 1h' },
      now,
    );
    const later = now + 1000;
    const updated = repo.update(
      created.id,
      { name: 'W', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 30m' },
      later,
    );
    expect(updated?.nextRunAt).toBe(later + 30 * 60_000);
  });

  it('clears schedule and next_run_at when a schedule is removed on update', () => {
    const created = repo.create({
      name: 'W',
      steps: [{ kind: 'note', label: 'A' }],
      schedule: 'every 1h',
    });
    const updated = repo.update(created.id, {
      name: 'W',
      steps: [{ kind: 'note', label: 'A' }],
      schedule: null,
    });
    expect(updated?.schedule).toBeNull();
    expect(updated?.nextRunAt).toBeNull();
  });

  it('dueForSchedule only returns enabled workflows with a concrete, due next_run_at', () => {
    const now = Date.now();
    const due = repo.create(
      { name: 'Due', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 1h' },
      now - 3_600_000, // created an hour ago, so its next_run_at is already due
    );
    repo.create(
      { name: 'Not yet', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 1h' },
      now,
    );
    const disabled = repo.create(
      { name: 'Disabled', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 1h' },
      now - 3_600_000,
    );
    repo.setEnabled(disabled.id, false);
    repo.create({ name: 'Unscheduled', steps: [{ kind: 'note', label: 'A' }] });

    const result = repo.dueForSchedule(now);
    expect(result.map((w) => w.id)).toEqual([due.id]);
  });

  it('rescheduleAfterFire recomputes a recurring schedule and retires a one-off', () => {
    const now = Date.now();
    const recurring = repo.create(
      { name: 'Recurring', steps: [{ kind: 'note', label: 'A' }], schedule: 'every 30m' },
      now,
    );
    repo.rescheduleAfterFire(recurring.id, now + 30 * 60_000);
    expect(repo.get(recurring.id)?.nextRunAt).toBe(now + 60 * 60_000);
    expect(repo.get(recurring.id)?.schedule).toBe('every 30m');

    const oneOff = repo.create(
      { name: 'OneOff', steps: [{ kind: 'note', label: 'A' }], schedule: '30m' },
      now,
    );
    repo.rescheduleAfterFire(oneOff.id, now + 30 * 60_000);
    expect(repo.get(oneOff.id)?.schedule).toBeNull();
    expect(repo.get(oneOff.id)?.nextRunAt).toBeNull();
  });
});
