import { useQuery } from '@tanstack/react-query';
import { getMemory, queryKeys } from '@/lib/api';
import { formatCompact } from '@/lib/format';
import { WidgetState } from './WidgetState';

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

/** What the agent remembers: its memory provider and the built-in note files. */
export function KnowledgeWidget() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.memory,
    queryFn: getMemory,
    staleTime: 60_000,
  });

  return (
    <WidgetState isPending={isPending} error={error}>
      {data && (
        <div className="flex h-full flex-col gap-3">
          {data.files.length > 0 && (
            <div className="flex gap-4">
              {data.files.map((file) => (
                <div key={file.name} className="min-w-0">
                  <p className="font-mono text-xl tracking-tight">{formatCompact(file.entries)}</p>
                  <p className="truncate text-[0.7rem] text-[var(--color-ink-faint)]">
                    {file.name === 'memory' ? 'Erinnerungen' : file.name}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--color-hairline)] pt-2">
            <p className="mb-1 text-[0.7rem] text-[var(--color-ink-faint)]">
              Speicher-Anbieter
              {data.active ? ` · aktiv: ${data.active}` : ' · keiner aktiv'}
            </p>

            {data.configured.length === 0 ? (
              <p className="text-xs text-[var(--color-ink-faint)]">
                Keiner eingerichtet — Hermes nutzt seine eingebauten Dateien.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {data.configured.map((provider) => (
                  <li key={provider.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{
                        background: STATUS_COLOR[provider.status ?? ''] ?? 'var(--color-ink-faint)',
                      }}
                      aria-hidden
                    />
                    <span className="truncate">{provider.name}</span>
                    <span className="ml-auto shrink-0 text-[0.65rem] text-[var(--color-ink-faint)]">
                      {STATUS_LABEL[provider.status ?? ''] ?? provider.status ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </WidgetState>
  );
}
