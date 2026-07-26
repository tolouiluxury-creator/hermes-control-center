import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { getInsights, queryKeys } from '@/lib/api';
import type { InsightSeverity } from '@/lib/hermesTypes';
import { WidgetState } from './WidgetState';

const SEVERITY: Record<InsightSeverity, { icon: typeof Info; color: string }> = {
  critical: { icon: ShieldAlert, color: 'var(--color-danger)' },
  warn: { icon: AlertTriangle, color: 'var(--color-warn)' },
  info: { icon: Info, color: 'var(--color-info)' },
};

/**
 * Rule-based observations, not a language model.
 *
 * The footer says so on purpose: a panel labelled "AI" that is really a handful
 * of thresholds trains people to distrust everything else on the page.
 */
export function InsightsWidget() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.insights,
    queryFn: getInsights,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const insights = data?.insights ?? [];

  return (
    <WidgetState
      isPending={isPending}
      error={error}
      isEmpty={insights.length === 0}
      emptyMessage="Nichts zu beanstanden"
    >
      <div className="flex h-full flex-col">
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {insights.map((insight) => {
            const { icon: Icon, color } = SEVERITY[insight.severity];
            const evidence = Object.entries(insight.evidence);

            return (
              <li key={insight.id} className="flex gap-2.5">
                <Icon size={14} className="mt-0.5 shrink-0" style={{ color }} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm leading-snug font-medium">{insight.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{insight.body}</p>

                  {evidence.length > 0 && (
                    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {evidence.slice(0, 4).map(([key, value]) => (
                        <div key={key} className="flex gap-1 text-[0.65rem]">
                          <dt className="text-[var(--color-ink-faint)]">{key}:</dt>
                          <dd className="font-mono">{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {insight.action && (
                    <code className="mt-1 inline-block rounded bg-[var(--color-base)] px-1.5 py-0.5 font-mono text-[0.65rem] text-[var(--color-ink-muted)]">
                      {insight.action}
                    </code>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-2 shrink-0 border-t border-[var(--color-hairline)] pt-1.5 text-[0.65rem] text-[var(--color-ink-faint)]">
          Regelbasierte Prüfungen deiner Messwerte — kein Sprachmodell beteiligt.
        </p>
      </div>
    </WidgetState>
  );
}
