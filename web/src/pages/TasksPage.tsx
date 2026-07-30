import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  createCronJob,
  cronAction,
  deleteCronJob,
  getCronDeliveryTargets,
  getCronJobs,
  getProfiles,
  queryKeys,
  updateCronJob,
} from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { describeCron } from '@/widgets/SchedulerWidget';
import type { CronJobInput, CronJobSummary } from '@/lib/hermesTypes';

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

/**
 * Create or edit one scheduled job.
 *
 * The profile picker only appears when creating: a job cannot move between
 * profiles, since each profile keeps its own cron store. On edit the profile is
 * shown as a fact instead, so it is clear which store is being written to.
 */
function JobEditor({
  job,
  onCancel,
  onSave,
  saving,
}: {
  job: CronJobSummary | null;
  onCancel: () => void;
  onSave: (input: CronJobInput & { profile: string }) => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  const profiles = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: getProfiles,
    staleTime: 60_000,
  });
  const targets = useQuery({
    queryKey: queryKeys.cronDeliveryTargets,
    queryFn: getCronDeliveryTargets,
    staleTime: 60_000,
  });

  const [name, setName] = useState(job?.name ?? '');
  const [schedule, setSchedule] = useState(job?.schedule ?? '');
  const [prompt, setPrompt] = useState(job?.prompt ?? '');
  const [deliver, setDeliver] = useState(job?.deliver ?? 'local');
  const [profile, setProfile] = useState(job?.profile ?? '');

  const chosenProfile = (job?.profile ?? profile) || (profiles.data?.current ?? '');

  /*
   * A job's stored target is not always one Hermes offers: the delivery-targets
   * endpoint lists `local` plus the configured platforms, while a job created
   * from a chat carries `deliver: "origin"`. Filling the select purely from the
   * endpoint would leave that value unmatched, and the browser would silently
   * show the first option instead — an edit would then reroute the output
   * without anyone touching the field. So the stored value is always an option.
   */
  const offered = targets.data ?? [];
  const options =
    deliver !== '' && !offered.some((target) => target.id === deliver)
      ? [{ id: deliver, name: deliver, homeTargetSet: true, homeEnvVar: null }, ...offered]
      : offered;
  const chosenTarget = options.find((target) => target.id === deliver);

  /* Hermes rejects an agent job with neither a prompt nor a skill (400). */
  const canSave = schedule.trim() !== '' && prompt.trim() !== '' && chosenProfile !== '' && !saving;

  const field =
    'mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]';
  const label = 'block text-xs text-[var(--color-ink-faint)]';

  return (
    <form
      className="card mb-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        onSave({
          profile: chosenProfile,
          schedule: schedule.trim(),
          name: name.trim(),
          prompt: prompt.trim(),
          deliver,
        });
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {job ? t('tasks.editTitle', { name: job.name }) : t('tasks.newTitle')}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
          aria-label={t('common.cancel')}
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={label}>
          {t('tasks.form.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <label className={label}>
          {t('tasks.form.schedule')}
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            required
            autoFocus
            placeholder="0 7 * * *"
            className={`${field} font-mono`}
          />
        </label>
      </div>
      <p className="mt-1 text-[0.65rem] text-[var(--color-ink-faint)]">
        {t('tasks.form.scheduleHelp')}
      </p>

      <label className={`mt-3 ${label}`}>
        {t('tasks.form.prompt')}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder={t('tasks.form.promptPlaceholder')}
          className={`${field} resize-y`}
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={label}>
          {t('tasks.form.deliver')}
          <select value={deliver} onChange={(e) => setDeliver(e.target.value)} className={field}>
            {options.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </select>
        </label>

        {job ? (
          <p className={label}>
            {t('tasks.form.profile')}
            <span className="mt-1 block px-3 py-2 text-sm">{job.profile ?? '—'}</span>
          </p>
        ) : (
          <label className={label}>
            {t('tasks.form.profile')}
            <select
              value={chosenProfile}
              onChange={(e) => setProfile(e.target.value)}
              className={field}
            >
              {(profiles.data?.profiles ?? []).map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {chosenTarget && !chosenTarget.homeTargetSet && (
        <p className="mt-2 text-xs text-[var(--color-warn)]">
          {t('tasks.form.noHomeChannel', { variable: chosenTarget.homeEnvVar ?? '' })}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 disabled:opacity-50"
        >
          <Check size={14} aria-hidden />
          {saving ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-[var(--color-hairline)] px-4 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

export function TasksPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t, lang } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<CronJobSummary | null | undefined>(undefined);

  const { data, isPending, error, dataUpdatedAt } = useQuery({
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
      const key =
        variables.action === 'pause'
          ? 'tasks.paused.toast'
          : variables.action === 'resume'
            ? 'tasks.resumed.toast'
            : 'tasks.triggered.toast';
      toast.push({ tone: 'success', title: t(key) });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: t('toast.actionFailed'),
        description: mutationError.message,
      }),
  });

  const remove = useMutation({
    mutationFn: deleteCronJob,
    onSuccess: async () => {
      setConfirmDelete(null);
      await invalidate();
      toast.push({ tone: 'success', title: t('tasks.deleted.toast') });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: t('toast.deleteFailed'),
        description: mutationError.message,
      }),
  });

  const save = useMutation({
    mutationFn: (input: CronJobInput & { profile: string }) => {
      if (!editing) return createCronJob(input);
      const { profile, ...updates } = input;
      return updateCronJob(editing.id, profile, updates);
    },
    onSuccess: async () => {
      const created = !editing;
      setEditing(undefined);
      await invalidate();
      toast.push({ tone: 'success', title: t(created ? 'tasks.created' : 'tasks.updated') });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: t('toast.saveFailed'),
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
      title={t('nav.aufgaben')}
      description={t('page.aufgaben.desc')}
      actions={
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20"
        >
          <Plus size={14} aria-hidden />
          {t('common.new')}
        </button>
      }
    >
      {editing !== undefined && (
        /* Keyed so switching to another job never carries the first one's text. */
        <JobEditor
          key={editing?.id ?? 'new'}
          job={editing}
          saving={save.isPending}
          onCancel={() => setEditing(undefined)}
          onSave={(input) => save.mutate(input)}
        />
      )}

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
          <p className="mt-4 text-sm font-medium">{t('tasks.empty.title')}</p>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            {t('tasks.empty.desc', { command: 'hermes cron' })}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-[var(--color-ink-faint)]" role="status">
            {t('tasks.count', { total: jobs.length, active })}
          </p>

          <ul className="space-y-2">
            {jobs.map((job: CronJobSummary) => {
              const described = describeCron(job.schedule, t);
              const disabled = busy(job.id);
              /*
               * A next run in the past means nothing has scheduled since — worth
               * naming, because the timestamp alone reads like a plan. Measured
               * against when the list was fetched, not Date.now(): that keeps the
               * render pure and says exactly what the data claimed.
               */
              const overdue = !job.paused && job.nextRun !== null && job.nextRun < dataUpdatedAt;
              const failed = job.lastStatus !== null && job.lastStatus !== 'ok';

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
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {job.name}
                        {job.profile && (
                          <span
                            className="rounded-md bg-[var(--color-raised)] px-1.5 py-0.5 text-[0.65rem] font-normal text-[var(--color-ink-faint)]"
                            title={t('tasks.profileAria', { name: job.profile })}
                          >
                            {job.profile}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                        {job.paused ? `${t('tasks.paused')} · ` : ''}
                        {described ?? t('tasks.scheduleUnknown')}
                        {described && described !== job.schedule && job.schedule && (
                          <span className="ml-2 font-mono text-[var(--color-ink-faint)]">
                            {job.schedule}
                          </span>
                        )}
                      </p>

                      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                        <div className="flex gap-1.5">
                          <dt className="text-[var(--color-ink-faint)]">{t('tasks.nextRun')}</dt>
                          <dd
                            className={overdue ? 'text-[var(--color-warn)]' : undefined}
                            title={formatDateTime(job.nextRun, lang) ?? undefined}
                          >
                            {job.nextRun === null
                              ? t('tasks.unknown')
                              : `${formatDateTime(job.nextRun, lang)}${
                                  overdue ? ` · ${t('tasks.overdue')}` : ''
                                }`}
                          </dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt className="text-[var(--color-ink-faint)]">{t('tasks.lastRun')}</dt>
                          <dd title={formatDateTime(job.lastRun, lang) ?? undefined}>
                            {job.lastRun === null
                              ? t('tasks.never')
                              : formatRelativeTime(job.lastRun, lang)}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <ActionButton
                        onClick={() => runAction.mutate({ id: job.id, action: 'trigger' })}
                        disabled={disabled}
                        label={t('tasks.trigger', { name: job.name })}
                        title={t('tasks.runNow')}
                      >
                        <Zap size={14} aria-hidden />
                      </ActionButton>
                      <ActionButton
                        onClick={() =>
                          runAction.mutate({ id: job.id, action: job.paused ? 'resume' : 'pause' })
                        }
                        disabled={disabled}
                        label={
                          job.paused
                            ? t('tasks.resumeAria', { name: job.name })
                            : t('tasks.pauseAria', { name: job.name })
                        }
                        title={job.paused ? t('tasks.resume') : t('tasks.pause')}
                      >
                        {job.paused ? (
                          <Play size={14} aria-hidden />
                        ) : (
                          <Pause size={14} aria-hidden />
                        )}
                      </ActionButton>
                      <ActionButton
                        onClick={() => setEditing(job)}
                        disabled={disabled}
                        label={t('tasks.editAria', { name: job.name })}
                        title={t('common.edit')}
                      >
                        <Pencil size={14} aria-hidden />
                      </ActionButton>
                      <ActionButton
                        onClick={() => setConfirmDelete(job.id)}
                        disabled={disabled}
                        label={t('tasks.deleteAria', { name: job.name })}
                        title={t('common.delete')}
                        danger
                      >
                        <Trash2 size={14} aria-hidden />
                      </ActionButton>
                    </div>
                  </div>

                  {failed && (
                    <div className="mt-3 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3">
                      <p className="flex items-center gap-2 text-xs font-medium text-[var(--color-danger)]">
                        <AlertTriangle size={13} aria-hidden />
                        {t('tasks.lastFailed', { status: job.lastStatus ?? '' })}
                      </p>
                      {job.lastError && (
                        <p className="mt-1 font-mono text-[0.65rem] break-words text-[var(--color-ink-muted)]">
                          {job.lastError}
                        </p>
                      )}
                    </div>
                  )}

                  {confirmDelete === job.id && (
                    <ConfirmInline
                      tone="danger"
                      message={t('tasks.deleteConfirm', { name: job.name })}
                      confirmLabel={t('common.delete')}
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
