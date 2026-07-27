import { z } from 'zod';
import type { HermesClient, RequestOptions } from './client.js';
import { DASHBOARD_STATUS_PATH } from './endpoints.js';
import {
  configRawSchema,
  curatorSchema,
  envSchema,
  normalizeConfigRaw,
  normalizeCurator,
  normalizeEnv,
  normalizeToolsets,
  normalizeUpdate,
  toolsetsSchema,
  updateSchema,
  type ConfigRaw,
  type CuratorStatus,
  type EnvVar,
  type Toolset,
  type UpdateStatus,
} from './settings.js';
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
  normalizeSessionMessages,
  normalizeSkillList,
  normalizeSkills,
  normalizeWebhooks,
  modelOptionsSchema,
  pairingSchema,
  sessionMessagesSchema,
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

/** Test endpoints (MCP, messaging) return a verdict with a human message. */
const testResultSchema = z.looseObject({
  ok: z.boolean().nullish(),
  state: z.string().nullish(),
  message: z.string().nullish(),
});
export type TestResult = z.infer<typeof testResultSchema>;

export type CronAction = 'pause' | 'resume' | 'trigger';

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

  /** The stored transcript of a session, for reopening a past conversation. */
  sessionMessages(
    sessionId: string,
    options?: RequestOptions,
  ): Promise<ReturnType<typeof normalizeSessionMessages>> {
    return this.client
      .json(
        sessionMessagesSchema,
        `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
        options,
      )
      .then(normalizeSessionMessages);
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

  /** Pause, resume or trigger a scheduled job. */
  cronAction(id: string, action: CronAction, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(
      actionResultSchema,
      `/api/cron/jobs/${encodeURIComponent(id)}/${action}`,
      { ...options, method: 'POST' },
    );
  }

  deleteCron(id: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, `/api/cron/jobs/${encodeURIComponent(id)}`, {
      ...options,
      method: 'DELETE',
    });
  }

  /** Set the agent's main model. `confirm_expensive_model` skips the price gate. */
  setMainModel(provider: string, model: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/model/set', {
      ...options,
      method: 'POST',
      body: { scope: 'main', provider, model, confirm_expensive_model: true },
    });
  }

  setMcpEnabled(name: string, enabled: boolean, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(
      actionResultSchema,
      `/api/mcp/servers/${encodeURIComponent(name)}/enabled`,
      { ...options, method: 'PUT', body: { enabled } },
    );
  }

  testMcp(name: string, options?: RequestOptions): Promise<TestResult> {
    return this.client.json(testResultSchema, `/api/mcp/servers/${encodeURIComponent(name)}/test`, {
      ...options,
      method: 'POST',
    });
  }

  deleteMcp(name: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, `/api/mcp/servers/${encodeURIComponent(name)}`, {
      ...options,
      method: 'DELETE',
    });
  }

  /** Set the active memory (RAG) provider. */
  setMemoryProvider(provider: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/memory/provider', {
      ...options,
      method: 'PUT',
      body: { provider },
    });
  }

  /** Enable or disable a messaging platform (gateway channel). */
  setPlatformEnabled(
    id: string,
    enabled: boolean,
    options?: RequestOptions,
  ): Promise<ActionResult> {
    return this.client.json(
      actionResultSchema,
      `/api/messaging/platforms/${encodeURIComponent(id)}`,
      { ...options, method: 'PUT', body: { enabled } },
    );
  }

  testPlatform(id: string, options?: RequestOptions): Promise<TestResult> {
    return this.client.json(
      testResultSchema,
      `/api/messaging/platforms/${encodeURIComponent(id)}/test`,
      { ...options, method: 'POST' },
    );
  }

  // --- Settings: reads ------------------------------------------------------

  env(options?: RequestOptions): Promise<EnvVar[]> {
    return this.client.json(envSchema, '/api/env', options).then(normalizeEnv);
  }

  configRaw(options?: RequestOptions): Promise<ConfigRaw> {
    return this.client.json(configRawSchema, '/api/config/raw', options).then(normalizeConfigRaw);
  }

  curator(options?: RequestOptions): Promise<CuratorStatus> {
    return this.client.json(curatorSchema, '/api/curator', options).then(normalizeCurator);
  }

  updateCheck(options?: RequestOptions): Promise<UpdateStatus> {
    return this.client
      .json(updateSchema, '/api/hermes/update/check', options)
      .then(normalizeUpdate);
  }

  toolsets(options?: RequestOptions): Promise<Toolset[]> {
    return this.client.json(toolsetsSchema, '/api/tools/toolsets', options).then(normalizeToolsets);
  }

  // --- Settings: writes -----------------------------------------------------

  setEnv(key: string, value: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/env', {
      ...options,
      method: 'PUT',
      body: { key, value },
    });
  }

  deleteEnv(key: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/env', {
      ...options,
      method: 'DELETE',
      body: { key },
    });
  }

  saveConfigRaw(yamlText: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/config/raw', {
      ...options,
      method: 'PUT',
      body: { yaml_text: yamlText },
    });
  }

  setCuratorPaused(paused: boolean, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/curator/paused', {
      ...options,
      method: 'PUT',
      body: { paused },
    });
  }

  runCurator(options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/curator/run', { ...options, method: 'POST' });
  }

  toggleToolset(name: string, enabled: boolean, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, `/api/tools/toolsets/${encodeURIComponent(name)}`, {
      ...options,
      method: 'PUT',
      body: { enabled },
    });
  }

  raw(path: string, options?: RequestOptions): Promise<Response> {
    return this.client.fetch(path, options);
  }
}
