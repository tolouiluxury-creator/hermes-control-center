import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  History,
  ListChecks,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  StepForward,
  StickyNote,
  Trash2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import {
  abortWorkflowRun,
  advanceWorkflowRun,
  ApiError,
  createWorkflow,
  deleteWorkflow,
  getCronJobs,
  getPrompts,
  getWorkflowRuns,
  getWorkflows,
  queryKeys,
  resolveWorkflowRun,
  setWorkflowEnabled,
  startWorkflowRun,
  updateWorkflow,
} from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { ScheduleField } from '@/components/ScheduleField';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { buildSchedule, parseSchedule } from '@/lib/schedule';
import { describeCron } from '@/widgets/SchedulerWidget';
import type {
  Workflow,
  WorkflowInput,
  WorkflowRunMode,
  WorkflowRunStatus,
  WorkflowRunStep,
  WorkflowRunStepStatus,
  WorkflowStepInput,
  WorkflowStepKind,
} from '@/lib/hermesTypes';

const STEP_META: Record<
  WorkflowStepKind,
  { labelKey: string; icon: typeof StickyNote; color: string }
> = {
  prompt: { labelKey: 'workflows.step.prompt', icon: ListChecks, color: 'var(--color-accent)' },
  cron: { labelKey: 'workflows.step.cron', icon: WorkflowIcon, color: 'var(--color-ok)' },
  note: { labelKey: 'workflows.step.note', icon: StickyNote, color: 'var(--color-ink-faint)' },
};

const STATUS_DOT: Record<WorkflowRunStatus, string> = {
  running: 'var(--color-accent)',
  waiting_for_user: 'var(--color-warn)',
  completed: 'var(--color-ok)',
  failed: 'var(--color-danger)',
  stopped: 'var(--color-ink-faint)',
};

interface LiveStep {
  status: WorkflowRunStepStatus;
  output: string;
  error: string | null;
}

interface LiveRun {
  workflowId: string;
  runId: string;
  mode: WorkflowRunMode;
  status: WorkflowRunStatus;
  steps: Record<string, LiveStep>;
}

/** The per-step list rendering, shared between the live panel and a frozen history entry. */
function RunStepsList({
  steps,
}: {
  steps: Pick<WorkflowRunStep, 'id' | 'kind' | 'label' | 'status' | 'output' | 'error'>[];
}) {
  const { t } = useI18n();
  return (
    <ol className="mt-2 space-y-1">
      {steps.map((step) => (
        <li key={step.id} className="text-xs">
          <div className="flex items-center gap-1.5">
            {step.status === 'running' && (
              <Loader2 size={11} className="animate-spin text-[var(--color-accent)]" aria-hidden />
            )}
            <span className="text-[var(--color-ink-muted)]">
              {t(`workflowRuns.stepStatus.${step.status}`)}
            </span>
            <span>{step.label}</span>
          </div>
          {step.status === 'running' && step.kind === 'cron' && (
            <p className="mt-0.5 text-[0.65rem] text-[var(--color-ink-faint)]">
              {t('workflowRuns.cronRunningHint')}
            </p>
          )}
          {step.status === 'running' && step.kind === 'prompt' && (
            <p className="mt-0.5 whitespace-pre-wrap text-[var(--color-ink-muted)]">
              {step.output || t('workflowRuns.promptRunningHint')}
            </p>
          )}
          {step.kind === 'prompt' && step.status === 'succeeded' && step.output && (
            <p className="mt-0.5 whitespace-pre-wrap text-[var(--color-ink-muted)]">
              {step.output}
            </p>
          )}
          {step.status === 'failed' && step.error && (
            <p className="mt-0.5 text-[var(--color-danger)]">{step.error}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

function WorkflowEditor({
  workflow,
  onCancel,
  onSave,
  saving,
}: {
  workflow: Workflow | null;
  onCancel: () => void;
  onSave: (input: WorkflowInput) => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(workflow?.name ?? '');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [steps, setSteps] = useState<WorkflowStepInput[]>(
    workflow?.steps.map((s) => ({ kind: s.kind, ref: s.ref, label: s.label })) ?? [],
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(workflow?.schedule != null);
  const [scheduleDraft, setScheduleDraft] = useState(() =>
    parseSchedule(workflow?.schedule ?? null),
  );

  const prompts = useQuery({ queryKey: queryKeys.prompts, queryFn: getPrompts, staleTime: 60_000 });
  const cron = useQuery({ queryKey: queryKeys.cron, queryFn: getCronJobs, staleTime: 60_000 });

  const field =
    'w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]';

  const addStep = (kind: WorkflowStepKind) =>
    setSteps((current) => [...current, { kind, ref: null, label: '' }]);

  const patchStep = (index: number, patch: Partial<WorkflowStepInput>) =>
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const removeStep = (index: number) =>
    setSteps((current) => current.filter((_, i) => i !== index));

  const move = (index: number, delta: number) =>
    setSteps((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  /*
   * A prompt or cron step with nothing chosen has an empty label, and the store
   * drops those on write. Filtering them away here would mean saving four steps
   * and getting three back with a success toast, so saving waits instead.
   */
  const incomplete = steps.some((step) => step.label.trim() === '');
  const scheduleExpression = scheduleEnabled ? buildSchedule(scheduleDraft) : null;
  const scheduleBlocksSave = scheduleEnabled && scheduleExpression === null;
  const canSave = name.trim() !== '' && !incomplete && !scheduleBlocksSave && !saving;

  return (
    <form
      className="card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        onSave({
          name,
          description,
          enabled: workflow?.enabled ?? true,
          steps,
          schedule: scheduleEnabled ? scheduleExpression : null,
        });
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {workflow ? t('workflows.editTitle') : t('workflows.newTitle')}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
          aria-label={t('common.cancel')}
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <label className="mt-3 block text-xs text-[var(--color-ink-faint)]">
        {t('workflows.name')}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          autoFocus
          className={`mt-1 ${field}`}
        />
      </label>

      <label className="mt-3 block text-xs text-[var(--color-ink-faint)]">
        {t('workflows.description')}
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          className={`mt-1 ${field}`}
        />
      </label>

      <div className="mt-4">
        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={(e) => setScheduleEnabled(e.target.checked)}
          />
          {t('workflows.scheduleEnable')}
        </label>
        {scheduleEnabled && (
          <div className="mt-2">
            <ScheduleField draft={scheduleDraft} onChange={setScheduleDraft} />
          </div>
        )}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs text-[var(--color-ink-faint)]">{t('workflows.steps')}</p>
        <ol className="space-y-2">
          {steps.map((step, index) => {
            const Meta = STEP_META[step.kind];
            return (
              <li
                key={index}
                className="flex items-center gap-2 rounded-xl border border-[var(--color-hairline)] p-2"
              >
                <span className="font-mono text-xs text-[var(--color-ink-faint)]">{index + 1}</span>
                <Meta.icon size={14} style={{ color: Meta.color }} aria-hidden />

                {step.kind === 'prompt' ? (
                  <select
                    value={step.ref ?? ''}
                    onChange={(e) => {
                      const p = prompts.data?.prompts.find((x) => x.id === e.target.value);
                      patchStep(index, { ref: e.target.value || null, label: p?.title ?? '' });
                    }}
                    className={`${field} min-w-0 flex-1`}
                  >
                    <option value="">{t('workflows.choosePrompt')}</option>
                    {(prompts.data?.prompts ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                ) : step.kind === 'cron' ? (
                  <select
                    value={step.ref ?? ''}
                    onChange={(e) => {
                      const j = cron.data?.find((x) => x.id === e.target.value);
                      patchStep(index, { ref: e.target.value || null, label: j?.name ?? '' });
                    }}
                    className={`${field} min-w-0 flex-1`}
                  >
                    <option value="">{t('workflows.chooseJob')}</option>
                    {(cron.data ?? []).map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={step.label}
                    onChange={(e) => patchStep(index, { label: e.target.value })}
                    placeholder={t('workflows.step.note')}
                    className={`${field} min-w-0 flex-1`}
                  />
                )}

                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={t('workflows.moveUp')}
                  className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] disabled:opacity-30"
                >
                  <ArrowUp size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === steps.length - 1}
                  aria-label={t('workflows.moveDown')}
                  className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] disabled:opacity-30"
                >
                  <ArrowDown size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  aria-label={t('workflows.removeStep')}
                  className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
                >
                  <X size={13} aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-2 flex flex-wrap gap-2">
          {(['prompt', 'cron', 'note'] as WorkflowStepKind[]).map((kind) => {
            const Meta = STEP_META[kind];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => addStep(kind)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
              >
                <Plus size={12} aria-hidden />
                {t(Meta.labelKey)}
              </button>
            );
          })}
        </div>

        {incomplete && (
          <p className="mt-2 text-xs text-[var(--color-warn)]">{t('workflows.stepIncomplete')}</p>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 disabled:opacity-50"
        >
          <Check size={14} aria-hidden />
          {saving ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-[var(--color-hairline)] px-4 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

function WorkflowCard({
  workflow,
  run,
  confirmDelete,
  onEdit,
  onConfirmDelete,
  onCancelDelete,
  toggle,
  startRun,
  abortRun,
  advanceRun,
  resolveRun,
  remove,
}: {
  workflow: Workflow;
  run: LiveRun | undefined;
  confirmDelete: boolean;
  onEdit: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  toggle: UseMutationResult<{ workflow: Workflow }, Error, Workflow>;
  startRun: UseMutationResult<
    { runId: string },
    Error,
    { workflowId: string; mode: WorkflowRunMode }
  >;
  abortRun: UseMutationResult<{ ok: boolean }, Error, string>;
  advanceRun: UseMutationResult<{ ok: boolean }, Error, string>;
  resolveRun: UseMutationResult<
    { ok: boolean },
    Error,
    { runId: string; action: 'continue' | 'stop' }
  >;
  remove: UseMutationResult<{ ok: boolean }, Error, string>;
}) {
  const { t, lang } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const history = useQuery({
    queryKey: queryKeys.workflowRuns(workflow.id),
    queryFn: () => getWorkflowRuns(workflow.id),
    enabled: historyOpen,
  });

  const workflowRunActive =
    run != null && (run.status === 'running' || run.status === 'waiting_for_user');
  // Which mode is actually running — only that button becomes the stop
  // control; the other stays a plain, disabled start button (only one run
  // per workflow at a time).
  const chainIsActive = workflowRunActive && run?.mode === 'chain';
  const stepIsActive = workflowRunActive && run?.mode === 'single_step';
  const startDisabled =
    !workflow.enabled ||
    workflow.steps.length === 0 ||
    (startRun.isPending && startRun.variables?.workflowId === workflow.id);
  const idleClass =
    'rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-accent)] disabled:opacity-30';
  const activeClass = 'rounded-lg p-1.5 text-[var(--color-accent)] disabled:opacity-40';
  const abortBusy = abortRun.isPending && abortRun.variables === run?.runId;

  const liveSteps = workflow.steps
    .map((step) => {
      const live = run?.steps[step.id];
      if (!live) return null;
      return {
        id: step.id,
        kind: step.kind,
        label: step.label,
        status: live.status,
        output: live.output,
        error: live.error,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={workflow.enabled}
          aria-label={t(workflow.enabled ? 'workflows.disableAria' : 'workflows.enableAria', {
            name: workflow.name,
          })}
          onClick={() => toggle.mutate(workflow)}
          disabled={toggle.isPending && toggle.variables?.id === workflow.id}
          className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40"
          style={{ background: workflow.enabled ? 'var(--color-ok)' : 'var(--color-raised)' }}
        >
          <span
            className="absolute top-0.5 size-4 rounded-full bg-white transition-all"
            style={{ left: workflow.enabled ? 'calc(100% - 1.125rem)' : '0.125rem' }}
            aria-hidden
          />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{workflow.name}</p>
          {workflow.description && (
            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{workflow.description}</p>
          )}
          {workflow.schedule && (
            <p
              className="mt-0.5 text-xs text-[var(--color-ink-faint)]"
              title={
                workflow.nextRunAt
                  ? (formatDateTime(workflow.nextRunAt, lang) ?? undefined)
                  : undefined
              }
            >
              {describeCron(workflow.schedule, t) ?? workflow.schedule}
              {' · '}
              {workflow.nextRunAt
                ? t('workflows.nextRun', { time: formatRelativeTime(workflow.nextRunAt, lang) })
                : t('workflows.scheduleRetired')}
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => {
              if (chainIsActive) {
                if (run) abortRun.mutate(run.runId);
              } else {
                startRun.mutate({ workflowId: workflow.id, mode: 'chain' });
              }
            }}
            disabled={chainIsActive ? abortBusy : workflowRunActive || startDisabled}
            className={chainIsActive ? activeClass : idleClass}
            aria-label={t(chainIsActive ? 'workflowRuns.stopAria' : 'workflowRuns.runChainAria', {
              name: workflow.name,
            })}
          >
            {chainIsActive ? (
              <Pause size={14} className="animate-pulse" aria-hidden />
            ) : (
              <Play size={14} aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (stepIsActive) {
                if (run) abortRun.mutate(run.runId);
              } else {
                startRun.mutate({ workflowId: workflow.id, mode: 'single_step' });
              }
            }}
            disabled={stepIsActive ? abortBusy : workflowRunActive || startDisabled}
            className={stepIsActive ? activeClass : idleClass}
            aria-label={t(
              stepIsActive ? 'workflowRuns.stopAria' : 'workflowRuns.runStepByStepAria',
              { name: workflow.name },
            )}
          >
            {stepIsActive ? (
              <Pause size={14} className="animate-pulse" aria-hidden />
            ) : (
              <StepForward size={14} aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            aria-label={t('workflows.editAria', { name: workflow.name })}
          >
            <Pencil size={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onConfirmDelete}
            className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
            aria-label={t('workflows.deleteAria', { name: workflow.name })}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </div>

      {workflow.steps.length > 0 && (
        <ol className="mt-3 space-y-1">
          {workflow.steps.map((step, index) => {
            const Meta = STEP_META[step.kind];
            return (
              <li key={step.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-[var(--color-ink-faint)]">{index + 1}</span>
                <Meta.icon size={12} style={{ color: Meta.color }} aria-hidden />
                <span className="text-[0.65rem] text-[var(--color-ink-faint)]">
                  {t(Meta.labelKey)}
                </span>
                <span className="truncate text-[var(--color-ink-muted)]">{step.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {run && (
        <div className="mt-3 rounded-xl border border-[var(--color-hairline)] p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            {run.status === 'running' && (
              <Loader2 size={12} className="animate-spin text-[var(--color-accent)]" aria-hidden />
            )}
            {t('workflowRuns.statusLabel', { status: t(`workflowRuns.status.${run.status}`) })}
          </p>
          <RunStepsList steps={liveSteps} />

          {run.status === 'waiting_for_user' &&
            (() => {
              const hasFailedStep = Object.values(run.steps).some((s) => s.status === 'failed');
              const busy = advanceRun.isPending || resolveRun.isPending;
              return hasFailedStep ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => resolveRun.mutate({ runId: run.runId, action: 'continue' })}
                    className="rounded-lg border border-[var(--color-hairline)] px-3 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
                  >
                    {t('workflowRuns.continue')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => resolveRun.mutate({ runId: run.runId, action: 'stop' })}
                    className="rounded-lg border border-[var(--color-danger)]/40 px-3 py-1 text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-40"
                  >
                    {t('workflowRuns.stop')}
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => advanceRun.mutate(run.runId)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
                  >
                    <StepForward size={12} aria-hidden />
                    {t('workflowRuns.nextStep')}
                  </button>
                </div>
              );
            })()}
        </div>
      )}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
        >
          <History size={12} aria-hidden />
          {t('workflowRuns.recentRuns')}
          <ChevronDown
            size={12}
            className={historyOpen ? 'rotate-180 transition-transform' : 'transition-transform'}
            aria-hidden
          />
        </button>

        {historyOpen && (
          <div className="mt-2">
            {history.isPending ? (
              <SkeletonText lines={2} />
            ) : history.data && history.data.runs.length > 0 ? (
              <ul className="space-y-1">
                {history.data.runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedRunId((id) => (id === r.id ? null : r.id))}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-[var(--color-raised)]"
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: STATUS_DOT[r.status] }}
                        aria-hidden
                      />
                      <span title={formatDateTime(r.startedAt, lang) ?? undefined}>
                        {formatRelativeTime(r.startedAt, lang)}
                      </span>
                      <span className="text-[var(--color-ink-faint)]">
                        {t(`workflowRuns.trigger.${r.trigger}`)}
                      </span>
                      <span className="ml-auto text-[var(--color-ink-muted)]">
                        {t(`workflowRuns.status.${r.status}`)}
                      </span>
                    </button>
                    {selectedRunId === r.id && (
                      <div className="ml-3 border-l border-[var(--color-hairline)] pl-3">
                        <RunStepsList steps={r.steps} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--color-ink-faint)]">{t('workflowRuns.noRuns')}</p>
            )}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmInline
          tone="danger"
          message={t('workflows.deleteConfirm', { name: workflow.name })}
          confirmLabel={t('common.delete')}
          pending={remove.isPending && remove.variables === workflow.id}
          onConfirm={() => remove.mutate(workflow.id)}
          onCancel={onCancelDelete}
        />
      )}
    </li>
  );
}

export function WorkflowsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const [editing, setEditing] = useState<Workflow | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Keyed by workflowId, not a single slot — different workflows can have
  // runs active at the same time (the runner only ever blocks a *second* run
  // of the *same* workflow), and each card needs to keep showing its own
  // run's progress independently of whatever else is running.
  const [liveRuns, setLiveRuns] = useState<Record<string, LiveRun>>({});
  // The single source of truth the SSE handlers below read and write —
  // synchronously, not through React's render/effect cycle. A ref synced via
  // a `useEffect([liveRuns])` lags behind bursts of same-tick SSE events (a
  // fast run can fire run.started..run.finished before React ever gets to
  // flush that effect), which silently dropped the completion toast on fast
  // successful runs. `setLiveRuns` below is only ever called with the
  // already-computed next value, never a functional updater, so there's
  // nothing left depending on render timing.
  const liveRunsRef = useRef<Record<string, LiveRun>>({});
  const applyLiveRun = (workflowId: string, run: LiveRun): void => {
    liveRunsRef.current = { ...liveRunsRef.current, [workflowId]: run };
    setLiveRuns(liveRunsRef.current);
  };
  /** SSE events after run.started only carry a runId — find which workflow that belongs to. */
  const findLiveRunByRunId = (runId: string): [string, LiveRun] | undefined =>
    Object.entries(liveRunsRef.current).find(([, run]) => run.runId === runId);

  const patchStep = (run: LiveRun, stepId: string, patch: Partial<LiveStep>): LiveRun => ({
    ...run,
    steps: { ...run.steps, [stepId]: { ...run.steps[stepId]!, ...patch } },
  });

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.workflows,
    queryFn: getWorkflows,
    staleTime: 30_000,
  });
  const workflows = useMemo(() => data?.workflows ?? [], [data]);

  // The SSE subscription below only runs once on mount, so it reads
  // workflows through this ref rather than the closed-over array, which
  // would otherwise always be the empty initial value. Workflow refetches
  // aren't part of the same tight SSE-event timing liveRunRef guards
  // against, so an effect-synced ref is fine here.
  const workflowsRef = useRef(workflows);
  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);

  useEffect(() => {
    const source = new EventSource('/api/workflows/events');

    const on = <T extends { runId: string }>(type: string, handler: (data: T) => void) => {
      source.addEventListener(type, (event: MessageEvent) => {
        try {
          handler(JSON.parse(event.data as string) as T);
        } catch {
          // Malformed frame: ignore rather than crash the stream handler.
        }
      });
    };

    // Seeding here — on the SSE event itself — rather than in startRun's
    // onSuccess is what lets a fast chain (e.g. a single prompt step) be
    // followed live: run.started is always published before any step.*
    // event for the same run, but the POST response can arrive after those
    // step events already fired, in which case seeding on onSuccess would
    // have missed them (no entry existed yet when they arrived).
    on<{ runId: string; workflowId: string; mode: WorkflowRunMode }>('run.started', (data) => {
      const workflow = workflowsRef.current.find((w) => w.id === data.workflowId);
      applyLiveRun(data.workflowId, {
        workflowId: data.workflowId,
        runId: data.runId,
        mode: data.mode,
        status: 'running',
        steps: Object.fromEntries(
          (workflow?.steps ?? []).map((s) => [
            s.id,
            { status: 'pending' as const, output: '', error: null },
          ]),
        ),
      });
    });
    on<{ runId: string; stepId: string }>('step.started', (data) => {
      const found = findLiveRunByRunId(data.runId);
      if (found) applyLiveRun(found[0], patchStep(found[1], data.stepId, { status: 'running' }));
    });
    on<{ runId: string; stepId: string; text: string }>('step.delta', (data) => {
      const found = findLiveRunByRunId(data.runId);
      if (found) {
        const [workflowId, run] = found;
        applyLiveRun(
          workflowId,
          patchStep(run, data.stepId, {
            output: (run.steps[data.stepId]?.output ?? '') + data.text,
          }),
        );
      }
    });
    on<{
      runId: string;
      stepId: string;
      status: WorkflowRunStepStatus;
      output: string;
      error: string | null;
    }>('step.finished', (data) => {
      const found = findLiveRunByRunId(data.runId);
      if (found) {
        const [workflowId, run] = found;
        applyLiveRun(
          workflowId,
          patchStep(run, data.stepId, {
            status: data.status,
            output: data.output,
            error: data.error,
          }),
        );
      }
    });
    on<{ runId: string }>('run.waiting_for_user', (data) => {
      const found = findLiveRunByRunId(data.runId);
      if (found) applyLiveRun(found[0], { ...found[1], status: 'waiting_for_user' });
    });
    on<{ runId: string; status: WorkflowRunStatus }>('run.finished', (data) => {
      const found = findLiveRunByRunId(data.runId);
      if (found) {
        const [workflowId, run] = found;
        const name = workflowsRef.current.find((w) => w.id === workflowId)?.name ?? '';
        if (data.status === 'completed') {
          const anyStepFailed = Object.values(run.steps).some((s) => s.status === 'failed');
          toast.push(
            anyStepFailed
              ? { tone: 'warning', title: t('workflowRuns.runFinishedWithErrors', { name }) }
              : { tone: 'success', title: t('workflowRuns.runFinished', { name }) },
          );
        } else if (data.status === 'failed') {
          toast.push({ tone: 'error', title: t('workflowRuns.runFailed', { name }) });
        } else if (data.status === 'stopped') {
          toast.push({ tone: 'info', title: t('workflowRuns.runStopped', { name }) });
        }
        applyLiveRun(workflowId, { ...run, status: data.status });
        // Keeps an already-open "Recent runs" list in sync with the run that
        // just finished, instead of only showing it after the next manual
        // expand/collapse.
        void queryClient.invalidateQueries({ queryKey: queryKeys.workflowRuns(workflowId) });
      }
    });

    return () => source.close();
  }, []);

  const startRun = useMutation({
    mutationFn: ({ workflowId, mode }: { workflowId: string; mode: WorkflowRunMode }) =>
      startWorkflowRun(workflowId, mode),
    // No onSuccess seeding here — the run.started SSE handler above does it,
    // and does so earlier than this callback can ever fire.
    onError: (e: Error) => {
      const code = e instanceof ApiError ? e.code : undefined;
      const key =
        code === 'workflow_disabled'
          ? 'workflowRuns.reason.disabled'
          : code === 'no_steps'
            ? 'workflowRuns.reason.noSteps'
            : code === 'run_in_progress'
              ? 'workflowRuns.reason.alreadyActive'
              : null;
      toast.push({
        tone: 'error',
        title: t('workflowRuns.startFailed'),
        description: key ? t(key) : e.message,
      });
    },
  });

  const advanceRun = useMutation({
    mutationFn: (runId: string) => advanceWorkflowRun(runId),
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('workflowRuns.actionFailed'), description: e.message }),
  });

  const resolveRun = useMutation({
    mutationFn: ({ runId, action }: { runId: string; action: 'continue' | 'stop' }) =>
      resolveWorkflowRun(runId, action),
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('workflowRuns.actionFailed'), description: e.message }),
  });

  const abortRun = useMutation({
    mutationFn: (runId: string) => abortWorkflowRun(runId),
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('workflowRuns.actionFailed'), description: e.message }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.workflows });

  const save = useMutation({
    mutationFn: (input: { id?: string; data: WorkflowInput }) =>
      input.id ? updateWorkflow(input.id, input.data) : createWorkflow(input.data),
    onSuccess: async () => {
      setEditing(undefined);
      await invalidate();
      toast.push({ tone: 'success', title: t('workflows.saved') });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.saveFailed'), description: e.message }),
  });

  const toggle = useMutation({
    mutationFn: (workflow: Workflow) => setWorkflowEnabled(workflow.id, !workflow.enabled),
    onSuccess: async () => invalidate(),
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.toggleFailed'), description: e.message }),
  });

  const remove = useMutation({
    mutationFn: deleteWorkflow,
    onSuccess: async () => {
      setConfirmDelete(null);
      await invalidate();
      toast.push({ tone: 'success', title: t('workflows.deleted') });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.deleteFailed'), description: e.message }),
  });

  return (
    <PageShell
      title={t('nav.workflows')}
      description={t('page.workflows.desc')}
      actions={
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20"
        >
          <Plus size={14} aria-hidden />
          {t('common.new')}
        </button>
      }
    >
      {editing !== undefined && (
        <div className="mb-4">
          {/* Remount on target change, so the fields never belong to another workflow. */}
          <WorkflowEditor
            key={editing?.id ?? 'new'}
            workflow={editing}
            saving={save.isPending}
            onCancel={() => setEditing(undefined)}
            onSave={(input) => save.mutate({ id: editing?.id, data: input })}
          />
        </div>
      )}

      {isPending ? (
        <SkeletonText lines={6} />
      ) : error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : workflows.length === 0 ? (
        <div className="card p-10 text-center">
          <span
            className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-raised)] text-[var(--color-ink-faint)]"
            aria-hidden
          >
            <WorkflowIcon size={22} />
          </span>
          <p className="mt-4 text-sm font-medium">{t('workflows.empty.title')}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-muted)]">
            {t('workflows.empty.desc')}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {workflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              run={liveRuns[workflow.id]}
              confirmDelete={confirmDelete === workflow.id}
              onEdit={() => setEditing(workflow)}
              onConfirmDelete={() => setConfirmDelete(workflow.id)}
              onCancelDelete={() => setConfirmDelete(null)}
              toggle={toggle}
              startRun={startRun}
              abortRun={abortRun}
              advanceRun={advanceRun}
              resolveRun={resolveRun}
              remove={remove}
            />
          ))}
        </ul>
      )}
    </PageShell>
  );
}
