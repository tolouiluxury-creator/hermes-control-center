import type { DashboardStatus, HealthDetailed, SystemStats } from './schemas.js';

/**
 * Hermes' telemetry payloads differ between versions: values arrive flat
 * (`cpu_percent`) or nested (`cpu: { percent }`), as numbers or as strings.
 * These helpers reduce them to one shape, and return null rather than a guess
 * whenever a value is genuinely absent — widgets render "—" for null.
 */

export interface HostMetrics {
  os: string | null;
  cpuPercent: number | null;
  cpuCount: number | null;
  memoryPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  diskPercent: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  uptimeSeconds: number | null;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim().replace('%', '');
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Reads the first present key from a flat payload or a nested sub-object. */
function pick(
  source: Record<string, unknown>,
  nested: Record<string, unknown> | null,
  flatKeys: string[],
  nestedKeys: string[],
): number | null {
  for (const key of flatKeys) {
    const value = toNumber(source[key]);
    if (value !== null) return value;
  }
  if (nested) {
    for (const key of nestedKeys) {
      const value = toNumber(nested[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

/**
 * Byte counts are only reported when we are confident about the unit: an
 * explicit `*_bytes` key, or a value large enough that any other unit would be
 * absurd (>= 1 MiB). Anything smaller could be MB or GB and is dropped rather
 * than displayed wrongly.
 */
const BYTE_CONFIDENCE_FLOOR = 1024 * 1024;

function pickBytes(
  source: Record<string, unknown>,
  nested: Record<string, unknown> | null,
  flatKeys: string[],
  nestedKeys: string[],
): number | null {
  const explicit = pick(
    source,
    nested,
    flatKeys.map((key) => `${key}_bytes`),
    nestedKeys.map((key) => `${key}_bytes`),
  );
  if (explicit !== null) return explicit;

  const value = pick(source, nested, flatKeys, nestedKeys);
  if (value === null) return null;
  return value >= BYTE_CONFIDENCE_FLOOR ? value : null;
}

function percent(value: number | null): number | null {
  if (value === null) return null;
  // Values are reported as 0-100. Clamp so a bad sample cannot break a gauge.
  return Math.min(100, Math.max(0, value));
}

export function normalizeSystemStats(raw: SystemStats): HostMetrics {
  const source = raw as unknown as Record<string, unknown>;
  const cpu = record(raw.cpu);
  const memory = record(raw.memory);
  const disk = record(raw.disk);
  const osRecord = record(raw.os);

  const os =
    typeof raw.os === 'string'
      ? raw.os
      : typeof osRecord?.name === 'string'
        ? osRecord.name
        : typeof raw.platform === 'string'
          ? raw.platform
          : null;

  return {
    os,
    cpuPercent: percent(
      pick(source, cpu, ['cpu_percent', 'cpu_usage'], ['percent', 'usage', 'used_percent']),
    ),
    cpuCount: pick(source, cpu, ['cpu_count', 'cpus'], ['count', 'cores']),
    memoryPercent: percent(
      pick(source, memory, ['memory_percent'], ['percent', 'used_percent', 'usage']),
    ),
    memoryUsedBytes: pickBytes(source, memory, ['memory_used'], ['used']),
    memoryTotalBytes: pickBytes(source, memory, ['memory_total'], ['total']),
    diskPercent: percent(
      pick(source, disk, ['disk_percent'], ['percent', 'used_percent', 'usage']),
    ),
    diskUsedBytes: pickBytes(source, disk, ['disk_used'], ['used']),
    diskTotalBytes: pickBytes(source, disk, ['disk_total'], ['total']),
    uptimeSeconds: pick(source, null, ['uptime_seconds', 'uptime'], []),
  };
}

export interface ReadinessCheck {
  name: string;
  ok: boolean | null;
  detail: string | null;
}

/**
 * `/health/detailed` reports checks either as an object keyed by name or as an
 * array of entries. Both collapse to a sorted list.
 */
export function normalizeReadinessChecks(raw: HealthDetailed): ReadinessCheck[] {
  const container = raw.readiness?.checks ?? raw.checks;
  const checks: ReadinessCheck[] = [];

  const readStatus = (value: unknown): { ok: boolean | null; detail: string | null } => {
    if (typeof value === 'boolean') return { ok: value, detail: null };
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      const ok = ['ok', 'healthy', 'pass', 'up', 'ready', 'true'].includes(normalized)
        ? true
        : ['fail', 'failed', 'error', 'down', 'unhealthy', 'false'].includes(normalized)
          ? false
          : null;
      return { ok, detail: value };
    }
    const entry = record(value);
    if (entry) {
      const nested = readStatus(entry.status ?? entry.ok ?? entry.healthy);
      const detail =
        typeof entry.detail === 'string'
          ? entry.detail
          : typeof entry.message === 'string'
            ? entry.message
            : nested.detail;
      return { ok: nested.ok, detail };
    }
    return { ok: null, detail: null };
  };

  if (Array.isArray(container)) {
    for (const item of container) {
      const entry = record(item);
      if (!entry) continue;
      const name = typeof entry.name === 'string' ? entry.name : null;
      if (!name) continue;
      const { ok, detail } = readStatus(entry.status ?? entry.ok ?? entry);
      checks.push({ name, ok, detail });
    }
  } else {
    const entries = record(container);
    if (entries) {
      for (const [name, value] of Object.entries(entries)) {
        const { ok, detail } = readStatus(value);
        checks.push({ name, ok, detail });
      }
    }
  }

  return checks.sort((a, b) => a.name.localeCompare(b.name));
}

export interface AgentSummary {
  version: string | null;
  gatewayRunning: boolean | null;
  activeSessions: number | null;
  profile: string | null;
}

export function normalizeDashboardStatus(raw: DashboardStatus): AgentSummary {
  const gateway = record(raw.gateway);
  const gatewayRunning =
    typeof raw.gateway_running === 'boolean'
      ? raw.gateway_running
      : typeof gateway?.running === 'boolean'
        ? gateway.running
        : typeof gateway?.status === 'string'
          ? ['running', 'ok', 'up', 'online'].includes(gateway.status.toLowerCase())
          : null;

  return {
    version: raw.version ?? raw.hermes_version ?? null,
    gatewayRunning,
    activeSessions: toNumber(raw.active_sessions),
    profile: raw.profile ?? null,
  };
}
