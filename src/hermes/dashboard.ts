import { z } from 'zod';
import type { HermesClient, RequestOptions } from './client.js';
import { DASHBOARD_STATUS_PATH } from './endpoints.js';
import {
  dashboardStatusSchema,
  systemStatsSchema,
  type DashboardStatus,
  type SystemStats,
} from './schemas.js';
import {
  analyticsSchema,
  cronJobsSchema,
  logsSchema,
  mcpServersSchema,
  memorySchema,
  messagingPlatformsSchema,
  modelInfoSchema,
  normalizeAnalytics,
  normalizeCronJobs,
  normalizeLogs,
  normalizeMcpServers,
  normalizeMemory,
  normalizeMessagingPlatforms,
  normalizeModelInfo,
  normalizeModelOptions,
  normalizePairing,
  normalizeSessions,
  normalizeSkillList,
  normalizeSkills,
  normalizeWebhooks,
  modelOptionsSchema,
  pairingSchema,
  sessionsSchema,
  skillsSchema,
  webhooksSchema,
  type AnalyticsSummary,
  type CronJobSummary,
  type McpServerSummary,
  type MemorySummary,
  type MessagingOverview,
  type ModelOptions,
  type ModelSummary,
  type PairingOverview,
  type SkillEntry,
  type SkillSummary,
  type WebhooksOverview,
} from './inventory.js';

/**
 * Loose result shape for dashboard writes. Hermes replies with an object that
 * usually carries `ok`, sometimes the affected entity too; we only care that
 * the request succeeded, and unknown keys survive.
 */
const actionResultSchema = z.looseObject({ ok: z.boolean().nullish() });
export type ActionResult = z.infer<typeof actionResultSchema>;

/**
 * Hermes dashboard backend (default :9119). Owns configuration, inventory
 * (skills, MCP, models) and telemetry. Unauthenticated on loopback; the profile
 * query parameter is added by the underlying client.
 */
export class DashboardClient {
  constructor(private readonly client: HermesClient) {}

  get baseUrl(): string {
    return this.client.baseUrl;
  }

  status(options?: RequestOptions): Promise<DashboardStatus> {
    return this.client.json(dashboardStatusSchema, DASHBOARD_STATUS_PATH, options);
  }

  systemStats(options?: RequestOptions): Promise<SystemStats> {
    return this.client.json(systemStatsSchema, '/api/system/stats', options);
  }

  skills(options?: RequestOptions): Promise<SkillSummary> {
    return this.client.json(skillsSchema, '/api/skills', options).then(normalizeSkills);
  }

  skillList(options?: RequestOptions): Promise<SkillEntry[]> {
    return this.client.json(skillsSchema, '/api/skills', options).then(normalizeSkillList);
  }

  modelOptions(options?: RequestOptions): Promise<ModelOptions> {
    return this.client
      .json(modelOptionsSchema, '/api/model/options', options)
      .then(normalizeModelOptions);
  }

  mcpServers(options?: RequestOptions): Promise<McpServerSummary[]> {
    return this.client
      .json(mcpServersSchema, '/api/mcp/servers', options)
      .then(normalizeMcpServers);
  }

  cronJobs(options?: RequestOptions): Promise<CronJobSummary[]> {
    return this.client.json(cronJobsSchema, '/api/cron/jobs', options).then(normalizeCronJobs);
  }

  logs(lines: number, options?: RequestOptions): Promise<ReturnType<typeof normalizeLogs>> {
    return this.client
      .json(logsSchema, '/api/logs', { ...options, query: { ...options?.query, lines } })
      .then(normalizeLogs);
  }

  modelInfo(options?: RequestOptions): Promise<ModelSummary> {
    return this.client.json(modelInfoSchema, '/api/model/info', options).then(normalizeModelInfo);
  }

  analytics(options?: RequestOptions): Promise<AnalyticsSummary> {
    return this.client
      .json(analyticsSchema, '/api/analytics/usage', options)
      .then(normalizeAnalytics);
  }

  sessions(limit: number, options?: RequestOptions): Promise<ReturnType<typeof normalizeSessions>> {
    return this.client
      .json(sessionsSchema, '/api/sessions', {
        ...options,
        query: { ...options?.query, limit, order: 'created' },
      })
      .then(normalizeSessions);
  }

  memory(options?: RequestOptions): Promise<MemorySummary> {
    return this.client.json(memorySchema, '/api/memory', options).then(normalizeMemory);
  }

  messagingPlatforms(options?: RequestOptions): Promise<MessagingOverview> {
    return this.client
      .json(messagingPlatformsSchema, '/api/messaging/platforms', options)
      .then(normalizeMessagingPlatforms);
  }

  webhooks(options?: RequestOptions): Promise<WebhooksOverview> {
    return this.client.json(webhooksSchema, '/api/webhooks', options).then(normalizeWebhooks);
  }

  pairing(options?: RequestOptions): Promise<PairingOverview> {
    return this.client.json(pairingSchema, '/api/pairing', options).then(normalizePairing);
  }

  // --- Writes ---------------------------------------------------------------
  // Body shapes are taken from Hermes' own dashboard client, not guessed. The
  // profile is appended as a query parameter by the underlying client.

  /** Enable or disable a skill for the agent. */
  toggleSkill(name: string, enabled: boolean, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/skills/toggle', {
      ...options,
      method: 'PUT',
      body: { name, enabled },
    });
  }

  raw(path: string, options?: RequestOptions): Promise<Response> {
    return this.client.fetch(path, options);
  }
}
