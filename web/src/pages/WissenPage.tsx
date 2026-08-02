import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check } from 'lucide-react';
import {
  getMemory,
  getMemoryProviderConfig,
  queryKeys,
  setMemoryProvider,
  setMemoryProviderConfig,
} from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatCompact } from '@/lib/format';
import type { MemoryProvider } from '@/lib/hermesTypes';

const STATUS_COLOR: Record<string, string> = {
  ready: 'var(--color-ok)',
  unavailable: 'var(--color-ink-faint)',
  needs_config: 'var(--color-warn)',
  error: 'var(--color-danger)',
};

const STATUS_KEYS = new Set(['ready', 'unavailable', 'needs_config', 'error']);

/** The built-in note files Hermes keeps regardless of provider. */
const FILE_KEY: Record<string, string> = {
  memory: 'wissen.files.memory',
  user: 'wissen.files.user',
};

/**
 * The fields a provider declares, rendered as Hermes describes them.
 *
 * Two things this form has to be honest about, both read out of Hermes' writer:
 * saving also makes the provider the active one, and a secret left blank keeps
 * whatever is stored rather than clearing it.
 */
function ProviderConfigForm({ name, onClose }: { name: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});

  const config = useQuery({
    queryKey: queryKeys.memoryProviderConfig(name),
    queryFn: () => getMemoryProviderConfig(name),
  });

  const save = useMutation({
    mutationFn: (values: Record<string, string>) => setMemoryProviderConfig(name, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.memory });
      await queryClient.invalidateQueries({ queryKey: queryKeys.memoryProviderConfig(name) });
      // Closing is the visible half of the answer. Clearing the edits and
      // re-reading the stored values leaves the form looking exactly as it did
      // before the click, so a form that stays open reads as "nothing happened"
      // — every other form here closes on success.
      onClose();
      toast.push({ tone: 'success', title: t('wissen.config.saved', { name }) });
    },
    onError: (error: Error) =>
      toast.push({ tone: 'error', title: t('toast.saveFailed'), description: error.message }),
  });

  const fields = config.data?.fields ?? [];
  const missing = fields.filter(
    (field) =>
      field.required &&
      (edits[field.key] ?? (field.kind === 'secret' ? (field.isSet ? 'set' : '') : field.value))
        .toString()
        .trim() === '',
  );

  const input =
    'mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]';

  return (
    <form
      className="mt-3 rounded-xl border border-[var(--color-hairline)] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (missing.length > 0 || save.isPending) return;
        save.mutate(edits);
      }}
    >
      {config.isPending ? (
        <SkeletonText lines={4} />
      ) : config.error ? (
        <p className="text-sm text-[var(--color-danger)]" role="alert">
          {config.error.message}
        </p>
      ) : fields.length === 0 ? (
        <p className="text-xs text-[var(--color-ink-muted)]">{t('wissen.config.noFields')}</p>
      ) : (
        <>
          {fields.map((field) => (
            <label key={field.key} className="mt-3 block text-xs first:mt-0">
              <span className="text-[var(--color-ink-faint)]">
                {field.label}
                {field.required && <span className="text-[var(--color-warn)]"> *</span>}
              </span>

              {field.options.length > 0 ? (
                <select
                  value={edits[field.key] ?? field.value}
                  onChange={(event) =>
                    setEdits((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  className={input}
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.kind === 'secret' ? 'password' : 'text'}
                  value={edits[field.key] ?? (field.kind === 'secret' ? '' : field.value)}
                  placeholder={
                    field.kind === 'secret' && field.isSet
                      ? t('wissen.config.secretKeep')
                      : (field.placeholder ?? '')
                  }
                  onChange={(event) =>
                    setEdits((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  className={input}
                />
              )}

              {field.description && (
                <span className="mt-1 block text-[0.65rem] text-[var(--color-ink-muted)]">
                  {field.description}
                </span>
              )}
              {field.url && (
                <a
                  href={field.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-0.5 inline-block text-[0.65rem] text-[var(--color-accent)] hover:underline"
                >
                  {field.url}
                </a>
              )}
            </label>
          ))}

          {/* Hermes activates on write; saying it after the click would be too late. */}
          <p className="mt-4 text-xs text-[var(--color-warn)]">
            {t('wissen.config.alsoActivates', { name })}
          </p>

          {missing.length > 0 && (
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {t('wissen.config.missing', {
                fields: missing.map((field) => field.label).join(', '),
              })}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={missing.length > 0 || save.isPending}
              className="rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 disabled:opacity-50"
            >
              {save.isPending ? t('common.saving') : t('wissen.config.saveAndActivate')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[var(--color-hairline)] px-4 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function ProviderRow({
  provider,
  active,
  confirming,
  pending,
  configuring,
  onActivate,
  onDeactivate,
  onConfirm,
  onCancel,
  onToggleConfig,
}: {
  provider: MemoryProvider;
  active: boolean;
  /** `'on'` while confirming activation, `'off'` while confirming a switch-off. */
  confirming: 'on' | 'off' | null;
  pending: boolean;
  configuring: boolean;
  onActivate: (name: string) => void;
  onDeactivate: (name: string) => void;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  onToggleConfig: (name: string) => void;
}) {
  const { t } = useI18n();
  const color = STATUS_COLOR[provider.status ?? ''] ?? 'var(--color-ink-faint)';
  const label =
    provider.status && STATUS_KEYS.has(provider.status)
      ? t(`wissen.status.${provider.status}`)
      : (provider.status ?? t('wissen.status.unknown'));

  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 size-2 shrink-0 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-sm">{provider.name}</span>
            {active && (
              <span className="inline-flex items-center gap-1 text-[0.65rem] text-[var(--color-ok)]">
                <Check size={11} aria-hidden />
                {t('common.active')}
              </span>
            )}
            {!active && provider.available && (
              <span className="text-[0.65rem] text-[var(--color-ok)]">{t('wissen.available')}</span>
            )}
            {!provider.available && provider.configured && (
              <span className="text-[0.65rem] text-[var(--color-ink-faint)]">
                {t('wissen.notUsable')}
              </span>
            )}
          </div>
          {provider.description && (
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{provider.description}</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => onToggleConfig(provider.name)}
          aria-expanded={configuring}
          className="mt-0.5 shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
          {t('wissen.config.open')}
        </button>

        {/*
         * The way back. Hermes maps "none" (and "", "built-in") to an empty
         * provider and skips the readiness check for it, so switching off is
         * always possible — without this button it just was not reachable.
         */}
        {active && (
          <button
            type="button"
            onClick={() => onDeactivate(provider.name)}
            disabled={pending}
            className="mt-0.5 shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-40"
          >
            {t('wissen.deactivate')}
          </button>
        )}

        {/* Only an available, not-yet-active provider can be switched to. */}
        {provider.available && !active && (
          <button
            type="button"
            onClick={() => onActivate(provider.name)}
            disabled={pending}
            className="mt-0.5 shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-40"
          >
            {t('common.activate')}
          </button>
        )}

        <span
          className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[0.65rem]"
          style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}
        >
          {label}
        </span>
      </div>

      {confirming !== null && (
        <ConfirmInline
          tone="warn"
          message={
            confirming === 'off'
              ? t('wissen.deactivateConfirm', { name: provider.name })
              : t('wissen.activateConfirm', { name: provider.name })
          }
          confirmLabel={confirming === 'off' ? t('wissen.deactivate') : t('common.activate')}
          pending={pending}
          // "none" is Hermes' sentinel for the built-in-only state.
          onConfirm={() => onConfirm(confirming === 'off' ? 'none' : provider.name)}
          onCancel={onCancel}
        />
      )}

      {configuring && (
        <ProviderConfigForm name={provider.name} onClose={() => onToggleConfig(provider.name)} />
      )}
    </li>
  );
}

export function WissenPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t, lang } = useI18n();
  /** Which row is asking, and whether it asks to switch on or off. */
  const [confirming, setConfirming] = useState<{ name: string; mode: 'on' | 'off' } | null>(null);
  /** Only one provider's form is open at a time; the rows are long enough. */
  const [configuring, setConfiguring] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.memory,
    queryFn: getMemory,
    staleTime: 60_000,
  });

  const activate = useMutation({
    mutationFn: (provider: string) => setMemoryProvider(provider),
    onSuccess: async (_r, provider) => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.memory });
      // "none" is a sentinel, not a provider — saying it was activated would lie.
      toast.push({
        tone: 'success',
        title:
          provider === 'none'
            ? t('wissen.deactivatedToast')
            : t('wissen.activatedToast', { name: provider }),
      });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.actionFailed'), description: e.message }),
  });

  return (
    <PageShell title={t('nav.wissen')} description={t('page.wissen.desc')}>
      {isPending ? (
        <SkeletonText lines={8} />
      ) : error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : !data ? null : (
        <div className="space-y-6">
          {data.files.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                {t('wissen.builtin')}
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {data.files.map((file) => {
                  const fileKey = FILE_KEY[file.name];
                  return (
                    <div key={file.name} className="card p-4">
                      <p className="font-mono text-2xl tracking-tight">
                        {formatCompact(file.entries, lang)}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                        {fileKey ? t(fileKey) : file.name}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                {t('wissen.providers')}
              </h3>
              <p className="text-xs text-[var(--color-ink-faint)]">
                {t('wissen.providersCount', {
                  available: data.availableCount,
                  total: data.providers.length,
                })}
                {data.active ? (
                  <>
                    {' · '}
                    <span className="inline-flex items-center gap-1 text-[var(--color-ok)]">
                      <Check size={11} aria-hidden />
                      {t('wissen.activeProvider', { name: data.active })}
                    </span>
                  </>
                ) : (
                  ` · ${t('wissen.noneActive')}`
                )}
              </p>
            </div>

            {data.providers.length === 0 ? (
              <div className="card p-10 text-center">
                <span
                  className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-raised)] text-[var(--color-ink-faint)]"
                  aria-hidden
                >
                  <BookOpen size={22} />
                </span>
                <p className="mt-4 text-sm font-medium">{t('wissen.empty.title')}</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-muted)]">
                  {t('wissen.empty.desc')}
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {data.providers.map((provider) => (
                  <ProviderRow
                    key={provider.name}
                    provider={provider}
                    active={data.active === provider.name}
                    confirming={confirming?.name === provider.name ? confirming.mode : null}
                    pending={activate.isPending && activate.variables === provider.name}
                    configuring={configuring === provider.name}
                    onActivate={(name) => setConfirming({ name, mode: 'on' })}
                    onDeactivate={(name) => setConfirming({ name, mode: 'off' })}
                    onConfirm={(name) => activate.mutate(name)}
                    onCancel={() => setConfirming(null)}
                    onToggleConfig={(name) =>
                      setConfiguring((current) => (current === name ? null : name))
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
