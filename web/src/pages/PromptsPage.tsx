import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCopy, CopyPlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  createPrompt,
  deletePrompt,
  getPrompts,
  queryKeys,
  recordPromptUse,
  updatePrompt,
} from '@/lib/api';
import { PageShell, SearchField } from '@/components/PageShell';
import { ConfirmInline } from '@/components/ConfirmInline';
import { SkeletonText } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/format';
import type { Prompt } from '@/lib/hermesTypes';

/** Mirrors the server's extraction so the editor can preview it while typing. */
function extractVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([a-zA-Z0-9_][a-zA-Z0-9_ -]{0,60})\s*\}\}/g)) {
    const name = match[1]?.trim();
    if (name) found.add(name);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function PromptEditor({
  prompt,
  onCancel,
  onSave,
  saving,
}: {
  prompt: Prompt | null;
  onCancel: () => void;
  onSave: (input: { title: string; body: string; tags: string[] }) => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(prompt?.title ?? '');
  const [body, setBody] = useState(prompt?.body ?? '');
  const [tags, setTags] = useState((prompt?.tags ?? []).join(', '));

  const variables = useMemo(() => extractVariables(body), [body]);
  const canSave = title.trim() !== '' && body.trim() !== '' && !saving;

  return (
    <form
      className="card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        onSave({
          title,
          body,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        });
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {prompt ? t('prompts.editTitle') : t('prompts.newTitle')}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
          aria-label={t('common.cancel')}
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <label className="mt-3 block text-xs text-[var(--color-ink-faint)]">
        {t('prompts.title')}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={200}
          autoFocus
          className="mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]"
        />
      </label>

      <label className="mt-3 block text-xs text-[var(--color-ink-faint)]">
        {t('prompts.text')}
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
          rows={10}
          placeholder={t('prompts.textPlaceholder')}
          className="mt-1 w-full resize-y rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-xs text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]"
        />
      </label>

      <label className="mt-3 block text-xs text-[var(--color-ink-faint)]">
        {t('prompts.tags')}
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder={t('prompts.tagsPlaceholder')}
          className="mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]"
        />
      </label>

      {variables.length > 0 && (
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
          {t('prompts.variables')}{' '}
          {variables.map((variable) => (
            <code
              key={variable}
              className="mr-1 rounded bg-[var(--color-raised)] px-1.5 py-0.5 font-mono text-[0.7rem]"
            >
              {variable}
            </code>
          ))}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-50"
        >
          <Check size={14} aria-hidden />
          {saving ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-[var(--color-hairline)] px-4 py-2 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

export function PromptsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t, lang } = useI18n();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Prompt | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.prompts,
    queryFn: getPrompts,
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.prompts });

  const save = useMutation({
    mutationFn: (input: { id?: string; title: string; body: string; tags: string[] }) =>
      input.id
        ? updatePrompt(input.id, { title: input.title, body: input.body, tags: input.tags })
        : createPrompt({ title: input.title, body: input.body, tags: input.tags }),
    onSuccess: async () => {
      setEditing(undefined);
      await invalidate();
      toast.push({ tone: 'success', title: t('prompts.saved') });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: t('toast.saveFailed'),
        description: mutationError.message,
      }),
  });

  /*
   * A copy to work from. The title gets a suffix rather than clashing — prompts
   * have no unique-name rule, and two identical titles in a list are worse than
   * a slightly clumsy one. The use counter starts at zero: it counts what this
   * copy is used for, not what the original was.
   */
  const duplicate = useMutation({
    mutationFn: (prompt: Prompt) =>
      createPrompt({
        title: t('prompts.duplicateTitle', { title: prompt.title }),
        body: prompt.body,
        tags: prompt.tags,
      }),
    onSuccess: async () => {
      await invalidate();
      toast.push({ tone: 'success', title: t('prompts.duplicated') });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: t('toast.saveFailed'),
        description: mutationError.message,
      }),
  });

  const remove = useMutation({
    mutationFn: deletePrompt,
    onSuccess: async () => {
      setConfirmDelete(null);
      await invalidate();
      toast.push({ tone: 'success', title: t('prompts.deleted') });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: t('toast.deleteFailed'),
        description: mutationError.message,
      }),
  });

  // Memoised because the fallback creates a fresh array on every render, which
  // would defeat the filter below.
  const prompts = useMemo(() => data?.prompts ?? [], [data]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return prompts;
    return prompts.filter(
      (prompt) =>
        prompt.title.toLowerCase().includes(needle) ||
        prompt.body.toLowerCase().includes(needle) ||
        prompt.tags.some((tag) => tag.includes(needle)),
    );
  }, [prompts, search]);

  const copy = async (prompt: Prompt): Promise<void> => {
    try {
      await navigator.clipboard.writeText(prompt.body);
      await recordPromptUse(prompt.id);
      await invalidate();
      toast.push({ tone: 'success', title: t('prompts.copied') });
    } catch {
      toast.push({
        tone: 'error',
        title: t('prompts.copyFailed'),
        description: t('prompts.copyFailedDesc'),
      });
    }
  };

  return (
    <PageShell
      title={t('nav.prompts')}
      description={t('page.prompts.desc')}
      actions={
        <>
          <SearchField value={search} onChange={setSearch} label={t('prompts.searchLabel')} />
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
          >
            <Plus size={14} aria-hidden />
            {t('common.new')}
          </button>
        </>
      }
    >
      {editing !== undefined && (
        <div className="mb-4">
          {/* Remount on target change, so the fields never belong to another prompt. */}
          <PromptEditor
            key={editing?.id ?? 'new'}
            prompt={editing}
            saving={save.isPending}
            onCancel={() => setEditing(undefined)}
            onSave={(input) => save.mutate({ id: editing?.id, ...input })}
          />
        </div>
      )}

      {isPending ? (
        <SkeletonText lines={8} />
      ) : error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : visible.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm font-medium">
            {prompts.length === 0 ? t('prompts.empty.none') : t('prompts.empty.noMatch')}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-muted)]">
            {prompts.length === 0 ? t('prompts.empty.noneDesc') : t('prompts.empty.noMatchDesc')}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((prompt) => (
            <li key={prompt.id} className="card p-4">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium">{prompt.title}</h3>
                  <p className="mt-0.5 text-[0.7rem] text-[var(--color-ink-faint)]">
                    {prompt.uses > 0 ? t('prompts.used', { count: prompt.uses }) : ''}
                    {t('prompts.changed', { time: formatRelativeTime(prompt.updatedAt, lang) })}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => void copy(prompt)}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-accent)]"
                    aria-label={t('prompts.copyAria', { title: prompt.title })}
                    title={t('prompts.copyText')}
                  >
                    <ClipboardCopy size={14} aria-hidden />
                  </button>
                  {/*
                   * Distinct from the clipboard button next to it: this makes a
                   * second entry. A single copy icon was read as "duplicate", so
                   * the two jobs now have two icons and two words.
                   */}
                  <button
                    type="button"
                    onClick={() => duplicate.mutate(prompt)}
                    disabled={duplicate.isPending}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
                    aria-label={t('prompts.duplicateAria', { title: prompt.title })}
                    title={t('prompts.duplicate')}
                  >
                    <CopyPlus size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(prompt)}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                    aria-label={t('prompts.editAria', { title: prompt.title })}
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(prompt.id)}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-danger)]"
                    aria-label={t('prompts.deleteAria', { title: prompt.title })}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </div>

              <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-[var(--color-base)] p-2.5 font-mono text-xs whitespace-pre-wrap text-[var(--color-ink-muted)]">
                {prompt.body}
              </pre>

              {(prompt.tags.length > 0 || prompt.variables.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {prompt.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-[0.65rem] text-[var(--color-ink-muted)]"
                    >
                      {tag}
                    </span>
                  ))}
                  {prompt.variables.map((variable) => (
                    <span
                      key={variable}
                      className="rounded-full bg-[var(--color-agent)]/10 px-2 py-0.5 font-mono text-[0.65rem] text-[var(--color-agent)]"
                      title={t('prompts.variableTitle')}
                    >
                      {variable}
                    </span>
                  ))}
                </div>
              )}

              {/* Deleting is irreversible, so it asks — inline, where the click was. */}
              {confirmDelete === prompt.id && (
                <ConfirmInline
                  tone="danger"
                  message={t('prompts.deleteConfirm', { title: prompt.title })}
                  confirmLabel={t('common.delete')}
                  cancelLabel={t('prompts.keep')}
                  pending={remove.isPending && remove.variables === prompt.id}
                  onConfirm={() => remove.mutate(prompt.id)}
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
