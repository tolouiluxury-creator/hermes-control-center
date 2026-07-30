import { useQuery } from '@tanstack/react-query';
import { getAnalytics, queryKeys } from '@/lib/api';
import { formatCompact, formatCost } from '@/lib/format';
import { PageShell } from '@/components/PageShell';
import { Sparkline } from '@/components/Sparkline';
import { SkeletonText } from '@/components/Skeleton';
import { useI18n } from '@/lib/i18n';

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-[var(--color-ink-faint)]">{label}</p>
      <p className="mt-1 font-mono text-xl tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[0.7rem] text-[var(--color-ink-faint)]">{hint}</p>}
    </div>
  );
}

/** A proportional bar. The number stays visible; the bar is only the comparison. */
function Bar({
  value,
  max,
  color = 'var(--color-accent)',
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <span
      className="block h-1 w-full overflow-hidden rounded-full bg-[var(--color-raised)]"
      aria-hidden
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${width}%`, background: color }}
      />
    </span>
  );
}

export function AnalyticsPage() {
  const { t, lang } = useI18n();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.analytics,
    queryFn: getAnalytics,
    staleTime: 120_000,
  });

  const daily = data?.daily ?? [];
  const maxDailyTokens = Math.max(1, ...daily.map((d) => d.inputTokens + d.outputTokens));
  const maxModelTokens = Math.max(1, ...(data?.byModel ?? []).map((m) => m.tokens));
  const maxToolCount = Math.max(1, ...(data?.topTools ?? []).map((t) => t.count));

  return (
    <PageShell
      title={t('nav.analytics')}
      description={
        data?.periodDays
          ? t('analytics.periodDesc', { days: data.periodDays })
          : t('page.analytics.desc')
      }
      wide
    >
      {isPending ? (
        <SkeletonText lines={10} />
      ) : error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : (
        data && (
          <div className="space-y-5">
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label={t('analytics.inputTokens')}
                value={formatCompact(data.totals.inputTokens, lang)}
                hint={t('analytics.inputTokens.hint')}
              />
              <StatCard
                label={t('analytics.outputTokens')}
                value={formatCompact(data.totals.outputTokens, lang)}
                hint={t('analytics.outputTokens.hint')}
              />
              <StatCard
                label={t('analytics.cost')}
                value={formatCost(data.totals.cost, lang)}
                hint={t(
                  data.totals.costIsEstimate ? 'analytics.cost.estimated' : 'analytics.cost.billed',
                )}
              />
              <StatCard
                label={t('analytics.apiCalls')}
                value={formatCompact(data.totals.apiCalls, lang)}
                hint={t('analytics.sessions', { count: data.totals.sessions ?? 0 })}
              />
            </section>

            {daily.length > 1 && (
              <section className="card p-5">
                <h3 className="text-sm font-semibold">{t('analytics.history')}</h3>
                <Sparkline
                  values={daily.map((entry) => entry.inputTokens + entry.outputTokens)}
                  className="mt-3 h-16 w-full"
                  label={t('analytics.tokensPerDay')}
                />
                <ul className="mt-3 space-y-1.5">
                  {daily.map((entry) => {
                    const tokens = entry.inputTokens + entry.outputTokens;
                    return (
                      <li
                        key={entry.day}
                        className="grid grid-cols-[6rem_1fr_5rem] items-center gap-3"
                      >
                        <span className="font-mono text-xs text-[var(--color-ink-faint)]">
                          {entry.day}
                        </span>
                        <Bar value={tokens} max={maxDailyTokens} />
                        <span className="text-right font-mono text-xs">
                          {formatCompact(tokens, lang)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {data.byModel.length > 0 && (
                <section className="card p-5">
                  <h3 className="mb-3 text-sm font-semibold">{t('analytics.byModel')}</h3>
                  <ul className="space-y-2">
                    {data.byModel.map((entry, index) => (
                      <li key={entry.model ?? `unnamed-${index}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-mono text-xs">
                            {entry.model ?? t('common.unknown')}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-[var(--color-ink-faint)]">
                            {formatCompact(entry.tokens, lang)} ·{' '}
                            {t('analytics.calls', { count: entry.apiCalls })}
                          </span>
                        </div>
                        <Bar value={entry.tokens} max={maxModelTokens} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.topTools.length > 0 && (
                <section className="card p-5">
                  <h3 className="mb-3 text-sm font-semibold">{t('analytics.topTools')}</h3>
                  <ul className="space-y-2">
                    {data.topTools.map((tool, index) => (
                      <li key={tool.tool ?? `unnamed-${index}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs">
                            {tool.tool ?? t('common.unknown')}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-[var(--color-ink-faint)]">
                            {tool.count}
                          </span>
                        </div>
                        <Bar value={tool.count} max={maxToolCount} color="var(--color-agent)" />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        )
      )}
    </PageShell>
  );
}
