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
  modelInfoSchema,
  normalizeAnalytics,
  normalizeCronJobs,
  normalizeLogs,
  normalizeMcpServers,
  normalizeMemory,
  normalizeModelInfo,
  normalizeSessions,
  normalizeSkills,
  sessionsSchema,
  skillsSchema,
  type AnalyticsSummary,
  type CronJobSummary,
  type McpServerSummary,
  type MemorySummary,
  type ModelSummary,
  type SkillSummary,
} from './inventory.js';

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

  raw(path: string, options?: RequestOptions): Promise<Response> {
    return this.client.fetch(path, options);
  }
}
