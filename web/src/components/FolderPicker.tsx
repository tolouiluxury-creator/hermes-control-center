import { useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronUp, FolderClosed, X } from 'lucide-react';
import { browseWorkspaceFolders } from '@/lib/api';
import { SkeletonText } from '@/components/Skeleton';
import { useI18n } from '@/lib/i18n';
import { parentOf } from '@/lib/paths';

/**
 * Browses folders on the Hermes host through the server (see the
 * `/api/workspace/browse` route) so the workspace root can be picked by
 * clicking rather than typed from memory — a browser file input cannot do
 * this itself: it never exposes an absolute host path, by design.
 */
export function FolderPicker({
  onSelect,
  onClose,
}: {
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [path, setPath] = useState<string | undefined>(undefined);

  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  const listing = useQuery({
    queryKey: ['workspace-browse', path ?? ''],
    queryFn: () => browseWorkspaceFolders(path),
  });

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button');
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const current = listing.data?.path;
  const folders = listing.data?.folders ?? [];

  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-black/50 px-4 pt-[10vh] backdrop-blur-sm"
      style={{ zIndex: 'var(--z-overlay)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
        className="card flex w-full max-w-lg flex-col overflow-hidden p-0"
        style={{
          boxShadow: 'var(--shadow-overlay)',
          animation: 'overlay-in var(--duration-fast) var(--ease-ui)',
        }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-[var(--color-hairline)] px-4 py-3">
          <h2 id="folder-picker-title" className="text-sm font-semibold">
            {t('workspace.browseTitle')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg p-1 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
            aria-label={t('common.close')}
          >
            <X size={15} aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-[var(--color-hairline)] px-4 py-2">
          <button
            type="button"
            onClick={() => current && setPath(parentOf(current))}
            disabled={!current || parentOf(current) === current}
            title={t('workspace.up')}
            aria-label={t('workspace.up')}
            className="shrink-0 rounded-lg p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-raised)] disabled:opacity-30"
          >
            <ChevronUp size={14} aria-hidden />
          </button>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-ink-muted)]">
            {current ?? ''}
          </code>
        </div>

        <div className="min-h-[16rem] flex-1 overflow-y-auto p-2">
          {listing.isPending ? (
            <SkeletonText lines={6} />
          ) : listing.error ? (
            <p className="p-3 text-sm text-[var(--color-danger)]" role="alert">
              {listing.error.message}
            </p>
          ) : folders.length === 0 ? (
            <p className="p-3 text-xs text-[var(--color-ink-muted)]">
              {t('workspace.browseEmpty')}
            </p>
          ) : (
            <ul>
              {folders.map((folder) => (
                <li key={folder.path}>
                  <button
                    type="button"
                    onClick={() => setPath(folder.path)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
                  >
                    <FolderClosed size={13} className="shrink-0" aria-hidden />
                    <span className="truncate font-mono">{folder.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-hairline)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)]"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!current}
            onClick={() => current && onSelect(current)}
            className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs text-[var(--color-accent)] disabled:opacity-40"
          >
            {t('workspace.browseSelect')}
          </button>
        </div>
      </div>
    </div>
  );
}
