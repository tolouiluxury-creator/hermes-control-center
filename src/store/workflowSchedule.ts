import { CronExpressionParser } from 'cron-parser';

/**
 * Turns a workflow's `schedule` string into "when does this next fire".
 * Accepts the same four formats the editor's `ScheduleField` produces (and
 * that Hermes' own Aufgaben schedules teach users): a bare relative duration
 * (`"30m"`, `"2h"`) for a one-off run, `"every 30m"` for a recurring
 * interval, a standard 5-field cron expression, or an ISO-ish local
 * timestamp (`YYYY-MM-DDTHH:MM`, what `<input type="datetime-local">`
 * produces) for a one-off run at a fixed time.
 *
 * Kept in `store/`, not `hermes/`, because it has nothing to do with talking
 * to Hermes — it is pure schedule math over a string this app itself owns.
 */

type ParsedSchedule =
  | { kind: 'relative'; ms: number }
  | { kind: 'interval'; ms: number }
  | { kind: 'once'; at: number }
  | { kind: 'cron'; expression: string };

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

const INTERVAL_RE = /^every\s+(\d+)\s*([a-z]+)$/i;
const RELATIVE_RE = /^(\d+)\s*([a-z]+)$/i;
const ONCE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function parseScheduleFormat(schedule: string): ParsedSchedule | null {
  const text = schedule.trim();
  if (text === '') return null;

  const interval = INTERVAL_RE.exec(text);
  if (interval) {
    const unitMs = UNIT_MS[interval[2]!.toLowerCase()];
    if (!unitMs) return null;
    return { kind: 'interval', ms: Number(interval[1]) * unitMs };
  }

  if (ONCE_RE.test(text)) {
    // No timezone in the string (same shape `<input type="datetime-local">`
    // produces) — `new Date()` reads it as local time on whatever machine
    // runs this, which is the server here, matching how Hermes' own
    // `parse_schedule` treats the identical format for Aufgaben.
    const at = new Date(text).getTime();
    return Number.isFinite(at) ? { kind: 'once', at } : null;
  }

  const relative = RELATIVE_RE.exec(text);
  if (relative) {
    const unitMs = UNIT_MS[relative[2]!.toLowerCase()];
    if (!unitMs) return null;
    return { kind: 'relative', ms: Number(relative[1]) * unitMs };
  }

  // Anything else is asserted to be a 5-field cron expression; cron-parser
  // itself is the validator (nextRunAt below returns null if it rejects it).
  if (text.split(/\s+/).length === 5) return { kind: 'cron', expression: text };

  return null;
}

/** True for schedules that fire more than once — `nextRunAt` should be recomputed after each fire. */
export function isRecurringSchedule(schedule: string): boolean {
  const parsed = parseScheduleFormat(schedule);
  return parsed?.kind === 'interval' || parsed?.kind === 'cron';
}

/**
 * The next time this schedule is due, strictly after `now` — or `null` if it
 * can't produce one (an unparseable expression, or a one-off timestamp
 * that's already in the past).
 */
export function nextRunAt(schedule: string, now = Date.now()): number | null {
  const parsed = parseScheduleFormat(schedule);
  if (!parsed) return null;

  switch (parsed.kind) {
    case 'relative':
    case 'interval':
      return now + parsed.ms;
    case 'once':
      return parsed.at > now ? parsed.at : null;
    case 'cron':
      try {
        return CronExpressionParser.parse(parsed.expression, {
          currentDate: new Date(now),
        })
          .next()
          .toDate()
          .getTime();
      } catch {
        return null;
      }
  }
}
