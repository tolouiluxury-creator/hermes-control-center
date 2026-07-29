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
  activeProfileSchema,
  analyticsSchema,
  auxiliaryModelsSchema,
  cronJobsSchema,
  logsSchema,
  mcpServersSchema,
  memorySchema,
  messagingPlatformsSchema,
  modelInfoSchema,
  normalizeAnalytics,
  normalizeAuxiliaryModels,
  normalizeCronJobs,
  normalizeLogs,
  normalizeMcpServers,
  normalizeMemory,
  normalizeMessagingPlatforms,
  normalizeModelInfo,
  normalizeModelOptions,
  normalizePairing,
  normalizeProfiles,
  normalizeProfileSoul,
  normalizeSessions,
  normalizeSessionMessages,
  normalizeSkillContent,
  normalizeSkillList,
  normalizeSkills,
  normalizeWebhooks,
  modelOptionsSchema,
  pairingSchema,
  profileSoulSchema,
  profilesSchema,
  sessionMessagesSchema,
  sessionsSchema,
  skillContentSchema,
  skillsSchema,
  webhooksSchema,
  type AnalyticsSummary,
  type AuxiliaryModels,
  type CronJobSummary,
  type McpServerSummary,
  type MemorySummary,
  type MessagingOverview,
  type ModelOptions,
  type ModelSummary,
  type PairingOverview,
  type ProfileOverview,
  type ProfileSoul,
  type SkillContent,
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

/**
 * Session deletes report how many rows actually went. Hermes skips ids it does
 * not know rather than failing the batch, so this is the only honest count —
 * `empty` omits it entirely when it removed nothing.
 */
const bulkDeleteResultSchema = z.looseObject({
  ok: z.boolean().nullish(),
  deleted: z.number().nullish(),
});
export type BulkDeleteResult = z.infer<typeof bulkDeleteResultSchema>;

/**
 * Some Hermes actions are not done when they answer: it spawns the CLI and
 * replies with the child's pid. The result says the work *started*, so callers
 * must not report success — they re-read and see for themselves.
 */
const spawnedActionSchema = z.looseObject({
  ok: z.boolean().nullish(),
  pid: z.number().nullish(),
  name: z.string().nullish(),
});
export type SpawnedAction = z.infer<typeof spawnedActionSchema>;

/** Enabling webhooks bounces the gateway; this says whether Hermes managed it. */
const webhookEnableSchema = z.looseObject({
  ok: z.boolean().nullish(),
  enabled: z.boolean().nullish(),
  needs_restart: z.boolean().nullish(),
});
export type WebhookEnableResult = z.infer<typeof webhookEnableSchema>;

/** Create is the one and only time the route's HMAC secret is returned. */
const webhookCreatedSchema = z.looseObject({
  name: z.string().nullish(),
  url: z.string().nullish(),
  secret: z.string().nullish(),
});
export type WebhookCreated = z.infer<typeof webhookCreatedSchema>;

const clearedResultSchema = z.looseObject({
  ok: z.boolean().nullish(),
  cleared: z.number().nullish(),
});
export type ClearedResult = z.infer<typeof clearedResultSchema>;

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

  sessions(
    limit: number,
    profile?: string | null,
    options?: RequestOptions,
  ): Promise<ReturnType<typeof normalizeSessions>> {
    return this.client
      .json(sessionsSchema, '/api/sessions', {
        ...options,
        query: { ...options?.query, limit, order: 'created', profile: profile || undefined },
      })
      .then(normalizeSessions);
  }

  /**
   * The installed profiles, plus which one is sticky and which one the running
   * dashboard actually uses. Two endpoints because Hermes keeps the list and the
   * pointer apart — and they genuinely disagree: `active` is what the next CLI
   * command picks up, `current` is what a chat started here runs as.
   */
  async profiles(options?: RequestOptions): Promise<ProfileOverview> {
    const [list, active] = await Promise.all([
      this.client.json(profilesSchema, '/api/profiles', options),
      this.client.json(activeProfileSchema, '/api/profiles/active', options),
    ]);
    return normalizeProfiles(list, active);
  }

  memory(options?: RequestOptions): Promise<MemorySummary> {
    return this.client.json(memorySchema, '/api/memory', options).then(normalizeMemory);
  }

  /** The stored transcript of a session, for reopening a past conversation. */
  sessionMessages(
    sessionId: string,
    profile?: string | null,
    options?: RequestOptions,
  ): Promise<ReturnType<typeof normalizeSessionMessages>> {
    return this.client
      .json(sessionMessagesSchema, `/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        ...options,
        query: { ...options?.query, profile: profile || undefined },
      })
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

  // --- Skills: authoring ----------------------------------------------------

  /** The raw SKILL.md of one skill, for the editor. */
  skillContent(name: string, options?: RequestOptions): Promise<SkillContent> {
    return this.client
      .json(skillContentSchema, '/api/skills/content', {
        ...options,
        query: { ...options?.query, name },
      })
      .then(normalizeSkillContent);
  }

  /**
   * Write a new skill.
   *
   * Hermes routes this through the same validated path its own `skill_manage`
   * tool uses — frontmatter validation, name and category checks, a size limit
   * — and rejects with 400 rather than writing something malformed. Its own
   * comment on why the agent's approval gate is skipped: "a write from the
   * authenticated dashboard IS the user acting directly".
   */
  createSkill(
    name: string,
    content: string,
    category?: string,
    options?: RequestOptions,
  ): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/skills', {
      ...options,
      method: 'POST',
      body: { name, content, category: category || null },
    });
  }

  /** Replace a skill's SKILL.md wholesale. */
  updateSkillContent(
    name: string,
    content: string,
    options?: RequestOptions,
  ): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/skills/content', {
      ...options,
      method: 'PUT',
      body: { name, content },
    });
  }

  /**
   * Remove a skill.
   *
   * There is no delete endpoint: Hermes shells out to `hermes skills uninstall`
   * and answers with the child's pid the moment it is spawned. So this reports
   * that the removal *started*, never that it finished — the caller has to
   * re-read the list to find out.
   */
  uninstallSkill(name: string, options?: RequestOptions): Promise<SpawnedAction> {
    return this.client.json(spawnedActionSchema, '/api/skills/hub/uninstall', {
      ...options,
      method: 'POST',
      body: { name },
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

  auxiliaryModels(options?: RequestOptions): Promise<AuxiliaryModels> {
    return this.client
      .json(auxiliaryModelsSchema, '/api/model/auxiliary', options)
      .then(normalizeAuxiliaryModels);
  }

  /**
   * Pin one side job to a model, or hand it back to the main one.
   *
   * Hermes reads two sentinels here rather than taking a flag: an empty `task`
   * means every slot, and the task `__reset__` puts them all back on auto.
   * Provider `auto` is how a single slot goes back to following the main model.
   */
  setAuxiliaryModel(
    task: string,
    provider: string,
    model: string,
    options?: RequestOptions,
  ): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/model/set', {
      ...options,
      method: 'POST',
      body: { scope: 'auxiliary', task, provider, model, confirm_expensive_model: true },
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

  // --- Webhooks and pairing -------------------------------------------------

  /**
   * Turn the webhook platform on.
   *
   * This restarts the gateway. Every messaging platform the agent runs — the
   * Telegram bot included — goes down for the duration, so the caller has to
   * say so before asking. `needs_restart` in the reply means Hermes could not
   * restart it itself and a human has to.
   */
  enableWebhooks(options?: RequestOptions): Promise<WebhookEnableResult> {
    return this.client.json(webhookEnableSchema, '/api/webhooks/enable', {
      ...options,
      method: 'POST',
    });
  }

  /**
   * Add a webhook route.
   *
   * The reply carries the route's HMAC secret, and this is the only time it is
   * ever returned — every read masks it down to `secret_set: true`. Whatever
   * shows it must say that too.
   */
  createWebhook(
    input: { name: string; description?: string; events?: string[]; prompt?: string },
    options?: RequestOptions,
  ): Promise<WebhookCreated> {
    return this.client.json(webhookCreatedSchema, '/api/webhooks', {
      ...options,
      method: 'POST',
      body: {
        name: input.name,
        description: input.description || null,
        events: input.events ?? [],
        prompt: input.prompt || null,
      },
    });
  }

  deleteWebhook(name: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, `/api/webhooks/${encodeURIComponent(name)}`, {
      ...options,
      method: 'DELETE',
    });
  }

  /** A disabled route stays on file; the gateway answers its events with 403. */
  setWebhookEnabled(
    name: string,
    enabled: boolean,
    options?: RequestOptions,
  ): Promise<ActionResult> {
    return this.client.json(
      actionResultSchema,
      `/api/webhooks/${encodeURIComponent(name)}/enabled`,
      { ...options, method: 'PUT', body: { enabled } },
    );
  }

  /** Let a pending user talk to the agent. The code is the one they were shown. */
  approvePairing(platform: string, code: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/pairing/approve', {
      ...options,
      method: 'POST',
      body: { platform, code },
    });
  }

  revokePairing(platform: string, userId: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/pairing/revoke', {
      ...options,
      method: 'POST',
      body: { platform, user_id: userId },
    });
  }

  clearPendingPairing(options?: RequestOptions): Promise<ClearedResult> {
    return this.client.json(clearedResultSchema, '/api/pairing/clear-pending', {
      ...options,
      method: 'POST',
    });
  }

  // --- MCP: authoring -------------------------------------------------------

  /**
   * Add an MCP server. Either `url` (http) or `command` (stdio), not both.
   *
   * `bearerToken` is provisioning input only: Hermes writes it into the
   * profile's `.env` and stores a reference in `headers`, so the token never
   * lands in config.yaml and never comes back out of a read.
   */
  createMcpServer(
    input: {
      name: string;
      url?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      auth?: string;
      bearerToken?: string;
    },
    options?: RequestOptions,
  ): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/mcp/servers', {
      ...options,
      method: 'POST',
      body: {
        name: input.name,
        url: input.url || null,
        command: input.command || null,
        args: input.args ?? [],
        env: input.env ?? {},
        auth: input.auth || null,
        bearer_token: input.bearerToken || null,
      },
    });
  }

  /**
   * Change one MCP server's fields.
   *
   * Deliberately NOT `PUT /api/mcp/servers`, which replaces the whole server
   * map. The only way to read that map is `GET /api/mcp/servers`, and it runs
   * every env value through `redact_key` first — so rebuilding the map from a
   * read and putting it back would write `sk-…abcd` over the real API key of
   * every stdio server at once. Verified in the Hermes source
   * (`_redact_mcp_env`).
   *
   * `PUT /api/config` deep-merges instead: dicts merge recursively, everything
   * else is replaced. So `args` is set wholesale (which is what editing a
   * command line means) while any `env` key not mentioned keeps its real value.
   * The price of that choice is that a merge cannot *remove* an env key —
   * that would need the whole-map endpoint, which is not offered here.
   */
  updateMcpServer(
    name: string,
    patch: {
      url?: string | null;
      command?: string | null;
      args?: string[];
      env?: Record<string, string>;
    },
    options?: RequestOptions,
  ): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/config', {
      ...options,
      method: 'PUT',
      body: { config: { mcp_servers: { [name]: patch } } },
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

  // --- Sessions: writes -----------------------------------------------------

  /**
   * Delete the given conversations in one transaction.
   *
   * POST rather than DELETE because the ids travel in a body, which many HTTP
   * clients refuse to send on DELETE — Hermes documents that choice too.
   * Unknown ids are skipped rather than failing the batch, so `deleted` is the
   * number that really went, not the number asked for. Hermes caps a batch at
   * 500; the caller is expected to stay under that.
   */
  deleteSessions(
    ids: string[],
    profile?: string | null,
    options?: RequestOptions,
  ): Promise<BulkDeleteResult> {
    return this.client.json(bulkDeleteResultSchema, '/api/sessions/bulk-delete', {
      ...options,
      method: 'POST',
      // The profile rides in the body here, not the query: the ids and the
      // database they live in have to travel together or the batch hits the
      // wrong state.db and reports zero deletions.
      body: { ids, ...(profile ? { profile } : {}) },
    });
  }

  // --- Profiles: writes -----------------------------------------------------
  // Bodies taken from Hermes' own request models (ProfileCreate, ProfileRename,
  // ProfileSoulUpdate, …), not guessed.

  /**
   * Create a profile, optionally as a copy of an existing one.
   *
   * `cloneFrom` copies config, skills and SOUL; `cloneAll` copies the whole
   * state including its conversations. Hermes seeds the bundled skills into a
   * fresh profile unless `noSkills` says otherwise.
   */
  createProfile(
    input: {
      name: string;
      cloneFrom?: string;
      cloneAll?: boolean;
      noSkills?: boolean;
      description?: string;
    },
    options?: RequestOptions,
  ): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/profiles', {
      ...options,
      method: 'POST',
      body: {
        name: input.name,
        clone_from: input.cloneFrom || null,
        clone_all: input.cloneAll === true,
        no_skills: input.noSkills === true,
        description: input.description || null,
      },
    });
  }

  renameProfile(name: string, newName: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, `/api/profiles/${encodeURIComponent(name)}`, {
      ...options,
      method: 'PATCH',
      body: { new_name: newName },
    });
  }

  deleteProfile(name: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, `/api/profiles/${encodeURIComponent(name)}`, {
      ...options,
      method: 'DELETE',
    });
  }

  /**
   * Set the sticky profile — what the next `hermes` command picks up.
   *
   * Deliberately NOT what the chat toolbar uses: Hermes' own docstring says
   * this "does not retarget the already-running dashboard process", so it is
   * offered here, where it is about the installation, and nowhere near a chat.
   */
  setActiveProfile(name: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, '/api/profiles/active', {
      ...options,
      method: 'POST',
      body: { name },
    });
  }

  setProfileDescription(
    name: string,
    description: string,
    options?: RequestOptions,
  ): Promise<ActionResult> {
    return this.client.json(
      actionResultSchema,
      `/api/profiles/${encodeURIComponent(name)}/description`,
      { ...options, method: 'PUT', body: { description } },
    );
  }

  /** The model a profile answers with, written into that profile's own config. */
  setProfileModel(
    name: string,
    provider: string,
    model: string,
    options?: RequestOptions,
  ): Promise<ActionResult> {
    return this.client.json(actionResultSchema, `/api/profiles/${encodeURIComponent(name)}/model`, {
      ...options,
      method: 'PUT',
      body: { provider, model },
    });
  }

  profileSoul(name: string, options?: RequestOptions): Promise<ProfileSoul> {
    return this.client
      .json(profileSoulSchema, `/api/profiles/${encodeURIComponent(name)}/soul`, options)
      .then(normalizeProfileSoul);
  }

  saveProfileSoul(name: string, content: string, options?: RequestOptions): Promise<ActionResult> {
    return this.client.json(actionResultSchema, `/api/profiles/${encodeURIComponent(name)}/soul`, {
      ...options,
      method: 'PUT',
      body: { content },
    });
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
