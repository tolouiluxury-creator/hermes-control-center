import { useQuery } from '@tanstack/react-query';
import { getAnalytics, queryKeys } from '@/lib/api';
import { formatCompact, formatCost } from '@/lib/format';
import { Sparkline } from '@/components/Sparkline';
import { useI18n } from '@/lib/i18n';
import { WidgetState } from './WidgetState';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[0.7rem] text-[var(--color-ink-faint)]">{label}</p>
      {/* Not `text-base`: this theme also registers `base` as a color token
          (the page background), and Tailwind's generated color utility wins
          the name collision on `color` — `text-base` renders invisible text
          rather than a 1rem heading. */}
      <p className="truncate font-mono text-[1rem] text-[var(--color-ink)] tracking-tight">
        {value}
      </p>
      {hint && <p className="truncate text-[0.65rem] text-[var(--color-ink-faint)]">{hint}</p>}
    </div>
  );
}

export function AnalyticsWidget() {
  const { t, lang } = useI18n();
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
      emptyMessage={t('analyticsWidget.empty')}
    >
      {data && (
        <div className="flex h-full flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label={t('analyticsWidget.input')}
              value={formatCompact(data.totals.inputTokens, lang)}
              hint={t('analyticsWidget.tokens')}
            />
            <Stat
              label={t('analyticsWidget.output')}
              value={formatCompact(data.totals.outputTokens, lang)}
              hint={t('analyticsWidget.tokens')}
            />
            <Stat
              label={t('analytics.cost')}
              value={formatCost(data.totals.cost, lang)}
              // Saying "estimated" matters: most providers here only estimate,
              // and a number presented as fact would be trusted as one.
              hint={t(
                data.totals.costIsEstimate
                  ? 'analyticsWidget.estimated'
                  : 'analyticsWidget.billedShort',
              )}
            />
          </div>

          {tokensPerDay.length > 1 && (
            <div>
              <Sparkline
                values={tokensPerDay}
                className="h-10 w-full"
                label={t('analytics.tokensPerDay')}
              />
              <p className="mt-0.5 text-[0.65rem] text-[var(--color-ink-faint)]">
                {data.periodDays
                  ? t('analyticsWidget.daysOf', { days: daily.length, total: data.periodDays })
                  : t('analyticsWidget.days', { days: daily.length })}{' '}
                · {t('analyticsWidget.apiCalls', { count: data.totals.apiCalls ?? 0 })}
              </p>
            </div>
          )}

          {data.topTools.length > 0 && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="mb-1 text-[0.7rem] text-[var(--color-ink-faint)]">
                {t('analytics.topTools')}
              </p>
              <ul className="space-y-0.5">
                {data.topTools.slice(0, 5).map((tool, index) => (
                  <li
                    key={tool.tool ?? `unnamed-${index}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span className="truncate">{tool.tool ?? t('common.unknown')}</span>
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
