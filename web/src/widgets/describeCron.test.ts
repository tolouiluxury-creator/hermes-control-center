import { describe, expect, it } from 'vitest';
import { describeCron } from './SchedulerWidget';

/**
 * A stand-in dictionary: the point is which key gets picked and with what
 * parameters, not the English wording.
 */
const t = (key: string, params?: Record<string, string | number>): string => {
  const names: Record<string, string> = {
    'cron.weekday.0': 'Sundays',
    'cron.weekday.1': 'Mondays',
    'cron.weekday.3': 'Wednesdays',
    'cron.weekday.5': 'Fridays',
  };
  if (key in names) return names[key]!;
  if (key === 'cron.time') return `${params?.hour}:${params?.minute}`;
  if (key === 'cron.daily') return `daily at ${params?.time}`;
  if (key === 'cron.weekly') return `${params?.weekday} at ${params?.time}`;
  if (key === 'cron.monthly') return `day ${params?.day} at ${params?.time}`;
  return key;
};

describe('describeCron', () => {
  it('describes the everyday shapes', () => {
    expect(describeCron('0 7 * * *', t)).toBe('daily at 07:00');
    expect(describeCron('0 7 * * 1', t)).toBe('Mondays at 07:00');
    expect(describeCron('0 9 1 * *', t)).toBe('day 1 at 09:00');
  });

  /* The picker can produce these, so they must not come back as raw cron. */
  it('describes a list of weekdays, in week order', () => {
    expect(describeCron('59 15 * * 1,3', t)).toBe('Mondays, Wednesdays at 15:59');
    expect(describeCron('0 7 * * 5,1', t)).toBe('Mondays, Fridays at 07:00');
  });

  it('treats cron Sunday 7 as Sunday, and puts it last', () => {
    expect(describeCron('0 8 * * 7', t)).toBe('Sundays at 08:00');
    expect(describeCron('0 8 * * 0,1', t)).toBe('Mondays, Sundays at 08:00');
  });

  /* Describing a schedule wrongly is worse than making someone read it raw. */
  it('hands back anything it cannot describe, unchanged', () => {
    for (const expression of ['30 18 * * 1-5', '0 */4 * * *', '0 9 1 6 *', 'every 30m', '2h']) {
      expect(describeCron(expression, t)).toBe(expression);
    }
    expect(describeCron(null, t)).toBeNull();
  });
});
