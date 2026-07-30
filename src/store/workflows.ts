import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';

/**
 * Workflows: named, ordered chains of steps that the control center stores on
 * the user's behalf. Hermes has no workflow concept, so — like the prompt
 * library — they live in our database.
 *
 * A step references either a library prompt or a Hermes cron job, or is a plain
 * note. Executing a chain needs the Hermes API server (for runs); until that is
 * enabled, workflows can be built and managed but not run — the UI says so
 * rather than pretending a run happened.
 */

export type WorkflowStepKind = 'prompt' | 'cron' | 'note';

export interface WorkflowStep {
  id: string;
  kind: WorkflowStepKind;
  /** A prompt id or a cron job id; null for a note. */
  ref: string | null;
  label: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStepInput {
  kind: WorkflowStepKind;
  ref?: string | null;
  label: string;
}

export interface WorkflowInput {
  name: string;
  description?: string;
  enabled?: boolean;
  steps?: WorkflowStepInput[];
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

interface StepRow {
  id: string;
  workflow_id: string;
  position: number;
  kind: string;
  config: string;
}

const STEP_KINDS = new Set<WorkflowStepKind>(['prompt', 'cron', 'note']);

function toStep(row: StepRow): WorkflowStep {
  let ref: string | null = null;
  let label = '';
  try {
    const config = JSON.parse(row.config) as { ref?: unknown; label?: unknown };
    ref = typeof config.ref === 'string' ? config.ref : null;
    label = typeof config.label === 'string' ? config.label : '';
  } catch {
    // A corrupt config becomes an empty note rather than a thrown error.
  }
  const kind = STEP_KINDS.has(row.kind as WorkflowStepKind)
    ? (row.kind as WorkflowStepKind)
    : 'note';
  return { id: row.id, kind, ref, label };
}

function normalizeSteps(steps: readonly WorkflowStepInput[] | undefined): WorkflowStepInput[] {
  return (steps ?? [])
    .filter((step) => STEP_KINDS.has(step.kind) && step.label.trim() !== '')
    .map((step) => ({
      kind: step.kind,
      ref: step.kind === 'note' ? null : (step.ref?.trim() ?? null) || null,
      label: step.label.trim(),
    }));
}

export class WorkflowsRepo {
  constructor(private readonly store: Store) {}

  private steps(workflowId: string): WorkflowStep[] {
    return this.store
      .all<StepRow>(
        'SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY position ASC',
        workflowId,
      )
      .map(toStep);
  }

  private toWorkflow(row: WorkflowRow): Workflow {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: row.enabled !== 0,
      steps: this.steps(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(): Workflow[] {
    return this.store
      .all<WorkflowRow>('SELECT * FROM workflows ORDER BY updated_at DESC')
      .map((row) => this.toWorkflow(row));
  }

  get(id: string): Workflow | null {
    const row = this.store.get<WorkflowRow>('SELECT * FROM workflows WHERE id = ?', id);
    return row ? this.toWorkflow(row) : null;
  }

  private writeSteps(workflowId: string, steps: WorkflowStepInput[]): void {
    steps.forEach((step, position) => {
      this.store.run(
        'INSERT INTO workflow_steps (id, workflow_id, position, kind, config) VALUES (?, ?, ?, ?, ?)',
        randomUUID(),
        workflowId,
        position,
        step.kind,
        JSON.stringify({ ref: step.ref ?? null, label: step.label }),
      );
    });
  }

  create(input: WorkflowInput, now = Date.now()): Workflow {
    const id = randomUUID();
    const steps = normalizeSteps(input.steps);

    this.store.transaction(() => {
      this.store.run(
        `INSERT INTO workflows (id, name, description, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        input.name.trim(),
        input.description?.trim() ?? '',
        input.enabled === false ? 0 : 1,
        now,
        now,
      );
      this.writeSteps(id, steps);
    });

    return this.get(id) as Workflow;
  }

  update(id: string, input: WorkflowInput, now = Date.now()): Workflow | null {
    if (!this.get(id)) return null;
    const steps = normalizeSteps(input.steps);

    this.store.transaction(() => {
      this.store.run(
        'UPDATE workflows SET name = ?, description = ?, enabled = ?, updated_at = ? WHERE id = ?',
        input.name.trim(),
        input.description?.trim() ?? '',
        input.enabled === false ? 0 : 1,
        now,
        id,
      );
      // Steps are replaced wholesale: simpler and race-free versus diffing.
      this.store.run('DELETE FROM workflow_steps WHERE workflow_id = ?', id);
      this.writeSteps(id, steps);
    });

    return this.get(id);
  }

  setEnabled(id: string, enabled: boolean, now = Date.now()): Workflow | null {
    if (!this.get(id)) return null;
    this.store.run(
      'UPDATE workflows SET enabled = ?, updated_at = ? WHERE id = ?',
      enabled ? 1 : 0,
      now,
      id,
    );
    return this.get(id);
  }

  delete(id: string): boolean {
    if (!this.get(id)) return false;
    // workflow_steps and workflow_runs cascade on delete (see the schema).
    this.store.run('DELETE FROM workflows WHERE id = ?', id);
    return true;
  }
}
