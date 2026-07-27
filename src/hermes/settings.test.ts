import { describe, expect, it } from 'vitest';
import { normalizeCurator, normalizeEnv, normalizeToolsets, normalizeUpdate } from './settings.js';

/** Payloads below are trimmed from a real Hermes 0.19.0. */

describe('normalizeEnv', () => {
  const real = {
    NOUS_BASE_URL: {
      is_set: false,
      redacted_value: null,
      description: 'Nous Portal base URL override',
      category: 'provider',
      is_password: false,
      advanced: true,
    },
    TELEGRAM_BOT_TOKEN: {
      is_set: true,
      redacted_value: '8627…7lkE',
      description: 'Telegram bot token',
      category: 'messaging',
      is_password: true,
    },
  };

  it('lists set variables first and never exposes a real value', () => {
    const vars = normalizeEnv(real);
    expect(vars[0]?.key).toBe('TELEGRAM_BOT_TOKEN');
    expect(vars[0]?.isSet).toBe(true);
    // Only the dashboard's own masked preview survives.
    expect(vars[0]?.redactedValue).toBe('8627…7lkE');
    expect(vars[0]?.isPassword).toBe(true);
  });

  it('defaults a missing category rather than dropping the variable', () => {
    const [only] = normalizeEnv({ FOO: { is_set: false } });
    expect(only?.category).toBe('sonstige');
  });
});

describe('normalizeCurator', () => {
  it('turns the ISO last-run timestamp into epoch milliseconds', () => {
    const status = normalizeCurator({
      enabled: true,
      paused: false,
      interval_hours: 168,
      last_run_at: '2026-07-22T20:13:15.348496+00:00',
      stale_after_days: 30,
      archive_after_days: 90,
    });
    expect(status.enabled).toBe(true);
    expect(status.intervalHours).toBe(168);
    expect(status.lastRunAt).toBe(Date.parse('2026-07-22T20:13:15.348496+00:00'));
  });

  it('reports no last run for a missing timestamp instead of 1970', () => {
    expect(normalizeCurator({ enabled: true }).lastRunAt).toBeNull();
  });
});

describe('normalizeUpdate', () => {
  it('reads the real update-check shape', () => {
    const status = normalizeUpdate({
      install_method: 'git',
      current_version: '0.19.0',
      behind: 0,
      update_available: false,
      can_apply: true,
      update_command: 'hermes update',
      message: "You're on the latest version.",
    });
    expect(status.currentVersion).toBe('0.19.0');
    expect(status.updateAvailable).toBe(false);
    expect(status.updateCommand).toBe('hermes update');
  });
});

describe('normalizeToolsets', () => {
  it('puts enabled toolsets first and counts their tools', () => {
    const toolsets = normalizeToolsets([
      { name: 'off', label: 'Off', enabled: false, available: true, tools: [] },
      {
        name: 'web',
        label: 'Web',
        enabled: true,
        available: true,
        tools: ['web_search', 'web_extract'],
      },
    ]);
    expect(toolsets[0]?.name).toBe('web');
    expect(toolsets[0]?.tools).toHaveLength(2);
  });
});
