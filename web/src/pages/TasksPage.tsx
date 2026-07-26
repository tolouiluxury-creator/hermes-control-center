import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Pause, Play } from 'lucide-react';
import { getCronJobs, queryKeys } from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { describeCron } from '@/widgets/SchedulerWidget';

export function TasksPage() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.cron,
    queryFn: getCronJobs,
    staleTime: 30_000,
  });

  const jobs = data ?? [];
  const active = jobs.filter((job) => !job.paused).length;

  return (
    <PageShell title="Aufgaben" description="Geplante Jobs, die dein Agent von selbst ausführt.">
      {isPending ? (
        <SkeletonText lines={6} />
      ) : error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : jobs.length === 0 ? (
        <div className="card p-10 text-center">
          <span
            className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-raised)] text-[var(--color-ink-faint)]"
            aria-hidden
          >
            <CalendarClock size={22} />
          </span>
          <p className="mt-4 text-sm font-medium">Keine geplanten Aufgaben</p>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            Über <code className="font-mono">hermes cron</code> angelegte Jobs erscheinen hier.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-[var(--color-ink-faint)]" role="status">
            {jobs.length} Jobs, davon {active} aktiv
          </p>

          <ul className="space-y-2">
            {jobs.map((job) => {
              const described = describeCron(job.schedule);

              return (
                <li key={job.id} className="card flex items-start gap-3 p-4">
                  <span
                    className="mt-0.5 shrink-0"
                    style={{ color: job.paused ? 'var(--color-ink-faint)' : 'var(--color-ok)' }}
                    aria-hidden
                  >
                    {job.paused ? <Pause size={14} /> : <Play size={14} />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{job.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                      {described ?? 'Zeitplan unbekannt'}
                      {described && described !== job.schedule && job.schedule && (
                        <span className="ml-2 font-mono text-[var(--color-ink-faint)]">
                          {job.schedule}
                        </span>
                      )}
                    </p>
                  </div>

                  <span className="shrink-0 font-mono text-[0.65rem] text-[var(--color-ink-faint)]">
                    {job.id}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
            Pausieren, Auslösen und Löschen greifen in den laufenden Betrieb ein — diese Aktionen
            baue ich mit Sicherheitsabfrage ein, sobald die Schreibvorgänge dran sind.
          </p>
        </>
      )}
    </PageShell>
  );
}
