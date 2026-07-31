import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronUp, File, FolderClosed, FolderPlus, Trash2 } from 'lucide-react';
import {
  createWorkspaceDirectory,
  deleteWorkspaceEntry,
  getWorkspaceRoot,
  listWorkspace,
  queryKeys,
  readWorkspaceFile,
  writeWorkspaceFile,
} from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/format';

/**
 * Files on the Hermes host, confined to one configured directory.
 *
 * The confinement is enforced on our server, not here — see
 * `src/routes/workspaceRoot.ts` for why it has to exist at all. This page only
 * ever sends back paths it was given, and the backend re-checks every one.
 */
export function WorkspacePage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [path, setPath] = useState<string | undefined>(undefined);
  const [openFile, setOpenFile] = useState<string | null>(null);
  /** The buffer while editing; null means the file is only being read. */
  const [editing, setEditing] = useState<string | null>(null);

  /**
   * Every change of the shown file goes through here, so the edit buffer can
   * never outlive the file it came from. Four call sites set this, and one of
   * them forgetting would mean saving one file's text into another.
   */
  const showFile = (target: string | null) => {
    setOpenFile(target);
    setEditing(null);
  };
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ path: string; directory: boolean } | null>(
    null,
  );

  const root = useQuery({ queryKey: queryKeys.workspaceRoot, queryFn: getWorkspaceRoot });

  const listing = useQuery({
    queryKey: queryKeys.workspaceList(path ?? ''),
    queryFn: () => listWorkspace(path),
    enabled: root.data?.configured === true,
  });

  const file = useQuery({
    queryKey: queryKeys.workspaceFile(openFile ?? ''),
    queryFn: () => readWorkspaceFile(openFile ?? ''),
    enabled: openFile !== null,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['workspace'] });
  const fail = (error: Error) =>
    toast.push({ tone: 'error', title: t('workspace.failed'), description: error.message });

  /*
   * A folder name, not a path. Separators and `..` would compose a path that the
   * server refuses as "outside the workspace root" — a true message, but a
   * baffling one when all you did was type a name. Said here instead, and the
   * server check stays where it belongs: it guards the API, not the typing.
   */
  const nameError = ((): string | null => {
    const name = newName.trim();
    if (name === '') return null;
    if (/[\\/]/.test(name)) return t('workspace.nameNoSlash');
    if (name === '.' || name === '..') return t('workspace.nameNoDots');
    return null;
  })();
  const mkdir = useMutation({
    mutationFn: () => createWorkspaceDirectory(`${listing.data?.path ?? ''}/${newName.trim()}`),
    onSuccess: async () => {
      setCreating(false);
      setNewName('');
      await refresh();
      toast.push({ tone: 'success', title: t('workspace.created') });
    },
    onError: fail,
  });

  /*
   * Hermes puts freshness on the client — "Stale-on-disk detection is the
   * client's job (re-read before save)" — so the read is invalidated after every
   * write and the editor closes onto the re-read text rather than its own copy.
   */
  const save = useMutation({
    mutationFn: ({ path: target, content }: { path: string; content: string }) =>
      writeWorkspaceFile(target, content),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
      toast.push({ tone: 'success', title: t('workspace.saved') });
    },
    onError: fail,
  });

  /* Also waits for the listing: the new folder's path is built from it. */
  const canCreate =
    newName.trim() !== '' && nameError === null && !mkdir.isPending && listing.data !== undefined;

  const remove = useMutation({
    mutationFn: ({ path: target, directory }: { path: string; directory: boolean }) =>
      // A directory needs the recursive flag; Hermes 409s on a non-empty one
      // without it, and the confirmation already said what is going.
      deleteWorkspaceEntry(target, directory),
    onSuccess: async () => {
      setConfirmDelete(null);
      showFile(null);
      await refresh();
      toast.push({ tone: 'success', title: t('workspace.deleted') });
    },
    onError: fail,
  });

  if (root.isPending) {
    return (
      <PageShell title={t('nav.workspace')} description={t('page.workspace.desc')}>
        <SkeletonText lines={6} />
      </PageShell>
    );
  }

  // Nothing configured means nothing shown. See the route module for why there
  // is no default: guessing which directory is safe to expose is not possible.
  if (!root.data?.configured) {
    return (
      <PageShell title={t('nav.workspace')} description={t('page.workspace.desc')}>
        <div className="card p-8">
          <p className="text-sm font-medium">{t('workspace.notConfigured')}</p>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            {t('workspace.notConfiguredWhy')}
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] p-3 font-mono text-xs">
            {'{\n  "workspaceRoot": "/root/workspace"\n}'}
          </pre>
        </div>
      </PageShell>
    );
  }

  const entries = listing.data?.entries ?? [];

  return (
    <PageShell
      title={t('nav.workspace')}
      description={t('page.workspace.desc')}
      actions={
        <button
          type="button"
          onClick={() => setCreating((open) => !open)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
        >
          <FolderPlus size={14} aria-hidden />
          {t('workspace.newFolder')}
        </button>
      }
      wide
    >
      <div className="card mb-3 flex flex-wrap items-center gap-2 p-3">
        <span className="font-mono text-xs text-[var(--color-ink-muted)]">
          {listing.data?.display ?? '/'}
        </span>
        <span
          className="ms-auto font-mono text-[0.65rem] text-[var(--color-ink-faint)]"
          title={t('workspace.rootTitle')}
        >
          {root.data.root}
        </span>
      </div>

      {/* Worth stating plainly: Hermes is not the thing keeping this in bounds. */}
      {listing.data && listing.data.hermesLockedRoot === null && (
        <p className="mb-3 text-xs text-[var(--color-ink-faint)]">{t('workspace.weConfine')}</p>
      )}

      {creating && (
        <div className="card mb-3 flex flex-wrap items-center gap-2 p-3">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t('workspace.folderName')}
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)]"
          />
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => mkdir.mutate()}
            className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs text-[var(--color-accent)] disabled:opacity-40"
          >
            {t('workspace.create')}
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)]"
          >
            {t('common.cancel')}
          </button>
          {nameError && (
            <p className="w-full text-xs text-[var(--color-danger)]" role="alert">
              {nameError}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="card p-2">
          {listing.isPending ? (
            <SkeletonText lines={6} />
          ) : listing.error ? (
            <p className="p-3 text-sm text-[var(--color-danger)]" role="alert">
              {listing.error.message}
            </p>
          ) : (
            <ul>
              {listing.data && !listing.data.atRoot && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setPath(parentOf(listing.data.path));
                      showFile(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)]"
                  >
                    <ChevronUp size={13} aria-hidden />
                    {t('workspace.up')}
                  </button>
                </li>
              )}
              {entries.length === 0 && (
                <li className="px-2.5 py-3 text-xs text-[var(--color-ink-muted)]">
                  {t('workspace.empty')}
                </li>
              )}
              {entries.map((entry) => (
                <li key={entry.path}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (entry.isDirectory) {
                          setPath(entry.path);
                          showFile(null);
                        } else {
                          showFile(entry.path);
                        }
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                        entry.path === openFile
                          ? 'bg-[var(--color-accent)]/10 text-[var(--color-ink)]'
                          : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)]'
                      }`}
                    >
                      {entry.isDirectory ? (
                        <FolderClosed size={13} className="shrink-0" aria-hidden />
                      ) : (
                        <File size={13} className="shrink-0" aria-hidden />
                      )}
                      <span className="truncate font-mono">{entry.name}</span>
                      {entry.modified && (
                        <span className="ms-auto shrink-0 text-[0.65rem] text-[var(--color-ink-faint)]">
                          {formatRelativeTime(entry.modified, lang)}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDelete({ path: entry.path, directory: entry.isDirectory })
                      }
                      aria-label={`${t('common.delete')} ${entry.name}`}
                      title={t('common.delete')}
                      className="shrink-0 rounded-lg p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
                    >
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </div>
                  {confirmDelete?.path === entry.path && (
                    <div className="px-2 pb-2">
                      <ConfirmInline
                        tone="danger"
                        message={
                          entry.isDirectory
                            ? t('workspace.deleteFolderConfirm', { name: entry.name })
                            : t('workspace.deleteFileConfirm', { name: entry.name })
                        }
                        confirmLabel={t('common.delete')}
                        pending={remove.isPending}
                        onConfirm={() => remove.mutate(confirmDelete)}
                        onCancel={() => setConfirmDelete(null)}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card min-h-[20rem] p-4">
          {openFile === null ? (
            <p className="text-xs text-[var(--color-ink-muted)]">{t('workspace.pickFile')}</p>
          ) : file.isPending ? (
            <SkeletonText lines={8} />
          ) : file.error ? (
            <p className="text-sm text-[var(--color-danger)]" role="alert">
              {file.error.message}
            </p>
          ) : file.data?.binary ? (
            <p className="text-xs text-[var(--color-ink-muted)]">{t('workspace.binary')}</p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-ink-faint)]">
                  {file.data?.name}
                </p>
                {editing === null ? (
                  <button
                    type="button"
                    onClick={() => setEditing(file.data?.text ?? '')}
                    className="shrink-0 rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                  >
                    {t('common.edit')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={save.isPending || editing === file.data?.text}
                      onClick={() => save.mutate({ path: openFile, content: editing })}
                      className="shrink-0 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs text-[var(--color-accent)] disabled:opacity-40"
                    >
                      {save.isPending ? t('common.saving') : t('common.save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="shrink-0 rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)]"
                    >
                      {t('common.cancel')}
                    </button>
                  </>
                )}
              </div>

              {editing === null ? (
                <pre className="overflow-x-auto text-xs whitespace-pre-wrap">{file.data?.text}</pre>
              ) : (
                <textarea
                  value={editing}
                  onChange={(event) => setEditing(event.target.value)}
                  rows={22}
                  spellCheck={false}
                  className="w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] p-2 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)]"
                />
              )}
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}

/** Parent of an absolute path, in whichever separator the host reports. */
function parentOf(absolute: string): string {
  const cut = Math.max(absolute.lastIndexOf('/'), absolute.lastIndexOf('\\'));
  return cut <= 0 ? absolute : absolute.slice(0, cut);
}
