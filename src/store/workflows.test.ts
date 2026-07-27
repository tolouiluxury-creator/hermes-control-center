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
