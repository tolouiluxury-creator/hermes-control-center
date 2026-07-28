import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ListChecks,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import {
  createWorkflow,
  deleteWorkflow,
  getCronJobs,
  getPrompts,
  getWorkflows,
  queryKeys,
  setWorkflowEnabled,
  updateWorkflow,
} from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import type {
  Workflow,
  WorkflowInput,
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

  const canSave = name.trim() !== '' && !saving;

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
          steps: steps.filter((s) => s.label.trim() !== ''),
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

export function WorkflowsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const [editing, setEditing] = useState<Workflow | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.workflows,
    queryFn: getWorkflows,
    staleTime: 30_000,
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

  const workflows = data?.workflows ?? [];

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
          <WorkflowEditor
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
            <li key={workflow.id} className="card p-4">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={workflow.enabled}
                  aria-label={t(
                    workflow.enabled ? 'workflows.disableAria' : 'workflows.enableAria',
                    { name: workflow.name },
                  )}
                  onClick={() => toggle.mutate(workflow)}
                  disabled={toggle.isPending && toggle.variables?.id === workflow.id}
                  className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40"
                  style={{
                    background: workflow.enabled ? 'var(--color-ok)' : 'var(--color-raised)',
                  }}
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
                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                      {workflow.description}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(workflow)}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                    aria-label={t('workflows.editAria', { name: workflow.name })}
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(workflow.id)}
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

              {confirmDelete === workflow.id && (
                <ConfirmInline
                  tone="danger"
                  message={t('workflows.deleteConfirm', { name: workflow.name })}
                  confirmLabel={t('common.delete')}
                  pending={remove.isPending && remove.variables === workflow.id}
                  onConfirm={() => remove.mutate(workflow.id)}
                  onCancel={() => setConfirmDelete(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
