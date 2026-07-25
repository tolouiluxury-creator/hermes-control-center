import { z } from 'zod';

/**
 * Schemas are deliberately lenient: unknown keys are preserved and nearly every
 * field is optional. Hermes evolves quickly, and a new field upstream must never
 * blank out a widget. Anything we actually render is normalised in the routes.
 */

const numeric = z.union([z.number(), z.string()]).nullish();

export const healthSchema = z.looseObject({
  status: z.string().nullish(),
});
export type Health = z.infer<typeof healthSchema>;

export const capabilitiesSchema = z.looseObject({
  object: z.string().nullish(),
  platform: z.string().nullish(),
  version: z.string().nullish(),
  features: z.record(z.string(), z.unknown()).nullish(),
  endpoints: z.record(z.string(), z.unknown()).nullish(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

/** `/health/detailed` — per-subsystem readiness, shape varies by version. */
export const healthDetailedSchema = z.looseObject({
  status: z.string().nullish(),
  readiness: z
    .looseObject({
      status: z.string().nullish(),
      checks: z.unknown().nullish(),
    })
    .nullish(),
  checks: z.unknown().nullish(),
  active_runs: numeric,
  pending_processes: numeric,
  delegations: numeric,
});
export type HealthDetailed = z.infer<typeof healthDetailedSchema>;

/** `/api/status` on the dashboard backend. */
export const dashboardStatusSchema = z.looseObject({
  version: z.string().nullish(),
  hermes_version: z.string().nullish(),
  gateway: z.unknown().nullish(),
  gateway_running: z.boolean().nullish(),
  platforms: z.unknown().nullish(),
  active_sessions: numeric,
  profile: z.string().nullish(),
  model: z.unknown().nullish(),
});
export type DashboardStatus = z.infer<typeof dashboardStatusSchema>;

/** `/api/system/stats` — host telemetry. Field names differ across versions. */
export const systemStatsSchema = z.looseObject({
  os: z.union([z.string(), z.looseObject({})]).nullish(),
  platform: z.string().nullish(),
  cpu: z.union([numeric, z.looseObject({})]).nullish(),
  cpu_percent: numeric,
  cpu_count: numeric,
  memory: z.union([numeric, z.looseObject({})]).nullish(),
  memory_percent: numeric,
  memory_total: numeric,
  memory_used: numeric,
  disk: z.union([numeric, z.looseObject({})]).nullish(),
  disk_percent: numeric,
  disk_total: numeric,
  disk_used: numeric,
  uptime: numeric,
  uptime_seconds: numeric,
  boot_time: numeric,
});
export type SystemStats = z.infer<typeof systemStatsSchema>;
