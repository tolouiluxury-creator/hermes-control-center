import { describe, expect, it } from 'vitest';
import {
  normalizeDashboardStatus,
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
