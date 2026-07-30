/**
 * Turning a schedule into something choosable.
 *
 * Hermes stores a schedule as one string — a cron expression, an `every 30m`
 * interval, a relative `2h`, or an ISO timestamp. Asking a user to write that by
 * hand means asking them to learn cron's five positional fields, which is a
 * cost the product should carry instead.
 *
 * So the editor works in modes, and these functions translate both ways: a mode
 * plus its fields becomes the string Hermes wants, and an existing string is
 * read back into the mode that produced it. Anything that does not fit a mode
 * falls to `custom` and is shown verbatim — describing a schedule wrongly is
 * worse than making someone read it raw.
 */

export type ScheduleMode = 'daily' | 'weekly' | 'monthly' | 'interval' | 'once' | 'custom';

export type IntervalUnit = 'm' | 'h' | 'd';

export interface ScheduleDraft {
  mode: ScheduleMode;
  /** `HH:MM`, used by daily, weekly and monthly. */
  time: string;
  /** Cron weekday numbers, 0 = Sunday. Empty means "no day picked yet". */
  weekdays: number[];
  /** Day of month, 1–31. */
  dayOfMonth: number;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  /** `YYYY-MM-DDTHH:MM`, what `<input type="datetime-local">` produces. */
  runAt: string;
  /** The raw string, for `custom` and as the fallback for everything else. */
  raw: string;
}

export const DEFAULT_DRAFT: ScheduleDraft = {
  mode: 'daily',
  time: '07:00',
  weekdays: [1],
  dayOfMonth: 1,
  intervalValue: 30,
  intervalUnit: 'm',
  runAt: '',
  raw: '',
};

const isNumber = (value: string): boolean => /^\d+$/.test(value);

/** `"07:05"` → `["5", "7"]` as cron's minute and hour, without leading zeros. */
function splitTime(time: string): [string, string] | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return [String(minute), String(hour)];
}

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * The string Hermes stores. Returns null when the draft cannot produce one —
 * a weekly schedule with no weekday, an empty custom field — so the caller can
 * keep saving disabled instead of sending something meaningless.
 */
export function buildSchedule(draft: ScheduleDraft): string | null {
  switch (draft.mode) {
    case 'daily': {
      const parts = splitTime(draft.time);
      return parts ? `${parts[0]} ${parts[1]} * * *` : null;
    }
    case 'weekly': {
      const parts = splitTime(draft.time);
      if (!parts || draft.weekdays.length === 0) return null;
      const days = [...new Set(draft.weekdays)].sort((a, b) => a - b).join(',');
      return `${parts[0]} ${parts[1]} * * ${days}`;
    }
    case 'monthly': {
      const parts = splitTime(draft.time);
      if (!parts || draft.dayOfMonth < 1 || draft.dayOfMonth > 31) return null;
      return `${parts[0]} ${parts[1]} ${draft.dayOfMonth} * *`;
    }
    case 'interval': {
      if (!Number.isInteger(draft.intervalValue) || draft.intervalValue < 1) return null;
      return `every ${draft.intervalValue}${draft.intervalUnit}`;
    }
    case 'once':
      return draft.runAt.trim() === '' ? null : draft.runAt.trim();
    case 'custom':
      return draft.raw.trim() === '' ? null : draft.raw.trim();
  }
}

/**
 * Read an existing schedule back into a draft, so editing a job starts from what
 * it actually does. Anything not recognised lands in `custom` with the original
 * text intact — an edit must never rewrite a schedule it failed to understand.
 */
export function parseSchedule(schedule: string | null): ScheduleDraft {
  const text = (schedule ?? '').trim();
  if (text === '') return { ...DEFAULT_DRAFT };

  const base: ScheduleDraft = { ...DEFAULT_DRAFT, mode: 'custom', raw: text };

  const interval =
    /^every\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i.exec(text);
  if (interval) {
    return {
      ...base,
      mode: 'interval',
      intervalValue: Number(interval[1]),
      intervalUnit: interval[2]![0]!.toLowerCase() as IntervalUnit,
    };
  }

  // `<input type="datetime-local">` has no seconds and no zone; anything richer
  // stays custom rather than being silently truncated on the next save.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    return { ...base, mode: 'once', runAt: text };
  }

  const parts = text.split(/\s+/);
  if (parts.length !== 5) return base;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (!isNumber(minute) || !isNumber(hour) || month !== '*') return base;
  if (Number(hour) > 23 || Number(minute) > 59) return base;

  const time = `${pad(Number(hour))}:${pad(Number(minute))}`;

  if (dayOfMonth === '*' && dayOfWeek === '*') return { ...base, mode: 'daily', time };

  if (dayOfMonth === '*' && dayOfWeek !== '*') {
    // Only a plain list of days round-trips; ranges and steps stay custom.
    const days = dayOfWeek.split(',');
    if (days.every((day) => isNumber(day) && Number(day) <= 7)) {
      return {
        ...base,
        mode: 'weekly',
        time,
        weekdays: [...new Set(days.map((day) => Number(day) % 7))],
      };
    }
    return base;
  }

  if (isNumber(dayOfMonth) && dayOfWeek === '*') {
    const day = Number(dayOfMonth);
    if (day >= 1 && day <= 31) return { ...base, mode: 'monthly', time, dayOfMonth: day };
  }

  return base;
}
