import { useQuery } from '@tanstack/react-query';
import { BookOpen, Check } from 'lucide-react';
import { getMemory, queryKeys } from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { formatCompact } from '@/lib/format';
import type { MemoryProvider } from '@/lib/hermesTypes';

const STATUS_LABEL: Record<string, string> = {
  ready: 'bereit',
  unavailable: 'nicht verfügbar',
  needs_config: 'Einrichtung nötig',
  error: 'Fehler',
};

const STATUS_COLOR: Record<string, string> = {
  ready: 'var(--color-ok)',
  unavailable: 'var(--color-ink-faint)',
  needs_config: 'var(--color-warn)',
  error: 'var(--color-danger)',
};

/** Human names for the built-in note files Hermes keeps regardless of provider. */
const FILE_LABEL: Record<string, string> = {
  memory: 'Erinnerungen',
  user: 'Nutzerprofil',
};

function ProviderRow({ provider }: { provider: MemoryProvider }) {
  const color = STATUS_COLOR[provider.status ?? ''] ?? 'var(--color-ink-faint)';
  const label = STATUS_LABEL[provider.status ?? ''] ?? provider.status ?? 'unbekannt';

  return (
    <li className="card flex items-start gap-3 p-4">
      <span
        className="mt-1 size-2 shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-sm">{provider.name}</span>
          {provider.available && (
            <span className="text-[0.65rem] text-[var(--color-ok)]">verfügbar</span>
          )}
          {!provider.available && provider.configured && (
            <span className="text-[0.65rem] text-[var(--color-ink-faint)]">
              eingerichtet, aber nicht nutzbar
            </span>
          )}
        </div>
        {provider.description && (
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{provider.description}</p>
        )}
      </div>
      <span
        className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[0.65rem]"
        style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}
      >
        {label}
      </span>
    </li>
  );
}

export function WissenPage() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.memory,
    queryFn: getMemory,
    staleTime: 60_000,
  });

  return (
    <PageShell
      title="Wissen (RAG)"
      description="Was dein Agent behält: die eingebauten Notizdateien und die verfügbaren Speicher-Anbieter für Langzeitgedächtnis und Retrieval."
    >
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
                Eingebautes Gedächtnis
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {data.files.map((file) => (
                  <div key={file.name} className="card p-4">
                    <p className="font-mono text-2xl tracking-tight">
                      {formatCompact(file.entries)}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                      {FILE_LABEL[file.name] ?? file.name}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                Speicher-Anbieter
              </h3>
              <p className="text-xs text-[var(--color-ink-faint)]">
                {data.availableCount} von {data.providers.length} verfügbar
                {data.active ? (
                  <>
                    {' · '}
                    <span className="inline-flex items-center gap-1 text-[var(--color-ok)]">
                      <Check size={11} aria-hidden />
                      aktiv: {data.active}
                    </span>
                  </>
                ) : (
                  ' · keiner aktiv'
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
                <p className="mt-4 text-sm font-medium">Keine Speicher-Anbieter gemeldet</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-muted)]">
                  Hermes nutzt derzeit nur seine eingebauten Notizdateien. Ein RAG-Anbieter wird in
                  der Hermes-Konfiguration eingerichtet.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {data.providers.map((provider) => (
                  <ProviderRow key={provider.name} provider={provider} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
