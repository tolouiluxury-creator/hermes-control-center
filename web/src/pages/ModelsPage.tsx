import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Lock, LockOpen } from 'lucide-react';
import { getModelInfo, getModelOptions, queryKeys } from '@/lib/api';
import { formatCompact } from '@/lib/format';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';

export function ModelsPage() {
  const options = useQuery({
    queryKey: queryKeys.models,
    queryFn: getModelOptions,
    staleTime: 60_000,
  });
  const info = useQuery({ queryKey: queryKeys.model, queryFn: getModelInfo, staleTime: 60_000 });

  return (
    <PageShell
      title="Modelle"
      description="Anbieter, die dein Hermes kennt, und das Modell, mit dem er gerade arbeitet."
    >
      {options.isPending ? (
        <SkeletonText lines={8} />
      ) : options.error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {options.error.message}
        </p>
      ) : (
        <>
          <section className="card mb-4 p-5">
            <p className="text-xs text-[var(--color-ink-faint)]">Aktuell aktiv</p>
            <p className="mt-1 font-mono text-xl tracking-tight">
              {options.data?.currentModel ?? '—'}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-ink-muted)]">
              {options.data?.currentProvider && (
                <span>Anbieter: {options.data.currentProvider}</span>
              )}
              {info.data?.contextLength && (
                <span>Kontext: {formatCompact(info.data.contextLength)} Token</span>
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
                      title="Dieser Anbieter liefert das aktive Modell"
                    >
                      <Check size={11} aria-hidden />
                      aktiv
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
                    {provider.authenticated ? 'angemeldet' : 'nicht angemeldet'}
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
                    {provider.models.slice(0, 12).map((model) => (
                      <li
                        key={model}
                        className={`rounded-full border px-2 py-0.5 font-mono text-[0.65rem] ${
                          model === options.data?.currentModel
                            ? 'border-[var(--color-accent)]/40 text-[var(--color-accent)]'
                            : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)]'
                        }`}
                      >
                        {model}
                      </li>
                    ))}
                    {provider.totalModels !== null && provider.totalModels > 12 && (
                      <li className="px-2 py-0.5 text-[0.65rem] text-[var(--color-ink-faint)]">
                        +{provider.totalModels - 12} weitere
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
            Das Modell zu wechseln verändert deine Hermes-Konfiguration. Diese Aktion baue ich mit
            Sicherheitsabfrage ein, sobald die Schreibvorgänge dran sind.
          </p>
        </>
      )}
    </PageShell>
  );
}
