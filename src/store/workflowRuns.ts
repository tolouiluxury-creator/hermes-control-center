import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';
import type { WorkflowStep, WorkflowStepKind } from './workflows.js';

/**
 * Run history for workflows, stored in `workflow_runs` — a table the very
 * first schema migration already created but nothing ever populated. Reused
 * as-is: `status` stays a plain queryable column, everything else (which
 * trigger started it, which mode, and the per-step outcomes) lives as JSON in
 * `detail`, the same pattern `workflow_steps.config` already uses.
 */

export type WorkflowRunTrigger = 'manual' | 'scheduled';
export type WorkflowRunMode = 'chain' | 'single_step';
export type WorkflowRunStatus = 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'stopped';
export type WorkflowRunStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface WorkflowRunStep {
  id: string;
  kind: WorkflowStepKind;
  ref: string | null;
  label: string;
  status: WorkflowRunStepStatus;
  output: string;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  trigger: WorkflowRunTrigger;
  mode: WorkflowRunMode;
  steps: WorkflowRunStep[];
  startedAt: number;
  finishedAt: number | null;
}

interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  detail: string;
}

interface RunDetail {
  trigger: WorkflowRunTrigger;
  mode: WorkflowRunMode;
  steps: WorkflowRunStep[];
}

const MAX_RUNS_PER_WORKFLOW = 5;

function toRun(row: WorkflowRunRow): WorkflowRun {
  const detail = JSON.parse(row.detail) as RunDetail;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as WorkflowRunStatus,
    trigger: detail.trigger,
    mode: detail.mode,
    steps: detail.steps,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export class WorkflowRunsRepo {
  constructor(private readonly store: Store) {}

  get(id: string): WorkflowRun | null {
    const row = this.store.get<WorkflowRunRow>('SELECT * FROM workflow_runs WHERE id = ?', id);
    return row ? toRun(row) : null;
  }

  listByWorkflow(workflowId: string, limit = MAX_RUNS_PER_WORKFLOW): WorkflowRun[] {
    return this.store
      .all<WorkflowRunRow>(
        'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?',
        workflowId,
        limit,
      )
      .map(toRun);
  }

  /** True while this workflow has a run that hasn't reached a terminal state. */
  hasActiveRun(workflowId: string): boolean {
    const row = this.store.get<{ id: string }>(
      `SELECT id FROM workflow_runs
       WHERE workflow_id = ? AND status IN ('running', 'waiting_for_user') LIMIT 1`,
      workflowId,
    );
    return row !== undefined;
  }

  create(
    workflowId: string,
    trigger: WorkflowRunTrigger,
    mode: WorkflowRunMode,
    steps: readonly WorkflowStep[],
    now = Date.now(),
  ): WorkflowRun {
    const id = randomUUID();
    const detail: RunDetail = {
      trigger,
      mode,
      steps: steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        ref: step.ref,
        label: step.label,
        status: 'pending',
        output: '',
        error: null,
        startedAt: null,
        finishedAt: null,
      })),
    };
    this.store.run(
      'INSERT INTO workflow_runs (id, workflow_id, status, started_at, finished_at, detail) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      workflowId,
      'running',
      now,
      null,
      JSON.stringify(detail),
    );
    return this.get(id) as WorkflowRun;
  }

  /** Patches one step by id inside a run's JSON detail. No-ops on an unknown run or step. */
  updateStep(runId: string, stepId: string, patch: Partial<WorkflowRunStep>): void {
    const row = this.store.get<WorkflowRunRow>('SELECT * FROM workflow_runs WHERE id = ?', runId);
    if (!row) return;
    const detail = JSON.parse(row.detail) as RunDetail;
    const index = detail.steps.findIndex((step) => step.id === stepId);
    if (index === -1) return;
    detail.steps[index] = { ...detail.steps[index]!, ...patch };
    this.store.run(
      'UPDATE workflow_runs SET detail = ? WHERE id = ?',
      JSON.stringify(detail),
      runId,
    );
  }

  finish(runId: string, status: WorkflowRunStatus, now = Date.now()): void {
    this.store.run(
      'UPDATE workflow_runs SET status = ?, finished_at = ? WHERE id = ?',
      status,
      now,
      runId,
    );
  }

  /** Keeps only the most recent `MAX_RUNS_PER_WORKFLOW` runs for a workflow. */
  prune(workflowId: string): void {
    this.store.run(
      `DELETE FROM workflow_runs
       WHERE workflow_id = ?
         AND id NOT IN (
           SELECT id FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?
         )`,
      workflowId,
      workflowId,
      MAX_RUNS_PER_WORKFLOW,
    );
  }

  /**
   * Marks any run left `running`/`waiting_for_user` from before a restart as
   * `failed`, and every one of its still-open steps too — a run that can no
   * longer be observed must not be shown as still in progress. Call once at
   * startup, before the scheduler or any request can start a new run.
   */
  reconcileInterrupted(now = Date.now()): void {
    const stale = this.store.all<WorkflowRunRow>(
      `SELECT * FROM workflow_runs WHERE status IN ('running', 'waiting_for_user')`,
    );
    for (const row of stale) {
      const detail = JSON.parse(row.detail) as RunDetail;
      detail.steps = detail.steps.map((step) =>
        step.status === 'pending' || step.status === 'running'
          ? {
              ...step,
              status: 'failed' as const,
              error: 'Interrupted by a server restart.',
              finishedAt: now,
            }
          : step,
      );
      this.store.run(
        'UPDATE workflow_runs SET status = ?, finished_at = ?, detail = ? WHERE id = ?',
        'failed',
        now,
        JSON.stringify(detail),
        row.id,
      );
    }
  }
}
