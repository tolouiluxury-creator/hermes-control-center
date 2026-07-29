import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, FileText, Pencil, Plus, Radio, Star, Trash2 } from 'lucide-react';
import {
  createProfile,
  deleteProfile,
  getProfileSoul,
  getProfiles,
  queryKeys,
  renameProfile,
  saveProfileSoul,
  setActiveProfile,
  setProfileDescription,
  setProfileModel,
  getModelOptions,
  type ProfileCreateInput,
} from '@/lib/api';
import type { ProfileSummary, ProviderSummary } from '@/lib/hermesTypes';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';

/**
 * Profiles are whole installations of the agent side by side: each has its own
 * config, skills, memory and conversations. Until now the control center could
 * see them and not touch them.
 *
 * Two pointers matter and they are not the same, which is the one thing this
 * page has to get across. `active` is sticky — the profile the next terminal
 * command picks up. `current` is the profile the running dashboard is scoped to,
 * and therefore what an unscoped chat actually uses. Hermes' own docstring is
 * explicit that setting the first "does not retarget the already-running
 * dashboard process", so the page labels them apart instead of offering one
 * button that appears to do both.
 */
export function ProfilePage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ProfileCreateInput>({ name: '' });
  const [renaming, setRenaming] = useState<{ name: string; next: string } | null>(null);
  const [describing, setDescribing] = useState<{ name: string; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [soulFor, setSoulFor] = useState<string | null>(null);
  const [soulDraft, setSoulDraft] = useState('');

  const profiles = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: getProfiles,
    staleTime: 30_000,
  });

  const models = useQuery({
    queryKey: queryKeys.models,
    queryFn: getModelOptions,
    staleTime: 60_000,
  });

  const soul = useQuery({
    queryKey: queryKeys.profileSoul(soulFor ?? ''),
    queryFn: () => getProfileSoul(soulFor ?? ''),
    enabled: soulFor !== null,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.profiles });

  /** Every write here reports through the same two lines, so none can fail silently. */
  const run = <T,>(
    work: () => Promise<T>,
    successTitle: string,
    onDone?: () => void,
  ): Promise<void> =>
    work()
      .then(async () => {
        await refresh();
        onDone?.();
        toast.push({ tone: 'success', title: successTitle });
      })
      .catch((error: unknown) => {
        toast.push({
          tone: 'error',
          title: t('profile.failed'),
          description: error instanceof Error ? error.message : undefined,
        });
      });

  const create = useMutation({
    mutationFn: () => createProfile(draft),
    onSuccess: async () => {
      await refresh();
      setCreating(false);
      setDraft({ name: '' });
      toast.push({ tone: 'success', title: t('profile.created', { name: draft.name }) });
    },
    onError: (error: Error) =>
      toast.push({ tone: 'error', title: t('profile.failed'), description: error.message }),
  });

  const saveSoul = useMutation({
    mutationFn: () => saveProfileSoul(soulFor ?? '', soulDraft),
    onSuccess: () => {
      setSoulFor(null);
      toast.push({ tone: 'success', title: t('profile.soulSaved') });
    },
    onError: (error: Error) =>
      toast.push({ tone: 'error', title: t('profile.failed'), description: error.message }),
  });

  const list = profiles.data?.profiles ?? [];

  return (
    <PageShell title={t('nav.profile')} description={t('page.profile.desc')}>
      {profiles.isPending ? (
        <SkeletonText lines={8} />
      ) : profiles.error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {profiles.error.message}
        </p>
      ) : (
        <>
          <section className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 p-5">
            <div>
              <p className="text-xs text-[var(--color-ink-faint)]">{t('profile.runningAs')}</p>
              <p className="mt-1 font-mono text-lg">{profiles.data?.current ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-ink-faint)]">{t('profile.stickyIs')}</p>
              <p className="mt-1 font-mono text-lg">{profiles.data?.active ?? '—'}</p>
            </div>
            {profiles.data?.active !== profiles.data?.current && (
              <p className="w-full text-xs text-[var(--color-warn)]">{t('profile.mismatch')}</p>
            )}
            <button
              type="button"
              onClick={() => setCreating((open) => !open)}
              className="ms-auto inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
            >
              <Plus size={14} aria-hidden />
              {t('profile.new')}
            </button>
          </section>

          {creating && (
            <section className="card mb-4 space-y-3 p-5">
              <label className="block">
                <span className="text-xs text-[var(--color-ink-faint)]">{t('profile.name')}</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="research"
                  className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-sm outline-none focus-visible:border-[var(--color-accent)]"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--color-ink-faint)]">
                  {t('profile.description')}
                </span>
                <input
                  value={draft.description ?? ''}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--color-ink-faint)]">
                  {t('profile.cloneFrom')}
                </span>
                <select
                  value={draft.cloneFrom ?? ''}
                  onChange={(event) =>
                    setDraft({ ...draft, cloneFrom: event.target.value || undefined })
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
                >
                  <option value="">{t('profile.cloneNone')}</option>
                  {list.map((profile) => (
                    <option key={profile.name} value={profile.name}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              {draft.cloneFrom && (
                <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                  <input
                    type="checkbox"
                    checked={draft.cloneAll === true}
                    onChange={(event) => setDraft({ ...draft, cloneAll: event.target.checked })}
                  />
                  {t('profile.cloneAll')}
                </label>
              )}
              <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                <input
                  type="checkbox"
                  checked={draft.noSkills === true}
                  onChange={(event) => setDraft({ ...draft, noSkills: event.target.checked })}
                />
                {t('profile.noSkills')}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={draft.name.trim() === '' || create.isPending}
                  onClick={() => create.mutate()}
                  className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:opacity-40"
                >
                  {t('profile.create')}
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="rounded-lg border border-[var(--color-hairline)] px-3 py-1.5 text-sm text-[var(--color-ink-muted)]"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </section>
          )}

          <ul className="space-y-3">
            {list.map((profile) => (
              <li key={profile.name} className="card p-4">
                <ProfileRow
                  profile={profile}
                  isRunning={profile.name === profiles.data?.current}
                  isSticky={profile.name === profiles.data?.active}
                  onMakeSticky={() =>
                    void run(
                      () => setActiveProfile(profile.name),
                      t('profile.stickySet', { name: profile.name }),
                    )
                  }
                  onRename={() => setRenaming({ name: profile.name, next: profile.name })}
                  onDescribe={() =>
                    setDescribing({ name: profile.name, text: profile.description ?? '' })
                  }
                  onSoul={() => {
                    setSoulFor(profile.name);
                    setSoulDraft('');
                  }}
                  onDelete={() => setConfirmDelete(profile.name)}
                  providers={models.data?.providers ?? []}
                  onModel={(provider, model) =>
                    void run(
                      () => setProfileModel(profile.name, provider, model),
                      t('profile.modelSet', { model }),
                    )
                  }
                />

                {renaming?.name === profile.name && (
                  <InlineEdit
                    value={renaming.next}
                    onChange={(next) => setRenaming({ ...renaming, next })}
                    onSave={() =>
                      void run(
                        () => renameProfile(profile.name, renaming.next),
                        t('profile.renamed', { name: renaming.next }),
                        () => setRenaming(null),
                      )
                    }
                    onCancel={() => setRenaming(null)}
                    saveLabel={t('profile.rename')}
                    cancelLabel={t('common.cancel')}
                    mono
                  />
                )}

                {describing?.name === profile.name && (
                  <InlineEdit
                    value={describing.text}
                    onChange={(text) => setDescribing({ ...describing, text })}
                    onSave={() =>
                      void run(
                        () => setProfileDescription(profile.name, describing.text),
                        t('profile.described'),
                        () => setDescribing(null),
                      )
                    }
                    onCancel={() => setDescribing(null)}
                    saveLabel={t('common.save')}
                    cancelLabel={t('common.cancel')}
                  />
                )}

                {soulFor === profile.name && (
                  <div className="mt-3">
                    {soul.isPending ? (
                      <SkeletonText lines={4} />
                    ) : (
                      <>
                        <p className="mb-1 text-xs text-[var(--color-ink-faint)]">
                          {soul.data?.exists ? t('profile.soulExists') : t('profile.soulNew')}
                        </p>
                        <textarea
                          value={soulDraft || (soul.data?.content ?? '')}
                          onChange={(event) => setSoulDraft(event.target.value)}
                          rows={12}
                          className="w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)]"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={saveSoul.isPending}
                            onClick={() => saveSoul.mutate()}
                            className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs text-[var(--color-accent)] disabled:opacity-40"
                          >
                            {t('common.save')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSoulFor(null)}
                            className="rounded-lg border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)]"
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {confirmDelete === profile.name && (
                  <ConfirmInline
                    tone="danger"
                    message={t('profile.deleteConfirm', { name: profile.name })}
                    confirmLabel={t('common.delete')}
                    onConfirm={() =>
                      void run(
                        () => deleteProfile(profile.name),
                        t('profile.deleted', { name: profile.name }),
                        () => setConfirmDelete(null),
                      )
                    }
                    onCancel={() => setConfirmDelete(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}

interface ProfileRowProps {
  profile: ProfileSummary;
  isRunning: boolean;
  isSticky: boolean;
  onMakeSticky: () => void;
  onRename: () => void;
  onDescribe: () => void;
  onSoul: () => void;
  onDelete: () => void;
  providers: ProviderSummary[];
  onModel: (provider: string, model: string) => void;
}

function ProfileRow({
  profile,
  isRunning,
  isSticky,
  onMakeSticky,
  onRename,
  onDescribe,
  onSoul,
  onDelete,
  providers,
  onModel,
}: ProfileRowProps) {
  const { t } = useI18n();
  // A provider you cannot reach would only produce a profile that fails on its
  // first turn, so the picker offers the ones that are signed in.
  const choices = providers.filter((provider) => provider.authenticated !== false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{profile.name}</span>

        {isRunning && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[0.65rem] text-[var(--color-accent)]"
            title={t('profile.runningHint')}
          >
            <Radio size={10} aria-hidden />
            {t('profile.running')}
          </span>
        )}
        {isSticky && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-[0.65rem] text-[var(--color-ink-muted)]"
            title={t('profile.stickyHint')}
          >
            <Star size={10} aria-hidden />
            {t('profile.sticky')}
          </span>
        )}
        {profile.isDefault && (
          <span className="rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-[0.65rem] text-[var(--color-ink-faint)]">
            {t('profile.isDefault')}
          </span>
        )}
        {profile.gatewayRunning && (
          <span
            className="rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-[0.65rem] text-[var(--color-ok)]"
            title={t('profile.gatewayHint')}
          >
            {t('profile.gateway')}
          </span>
        )}

        <span className="ms-auto flex shrink-0 items-center gap-1">
          {!isSticky && (
            <RowButton onClick={onMakeSticky} title={t('profile.makeSticky')}>
              <Star size={13} aria-hidden />
            </RowButton>
          )}
          <RowButton onClick={onSoul} title={t('profile.soul')}>
            <FileText size={13} aria-hidden />
          </RowButton>
          <RowButton onClick={onDescribe} title={t('profile.describe')}>
            <Pencil size={13} aria-hidden />
          </RowButton>
          <RowButton onClick={onRename} title={t('profile.rename')}>
            <Copy size={13} aria-hidden />
          </RowButton>
          {/* Out of reach on purpose: the default profile (Hermes refuses anyway),
              the one this dashboard is running as, and any profile whose gateway
              is live — that last one is somebody's bot answering messages right
              now, and deleting it would take config, memory and every
              conversation with it. */}
          {!profile.isDefault && !isRunning && !profile.gatewayRunning && (
            <RowButton onClick={onDelete} title={t('common.delete')} danger>
              <Trash2 size={13} aria-hidden />
            </RowButton>
          )}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[0.7rem] text-[var(--color-ink-faint)]">{t('profile.model')}</span>
        <select
          value={profile.model ? `${profile.provider ?? ''}|${profile.model}` : ''}
          onChange={(event) => {
            const [provider = '', model = ''] = event.target.value.split('|');
            if (model !== '') onModel(provider, model);
          }}
          className="min-w-0 max-w-xs flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)]"
        >
          {/* The stored pair may name a provider slug the options list spells
              differently (a custom endpoint), so the current value is always
              offered back — otherwise the select would silently show something
              this profile is not on. */}
          <option value={profile.model ? `${profile.provider ?? ''}|${profile.model}` : ''}>
            {profile.model ?? t('profile.modelNone')}
            {profile.provider ? ` · ${profile.provider}` : ''}
          </option>
          {choices.flatMap((provider) =>
            provider.models
              .filter((model) => !(model === profile.model && provider.slug === profile.provider))
              .map((model) => (
                <option key={`${provider.slug}|${model}`} value={`${provider.slug}|${model}`}>
                  {model} · {provider.name}
                </option>
              )),
          )}
        </select>
      </div>

      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] text-[var(--color-ink-faint)]">
        {profile.skillCount !== null && (
          <span>{t('profile.skills', { count: profile.skillCount })}</span>
        )}
        {profile.path && <span className="font-mono">{profile.path}</span>}
      </p>

      {profile.description && (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{profile.description}</p>
      )}
    </>
  );
}

function RowButton({
  onClick,
  title,
  danger,
  children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`rounded-lg border border-[var(--color-hairline)] p-1.5 transition-colors hover:border-[var(--color-accent)]/40 ${
        danger
          ? 'text-[var(--color-danger)] hover:border-[var(--color-danger)]/40'
          : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}

function InlineEdit({
  value,
  onChange,
  onSave,
  onCancel,
  saveLabel,
  cancelLabel,
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  cancelLabel: string;
  mono?: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`min-w-0 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-1.5 text-sm outline-none focus-visible:border-[var(--color-accent)] ${
          mono ? 'font-mono' : ''
        }`}
      />
      <button
        type="button"
        onClick={onSave}
        disabled={value.trim() === ''}
        className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs text-[var(--color-accent)] disabled:opacity-40"
      >
        <Check size={12} aria-hidden />
        {saveLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)]"
      >
        {cancelLabel}
      </button>
    </div>
  );
}
