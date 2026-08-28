import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  Braces,
  FileCode,
  KeyRound,
  Languages,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Sun,
  Type,
  UserRound,
  Wrench,
} from 'lucide-react';
import {
  changePassword,
  deleteEnv,
  getAuthStatus,
  getConfigRaw,
  getCurator,
  getEnv,
  getProfiles,
  getToolsets,
  getUpdate,
  getUpdateCheck,
  getMeta,
  getSelfUpdateState,
  triggerSelfUpdate,
  getHermesUpdateState,
  triggerHermesUpdate,
  queryKeys,
  runCurator,
  setCuratorPaused,
  setEnv,
  toggleToolset,
} from '@/lib/api';
import { FilterChips, PageShell, SearchField } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { ChipMenu, type ChipMenuOption } from '@/components/ChipMenu';
import { useToast } from '@/components/Toast';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { useFontSize, type FontSizePreference } from '@/lib/fontSize';
import { useI18n, LANGUAGES } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/format';
import type { EnvVar, Toolset } from '@/lib/hermesTypes';

function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id}>
      {/* Not `text-base`: this project's theme registers `base` as a color
          token too (the page background), and Tailwind resolves the name
          collision in the color utility's favor — `text-base` silently sets
          the text color to the background instead of the font size,
          rendering the heading invisible. `text-[0.9375rem]` sizes it
          without touching that name. */}
      <h3 className="text-[0.9375rem] font-semibold text-[var(--color-ink)]">{title}</h3>
      {description && (
        <p className="mt-0.5 mb-4 max-w-2xl text-sm text-[var(--color-ink-muted)]">{description}</p>
      )}
      {!description && <div className="mb-4" />}
      {children}
    </section>
  );
}

// --- Appearance -------------------------------------------------------------

const THEME_OPTIONS: { id: ThemePreference; icon: typeof Moon }[] = [
  { id: 'dark', icon: Moon },
  { id: 'light', icon: Sun },
  { id: 'system', icon: Monitor },
];

const THEME_LABEL_KEY: Record<ThemePreference, string> = {
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
  system: 'settings.theme.system',
};

/** Icon grows with the option so the row previews the effect, not just names it. */
const FONT_SIZE_OPTIONS: { id: FontSizePreference; size: number }[] = [
  { id: 'small', size: 12 },
  { id: 'default', size: 14 },
  { id: 'large', size: 17 },
];

const FONT_SIZE_LABEL_KEY: Record<FontSizePreference, string> = {
  small: 'settings.fontSize.small',
  default: 'settings.fontSize.default',
  large: 'settings.fontSize.large',
};

function LanguageSection() {
  const { t, lang, setLang } = useI18n();
  return (
    <Section id="language" title={t('settings.language')} description={t('settings.language.desc')}>
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map(({ id, endonym }) => {
          const active = lang === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setLang(id)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {endonym}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function AppearanceSection() {
  const { t } = useI18n();
  const { preference, setPreference } = useTheme();
  const { preference: fontSize, setPreference: setFontSize } = useFontSize();
  return (
    <Section
      id="appearance"
      title={t('settings.appearance')}
      description={t('settings.appearance.desc')}
    >
      <div className="flex flex-wrap gap-2">
        {THEME_OPTIONS.map(({ id, icon: Icon }) => {
          const active = preference === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPreference(id)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Icon size={14} aria-hidden />
              {t(THEME_LABEL_KEY[id])}
            </button>
          );
        })}
      </div>

      <p className="mt-4 mb-2 text-xs font-medium text-[var(--color-ink-muted)]">
        {t('settings.fontSize')}
      </p>
      <div className="flex flex-wrap gap-2">
        {FONT_SIZE_OPTIONS.map(({ id, size }) => {
          const active = fontSize === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFontSize(id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Type size={size} aria-hidden />
              {t(FONT_SIZE_LABEL_KEY[id])}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// --- Toolsets ---------------------------------------------------------------

function ToolsetRow({
  toolset,
  pending,
  onToggle,
}: {
  toolset: Toolset;
  pending: boolean;
  onToggle: (toolset: Toolset) => void;
}) {
  const { t } = useI18n();

  return (
    <li className="flex items-start gap-3 border-b border-[var(--color-hairline)] px-3 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{toolset.label}</span>
          <span className="font-mono text-[0.65rem] text-[var(--color-ink-faint)]">
            {toolset.name}
          </span>
          {/* Not a lock — a toolset can be switched on before its keys exist,
              and Hermes will simply have nothing to reach until they do. */}
          {!toolset.configured && (
            <span className="text-[0.65rem] text-[var(--color-warn)]">
              {t('settings.tools.needsKeys')}
            </span>
          )}
        </div>
        {toolset.description && (
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{toolset.description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={toolset.enabled}
        aria-label={`${toolset.label} ${toolset.enabled ? t('common.disable') : t('common.enable')}`}
        onClick={() => onToggle(toolset)}
        disabled={pending}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40"
        style={{ background: toolset.enabled ? 'var(--color-ok)' : 'var(--color-raised)' }}
      >
        <span
          className="absolute top-0.5 size-4 rounded-full bg-white transition-all"
          style={{ left: toolset.enabled ? 'calc(100% - 1.125rem)' : '0.125rem' }}
          aria-hidden
        />
      </button>
    </li>
  );
}

function ToolsetsSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.toolsets,
    queryFn: getToolsets,
    staleTime: 30_000,
  });

  const toggle = useMutation({
    mutationFn: (toolset: Toolset) => toggleToolset(toolset.name, !toolset.enabled),
    onSuccess: async (_r, toolset) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.toolsets });
      toast.push({
        tone: 'success',
        title: t(toolset.enabled ? 'skills.disabledToast' : 'skills.enabledToast', {
          name: toolset.label,
        }),
      });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.toggleFailed'), description: e.message }),
  });

  return (
    <Section id="tools" title={t('settings.tools')} description={t('settings.tools.desc')}>
      {isPending ? (
        <SkeletonText lines={5} />
      ) : error ? (
        <p className="card p-4 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : (
        <ul className="card overflow-hidden p-0">
          {(data ?? []).map((toolset) => (
            <ToolsetRow
              key={toolset.name}
              toolset={toolset}
              pending={toggle.isPending && toggle.variables?.name === toolset.name}
              onToggle={(t) => toggle.mutate(t)}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

// --- Maintenance: update + curator -----------------------------------------

/** Control Center eigene Version + Update-Status (aus /api/meta + /api/meta/update). */
function MetaVersionRow() {
  const { t } = useI18n();
  const meta = useQuery({
    queryKey: queryKeys.meta,
    queryFn: getMeta,
    staleTime: 60_000,
    retry: false,
  });
  const updateCheck = useQuery({
    queryKey: queryKeys.updateCheck,
    queryFn: getUpdateCheck,
    staleTime: 60_000,
    retry: false,
  });
  const available = updateCheck.data?.updateAvailable && updateCheck.data.latestVersion;
  return (
    <div>
      <p className="mt-1 font-mono text-lg">{meta.data?.version ? `v${meta.data.version}` : '—'}</p>
      <div className="mt-1.5">
        {available ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-xs text-[var(--color-accent)]">
            {t('settings.update.latest', { version: updateCheck.data?.latestVersion ?? '' })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
            {t('settings.update.current', { version: meta.data?.version ?? '' })}
          </span>
        )}
      </div>
    </div>
  );
}

function MaintenanceSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t, lang } = useI18n();
  const update = useQuery({ queryKey: queryKeys.update, queryFn: getUpdate, staleTime: 300_000 });
  const curator = useQuery({ queryKey: queryKeys.curator, queryFn: getCurator, staleTime: 60_000 });
  const profiles = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: getProfiles,
    staleTime: 30_000,
  });

  /**
   * Whether "Run now" and the status above it are about the same profile.
   *
   * They need not be. `GET /api/curator` answers from the dashboard's own
   * process, so it reports the profile the dashboard runs as. `POST
   * /api/curator/run` spawns `hermes curator run` with no `-p`, so it picks up
   * the sticky profile. Neither endpoint accepts a profile, so this cannot be
   * steered from here — only said out loud. Verified on a server where the two
   * differ: the run reported `checked=71`, the sticky profile's skill count,
   * while the card kept showing the other profile's untouched "last run".
   */
  const runsElsewhere =
    profiles.data != null &&
    profiles.data.active != null &&
    profiles.data.current != null &&
    profiles.data.active !== profiles.data.current;

  const invalidateCurator = () => queryClient.invalidateQueries({ queryKey: queryKeys.curator });

  const pause = useMutation({
    mutationFn: (paused: boolean) => setCuratorPaused(paused),
    onSuccess: async (_r, paused) => {
      await invalidateCurator();
      toast.push({
        tone: 'success',
        title: t(paused ? 'settings.curator.pausedToast' : 'settings.curator.resumedToast'),
      });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.actionFailed'), description: e.message }),
  });

  const run = useMutation({
    mutationFn: () => runCurator(),
    onSuccess: async () => {
      await invalidateCurator();
      toast.push({ tone: 'success', title: t('settings.curator.startedToast') });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.actionFailed'), description: e.message }),
  });

  // --- Self-Update ---------------------------------------------------------
  const ccUpdate = useQuery({
    queryKey: queryKeys.updateCheck,
    queryFn: getUpdateCheck,
    staleTime: 60_000,
  });
  const selfUpdate = useQuery({
    queryKey: queryKeys.selfUpdate,
    queryFn: getSelfUpdateState,
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data?.state.running ? 3_000 : false),
  });
  const trigger = useMutation({
    mutationFn: triggerSelfUpdate,
    onSuccess: () => {
      toast.push({ tone: 'success', title: t('settings.update.startedToast') });
    },
    onError: (e: Error) =>
      toast.push({
        tone: 'error',
        title: t('settings.update.failedToast'),
        description: e.message,
      }),
  });

  const su = selfUpdate.data?.state;
  const suRunning = su?.running ?? false;

  // --- Hermes-Agent-Update -------------------------------------------------
  const hermesUpdate = useQuery({
    queryKey: queryKeys.hermesUpdate,
    queryFn: getHermesUpdateState,
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data?.state.running ? 3_000 : false),
  });
  const triggerHermes = useMutation({
    mutationFn: triggerHermesUpdate,
    onSuccess: () => {
      toast.push({ tone: 'success', title: t('settings.hermesUpdate.startedToast') });
    },
    onError: (e: Error) =>
      toast.push({
        tone: 'error',
        title: t('settings.hermesUpdate.failedToast'),
        description: e.message,
      }),
  });

  const hu = hermesUpdate.data?.state;
  const huRunning = hu?.running ?? false;

  return (
    <Section
      id="maintenance"
      title={t('settings.maintenance')}
      description={t('settings.maintenance.desc')}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Control Center Version + Self-Update */}
        <div className="card p-4">
          <p className="text-xs text-[var(--color-ink-faint)]">{t('settings.ccTitle')}</p>
          <MetaVersionRow />
        </div>

        {/* Hermes Agent Update + Button */}
        <div className="card p-4 col-span-full">
          <p className="text-xs text-[var(--color-ink-faint)]">{t('settings.hermesUpdate.title')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm text-[var(--color-ink)]">
              {update.data?.currentVersion ?? '—'}
            </span>
            {update.data?.updateAvailable && (
              <span className="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-xs text-[var(--color-accent)]">
                {t('settings.update.available')}
              </span>
            )}
            {!update.data?.updateAvailable && !huRunning && hu?.status !== 'installed' && (
              <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
                {t('settings.update.current', { version: update.data?.currentVersion ?? '' })}
              </span>
            )}
            {hu?.status === 'running' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-xs text-[var(--color-accent)]">
                <span className="size-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
                {t('settings.update.running')}
              </span>
            )}
            {hu?.status === 'uptodate' && (
              <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-400">
                {t('settings.update.uptodate')}
              </span>
            )}
            {hu?.status === 'installed' && (
              <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-400">
                {t('settings.update.installed')}
              </span>
            )}
            {hu?.status === 'failed' && (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                {t('settings.update.failed')}
              </span>
            )}
            {hu?.message && hu?.status !== 'running' && (
              <span className="text-xs text-[var(--color-ink-muted)]">{hu.message}</span>
            )}
            <button
              type="button"
              onClick={() => triggerHermes.mutate()}
              disabled={huRunning || triggerHermes.isPending}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
            >
              <RefreshCw size={13} className={huRunning ? 'animate-spin' : ''} />
              {huRunning
                ? t('settings.update.button.running')
                : t('settings.hermesUpdate.button')}
            </button>
          </div>
          {hu?.log && hu.status !== 'idle' && (
            <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] p-2 font-mono text-[0.65rem] leading-relaxed text-[var(--color-ink-muted)]">
              {hu.log}
            </pre>
          )}
        </div>

        {/* Self-Update Karte (CC) */}
        <div className="card p-4 col-span-full">
          <p className="text-xs text-[var(--color-ink-faint)]">{t('settings.ccUpdate.title')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm text-[var(--color-ink)]">
              {ccUpdate.data?.currentVersion ?? '—'}
            </span>
            {ccUpdate.data?.updateAvailable && (
              <span className="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-xs text-[var(--color-accent)]">
                {t('settings.update.latest', { version: ccUpdate.data.latestVersion ?? '' })}
              </span>
            )}
            {!ccUpdate.data?.updateAvailable && !suRunning && su?.status !== 'installed' && (
              <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
                {t('settings.update.current', {
                  version: ccUpdate.data?.currentVersion ?? '',
                })}
              </span>
            )}
            {su?.status === 'running' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-xs text-[var(--color-accent)]">
                <span className="size-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
                {t('settings.update.running')}
              </span>
            )}
            {su?.status === 'uptodate' && (
              <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-400">
                {t('settings.update.uptodate')}
              </span>
            )}
            {su?.status === 'installed' && (
              <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-400">
                {t('settings.update.installed')}
              </span>
            )}
            {su?.status === 'failed' && (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                {t('settings.update.failed')}
              </span>
            )}
            {su?.message && su?.status !== 'running' && (
              <span className="text-xs text-[var(--color-ink-muted)]">{su.message}</span>
            )}
            <button
              type="button"
              onClick={() => trigger.mutate()}
              disabled={suRunning || trigger.isPending}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
            >
              <RefreshCw size={13} className={suRunning ? 'animate-spin' : ''} />
              {suRunning
                ? t('settings.update.button.running')
                : t('settings.update.button')}
            </button>
          </div>
          {su?.log && su.status !== 'idle' && (
            <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] p-2 font-mono text-[0.65rem] leading-relaxed text-[var(--color-ink-muted)]">
              {su.log}
            </pre>
          )}
        </div>

        <div className="card p-4">
          <p className="text-xs text-[var(--color-ink-faint)]">{t('settings.curator')}</p>
          {curator.isPending ? (
            <SkeletonText lines={2} />
          ) : curator.error ? (
            <p className="text-sm text-[var(--color-danger)]">{curator.error.message}</p>
          ) : (
            <>
              <p className="mt-1 text-sm">
                {curator.data?.paused
                  ? t('settings.curator.paused')
                  : curator.data?.enabled
                    ? t('common.active')
                    : t('settings.curator.off')}
                {curator.data?.lastRunAt && (
                  <span className="text-[var(--color-ink-faint)]">
                    {' · '}
                    {t('settings.curator.lastRun', {
                      time: formatRelativeTime(curator.data.lastRunAt, lang),
                    })}
                  </span>
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => run.mutate()}
                  disabled={run.isPending}
                  className="rounded-lg border border-[var(--color-hairline)] px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-40"
                >
                  {t('settings.curator.runNow')}
                </button>
                <button
                  type="button"
                  onClick={() => pause.mutate(!curator.data?.paused)}
                  disabled={pause.isPending}
                  className="rounded-lg border border-[var(--color-hairline)] px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
                >
                  {curator.data?.paused
                    ? t('settings.curator.resume')
                    : t('settings.curator.pause')}
                </button>
              </div>
              {runsElsewhere && (
                <p className="mt-2 text-xs text-[var(--color-warn)]">
                  {t('settings.curator.otherProfile', {
                    running: profiles.data?.current ?? '',
                    sticky: profiles.data?.active ?? '',
                  })}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

// --- Environment variables and secrets --------------------------------------

const ENV_CATEGORY_KEY: Record<string, string> = {
  provider: 'env.category.provider',
  tool: 'env.category.tool',
  skill: 'env.category.skill',
  messaging: 'env.category.messaging',
  setting: 'env.category.setting',
  sonstige: 'env.category.other',
};

function EnvRow({
  entry,
  editing,
  pending,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  entry: EnvVar;
  editing: boolean;
  pending: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();

  return (
    <li className="border-b border-[var(--color-hairline)] px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
            entry.isSet ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-ink-faint)]'
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs">{entry.key}</span>
            {entry.isSet && entry.redactedValue && (
              <span className="font-mono text-[0.65rem] text-[var(--color-ink-faint)]">
                {entry.redactedValue}
              </span>
            )}
          </div>
          {entry.description && (
            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{entry.description}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-40"
          >
            {entry.isSet ? t('settings.env.change') : t('settings.env.set')}
          </button>
          {entry.isSet && (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-40"
            >
              {t('common.delete')}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <EnvValueForm entry={entry} pending={pending} onSave={onSave} onCancel={onCancel} />
      )}
    </li>
  );
}

/**
 * The value field for one variable.
 *
 * Its own component on purpose: it holds a secret in state, and mounting it
 * only while the row is open means cancelling or saving unmounts it and the
 * typed value is gone. Kept on the row instead, the next "Change" click would
 * hand the previous secret back.
 */
function EnvValueForm({
  entry,
  pending,
  onSave,
  onCancel,
}: {
  entry: EnvVar;
  pending: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState('');

  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() !== '') onSave(value);
      }}
    >
      <input
        type={entry.isPassword ? 'password' : 'text'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        placeholder={t('settings.env.valueFor', { key: entry.key })}
        className="min-w-0 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-1.5 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)]"
      />
      <button
        type="submit"
        disabled={pending || value.trim() === ''}
        className="rounded-lg bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs text-[var(--color-accent)] disabled:opacity-40"
      >
        {t('common.save')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-ink-muted)]"
      >
        {t('common.cancel')}
      </button>
    </form>
  );
}

/**
 * The variables and secrets of one profile's `.env`.
 *
 * Profile-scoped on purpose. Every profile keeps its own `.env`, and the
 * profile the dashboard was launched with is not necessarily the one whose
 * gateway is running — on a real install those differ. Writing
 * `TELEGRAM_ALLOWED_USERS` into the wrong one is a lock on a door nobody uses:
 * the list looks set, and the bot keeps answering everybody.
 */
function EnvSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('gesetzt');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** Null means the profile the dashboard runs as. */
  const [profile, setProfile] = useState<string | null>(null);

  const profiles = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: getProfiles,
    staleTime: 60_000,
  });

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.envFor(profile),
    queryFn: () => getEnv(profile),
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.envFor(profile) });

  const profileOptions: ChipMenuOption[] = (profiles.data?.profiles ?? []).map((entry) => ({
    value: entry.name === profiles.data?.current ? '' : entry.name,
    label: entry.name,
    hint: entry.gatewayRunning ? t('telegram.gatewayUp') : null,
  }));

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => setEnv(key, value, profile),
    onSuccess: async (_r, variables) => {
      setEditing(null);
      await invalidate();
      toast.push({ tone: 'success', title: t('settings.env.savedToast', { key: variables.key }) });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.saveFailed'), description: e.message }),
  });

  const remove = useMutation({
    mutationFn: (key: string) => deleteEnv(key, profile),
    onSuccess: async (_r, key) => {
      setConfirmDelete(null);
      await invalidate();
      toast.push({ tone: 'success', title: t('settings.env.removedToast', { key }) });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.removeFailed'), description: e.message }),
  });

  const entries = useMemo(() => data ?? [], [data]);
  const categories = useMemo(() => {
    const set = new Set(entries.map((e) => e.category));
    return [...set].sort();
  }, [entries]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (needle === '') {
        // With no search, "gesetzt" shows configured vars; otherwise a category.
        if (category === 'gesetzt') return entry.isSet;
        return entry.category === category;
      }
      return (
        entry.key.toLowerCase().includes(needle) ||
        (entry.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [entries, search, category]);

  return (
    <Section id="env" title={t('settings.env')} description={t('settings.env.desc')}>
      {profileOptions.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ChipMenu
            icon={<UserRound size={12} />}
            label={profile ?? profiles.data?.current ?? '—'}
            title={t('settings.env.profileTitle')}
            options={profileOptions}
            value={profile ?? ''}
            onChange={(value) => {
              setProfile(value === '' ? null : value);
              setEditing(null);
              setConfirmDelete(null);
            }}
          />
          <span className="text-xs text-[var(--color-ink-faint)]">
            {t('settings.env.profileNote')}
          </span>
        </div>
      )}
      {isPending ? (
        <SkeletonText lines={5} />
      ) : error ? (
        <p className="card p-4 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchField
              value={search}
              onChange={setSearch}
              label={t('settings.env.searchLabel')}
            />
          </div>
          {search.trim() === '' && (
            <div className="mb-3">
              <FilterChips
                label={t('settings.env.scope')}
                value={category}
                onChange={setCategory}
                options={[
                  {
                    id: 'gesetzt',
                    label: t('settings.env.scope.set'),
                    count: entries.filter((e) => e.isSet).length,
                  },
                  ...categories.map((id) => ({
                    id,
                    label: ENV_CATEGORY_KEY[id] ? t(ENV_CATEGORY_KEY[id]) : id,
                    count: entries.filter((e) => e.category === id).length,
                  })),
                ]}
              />
            </div>
          )}

          <p className="mb-2 text-xs text-[var(--color-ink-faint)]" role="status">
            {t('settings.env.count', { count: visible.length })}
          </p>

          {visible.length === 0 ? (
            <p className="card p-6 text-center text-sm text-[var(--color-ink-muted)]">
              {t('settings.env.none')}
            </p>
          ) : (
            <ul className="card overflow-hidden p-0">
              {visible.slice(0, 100).map((entry) => (
                <div key={entry.key}>
                  <EnvRow
                    entry={entry}
                    editing={editing === entry.key}
                    pending={
                      (save.isPending && save.variables?.key === entry.key) ||
                      (remove.isPending && remove.variables === entry.key)
                    }
                    onEdit={() => {
                      setConfirmDelete(null);
                      setEditing(entry.key);
                    }}
                    onCancel={() => setEditing(null)}
                    onSave={(value) => save.mutate({ key: entry.key, value })}
                    onDelete={() => {
                      setEditing(null);
                      setConfirmDelete(entry.key);
                    }}
                  />
                  {confirmDelete === entry.key && (
                    <div className="px-3 pb-2">
                      <ConfirmInline
                        tone="danger"
                        message={t('settings.env.removeConfirm', { key: entry.key })}
                        confirmLabel={t('common.remove')}
                        pending={remove.isPending && remove.variables === entry.key}
                        onConfirm={() => remove.mutate(entry.key)}
                        onCancel={() => setConfirmDelete(null)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </ul>
          )}
          {visible.length > 100 && (
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
              {t('settings.env.limited')}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

// --- Raw config -------------------------------------------------------------

/**
 * The Hermes configuration, shown and not editable.
 *
 * Editing used to live here and was removed on purpose: the file is edited on
 * the server, in a terminal. A web editor could only write it the way Hermes
 * writes it — parse the text and re-serialise the mapping — which silently
 * dropped every comment in the file, and Hermes ships long explanatory blocks.
 * Reading is verbatim (`path.read_text()`), so what stands here is the file.
 */
function ConfigSection() {
  const { t } = useI18n();

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.configRaw,
    queryFn: getConfigRaw,
    staleTime: 30_000,
  });

  return (
    <Section id="config" title={t('settings.config')} description={t('settings.config.desc')}>
      {isPending ? (
        <SkeletonText lines={6} />
      ) : error ? (
        <p className="card p-4 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : (
        <div className="card p-4">
          {data?.path && (
            <p className="mb-2 font-mono text-[0.65rem] text-[var(--color-ink-faint)]">
              {data.path}
            </p>
          )}
          <pre className="max-h-72 overflow-auto rounded-lg bg-[var(--color-base)] p-3 font-mono text-xs whitespace-pre-wrap text-[var(--color-ink-muted)]">
            {data?.yaml || t('settings.config.empty')}
          </pre>
        </div>
      )}
    </Section>
  );
}

// --- Security ---------------------------------------------------------------

const PASSWORD_FIELD_CLASS =
  'w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-1.5 text-sm outline-none focus-visible:border-[var(--color-accent)]';

function ChangePasswordForm() {
  const { t } = useI18n();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const change = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.push({ tone: 'success', title: t('settings.security.changedToast') });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.saveFailed'), description: e.message }),
  });

  // Mirrors the server's own rule (validatePasswordStrength) so a doomed
  // submission is caught before the round trip, not after.
  const tooShort = newPassword !== '' && newPassword.length < 8;
  const mismatch = confirmPassword !== '' && newPassword !== confirmPassword;
  const canSubmit =
    currentPassword !== '' &&
    newPassword !== '' &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    !change.isPending;

  return (
    <form
      className="card mt-3 max-w-sm space-y-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) change.mutate();
      }}
    >
      <div>
        <label className="mb-1 block text-xs text-[var(--color-ink-muted)]">
          {t('settings.security.currentPassword')}
        </label>
        <input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          className={PASSWORD_FIELD_CLASS}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-[var(--color-ink-muted)]">
          {t('settings.security.newPassword')}
        </label>
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          className={PASSWORD_FIELD_CLASS}
        />
        {tooShort && (
          <p className="mt-1 text-xs text-[var(--color-danger)]">
            {t('settings.security.tooShort')}
          </p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs text-[var(--color-ink-muted)]">
          {t('settings.security.confirmPassword')}
        </label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          className={PASSWORD_FIELD_CLASS}
        />
        {mismatch && (
          <p className="mt-1 text-xs text-[var(--color-danger)]">
            {t('settings.security.mismatch')}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-lg bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs text-[var(--color-accent)] disabled:opacity-40"
      >
        {change.isPending ? t('common.saving') : t('settings.security.changePassword')}
      </button>
    </form>
  );
}

function SecuritySection() {
  const { t } = useI18n();
  const [before, after] = t('settings.security.password').split('{command}');
  const auth = useQuery({ queryKey: queryKeys.auth, queryFn: getAuthStatus, staleTime: 30_000 });

  return (
    <Section id="security" title={t('settings.security')} description={t('settings.security.desc')}>
      <div className="card flex items-start gap-3 p-4">
        <KeyRound size={16} className="mt-0.5 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
        <p className="text-xs text-[var(--color-ink-muted)]">
          {before}
          <code className="font-mono text-[var(--color-ink)]">
            hermes-control-center --set-password
          </code>
          {after}
        </p>
      </div>
      {/* Changing a password that does not exist yet cannot succeed — the CLI
          note above is the only path until one has been set at least once. */}
      {auth.data?.required && <ChangePasswordForm />}
    </Section>
  );
}

/**
 * Seven sections, and the useful ones used to be at the bottom: the toolsets
 * alone are twenty-six rows, which put "Environment & keys" some two thousand
 * pixels down a single stacked column. A category picked here decides which
 * one section mounts on the right — the other six, and their queries, stay
 * unmounted until picked, not just visually out of the way.
 */
const SETTINGS_SECTIONS: { id: string; icon: typeof Languages; titleKey: string }[] = [
  { id: 'language', icon: Languages, titleKey: 'settings.language' },
  { id: 'appearance', icon: Palette, titleKey: 'settings.appearance' },
  { id: 'tools', icon: Wrench, titleKey: 'settings.tools' },
  { id: 'maintenance', icon: RefreshCw, titleKey: 'settings.maintenance' },
  { id: 'env', icon: Braces, titleKey: 'settings.env' },
  { id: 'config', icon: FileCode, titleKey: 'settings.config' },
  { id: 'security', icon: KeyRound, titleKey: 'settings.security' },
];

function SettingsNav({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const label = t('settings.categories');

  return (
    <>
      {/* Narrow and medium widths: a wrapping row of chips above the content —
          the same chip vocabulary as the theme/font pickers below, not a new one. */}
      <nav aria-label={label} className="mb-5 flex flex-wrap gap-1.5 lg:hidden">
        {SETTINGS_SECTIONS.map(({ id, icon: Icon, titleKey }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-current={isActive ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                isActive
                  ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Icon size={13} aria-hidden />
              {t(titleKey)}
            </button>
          );
        })}
      </nav>

      {/* Wide: a fixed sidebar, sticky under the page header, divided from the
          detail pane by the same hairline every card border already uses. */}
      <nav
        aria-label={label}
        className="hidden lg:sticky lg:top-6 lg:block lg:self-start lg:border-e lg:border-[var(--color-hairline)] lg:pe-5"
      >
        <ul className="space-y-0.5">
          {SETTINGS_SECTIONS.map(({ id, icon: Icon, titleKey }) => {
            const isActive = id === active;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <Icon size={15} className="shrink-0" aria-hidden />
                  <span>{t(titleKey)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

const DEFAULT_SETTINGS_TAB = SETTINGS_SECTIONS[0]!.id;

export function EinstellungenPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get('tab');
  const active = SETTINGS_SECTIONS.some((section) => section.id === requested)
    ? (requested as string)
    : DEFAULT_SETTINGS_TAB;

  const selectTab = (id: string) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('tab', id);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <PageShell title={t('nav.einstellungen')} description={t('page.einstellungen.desc')}>
      <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:items-start lg:gap-8">
        <SettingsNav active={active} onSelect={selectTab} />
        <div className="min-w-0">
          {active === 'language' && <LanguageSection />}
          {active === 'appearance' && <AppearanceSection />}
          {active === 'tools' && <ToolsetsSection />}
          {active === 'maintenance' && <MaintenanceSection />}
          {active === 'env' && <EnvSection />}
          {active === 'config' && <ConfigSection />}
          {active === 'security' && <SecuritySection />}
        </div>
      </div>
    </PageShell>
  );
}
