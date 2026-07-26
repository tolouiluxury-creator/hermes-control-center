import { useQuery } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { getCronJobs, queryKeys } from '@/lib/api';
import { WidgetState } from './WidgetState';

/**
 * Turns the common cron expressions into German. Anything unusual is shown
 * verbatim rather than described wrongly — a schedule the user misreads is
 * worse than one they have to decode.
 */
export function describeCron(expression: string | null): string | null {
  if (!expression) return null;

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const isNumber = (value: string): boolean => /^\d+$/.test(value);
  if (!isNumber(minute) || !isNumber(hour)) return expression;

  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')} Uhr`;
  const weekdays = [
    'sonntags',
    'montags',
    'dienstags',
    'mittwochs',
    'donnerstags',
    'freitags',
    'samstags',
  ];

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') return `täglich um ${time}`;
  if (dayOfMonth === '*' && month === '*' && isNumber(dayOfWeek)) {
    const name = weekdays[Number(dayOfWeek) % 7];
    return name ? `${name} um ${time}` : expression;
  }
  if (isNumber(dayOfMonth) && month === '*' && dayOfWeek === '*') {
    return `am ${dayOfMonth}. jedes Monats um ${time}`;
  }

  return expression;
}

export function SchedulerWidget() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.cron,
    queryFn: getCronJobs,
    staleTime: 30_000,
  });

  const jobs = data ?? [];

  return (
    <WidgetState
      isPending={isPending}
      error={error}
      isEmpty={jobs.length === 0}
      emptyMessage="Keine geplanten Aufgaben"
    >
      <ul className="h-full space-y-1.5 overflow-y-auto">
        {jobs.map((job) => {
          const described = describeCron(job.schedule);

          return (
            <li
              key={job.id}
              className="flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--color-raised)]"
            >
              <span
                className="mt-0.5 shrink-0"
                style={{ color: job.paused ? 'var(--color-ink-faint)' : 'var(--color-ok)' }}
                aria-hidden
              >
                {job.paused ? <Pause size={12} /> : <Play size={12} />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm" title={job.name}>
                  {job.name}
                </span>
                {described && (
                  <span className="block truncate text-[0.7rem] text-[var(--color-ink-faint)]">
                    {described}
                    {described !== job.schedule && job.schedule && (
                      <span className="ml-1.5 font-mono opacity-60">{job.schedule}</span>
                    )}
                  </span>
                )}
              </span>

              {job.paused && (
                <span className="shrink-0 text-[0.65rem] text-[var(--color-ink-faint)]">
                  pausiert
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </WidgetState>
  );
}
