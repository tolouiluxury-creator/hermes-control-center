import { useI18n } from '@/lib/i18n';
import { buildSchedule, type IntervalUnit, type ScheduleDraft } from '@/lib/schedule';
import { describeCron } from '@/widgets/SchedulerWidget';

/**
 * Picking when a job runs, without knowing cron.
 *
 * The modes cover what people actually schedule; `custom` keeps the raw field
 * for everything else, so nothing Hermes accepts becomes unreachable. Whatever
 * is picked, the resulting expression is shown in full underneath — the point is
 * to spare people writing it, not to hide what was stored.
 */

const MODES = ['daily', 'weekly', 'monthly', 'interval', 'once', 'custom'] as const;
const UNITS: IntervalUnit[] = ['m', 'h', 'd'];
/** Monday first for reading; the value is cron's numbering, 0 = Sunday. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function ScheduleField({
  draft,
  onChange,
}: {
  draft: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
}) {
  const { t } = useI18n();
  const expression = buildSchedule(draft);
  const described = expression ? describeCron(expression, t) : null;

  const patch = (change: Partial<ScheduleDraft>) => onChange({ ...draft, ...change });

  const toggleWeekday = (day: number) =>
    patch({
      weekdays: draft.weekdays.includes(day)
        ? draft.weekdays.filter((entry) => entry !== day)
        : [...draft.weekdays, day],
    });

  const field =
    'rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent)]';
  const chip = (active: boolean) =>
    `rounded-lg border px-2.5 py-1 text-xs transition-colors ${
      active
        ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
        : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
    }`;

  return (
    <div>
      <p className="block text-xs text-[var(--color-ink-faint)]">{t('tasks.form.schedule')}</p>

      <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={t('schedule.modeAria')}>
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={draft.mode === mode}
            onClick={() => patch({ mode })}
            className={chip(draft.mode === mode)}
          >
            {t(`schedule.mode.${mode}`)}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {(draft.mode === 'daily' || draft.mode === 'weekly' || draft.mode === 'monthly') && (
          <label className="block text-xs text-[var(--color-ink-faint)]">
            {t('schedule.time')}
            <input
              type="time"
              value={draft.time}
              onChange={(event) => patch({ time: event.target.value })}
              className={`mt-1 block ${field}`}
            />
          </label>
        )}

        {draft.mode === 'monthly' && (
          <label className="block text-xs text-[var(--color-ink-faint)]">
            {t('schedule.dayOfMonth')}
            <input
              type="number"
              min={1}
              max={31}
              value={draft.dayOfMonth}
              onChange={(event) => patch({ dayOfMonth: Number(event.target.value) })}
              className={`mt-1 block w-20 ${field}`}
            />
          </label>
        )}

        {draft.mode === 'interval' && (
          <>
            <label className="block text-xs text-[var(--color-ink-faint)]">
              {t('schedule.every')}
              <input
                type="number"
                min={1}
                value={draft.intervalValue}
                onChange={(event) => patch({ intervalValue: Number(event.target.value) })}
                className={`mt-1 block w-24 ${field}`}
              />
            </label>
            <label className="block text-xs text-[var(--color-ink-faint)]">
              <span className="sr-only">{t('schedule.unit')}</span>
              <select
                value={draft.intervalUnit}
                onChange={(event) => patch({ intervalUnit: event.target.value as IntervalUnit })}
                className={`mt-1 block ${field}`}
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(`schedule.unit.${unit}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {draft.mode === 'once' && (
          <label className="block text-xs text-[var(--color-ink-faint)]">
            {t('schedule.runAt')}
            <input
              type="datetime-local"
              value={draft.runAt}
              onChange={(event) => patch({ runAt: event.target.value })}
              className={`mt-1 block ${field}`}
            />
          </label>
        )}

        {draft.mode === 'custom' && (
          <label className="block w-full text-xs text-[var(--color-ink-faint)]">
            {t('schedule.customLabel')}
            <input
              value={draft.raw}
              onChange={(event) => patch({ raw: event.target.value })}
              placeholder="0 7 * * *"
              className={`mt-1 block w-full font-mono ${field}`}
            />
          </label>
        )}
      </div>

      {draft.mode === 'weekly' && (
        <div className="mt-3">
          <p className="text-xs text-[var(--color-ink-faint)]">{t('schedule.weekdays')}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {WEEKDAY_ORDER.map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={draft.weekdays.includes(day)}
                onClick={() => toggleWeekday(day)}
                className={chip(draft.weekdays.includes(day))}
              >
                {t(`cron.weekday.${day}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {draft.mode === 'custom' && (
        <p className="mt-2 text-[0.65rem] text-[var(--color-ink-faint)]">
          {t('tasks.form.scheduleHelp')}
        </p>
      )}

      <p className="mt-2 text-xs">
        {expression === null ? (
          <span className="text-[var(--color-warn)]">{t('schedule.incomplete')}</span>
        ) : (
          <span className="text-[var(--color-ink-muted)]">
            {described && described !== expression ? `${described} · ` : ''}
            <span className="font-mono text-[var(--color-ink-faint)]">{expression}</span>
          </span>
        )}
      </p>
    </div>
  );
}
