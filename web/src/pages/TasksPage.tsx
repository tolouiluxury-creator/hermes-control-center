import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pause, Play, Trash2, Zap } from 'lucide-react';
import { cronAction, deleteCronJob, getCronJobs, queryKeys } from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { describeCron } from '@/widgets/SchedulerWidget';
import type { CronJobSummary } from '@/lib/hermesTypes';

/** Small icon button used for the per-job actions. */
function ActionButton({
  onClick,
  disabled,
  label,
  title,
  danger = false,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className={`rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors disabled:opacity-40 ${
        danger ? 'hover:text-[var(--color-danger)]' : 'hover:text-[var(--color-accent)]'
      }`}
    >
      {children}
    </button>
  );
}

export function TasksPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.cron,
    queryFn: getCronJobs,
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.cron });

  const runAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'trigger' }) =>
      cronAction(id, action),
    onSuccess: async (_result, variables) => {
      await invalidate();
      const verb =
        variables.action === 'pause'
          ? 'pausiert'
          : variables.action === 'resume'
            ? 'fortgesetzt'
            : 'ausgelöst';
      toast.push({ tone: 'success', title: `Job ${verb}` });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: 'Aktion fehlgeschlagen',
        description: mutationError.message,
      }),
  });

  const remove = useMutation({
    mutationFn: deleteCronJob,
    onSuccess: async () => {
      setConfirmDelete(null);
      await invalidate();
      toast.push({ tone: 'success', title: 'Job gelöscht' });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: 'Löschen fehlgeschlagen',
        description: mutationError.message,
      }),
  });

  const busy = (id: string) =>
    (runAction.isPending && runAction.variables?.id === id) ||
    (remove.isPending && remove.variables === id);

  const jobs = data ?? [];
  const active = jobs.filter((job: CronJobSummary) => !job.paused).length;

  return (
    <PageShell
      title="Aufgaben"
      description="Geplante Jobs, die dein Agent von selbst ausführt. Pausieren, Auslösen und Löschen greifen in den laufenden Betrieb ein."
    >
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
            {jobs.map((job: CronJobSummary) => {
              const described = describeCron(job.schedule);
              const disabled = busy(job.id);

              return (
                <li key={job.id} className="card p-4">
                  <div className="flex items-start gap-3">
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
                        {job.paused ? 'pausiert · ' : ''}
                        {described ?? 'Zeitplan unbekannt'}
                        {described && described !== job.schedule && job.schedule && (
                          <span className="ml-2 font-mono text-[var(--color-ink-faint)]">
                            {job.schedule}
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <ActionButton
                        onClick={() => runAction.mutate({ id: job.id, action: 'trigger' })}
                        disabled={disabled}
                        label={`${job.name} jetzt ausführen`}
                        title="Jetzt ausführen"
                      >
                        <Zap size={14} aria-hidden />
                      </ActionButton>
                      <ActionButton
                        onClick={() =>
                          runAction.mutate({ id: job.id, action: job.paused ? 'resume' : 'pause' })
                        }
                        disabled={disabled}
                        label={`${job.name} ${job.paused ? 'fortsetzen' : 'pausieren'}`}
                        title={job.paused ? 'Fortsetzen' : 'Pausieren'}
                      >
                        {job.paused ? (
                          <Play size={14} aria-hidden />
                        ) : (
                          <Pause size={14} aria-hidden />
                        )}
                      </ActionButton>
                      <ActionButton
                        onClick={() => setConfirmDelete(job.id)}
                        disabled={disabled}
                        label={`${job.name} löschen`}
                        title="Löschen"
                        danger
                      >
                        <Trash2 size={14} aria-hidden />
                      </ActionButton>
                    </div>
                  </div>

                  {confirmDelete === job.id && (
                    <ConfirmInline
                      tone="danger"
                      message={
                        <>„{job.name}" endgültig löschen? Das lässt sich nicht rückgängig machen.</>
                      }
                      confirmLabel="Löschen"
                      pending={remove.isPending && remove.variables === job.id}
                      onConfirm={() => remove.mutate(job.id)}
                      onCancel={() => setConfirmDelete(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </PageShell>
  );
}
