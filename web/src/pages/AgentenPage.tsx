import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Pencil, Plus, Trash2, Wand2, X } from 'lucide-react';
import {
  createAgent,
  deleteAgent,
  getAgents,
  getModelOptions,
  getSkillList,
  getToolsets,
  queryKeys,
  setMainModel,
  updateAgent,
} from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import type { Agent, AgentInput } from '@/lib/hermesTypes';

const ACCENTS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

function AgentEditor({
  agent,
  onCancel,
  onSave,
  saving,
}: {
  agent: Agent | null;
  onCancel: () => void;
  onSave: (input: AgentInput) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(agent?.name ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [provider, setProvider] = useState(agent?.provider ?? '');
  const [model, setModel] = useState(agent?.model ?? '');
  const [toolset, setToolset] = useState(agent?.toolset ?? '');
  const [skills, setSkills] = useState((agent?.skills ?? []).join(', '));
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '');
  const [accent, setAccent] = useState(agent?.accent ?? ACCENTS[0]);
  const { t } = useI18n();

  const options = useQuery({
    queryKey: queryKeys.models,
    queryFn: getModelOptions,
    staleTime: 60_000,
  });
  const toolsets = useQuery({
    queryKey: queryKeys.toolsets,
    queryFn: getToolsets,
    staleTime: 60_000,
  });
  const skillList = useQuery({
    queryKey: queryKeys.skillList,
    queryFn: getSkillList,
    staleTime: 60_000,
  });

  const providerModels = useMemo(
    () => options.data?.providers.find((p) => p.slug === provider)?.models ?? [],
    [options.data, provider],
  );

  const canSave = name.trim() !== '' && !saving;
  const field =
    'mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]';
  const label = 'block text-xs text-[var(--color-ink-faint)]';

  return (
    <form
      className="card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        onSave({
          name,
          description,
          provider: provider || null,
          model: model || null,
          toolset: toolset || null,
          skills: skills
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          systemPrompt,
          accent,
        });
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {agent ? t('agents.editTitle') : t('agents.newTitle')}
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

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={label}>
          {t('agents.name')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoFocus
            className={field}
          />
        </label>
        <label className={label}>
          {t('agents.color')}
          <span className="mt-1 flex gap-1.5">
            {ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={t('agents.colorAria', { color })}
                onClick={() => setAccent(color)}
                className="size-6 rounded-full transition-transform"
                style={{
                  background: color,
                  outline: accent === color ? '2px solid var(--color-ink)' : 'none',
                  outlineOffset: 2,
                }}
              />
            ))}
          </span>
        </label>
      </div>

      <label className={`mt-3 ${label}`}>
        {t('agents.description')}
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          placeholder={t('agents.descPlaceholder')}
          className={field}
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={label}>
          {t('agents.provider')}
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setModel('');
            }}
            className={field}
          >
            <option value="">{t('agents.none')}</option>
            {(options.data?.providers ?? []).map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t('agents.model')}
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list="agent-models"
            placeholder={t('agents.modelPlaceholder')}
            className={field}
          />
          <datalist id="agent-models">
            {providerModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </div>

      <label className={`mt-3 ${label}`}>
        {t('agents.toolset')}
        <select value={toolset} onChange={(e) => setToolset(e.target.value)} className={field}>
          <option value="">{t('agents.none')}</option>
          {(toolsets.data ?? []).map((t) => (
            <option key={t.name} value={t.name}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className={`mt-3 ${label}`}>
        {t('agents.skills')}
        <input
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          list="agent-skills"
          placeholder={t('agents.skillsPlaceholder')}
          className={`${field} font-mono text-xs`}
        />
        <datalist id="agent-skills">
          {(skillList.data ?? []).map((s) => (
            <option key={s.name} value={s.name} />
          ))}
        </datalist>
      </label>

      <label className={`mt-3 ${label}`}>
        {t('agents.systemPrompt')}
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={5}
          placeholder={t('agents.systemPromptPlaceholder')}
          className={`${field} resize-y font-mono text-xs`}
        />
      </label>

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

export function AgentenPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const [editing, setEditing] = useState<Agent | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.agents,
    queryFn: getAgents,
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.agents });

  const save = useMutation({
    mutationFn: (input: { id?: string; data: AgentInput }) =>
      input.id ? updateAgent(input.id, input.data) : createAgent(input.data),
    onSuccess: async () => {
      setEditing(undefined);
      await invalidate();
      toast.push({ tone: 'success', title: t('agents.saved') });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.saveFailed'), description: e.message }),
  });

  const remove = useMutation({
    mutationFn: deleteAgent,
    onSuccess: async () => {
      setConfirmDelete(null);
      await invalidate();
      toast.push({ tone: 'success', title: t('agents.deleted') });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.deleteFailed'), description: e.message }),
  });

  const apply = useMutation({
    mutationFn: (agent: Agent) => setMainModel(agent.provider ?? '', agent.model ?? ''),
    onSuccess: async (_r, agent) => {
      setConfirmApply(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.model });
      await queryClient.invalidateQueries({ queryKey: queryKeys.models });
      toast.push({ tone: 'success', title: t('agents.applied', { name: agent.name }) });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.applyFailed'), description: e.message }),
  });

  const agents = data?.agents ?? [];

  return (
    <PageShell
      title={t('nav.agenten')}
      description={t('page.agenten.desc')}
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
          <AgentEditor
            agent={editing}
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
      ) : agents.length === 0 ? (
        <div className="card p-10 text-center">
          <span
            className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-raised)] text-[var(--color-ink-faint)]"
            aria-hidden
          >
            <Bot size={22} />
          </span>
          <p className="mt-4 text-sm font-medium">{t('agents.empty.title')}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-muted)]">
            {t('agents.empty.desc')}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {agents.map((agent) => (
            <li key={agent.id} className="card p-4">
              <div className="flex items-start gap-3">
                <span
                  className="mt-1 size-3 shrink-0 rounded-full"
                  style={{ background: agent.accent ?? 'var(--color-ink-faint)' }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{agent.name}</p>
                  {agent.description && (
                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                      {agent.description}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(agent)}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                    aria-label={t('agents.editAria', { name: agent.name })}
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(agent.id)}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
                    aria-label={t('agents.deleteAria', { name: agent.name })}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </div>

              <dl className="mt-2 space-y-0.5 text-xs text-[var(--color-ink-muted)]">
                {agent.model && (
                  <div className="flex gap-2">
                    <dt className="text-[var(--color-ink-faint)]">{t('agents.metaModel')}</dt>
                    <dd className="font-mono">
                      {agent.model}
                      {agent.provider && ` · ${agent.provider}`}
                    </dd>
                  </div>
                )}
                {agent.toolset && (
                  <div className="flex gap-2">
                    <dt className="text-[var(--color-ink-faint)]">{t('agents.metaTools')}</dt>
                    <dd>{agent.toolset}</dd>
                  </div>
                )}
                {agent.skills.length > 0 && (
                  <div className="flex gap-2">
                    <dt className="text-[var(--color-ink-faint)]">{t('agents.metaSkills')}</dt>
                    <dd>{agent.skills.length}</dd>
                  </div>
                )}
              </dl>

              {agent.provider && agent.model && (
                <button
                  type="button"
                  onClick={() => setConfirmApply(agent.id)}
                  disabled={apply.isPending}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-40"
                >
                  <Wand2 size={13} aria-hidden />
                  {t('agents.applyModel')}
                </button>
              )}

              {confirmApply === agent.id && (
                <ConfirmInline
                  tone="warn"
                  message={t('models.switchConfirm', { model: agent.model ?? '' })}
                  confirmLabel={t('common.apply')}
                  pending={apply.isPending}
                  onConfirm={() => apply.mutate(agent)}
                  onCancel={() => setConfirmApply(null)}
                />
              )}

              {confirmDelete === agent.id && (
                <ConfirmInline
                  tone="danger"
                  message={t('agents.deleteConfirm', { name: agent.name })}
                  confirmLabel={t('common.delete')}
                  pending={remove.isPending && remove.variables === agent.id}
                  onConfirm={() => remove.mutate(agent.id)}
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
