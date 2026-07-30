import { describe, expect, it } from 'vitest';
import { buildSchedule, DEFAULT_DRAFT, parseSchedule, type ScheduleDraft } from './schedule';

const draft = (patch: Partial<ScheduleDraft>): ScheduleDraft => ({ ...DEFAULT_DRAFT, ...patch });

describe('buildSchedule', () => {
  it('writes cron without leading zeros, the way Hermes stores it', () => {
    expect(buildSchedule(draft({ mode: 'daily', time: '07:00' }))).toBe('0 7 * * *');
    expect(buildSchedule(draft({ mode: 'daily', time: '18:05' }))).toBe('5 18 * * *');
  });

  it('sorts and de-duplicates the weekdays', () => {
    expect(buildSchedule(draft({ mode: 'weekly', time: '07:00', weekdays: [5, 1, 1] }))).toBe(
      '0 7 * * 1,5',
    );
  });

  it('writes the monthly day and the interval', () => {
    expect(buildSchedule(draft({ mode: 'monthly', time: '09:00', dayOfMonth: 1 }))).toBe(
      '0 9 1 * *',
    );
    expect(buildSchedule(draft({ mode: 'interval', intervalValue: 30, intervalUnit: 'm' }))).toBe(
      'every 30m',
    );
  });

  /*
   * A draft that cannot produce a schedule must say so rather than fall back to
   * something plausible: saving a job on the wrong day is worse than not saving.
   */
  it('refuses to invent a schedule out of an incomplete draft', () => {
    expect(buildSchedule(draft({ mode: 'weekly', weekdays: [] }))).toBeNull();
    expect(buildSchedule(draft({ mode: 'daily', time: '25:00' }))).toBeNull();
    expect(buildSchedule(draft({ mode: 'interval', intervalValue: 0 }))).toBeNull();
    expect(buildSchedule(draft({ mode: 'once', runAt: '' }))).toBeNull();
    expect(buildSchedule(draft({ mode: 'custom', raw: '  ' }))).toBeNull();
  });
});

describe('parseSchedule', () => {
  it('reads back the real jobs on the server', () => {
    expect(parseSchedule('0 7 * * *')).toMatchObject({ mode: 'daily', time: '07:00' });
    expect(parseSchedule('0 7 * * 1')).toMatchObject({
      mode: 'weekly',
      time: '07:00',
      weekdays: [1],
    });
    expect(parseSchedule('0 9 * * *')).toMatchObject({ mode: 'daily', time: '09:00' });
  });

  it('reads intervals in every spelling Hermes accepts', () => {
    expect(parseSchedule('every 30m')).toMatchObject({ intervalValue: 30, intervalUnit: 'm' });
    expect(parseSchedule('every 2 hours')).toMatchObject({ intervalValue: 2, intervalUnit: 'h' });
    expect(parseSchedule('EVERY 1d')).toMatchObject({ intervalValue: 1, intervalUnit: 'd' });
  });

  it('treats cron Sunday 7 and 0 as the same day', () => {
    expect(parseSchedule('0 8 * * 7').weekdays).toEqual([0]);
    expect(parseSchedule('0 8 * * 0').weekdays).toEqual([0]);
  });

  it('reads a one-off timestamp', () => {
    expect(parseSchedule('2026-08-03T14:00')).toMatchObject({
      mode: 'once',
      runAt: '2026-08-03T14:00',
    });
  });

  /*
   * The important half: everything the modes cannot express must survive
   * untouched. Ranges, steps, month restrictions and relative one-offs are all
   * valid to Hermes, and an edit that rewrote them would change what the job does.
   */
  it('keeps anything the modes cannot express, verbatim', () => {
    for (const expression of [
      '30 18 * * 1-5',
      '0 */4 * * *',
      '0 9 1 6 *',
      '2h',
      '2026-08-03T14:00:30+02:00',
      'nonsense',
    ]) {
      const parsed = parseSchedule(expression);
      expect(parsed.mode).toBe('custom');
      expect(parsed.raw).toBe(expression);
      expect(buildSchedule(parsed)).toBe(expression);
    }
  });

  it('round-trips every mode it claims to understand', () => {
    for (const expression of [
      '0 7 * * *',
      '5 18 * * *',
      '0 7 * * 1,5',
      // Task007 as the user created it: opening and saving must not drop a day.
      '59 15 * * 1,3',
      '0 9 1 * *',
      'every 30m',
    ]) {
      expect(buildSchedule(parseSchedule(expression))).toBe(expression);
    }
  });

  it('starts from the default when there is no schedule yet', () => {
    expect(parseSchedule(null).mode).toBe('daily');
    expect(parseSchedule('   ').mode).toBe('daily');
  });
});
