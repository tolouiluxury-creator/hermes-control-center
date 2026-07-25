/**
 * Mirror of the server DTOs in `src/status.ts`, `src/hermes/discovery.ts` and
 * `src/events.ts`. Kept hand-written (not generated) so the browser contract is
 * reviewable in one place; the shared shapes are small and change rarely.
 */

export type ValueSource = 'flag' | 'env' | 'profile-config' | 'config' | 'default';

export interface UpstreamTarget {
  url: string;
  source: ValueSource;
}

export interface PublicHermesConnection {
  hermesHome: string;
  homeExists: boolean;
  profile: string | null;
  profiles: string[];
  apiServer: {
    url: string;
    source: ValueSource;
    hasKey: boolean;
    keySource: ValueSource | null;
    enabled: boolean | null;
  };
  dashboard: UpstreamTarget;
  warnings: string[];
}

export interface UpstreamState {
  url: string;
  reachable: boolean;
  latencyMs: number | null;
  failure: string | null;
  message: string | null;
}

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

export interface AgentSummary {
  version: string | null;
  gatewayRunning: boolean | null;
  activeSessions: number | null;
  profile: string | null;
}

export interface ReadinessCheck {
  name: string;
  ok: boolean | null;
  detail: string | null;
}

export interface StatusSnapshot {
  ts: number;
  apiServer: UpstreamState & {
    hasKey: boolean;
    enabled: boolean | null;
    features: Record<string, unknown> | null;
  };
  dashboard: UpstreamState;
  agent: AgentSummary | null;
  host: HostMetrics | null;
  readiness: ReadinessCheck[];
  setupRequired: boolean;
  connection: PublicHermesConnection;
}

export interface Sample {
  ts: number;
  value: number;
}

export interface MetricSeries {
  metric: string;
  windowMs: number;
  samples: Sample[];
}

export type ControlCenterEvent =
  | { type: 'status'; snapshot: StatusSnapshot }
  | { type: 'metrics'; ts: number; values: Record<string, number> }
  | { type: 'notification'; id: string; severity: string; title: string; body: string }
  | { type: 'invalidate'; keys: string[] };

export interface Meta {
  name: string;
  version: string;
  node: string;
  platform: string;
  profile: string | null;
  hermesHome: string;
  stateHome: string;
  startedAt: string;
}
