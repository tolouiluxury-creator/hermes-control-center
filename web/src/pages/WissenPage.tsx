import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check } from 'lucide-react';
import { getMemory, queryKeys, setMemoryProvider } from '@/lib/api';
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

function ProviderRow({
  provider,
  active,
  confirming,
  pending,
  onActivate,
  onConfirm,
  onCancel,
}: {
  provider: MemoryProvider;
  active: boolean;
  confirming: boolean;
  pending: boolean;
  onActivate: (name: string) => void;
  onConfirm: (name: string) => void;
  onCancel: () => void;
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

      {confirming && (
        <ConfirmInline
          tone="warn"
          message={t('wissen.activateConfirm', { name: provider.name })}
          confirmLabel={t('common.activate')}
          pending={pending}
          onConfirm={() => onConfirm(provider.name)}
          onCancel={onCancel}
        />
      )}
    </li>
  );
}

export function WissenPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t, lang } = useI18n();
  const [confirming, setConfirming] = useState<string | null>(null);

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
      toast.push({ tone: 'success', title: t('wissen.activatedToast', { name: provider }) });
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
                    confirming={confirming === provider.name}
                    pending={activate.isPending && activate.variables === provider.name}
                    onActivate={setConfirming}
                    onConfirm={(name) => activate.mutate(name)}
                    onCancel={() => setConfirming(null)}
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
