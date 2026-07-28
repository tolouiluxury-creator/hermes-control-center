import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Lock, LockOpen } from 'lucide-react';
import { getModelInfo, getModelOptions, queryKeys, setMainModel } from '@/lib/api';
import { formatCompact } from '@/lib/format';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';

export function ModelsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  /** The provider+model a switch is being confirmed for, if any. */
  const [pending, setPending] = useState<{ provider: string; model: string } | null>(null);

  const options = useQuery({
    queryKey: queryKeys.models,
    queryFn: getModelOptions,
    staleTime: 60_000,
  });
  const info = useQuery({ queryKey: queryKeys.model, queryFn: getModelInfo, staleTime: 60_000 });

  const switchModel = useMutation({
    mutationFn: ({ provider, model }: { provider: string; model: string }) =>
      setMainModel(provider, model),
    onSuccess: async (_result, variables) => {
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.models });
      await queryClient.invalidateQueries({ queryKey: queryKeys.model });
      toast.push({ tone: 'success', title: t('models.switched', { model: variables.model }) });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: t('models.switchFailed'),
        description: mutationError.message,
      }),
  });

  return (
    <PageShell title={t('nav.modelle')} description={t('page.modelle.desc')}>
      {options.isPending ? (
        <SkeletonText lines={8} />
      ) : options.error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {options.error.message}
        </p>
      ) : (
        <>
          <section className="card mb-4 p-5">
            <p className="text-xs text-[var(--color-ink-faint)]">{t('models.active')}</p>
            <p className="mt-1 font-mono text-xl tracking-tight">
              {options.data?.currentModel ?? '—'}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-ink-muted)]">
              {options.data?.currentProvider && (
                <span>{t('models.provider', { name: options.data.currentProvider })}</span>
              )}
              {info.data?.contextLength && (
                <span>
                  {t('models.context', { tokens: formatCompact(info.data.contextLength) })}
                </span>
              )}
            </div>
          </section>

          <ul className="space-y-3">
            {(options.data?.providers ?? []).map((provider) => (
              <li key={provider.slug} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {provider.isCurrent && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[0.65rem] text-[var(--color-accent)]"
                      title={t('models.providerOfActive')}
                    >
                      <Check size={11} aria-hidden />
                      {t('common.active')}
                    </span>
                  )}

                  <span className="text-sm font-medium">{provider.name}</span>
                  <span className="font-mono text-[0.7rem] text-[var(--color-ink-faint)]">
                    {provider.slug}
                  </span>

                  {/* Authentication decides whether a provider is usable at all,
                      so it is stated rather than left to be discovered on use. */}
                  <span
                    className="ml-auto inline-flex shrink-0 items-center gap-1 text-[0.7rem]"
                    style={{
                      color: provider.authenticated ? 'var(--color-ok)' : 'var(--color-ink-faint)',
                    }}
                  >
                    {provider.authenticated ? (
                      <LockOpen size={11} aria-hidden />
                    ) : (
                      <Lock size={11} aria-hidden />
                    )}
                    {provider.authenticated
                      ? t('models.authenticated')
                      : t('models.notAuthenticated')}
                    {provider.authType && provider.authType !== 'virtual' && (
                      <span className="text-[var(--color-ink-faint)]"> · {provider.authType}</span>
                    )}
                  </span>
                </div>

                {provider.warning && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-warn)]">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
                    {provider.warning}
                  </p>
                )}

                {provider.models.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {provider.models.slice(0, 12).map((model) => {
                      const isCurrent = model === options.data?.currentModel;
                      // Only an authenticated provider's non-current models can be
                      // switched to; the rest are shown but not clickable.
                      const switchable = provider.authenticated === true && !isCurrent;

                      return (
                        <li key={model}>
                          <button
                            type="button"
                            disabled={!switchable || switchModel.isPending}
                            onClick={() => setPending({ provider: provider.slug, model })}
                            title={
                              switchable
                                ? t('models.switchTitle', { model })
                                : isCurrent
                                  ? t('models.currentModel')
                                  : t('models.notSignedIn')
                            }
                            className={`rounded-full border px-2 py-0.5 font-mono text-[0.65rem] transition-colors ${
                              isCurrent
                                ? 'border-[var(--color-accent)]/40 text-[var(--color-accent)]'
                                : switchable
                                  ? 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]'
                                  : 'border-[var(--color-hairline)] text-[var(--color-ink-faint)] cursor-default'
                            }`}
                          >
                            {model}
                          </button>
                        </li>
                      );
                    })}
                    {provider.totalModels !== null && provider.totalModels > 12 && (
                      <li className="px-2 py-0.5 text-[0.65rem] text-[var(--color-ink-faint)]">
                        {t('models.moreModels', { count: provider.totalModels - 12 })}
                      </li>
                    )}
                  </ul>
                )}

                {pending?.provider === provider.slug && (
                  <ConfirmInline
                    tone="warn"
                    message={t('models.switchConfirm', { model: pending.model })}
                    confirmLabel={t('models.switch')}
                    pending={switchModel.isPending}
                    onConfirm={() => switchModel.mutate(pending)}
                    onCancel={() => setPending(null)}
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
