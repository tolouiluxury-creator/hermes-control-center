import { useQuery } from '@tanstack/react-query';
import { getAnalytics, queryKeys } from '@/lib/api';
import { formatCompact, formatCost } from '@/lib/format';
import { Sparkline } from '@/components/Sparkline';
import { WidgetState } from './WidgetState';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[0.7rem] text-[var(--color-ink-faint)]">{label}</p>
      <p className="truncate font-mono text-base tracking-tight">{value}</p>
      {hint && <p className="truncate text-[0.65rem] text-[var(--color-ink-faint)]">{hint}</p>}
    </div>
  );
}

export function AnalyticsWidget() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.analytics,
    queryFn: getAnalytics,
    staleTime: 120_000,
  });

  const daily = data?.daily ?? [];
  const tokensPerDay = daily.map((entry) => entry.inputTokens + entry.outputTokens);

  return (
    <WidgetState
      isPending={isPending}
      error={error}
      isEmpty={data !== undefined && daily.length === 0 && !data.totals.apiCalls}
      emptyMessage="Noch keine Nutzungsdaten"
    >
      {data && (
        <div className="flex h-full flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Eingabe" value={formatCompact(data.totals.inputTokens)} hint="Token" />
            <Stat label="Ausgabe" value={formatCompact(data.totals.outputTokens)} hint="Token" />
            <Stat
              label="Kosten"
              value={formatCost(data.totals.cost)}
              // Saying "geschätzt" matters: most providers here only estimate,
              // and a number presented as fact would be trusted as one.
              hint={data.totals.costIsEstimate ? 'geschätzt' : 'abgerechnet'}
            />
          </div>

          {tokensPerDay.length > 1 && (
            <div>
              <Sparkline
                values={tokensPerDay}
                className="h-10 w-full"
                label="Tokenverbrauch pro Tag"
              />
              <p className="mt-0.5 text-[0.65rem] text-[var(--color-ink-faint)]">
                {daily.length} Tage
                {data.periodDays ? ` von ${data.periodDays}` : ''} · {data.totals.apiCalls ?? 0}{' '}
                API-Aufrufe
              </p>
            </div>
          )}

          {data.topTools.length > 0 && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="mb-1 text-[0.7rem] text-[var(--color-ink-faint)]">
                Meistgenutzte Tools
              </p>
              <ul className="space-y-0.5">
                {data.topTools.slice(0, 5).map((tool) => (
                  <li key={tool.tool} className="flex items-center gap-2 text-xs">
                    <span className="truncate">{tool.tool}</span>
                    <span className="ml-auto shrink-0 font-mono text-[var(--color-ink-faint)]">
                      {tool.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </WidgetState>
  );
}
