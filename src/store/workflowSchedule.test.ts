import { describe, expect, it } from 'vitest';
import { isRecurringSchedule, nextRunAt } from './workflowSchedule.js';

const NOW = new Date('2026-08-10T12:00:00Z').getTime();

describe('nextRunAt', () => {
  it('fires a relative one-off after its duration', () => {
    expect(nextRunAt('30m', NOW)).toBe(NOW + 30 * 60_000);
    expect(nextRunAt('2h', NOW)).toBe(NOW + 2 * 3_600_000);
    expect(nextRunAt('1d', NOW)).toBe(NOW + 86_400_000);
  });

  it('fires a recurring interval after its duration', () => {
    expect(nextRunAt('every 30m', NOW)).toBe(NOW + 30 * 60_000);
    expect(nextRunAt('every 2 hours', NOW)).toBe(NOW + 2 * 3_600_000);
  });

  /**
   * `<input type="datetime-local">` strings carry no timezone, so both the
   * implementation and these tests read them as local wall-clock time —
   * built here from local getters (not `toISOString()`, which is UTC) so
   * the round trip holds regardless of which timezone the test runs in.
   */
  const toLocalIsoMinutes = (date: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  it('fires a future ISO-local timestamp exactly then, and rejects a past one', () => {
    // A 2-day margin comfortably clears any real timezone's UTC offset.
    const future = new Date(NOW + 2 * 86_400_000);
    const iso = toLocalIsoMinutes(future);
    expect(nextRunAt(iso, NOW)).toBe(new Date(iso).getTime());

    const past = toLocalIsoMinutes(new Date(NOW - 2 * 86_400_000));
    expect(nextRunAt(past, NOW)).toBeNull();
  });

  it('computes the next occurrence of a cron expression', () => {
    // cron-parser reads the expression in local server time, same as Hermes'
    // own cron scheduler — "0 7 * * 1" means 07:00 local on Mondays.
    const next = nextRunAt('0 7 * * 1', NOW);
    expect(next).not.toBeNull();
    expect(new Date(next!).getDay()).toBe(1);
    expect(new Date(next!).getHours()).toBe(7);
    expect(next!).toBeGreaterThan(NOW);
  });

  it('returns null for garbage input', () => {
    expect(nextRunAt('', NOW)).toBeNull();
    expect(nextRunAt('not a schedule', NOW)).toBeNull();
    expect(nextRunAt('every 3 fortnights', NOW)).toBeNull();
    expect(nextRunAt('99 99 * * *', NOW)).toBeNull();
  });
});

describe('isRecurringSchedule', () => {
  it('is true for "every" intervals and cron expressions', () => {
    expect(isRecurringSchedule('every 30m')).toBe(true);
    expect(isRecurringSchedule('0 7 * * 1')).toBe(true);
  });

  it('is false for relative and fixed one-offs', () => {
    expect(isRecurringSchedule('30m')).toBe(false);
    expect(isRecurringSchedule('2026-08-10T14:00')).toBe(false);
  });

  it('is false for garbage', () => {
    expect(isRecurringSchedule('not a schedule')).toBe(false);
  });
});
