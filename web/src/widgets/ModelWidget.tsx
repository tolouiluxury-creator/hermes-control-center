import { useQuery } from '@tanstack/react-query';
import { getModelInfo, queryKeys } from '@/lib/api';
import { formatCompact } from '@/lib/format';
import { WidgetState } from './WidgetState';

export function ModelWidget() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.model,
    queryFn: getModelInfo,
    staleTime: 60_000,
  });

  return (
    <WidgetState isPending={isPending} error={error}>
      {data && (
        <div className="flex h-full flex-col gap-3">
          <div>
            <p
              className="truncate font-mono text-lg tracking-tight"
              title={data.model ?? undefined}
            >
              {data.model ?? '—'}
            </p>
            {data.provider && (
              <p className="text-xs text-[var(--color-ink-faint)]">über {data.provider}</p>
            )}
          </div>

          {data.contextLength !== null && (
            <div className="flex items-baseline justify-between gap-2 border-t border-[var(--color-hairline)] pt-2">
              <span className="text-xs text-[var(--color-ink-faint)]">Kontextfenster</span>
              <span className="font-mono text-sm">{formatCompact(data.contextLength)} Token</span>
            </div>
          )}

          {data.capabilities.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {data.capabilities.map((capability) => (
                <li
                  key={capability}
                  className="rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-[0.65rem] text-[var(--color-ink-muted)]"
                >
                  {capability}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </WidgetState>
  );
}
