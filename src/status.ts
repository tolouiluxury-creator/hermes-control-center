import { UpstreamError } from './hermes/client.js';
import type { ApiServerClient } from './hermes/apiServer.js';
import type { DashboardClient } from './hermes/dashboard.js';
import {
  normalizeDashboardStatus,
  normalizeComponentChecks,
  normalizeReadinessChecks,
  normalizeSystemStats,
  type AgentSummary,
  type HostMetrics,
  type ReadinessCheck,
} from './hermes/normalize.js';
import type { PublicHermesConnection } from './hermes/discovery.js';
import { describeError } from './log.js';

export interface UpstreamState {
  url: string;
  reachable: boolean;
  latencyMs: number | null;
  /** Machine-readable failure reason when unreachable. */
  failure: string | null;
  message: string | null;
}

export interface StatusSnapshot {
  ts: number;
  apiServer: UpstreamState & {
    hasKey: boolean;
    /** What Hermes' own config says about API_SERVER_ENABLED. */
    enabled: boolean | null;
    features: Record<string, unknown> | null;
  };
  dashboard: UpstreamState;
  agent: AgentSummary | null;
  host: HostMetrics | null;
  readiness: ReadinessCheck[];
  /** True when at least one upstream is unusable, so the UI shows setup guidance. */
  setupRequired: boolean;
  connection: PublicHermesConnection;
}

async function timed<T>(work: () => Promise<T>): Promise<{
  value: T | null;
  latencyMs: number;
  error: UpstreamError | Error | null;
}> {
  const started = performance.now();
  try {
    const value = await work();
    return { value, latencyMs: Math.round(performance.now() - started), error: null };
  } catch (error) {
    return {
      value: null,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function stateFrom(
  url: string,
  latencyMs: number,
  error: Error | null,
  reachable: boolean,
): UpstreamState {
  if (reachable) return { url, reachable: true, latencyMs, failure: null, message: null };
  return {
    url,
    reachable: false,
    latencyMs: null,
    failure: error instanceof UpstreamError ? error.failure : 'unreachable',
    message: error ? describeError(error) : 'unreachable',
  };
}

export interface StatusSources {
  api: ApiServerClient;
  dashboard: DashboardClient;
  connection: PublicHermesConnection;
}

/**
 * One round trip to both Hermes surfaces, reduced to a single snapshot. Each
 * sub-request fails independently: a dead dashboard must not hide a healthy API
 * server, and vice versa.
 */
export async function buildStatusSnapshot(sources: StatusSources): Promise<StatusSnapshot> {
  const { api, dashboard, connection } = sources;

  const [health, dashboardStatus, systemStats] = await Promise.all([
    timed(() => api.health({ timeoutMs: 3000 })),
    timed(() => dashboard.status({ timeoutMs: 4000 })),
    timed(() => dashboard.systemStats({ timeoutMs: 4000 })),
  ]);

  const apiReachable = health.error === null;
  const dashboardReachable = dashboardStatus.error === null;

  // These two need a working, authenticated API server, so only try when it is up.
  const [capabilities, healthDetailed] = apiReachable
    ? await Promise.all([
        timed(() => api.capabilities({ timeoutMs: 4000 })),
        timed(() => api.healthDetailed({ timeoutMs: 4000 })),
      ])
    : [
        { value: null, latencyMs: 0, error: null },
        { value: null, latencyMs: 0, error: null },
      ];

  const apiState = stateFrom(api.baseUrl, health.latencyMs, health.error, apiReachable);
  const dashboardState = stateFrom(
    dashboard.baseUrl,
    dashboardStatus.latencyMs,
    dashboardStatus.error,
    dashboardReachable,
  );

  const features =
    capabilities.value && typeof capabilities.value.features === 'object'
      ? (capabilities.value.features as Record<string, unknown>)
      : null;

  return {
    ts: Date.now(),
    apiServer: {
      ...apiState,
      hasKey: api.hasKey,
      enabled: connection.apiServer.enabled,
      features,
    },
    dashboard: dashboardState,
    agent: dashboardStatus.value ? normalizeDashboardStatus(dashboardStatus.value) : null,
    host: systemStats.value ? normalizeSystemStats(systemStats.value) : null,
    // The dashboard's own component map is the primary source: it works even
    // with the API server switched off, which is a common setup. Where the API
    // server is up, its per-subsystem checks are merged in on top.
    readiness: mergeReadiness(
      dashboardStatus.value ? normalizeComponentChecks(dashboardStatus.value) : [],
      healthDetailed.value ? normalizeReadinessChecks(healthDetailed.value) : [],
    ),
    setupRequired: !apiReachable || !dashboardReachable || !api.hasKey,
    connection,
  };
}

/**
 * Combines readiness from both upstreams. Names can overlap (both report a
 * "gateway"), and the API server's view is the more detailed one, so it wins.
 */
function mergeReadiness(primary: ReadinessCheck[], override: ReadinessCheck[]): ReadinessCheck[] {
  if (override.length === 0) return primary;

  const byName = new Map(primary.map((check) => [check.name, check]));
  for (const check of override) byName.set(check.name, check);

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Metric names recorded from a snapshot into the ring buffer. */
export const HOST_METRICS = ['cpu', 'memory', 'disk'] as const;

export function metricInputsFromSnapshot(snapshot: StatusSnapshot) {
  return [
    { metric: 'cpu', value: snapshot.host?.cpuPercent ?? null },
    { metric: 'memory', value: snapshot.host?.memoryPercent ?? null },
    { metric: 'disk', value: snapshot.host?.diskPercent ?? null },
    { metric: 'api_latency', value: snapshot.apiServer.latencyMs },
    { metric: 'dashboard_latency', value: snapshot.dashboard.latencyMs },
  ];
}
