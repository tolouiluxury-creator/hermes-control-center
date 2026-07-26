import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  createPrompt,
  deletePrompt,
  getPrompts,
  queryKeys,
  recordPromptUse,
  updatePrompt,
} from '@/lib/api';
import { PageShell, SearchField } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
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
        <h3 className="text-sm font-semibold">{prompt ? 'Prompt bearbeiten' : 'Neuer Prompt'}</h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
          aria-label="Abbrechen"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <label className="mt-3 block text-xs text-[var(--color-ink-faint)]">
        Titel
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
        Text
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
          rows={10}
          placeholder={'Schreibe eine Zusammenfassung über {{thema}} in {{sprache}}.'}
          className="mt-1 w-full resize-y rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-xs text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]"
        />
      </label>

      <label className="mt-3 block text-xs text-[var(--color-ink-faint)]">
        Schlagwörter, durch Komma getrennt
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="recherche, wöchentlich"
          className="mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]"
        />
      </label>

      {variables.length > 0 && (
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
          Erkannte Platzhalter:{' '}
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
          {saving ? 'Speichere …' : 'Speichern'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-[var(--color-hairline)] px-4 py-2 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}

export function PromptsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
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
      toast.push({ tone: 'success', title: 'Prompt gespeichert' });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: 'Speichern fehlgeschlagen',
        description: mutationError.message,
      }),
  });

  const remove = useMutation({
    mutationFn: deletePrompt,
    onSuccess: async () => {
      setConfirmDelete(null);
      await invalidate();
      toast.push({ tone: 'success', title: 'Prompt gelöscht' });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: 'Löschen fehlgeschlagen',
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
      toast.push({ tone: 'success', title: 'In die Zwischenablage kopiert' });
    } catch {
      toast.push({
        tone: 'error',
        title: 'Kopieren nicht möglich',
        description: 'Der Browser hat den Zugriff auf die Zwischenablage abgelehnt.',
      });
    }
  };

  return (
    <PageShell
      title="Prompt-Bibliothek"
      description="Deine eigenen Vorlagen. Sie liegen im Control Center, nicht in Hermes — Hermes hat keine Prompt-Bibliothek."
      actions={
        <>
          <SearchField value={search} onChange={setSearch} label="Prompts durchsuchen" />
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
          >
            <Plus size={14} aria-hidden />
            Neu
          </button>
        </>
      }
    >
      {editing !== undefined && (
        <div className="mb-4">
          <PromptEditor
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
            {prompts.length === 0 ? 'Noch keine Prompts' : 'Kein Treffer'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-muted)]">
            {prompts.length === 0
              ? 'Sammle hier Formulierungen, die sich bewährt haben. Mit {{platzhaltern}} bleiben sie wiederverwendbar.'
              : 'Andere Suchbegriffe probieren.'}
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
                    {prompt.uses > 0 ? `${prompt.uses}× verwendet · ` : ''}
                    geändert {formatRelativeTime(prompt.updatedAt)}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => void copy(prompt)}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-accent)]"
                    aria-label={`${prompt.title} kopieren`}
                    title="Text kopieren"
                  >
                    <Copy size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(prompt)}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                    aria-label={`${prompt.title} bearbeiten`}
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(prompt.id)}
                    className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-danger)]"
                    aria-label={`${prompt.title} löschen`}
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
                      title="Platzhalter im Text"
                    >
                      {variable}
                    </span>
                  ))}
                </div>
              )}

              {/* Deleting is irreversible, so it asks — inline, where the click was. */}
              {confirmDelete === prompt.id && (
                <div
                  className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3"
                  role="alertdialog"
                  aria-label="Löschen bestätigen"
                >
                  <p className="min-w-0 flex-1 text-xs">
                    „{prompt.title}" endgültig löschen? Das lässt sich nicht rückgängig machen.
                  </p>
                  <button
                    type="button"
                    onClick={() => remove.mutate(prompt.id)}
                    disabled={remove.isPending}
                    className="rounded-lg bg-[var(--color-danger)]/15 px-3 py-1 text-xs text-[var(--color-danger)] disabled:opacity-50"
                  >
                    Löschen
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(null)}
                    className="rounded-lg px-3 py-1 text-xs text-[var(--color-ink-muted)]"
                  >
                    Behalten
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
