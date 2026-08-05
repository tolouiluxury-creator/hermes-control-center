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
  setWorkspaceRoot,
  writeWorkspaceFile,
} from '@/lib/api';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { FolderPicker } from '@/components/FolderPicker';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/format';
import { parentOf } from '@/lib/paths';

/**
 * Files on the Hermes host, confined to one configured directory.
 *
 * The confinement is enforced on our server, not here — see
 * `src/routes/workspaceRoot.ts` for why it has to exist at all. This page only
 * ever sends back paths it was given, and the backend re-checks every one.
 */
export function WorkspaceBrowser({ compact = false }: { compact?: boolean }) {
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
  const [createKind, setCreateKind] = useState<'folder' | 'file'>('folder');
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ path: string; directory: boolean } | null>(
    null,
  );
  const [rootDraft, setRootDraft] = useState('');
  const [browsingRoot, setBrowsingRoot] = useState(false);

  const root = useQuery({ queryKey: queryKeys.workspaceRoot, queryFn: getWorkspaceRoot });

  const setRoot = useMutation({
    mutationFn: (value: string) => setWorkspaceRoot(value),
    onSuccess: async () => {
      // Changing the root mid-browse would otherwise leave stale state around:
      // a sub-path or open file from the *old* root, now pointed at the new
      // one — at best a wrong listing, at worst a save landing somewhere the
      // person never chose.
      setPath(undefined);
      showFile(null);
      setConfirmDelete(null);
      setRootDraft('');
      await queryClient.invalidateQueries({ queryKey: ['workspace'] });
      toast.push({ tone: 'success', title: t('workspace.rootSet') });
    },
    onError: (error: Error) =>
      toast.push({ tone: 'error', title: t('workspace.failed'), description: error.message }),
  });

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
  /*
   * One mutation for both kinds. A new file is created empty and opened straight
   * into the editor — creating a file only to hunt for it in the list would be
   * a step nobody wants.
   */
  const create = useMutation({
    mutationFn: () => {
      const target = `${listing.data?.path ?? ''}/${newName.trim()}`;
      return createKind === 'folder'
        ? createWorkspaceDirectory(target)
        : writeWorkspaceFile(target, '');
    },
    onSuccess: async () => {
      const target = `${listing.data?.path ?? ''}/${newName.trim()}`;
      const madeFile = createKind === 'file';
      setCreating(false);
      setNewName('');
      await refresh();
      if (madeFile) {
        setOpenFile(target);
        setEditing('');
      }
      toast.push({
        tone: 'success',
        title: t(madeFile ? 'workspace.fileCreated' : 'workspace.created'),
      });
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
    newName.trim() !== '' && nameError === null && !create.isPending && listing.data !== undefined;

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
    return <SkeletonText lines={6} />;
  }

  // Nothing configured means nothing shown. See the route module for why there
  // is no default: guessing which directory is safe to expose is not possible
  // server-side, so the person using this page names it instead.
  if (!root.data?.configured) {
    return (
      <div className="card p-8">
        <p className="text-sm font-medium">{t('workspace.notConfigured')}</p>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          {t('workspace.notConfiguredWhy')}
        </p>
        <form
          className="mt-4 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = rootDraft.trim();
            if (value === '' || setRoot.isPending) return;
            setRoot.mutate(value);
          }}
        >
          <input
            value={rootDraft}
            onChange={(event) => setRootDraft(event.target.value)}
            placeholder={t('workspace.rootPlaceholder')}
            aria-label={t('workspace.rootLabel')}
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)]"
          />
          <button
            type="button"
            onClick={() => setBrowsingRoot(true)}
            className="shrink-0 rounded-lg border border-[var(--color-hairline)] px-3 py-2 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            {t('workspace.browse')}
          </button>
          <button
            type="submit"
            disabled={rootDraft.trim() === '' || setRoot.isPending}
            className="shrink-0 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-xs text-[var(--color-accent)] disabled:opacity-40"
          >
            {t('workspace.rootSave')}
          </button>
        </form>
        <p className="mt-2 text-xs text-[var(--color-ink-faint)]">{t('workspace.rootHint')}</p>
        {browsingRoot && (
          <FolderPicker
            onClose={() => setBrowsingRoot(false)}
            onSelect={(picked) => {
              setRootDraft(picked);
              setBrowsingRoot(false);
            }}
          />
        )}
      </div>
    );
  }

  const entries = listing.data?.entries ?? [];

  return (
    <div className={compact ? 'flex h-full min-h-0 flex-col' : undefined}>
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
        <button
          type="button"
          onClick={() => setBrowsingRoot(true)}
          className="shrink-0 rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
          {t('workspace.rootChange')}
        </button>
      </div>

      {browsingRoot && (
        <FolderPicker
          onClose={() => setBrowsingRoot(false)}
          onSelect={(picked) => {
            setBrowsingRoot(false);
            setRoot.mutate(picked);
          }}
        />
      )}

      {/* Worth stating plainly: Hermes is not the thing keeping this in bounds. */}
      {listing.data && listing.data.hermesLockedRoot === null && (
        <p className="mb-3 text-xs text-[var(--color-ink-faint)]">{t('workspace.weConfine')}</p>
      )}

      <div className="mb-3">
        <button
          type="button"
          onClick={() => setCreating((open) => !open)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
        >
          <FolderPlus size={14} aria-hidden />
          {t('workspace.new')}
        </button>
      </div>

      {creating && (
        <div
          className={`card mb-3 flex gap-2 p-3 ${
            compact ? 'flex-col items-stretch' : 'flex-wrap items-center'
          }`}
        >
          {/* Folder or file: Hermes' write-text creates as well as overwrites. */}
          <div
            className="flex shrink-0 gap-1"
            role="radiogroup"
            aria-label={t('workspace.newWhat')}
          >
            {(['folder', 'file'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={createKind === kind}
                onClick={() => setCreateKind(kind)}
                className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                  createKind === kind
                    ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {t(kind === 'folder' ? 'workspace.kindFolder' : 'workspace.kindFile')}
              </button>
            ))}
          </div>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t(createKind === 'folder' ? 'workspace.folderName' : 'workspace.fileName')}
            autoFocus
            className={`rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)] ${
              compact ? 'w-full' : 'min-w-0 flex-1'
            }`}
          />
          {/* `contents` in the wide layout keeps these as direct flex items of
              the row above, same as before; the compact layout needs its own
              row instead — cramming radios + name + two buttons into a 288px
              sidebar on one flex-wrap line looked exactly as messy as it sounds. */}
          <div className={compact ? 'flex gap-2' : 'contents'}>
            <button
              type="button"
              disabled={!canCreate}
              onClick={() => create.mutate()}
              className={`rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs text-[var(--color-accent)] disabled:opacity-40 ${compact ? 'flex-1' : ''}`}
            >
              {t('workspace.create')}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className={`rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] ${compact ? 'flex-1' : ''}`}
            >
              {t('common.cancel')}
            </button>
          </div>
          {nameError && (
            <p className="w-full text-xs text-[var(--color-danger)]" role="alert">
              {nameError}
            </p>
          )}
        </div>
      )}

      <div
        className={compact ? 'flex min-h-0 flex-1 flex-col' : 'grid gap-4 lg:grid-cols-[22rem_1fr]'}
      >
        {(!compact || openFile === null) && (
          <div className={compact ? 'min-h-0 flex-1 overflow-y-auto' : 'card p-2'}>
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
        )}

        {(!compact || openFile !== null) && (
          <div
            className={
              compact
                ? 'flex min-h-0 flex-1 flex-col overflow-y-auto p-2'
                : 'card min-h-[20rem] p-4'
            }
          >
            {compact && openFile !== null && (
              <button
                type="button"
                onClick={() => showFile(null)}
                className="mb-2 self-start text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                ← {t('workspace.backToList')}
              </button>
            )}
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
                  <pre className="overflow-x-auto text-xs whitespace-pre-wrap">
                    {file.data?.text}
                  </pre>
                ) : (
                  <textarea
                    value={editing}
                    onChange={(event) => setEditing(event.target.value)}
                    rows={compact ? 12 : 22}
                    spellCheck={false}
                    className="w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] p-2 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)]"
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
