import { describe, expect, it } from 'vitest';
import {
  normalizeDashboardStatus,
  normalizeComponentChecks,
  normalizeReadinessChecks,
  normalizeSystemStats,
  toNumber,
} from './normalize.js';
import type { DashboardStatus, HealthDetailed, SystemStats } from './schemas.js';

const stats = (value: unknown): SystemStats => value as SystemStats;
const health = (value: unknown): HealthDetailed => value as HealthDetailed;
const status = (value: unknown): DashboardStatus => value as DashboardStatus;

describe('toNumber', () => {
  it('accepts numbers, numeric strings and percent strings', () => {
    expect(toNumber(23)).toBe(23);
    expect(toNumber('23.5')).toBe(23.5);
    expect(toNumber('46%')).toBe(46);
  });

  it('rejects anything else', () => {
    expect(toNumber('')).toBeNull();
    expect(toNumber('n/a')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber({})).toBeNull();
  });
});

describe('normalizeSystemStats', () => {
  it('reads the flat field layout', () => {
    const result = normalizeSystemStats(
      stats({
        os: 'Ubuntu 24.04',
        cpu_percent: 23,
        cpu_count: 12,
        memory_percent: 46,
        memory_total: 34_359_738_368,
        memory_used: 15_784_066_355,
        disk_percent: 62,
        uptime_seconds: 453_600,
      }),
    );

    expect(result).toMatchObject({
      os: 'Ubuntu 24.04',
      cpuPercent: 23,
      cpuCount: 12,
      memoryPercent: 46,
      memoryTotalBytes: 34_359_738_368,
      diskPercent: 62,
      uptimeSeconds: 453_600,
    });
  });

  it('reads the nested field layout', () => {
    const result = normalizeSystemStats(
      stats({
        os: { name: 'Windows 11' },
        cpu: { percent: '31', cores: 8 },
        memory: { used_percent: 71, total: 17_179_869_184 },
        disk: { percent: 12 },
      }),
    );

    expect(result).toMatchObject({
      os: 'Windows 11',
      cpuPercent: 31,
      cpuCount: 8,
      memoryPercent: 71,
      memoryTotalBytes: 17_179_869_184,
      diskPercent: 12,
    });
  });

  it('prefers explicit *_bytes keys and drops unit-ambiguous values', () => {
    const explicit = normalizeSystemStats(stats({ memory_total_bytes: 8_589_934_592 }));
    expect(explicit.memoryTotalBytes).toBe(8_589_934_592);

    // 16384 could be MB, MiB or KB — better to show nothing than the wrong unit.
    const ambiguous = normalizeSystemStats(stats({ memory_total: 16_384 }));
    expect(ambiguous.memoryTotalBytes).toBeNull();
  });

  it('clamps out-of-range percentages and returns null for missing values', () => {
    const result = normalizeSystemStats(stats({ cpu_percent: 140, memory_percent: -5 }));
    expect(result.cpuPercent).toBe(100);
    expect(result.memoryPercent).toBe(0);
    expect(result.diskPercent).toBeNull();
    expect(result.uptimeSeconds).toBeNull();
  });
});

/**
 * Captured verbatim from Hermes 0.19.0 (`GET /api/status`). Keeping the real
 * shape here is what stops the normalisers from drifting back towards the
 * documented-but-wrong payloads they were first written against.
 */
const REAL_STATUS_019 = {
  version: '0.19.0',
  release_date: '2026.7.20',
  config_version: 33,
  latest_config_version: 33,
  can_update_hermes: true,
  gateway_running: true,
  gateway_state: 'running',
  gateway_platforms: {},
  gateway_exit_reason: null,
  active_agents: 0,
  gateway_busy: false,
  active_sessions: 0,
  auth_required: false,
  components: {
    gateway: { status: 'ok', state: 'running' },
    dashboard: { status: 'ok', recent_unhandled_errors: 0, last_error_at: null, selftest: 'ok' },
    storage: { status: 'ok' },
    platforms: { status: 'ok', configured: 1, connected: 1 },
  },
  overall: 'ok',
  profiles: ['default', 'sunrise'],
  hermes_home: '/root/.hermes',
  config_path: '/root/.hermes/config.yaml',
};

/** Captured verbatim from Hermes 0.19.0 (`GET /api/system/stats`). */
const REAL_SYSTEM_STATS_019 = {
  os: 'Linux',
  os_release: '6.8.0-136-generic',
  arch: 'x86_64',
  hostname: 'ubuntu',
  hermes_version: '0.19.0',
  cpu_count: 6,
  memory: { total: 8267022336, available: 5349269504, used: 2917752832, percent: 35.3 },
  disk: { total: 248505155584, used: 19128717312, free: 229359661056, percent: 7.7 },
  cpu_percent: 16.9,
  load_avg: [0.21, 0.2, 0.18],
  uptime_seconds: 610333,
  process: { pid: 827459, rss: 302407680, num_threads: 11 },
  psutil: true,
};

describe('real Hermes 0.19.0 payloads', () => {
  it('normalises host metrics without losing or inventing values', () => {
    expect(normalizeSystemStats(REAL_SYSTEM_STATS_019)).toEqual({
      os: 'Linux',
      cpuPercent: 16.9,
      cpuCount: 6,
      memoryPercent: 35.3,
      memoryUsedBytes: 2917752832,
      memoryTotalBytes: 8267022336,
      diskPercent: 7.7,
      diskUsedBytes: 19128717312,
      diskTotalBytes: 248505155584,
      uptimeSeconds: 610333,
    });
  });

  it('reads the agent summary, including fields 0.19 renamed', () => {
    const summary = normalizeDashboardStatus(REAL_STATUS_019);
    expect(summary.version).toBe('0.19.0');
    expect(summary.gatewayRunning).toBe(true);
    expect(summary.gatewayState).toBe('running');
    expect(summary.overall).toBe('ok');
    expect(summary.profiles).toEqual(['default', 'sunrise']);
    // 0.19 has no single `profile` field, and two candidates must not be guessed.
    expect(summary.profile).toBeNull();
  });

  it('derives readiness from components, with details worth reading', () => {
    expect(normalizeComponentChecks(REAL_STATUS_019)).toEqual([
      { name: 'dashboard', ok: true, detail: 'selftest: ok' },
      { name: 'gateway', ok: true, detail: 'state: running' },
      { name: 'platforms', ok: true, detail: 'configured: 1, connected: 1' },
      { name: 'storage', ok: true, detail: 'ok' },
    ]);
  });

  it('flags a degraded component as a warning, never as healthy', () => {
    const degraded = normalizeComponentChecks({
      components: {
        gateway: { status: 'degraded', state: 'stopped' },
        storage: { status: 'error' },
      },
    });
    expect(degraded).toEqual([
      { name: 'gateway', ok: null, detail: 'state: stopped' },
      { name: 'storage', ok: false, detail: 'error' },
    ]);
  });

  it('returns nothing when components are absent', () => {
    expect(normalizeComponentChecks({ version: '0.7.0' })).toEqual([]);
  });
});

describe('normalizeReadinessChecks', () => {
  it('handles a keyed object of string statuses', () => {
    const result = normalizeReadinessChecks(
      health({ readiness: { checks: { database: 'ok', model: 'fail' } } }),
    );
    expect(result).toEqual([
      { name: 'database', ok: true, detail: 'ok' },
      { name: 'model', ok: false, detail: 'fail' },
    ]);
  });

  it('handles an array of entries with nested detail', () => {
    const result = normalizeReadinessChecks(
      health({
        checks: [
          { name: 'disk', status: { ok: true, message: '62% used' } },
          { name: 'gateway', status: 'degraded' },
        ],
      }),
    );
    expect(result).toEqual([
      { name: 'disk', ok: true, detail: '62% used' },
      { name: 'gateway', ok: null, detail: 'degraded' },
    ]);
  });

  it('returns an empty list when no checks are reported', () => {
    expect(normalizeReadinessChecks(health({ status: 'ok' }))).toEqual([]);
  });
});

describe('normalizeDashboardStatus', () => {
  it('derives gateway state from a boolean, an object or a status string', () => {
    expect(normalizeDashboardStatus(status({ gateway_running: true })).gatewayRunning).toBe(true);
    expect(normalizeDashboardStatus(status({ gateway: { running: false } })).gatewayRunning).toBe(
      false,
    );
    expect(normalizeDashboardStatus(status({ gateway: { status: 'online' } })).gatewayRunning).toBe(
      true,
    );
    expect(normalizeDashboardStatus(status({})).gatewayRunning).toBeNull();
  });

  it('falls back to hermes_version', () => {
    expect(normalizeDashboardStatus(status({ hermes_version: '0.7.2' })).version).toBe('0.7.2');
  });
});
