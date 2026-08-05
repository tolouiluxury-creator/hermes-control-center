import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pin, Plus, Trash2 } from 'lucide-react';
import { createTodo, deleteTodo, getTodos, queryKeys, setTodoDone, setTodoPinned } from '@/lib/api';
import { SkeletonText } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';

export interface TodosPanelHandle {
  /** Fills the quick-add field with the given text and focuses it, without saving. */
  prefillAndFocus: (text: string) => void;
}

export const TodosPanel = forwardRef<TodosPanelHandle, { sessionId: string | null }>(
  function TodosPanel({ sessionId }, ref) {
    const { t } = useI18n();
    const toast = useToast();
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => ({
      prefillAndFocus: (text: string) => {
        setDraft(text.length > 200 ? `${text.slice(0, 200)}…` : text);
        inputRef.current?.focus();
      },
    }));

    const todos = useQuery({
      queryKey: queryKeys.todos(sessionId ?? ''),
      queryFn: () => getTodos(sessionId ?? ''),
      enabled: sessionId !== null,
    });

    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.todos(sessionId ?? '') });
    const fail = (error: Error) =>
      toast.push({ tone: 'error', title: t('todos.actionFailed'), description: error.message });

    const add = useMutation({
      mutationFn: (text: string) => createTodo(sessionId ?? '', text),
      onSuccess: async () => {
        setDraft('');
        await invalidate();
      },
      onError: fail,
    });

    const toggleDone = useMutation({
      mutationFn: ({ id, done }: { id: string; done: boolean }) => setTodoDone(id, done),
      onSuccess: invalidate,
      onError: fail,
    });

    const togglePinned = useMutation({
      mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => setTodoPinned(id, pinned),
      onSuccess: invalidate,
      onError: fail,
    });

    const remove = useMutation({
      mutationFn: (id: string) => deleteTodo(id),
      onSuccess: invalidate,
      onError: fail,
    });

    if (sessionId === null) {
      return <p className="p-3 text-xs text-[var(--color-ink-muted)]">{t('todos.needsSession')}</p>;
    }

    const list = todos.data?.todos ?? [];
    const submitDraft = () => {
      const text = draft.trim();
      if (text === '' || add.isPending) return;
      add.mutate(text);
    };

    return (
      <div className="flex h-full flex-col p-3">
        <form
          className="flex items-start gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitDraft();
              }
            }}
            rows={1}
            placeholder={t('todos.quickAddPlaceholder')}
            className="min-h-[1.9rem] min-w-0 flex-1 resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 text-xs outline-none focus-visible:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={draft.trim() === '' || add.isPending}
            aria-label={t('todos.add')}
            className="mt-0.5 shrink-0 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 p-1.5 text-[var(--color-accent)] disabled:opacity-40"
          >
            <Plus size={13} aria-hidden />
          </button>
        </form>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {todos.isPending ? (
            <SkeletonText lines={4} />
          ) : list.length === 0 ? (
            <p className="px-1 text-xs text-[var(--color-ink-faint)]">{t('todos.empty')}</p>
          ) : (
            <ul className="min-w-0 space-y-2">
              {list.map((todo) => (
                <li key={todo.id} className="flex min-w-0 items-start gap-1.5">
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) =>
                      toggleDone.mutate({ id: todo.id, done: event.target.checked })
                    }
                    aria-label={todo.text}
                    className="mt-1 size-3.5 shrink-0"
                  />
                  <span
                    className={`min-w-0 flex-1 text-xs break-words whitespace-pre-wrap ${
                      todo.done
                        ? 'text-[var(--color-ink-faint)] line-through'
                        : 'text-[var(--color-ink)]'
                    }`}
                  >
                    {todo.text}
                  </span>
                  {/* Always visible, not hover-only — a long, wrapped todo has no
                      "row" left to hover for a hidden action to appear in. */}
                  <div className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      onClick={() => togglePinned.mutate({ id: todo.id, pinned: !todo.pinned })}
                      title={todo.pinned ? t('todos.unpin') : t('todos.pin')}
                      aria-label={todo.pinned ? t('todos.unpin') : t('todos.pin')}
                      className={`shrink-0 rounded p-0.5 ${
                        todo.pinned
                          ? 'text-[var(--color-accent)]'
                          : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]'
                      }`}
                    >
                      <Pin size={11} aria-hidden fill={todo.pinned ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(todo.id)}
                      title={t('common.delete')}
                      aria-label={`${t('common.delete')} ${todo.text}`}
                      className="shrink-0 rounded p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
                    >
                      <Trash2 size={11} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  },
);
