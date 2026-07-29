import { z } from 'zod';

/**
 * Schemas and normalisers for the dashboard's inventory and telemetry
 * endpoints, captured from a real Hermes 0.19.0 rather than from documentation.
 *
 * Every schema is lenient: unknown keys survive, and anything the agent might
 * omit is optional. The normalisers then reduce each payload to the small,
 * camel-cased shape the widgets consume, so a renamed upstream field is one
 * edit here instead of a hunt through components.
 */

const numeric = z.union([z.number(), z.string()]).nullish();

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// --- Skills -----------------------------------------------------------------

export const skillsSchema = z.array(
  z.looseObject({
    name: z.string(),
    description: z.string().nullish(),
    category: z.string().nullish(),
    enabled: z.boolean().nullish(),
    usage: numeric,
    provenance: z.string().nullish(),
  }),
);

export interface SkillSummary {
  total: number;
  enabled: number;
  categories: { name: string; count: number }[];
  /** Most-used skills first; the tail is rarely interesting. */
  top: { name: string; usage: number; enabled: boolean; category: string | null }[];
}

export function normalizeSkills(raw: z.infer<typeof skillsSchema>): SkillSummary {
  const categories = new Map<string, number>();
  let enabled = 0;

  for (const skill of raw) {
    if (skill.enabled !== false) enabled += 1;
    const category = skill.category?.trim() || 'Ohne Kategorie';
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }

  const top = raw
    .map((skill) => ({
      name: skill.name,
      usage: toNumber(skill.usage) ?? 0,
      enabled: skill.enabled !== false,
      category: skill.category ?? null,
    }))
    .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name))
    .slice(0, 8);

  return {
    total: raw.length,
    enabled,
    categories: [...categories.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    top,
  };
}

export interface SkillEntry {
  name: string;
  description: string | null;
  category: string | null;
  enabled: boolean;
  usage: number;
  /** Where the skill came from: bundled with Hermes, added by the agent, or installed from the hub. */
  provenance: string | null;
}

/** The full list, for the management page. The widget uses the summary above. */
export function normalizeSkillList(raw: z.infer<typeof skillsSchema>): SkillEntry[] {
  return raw
    .map((skill) => ({
      name: skill.name,
      description: skill.description?.trim() || null,
      category: skill.category?.trim() || null,
      enabled: skill.enabled !== false,
      usage: toNumber(skill.usage) ?? 0,
      provenance: skill.provenance ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One skill's raw SKILL.md, for the editor. */
export const skillContentSchema = z.looseObject({
  name: z.string().nullish(),
  content: z.string().nullish(),
  path: z.string().nullish(),
});

export interface SkillContent {
  name: string;
  content: string;
  /** Where the file lives — the only hint of which profile a skill came from. */
  path: string | null;
}

export function normalizeSkillContent(raw: z.infer<typeof skillContentSchema>): SkillContent {
  return { name: raw.name ?? '', content: raw.content ?? '', path: raw.path ?? null };
}

// --- Model options ----------------------------------------------------------

export const modelOptionsSchema = z.looseObject({
  model: z.string().nullish(),
  provider: z.string().nullish(),
  providers: z
    .array(
      z.looseObject({
        slug: z.string().nullish(),
        name: z.string().nullish(),
        is_current: z.boolean().nullish(),
        is_user_defined: z.boolean().nullish(),
        models: z.array(z.string()).nullish(),
        total_models: numeric,
        source: z.string().nullish(),
        authenticated: z.boolean().nullish(),
        auth_type: z.string().nullish(),
        warning: z.string().nullish(),
      }),
    )
    .nullish(),
});

export interface ProviderSummary {
  slug: string;
  name: string;
  isCurrent: boolean;
  authenticated: boolean | null;
  authType: string | null;
  source: string | null;
  models: string[];
  totalModels: number | null;
  warning: string | null;
  userDefined: boolean;
}

export interface ModelOptions {
  currentModel: string | null;
  currentProvider: string | null;
  providers: ProviderSummary[];
}

export function normalizeModelOptions(raw: z.infer<typeof modelOptionsSchema>): ModelOptions {
  return {
    currentModel: raw.model ?? null,
    currentProvider: raw.provider ?? null,
    providers: (raw.providers ?? [])
      .map((provider, index) => ({
        slug: provider.slug ?? `provider-${index}`,
        name: provider.name ?? provider.slug ?? `Anbieter ${index + 1}`,
        isCurrent: provider.is_current === true,
        authenticated: provider.authenticated ?? null,
        authType: provider.auth_type ?? null,
        source: provider.source ?? null,
        models: provider.models ?? [],
        totalModels: toNumber(provider.total_models),
        warning: provider.warning?.trim() || null,
        userDefined: provider.is_user_defined === true,
      }))
      // The one in use first, then the ones that could be used.
      .sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
        if (a.authenticated !== b.authenticated) return a.authenticated ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
  };
}

// --- Auxiliary models -------------------------------------------------------

/**
 * The side jobs Hermes farms out to a model other than the one you chat with:
 * reading an image, compressing a long conversation, naming a session. Provider
 * `auto` means "use the main model", which is the default for every slot.
 */
export const auxiliaryModelsSchema = z.looseObject({
  tasks: z
    .array(
      z.looseObject({
        task: z.string().nullish(),
        provider: z.string().nullish(),
        model: z.string().nullish(),
        base_url: z.string().nullish(),
      }),
    )
    .nullish(),
  main: z.looseObject({ provider: z.string().nullish(), model: z.string().nullish() }).nullish(),
});

export interface AuxiliaryTask {
  task: string;
  provider: string;
  model: string;
  /** True when this slot simply follows the main model. */
  inherits: boolean;
}

export interface AuxiliaryModels {
  tasks: AuxiliaryTask[];
  mainModel: string | null;
  mainProvider: string | null;
}

export function normalizeAuxiliaryModels(
  raw: z.infer<typeof auxiliaryModelsSchema>,
): AuxiliaryModels {
  return {
    tasks: (raw.tasks ?? []).map((entry, index) => {
      const provider = entry.provider ?? '';
      return {
        task: entry.task ?? `task-${index}`,
        provider,
        model: entry.model ?? '',
        // Hermes writes "auto" for an unpinned slot; an empty model means the
        // same thing on installs that left the provider blank instead.
        inherits: provider === '' || provider === 'auto' || (entry.model ?? '') === '',
      };
    }),
    mainModel: raw.main?.model ?? null,
    mainProvider: raw.main?.provider ?? null,
  };
}

// --- Profiles ---------------------------------------------------------------

export const profilesSchema = z.looseObject({
  profiles: z
    .array(
      z.looseObject({
        name: z.string().nullish(),
        path: z.string().nullish(),
        is_default: z.boolean().nullish(),
        model: z.string().nullish(),
        provider: z.string().nullish(),
        description: z.string().nullish(),
        skill_count: numeric,
        gateway_running: z.boolean().nullish(),
      }),
    )
    .nullish(),
});

/** SOUL.md is the profile's own standing instructions; absent is normal. */
export const profileSoulSchema = z.looseObject({
  content: z.string().nullish(),
  exists: z.boolean().nullish(),
});

export interface ProfileSoul {
  content: string;
  exists: boolean;
}

export function normalizeProfileSoul(raw: z.infer<typeof profileSoulSchema>): ProfileSoul {
  return { content: raw.content ?? '', exists: raw.exists === true };
}

export const activeProfileSchema = z.looseObject({
  active: z.string().nullish(),
  current: z.string().nullish(),
});

export interface ProfileSummary {
  name: string;
  path: string | null;
  isDefault: boolean;
  model: string | null;
  provider: string | null;
  description: string | null;
  skillCount: number | null;
  gatewayRunning: boolean;
}

export interface ProfileOverview {
  profiles: ProfileSummary[];
  /**
   * The sticky default a new `hermes` command would pick up.
   *
   * Not the same thing as {@link current}, and Hermes says so in its own
   * docstring: setting it "does not retarget the already-running dashboard
   * process". Shown for orientation, never used to decide where a chat runs.
   */
  active: string | null;
  /** The profile the running dashboard — and therefore an unscoped chat — uses. */
  current: string | null;
}

export function normalizeProfiles(
  raw: z.infer<typeof profilesSchema>,
  activeRaw: z.infer<typeof activeProfileSchema>,
): ProfileOverview {
  return {
    profiles: (raw.profiles ?? [])
      .map((profile, index) => ({
        name: profile.name ?? `profile-${index}`,
        path: profile.path ?? null,
        isDefault: profile.is_default === true,
        model: profile.model ?? null,
        provider: profile.provider ?? null,
        description: profile.description?.trim() || null,
        skillCount: toNumber(profile.skill_count),
        gatewayRunning: profile.gateway_running === true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    active: activeRaw.active ?? null,
    current: activeRaw.current ?? null,
  };
}

// --- MCP servers ------------------------------------------------------------

export const mcpServersSchema = z.looseObject({
  servers: z
    .array(
      z.looseObject({
        name: z.string().nullish(),
        enabled: z.boolean().nullish(),
        status: z.string().nullish(),
        connected: z.boolean().nullish(),
        tools: z.union([z.array(z.unknown()), numeric]).nullish(),
        transport: z.string().nullish(),
        command: z.string().nullish(),
        url: z.string().nullish(),
      }),
    )
    .nullish(),
});

export interface McpServerSummary {
  name: string;
  enabled: boolean;
  status: string | null;
  toolCount: number | null;
  transport: string | null;
}

export function normalizeMcpServers(raw: z.infer<typeof mcpServersSchema>): McpServerSummary[] {
  return (raw.servers ?? []).map((server, index) => ({
    name: server.name ?? `Server ${index + 1}`,
    enabled: server.enabled !== false,
    status: server.status ?? (server.connected === true ? 'connected' : null),
    toolCount: Array.isArray(server.tools) ? server.tools.length : toNumber(server.tools),
    transport: server.transport ?? (server.url ? 'http' : server.command ? 'stdio' : null),
  }));
}

// --- Cron jobs --------------------------------------------------------------

export const cronJobsSchema = z.array(
  z.looseObject({
    id: z.string().nullish(),
    name: z.string().nullish(),
    prompt: z.string().nullish(),
    enabled: z.boolean().nullish(),
    paused: z.boolean().nullish(),
    schedule: z
      .union([
        z.string(),
        z.looseObject({
          kind: z.string().nullish(),
          expr: z.string().nullish(),
          display: z.string().nullish(),
        }),
      ])
      .nullish(),
    schedule_display: z.string().nullish(),
    next_run: numeric,
    last_run: numeric,
    model: z.string().nullish(),
  }),
);

export interface CronJobSummary {
  id: string;
  name: string;
  schedule: string | null;
  paused: boolean;
  nextRun: number | null;
  lastRun: number | null;
}

export function normalizeCronJobs(raw: z.infer<typeof cronJobsSchema>): CronJobSummary[] {
  return raw.map((job, index) => {
    const schedule =
      job.schedule_display ??
      (typeof job.schedule === 'string'
        ? job.schedule
        : (job.schedule?.display ?? job.schedule?.expr ?? null));

    return {
      id: job.id ?? `job-${index}`,
      name: job.name?.trim() || job.prompt?.slice(0, 60) || 'Unbenannter Job',
      schedule,
      // Hermes reports either flag depending on version; either one pauses it.
      paused: job.paused === true || job.enabled === false,
      nextRun: toNumber(job.next_run),
      lastRun: toNumber(job.last_run),
    };
  });
}

// --- Logs -------------------------------------------------------------------

export const logsSchema = z.looseObject({
  file: z.string().nullish(),
  lines: z.array(z.string()).nullish(),
});

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'plain';

export interface LogLine {
  text: string;
  level: LogLevel;
}

/**
 * Classifies a log line so errors can be highlighted. Deliberately conservative:
 * a line is only an error if it says so in a recognisable place, because
 * colouring ordinary output red teaches people to ignore the colour.
 */
export function classifyLogLine(text: string): LogLevel {
  const head = text.slice(0, 120).toUpperCase();
  if (/\b(ERROR|CRITICAL|FATAL|EXCEPTION|TRACEBACK)\b/.test(head)) return 'error';
  if (/\b(WARN|WARNING)\b/.test(head)) return 'warn';
  if (/\b(INFO)\b/.test(head)) return 'info';
  if (/\b(DEBUG|TRACE)\b/.test(head)) return 'debug';
  return 'plain';
}

export function normalizeLogs(raw: z.infer<typeof logsSchema>): {
  file: string | null;
  lines: LogLine[];
} {
  return {
    file: raw.file ?? null,
    lines: (raw.lines ?? []).map((text) => ({ text, level: classifyLogLine(text) })),
  };
}

// --- Model ------------------------------------------------------------------

export const modelInfoSchema = z.looseObject({
  model: z.string().nullish(),
  provider: z.string().nullish(),
  auto_context_length: numeric,
  config_context_length: numeric,
  effective_context_length: numeric,
  capabilities: z.looseObject({}).nullish(),
});

export interface ModelSummary {
  model: string | null;
  provider: string | null;
  contextLength: number | null;
  capabilities: string[];
}

export function normalizeModelInfo(raw: z.infer<typeof modelInfoSchema>): ModelSummary {
  const capabilities = Object.entries(raw.capabilities ?? {})
    .filter(([, value]) => value === true)
    .map(([name]) => name);

  return {
    model: raw.model ?? null,
    provider: raw.provider ?? null,
    contextLength:
      toNumber(raw.effective_context_length) ??
      toNumber(raw.config_context_length) ??
      toNumber(raw.auto_context_length),
    capabilities,
  };
}

// --- Analytics --------------------------------------------------------------

export const analyticsSchema = z.looseObject({
  daily: z
    .array(
      z.looseObject({
        day: z.string().nullish(),
        input_tokens: numeric,
        output_tokens: numeric,
        estimated_cost: numeric,
        actual_cost: numeric,
        sessions: numeric,
        api_calls: numeric,
      }),
    )
    .nullish(),
  by_model: z
    .array(
      z.looseObject({
        model: z.string().nullish(),
        input_tokens: numeric,
        output_tokens: numeric,
        estimated_cost: numeric,
        api_calls: numeric,
      }),
    )
    .nullish(),
  totals: z
    .looseObject({
      total_input: numeric,
      total_output: numeric,
      total_estimated_cost: numeric,
      total_actual_cost: numeric,
      total_sessions: numeric,
      total_api_calls: numeric,
    })
    .nullish(),
  tools: z
    .array(z.looseObject({ tool: z.string().nullish(), count: numeric, percentage: numeric }))
    .nullish(),
  period_days: numeric,
});

export interface AnalyticsSummary {
  periodDays: number | null;
  totals: {
    inputTokens: number | null;
    outputTokens: number | null;
    /** Actual cost when the provider reports it, otherwise the estimate. */
    cost: number | null;
    costIsEstimate: boolean;
    sessions: number | null;
    apiCalls: number | null;
  };
  daily: { day: string; inputTokens: number; outputTokens: number; cost: number }[];
  byModel: { model: string; tokens: number; cost: number; apiCalls: number }[];
  topTools: { tool: string; count: number }[];
}

export function normalizeAnalytics(raw: z.infer<typeof analyticsSchema>): AnalyticsSummary {
  const actual = toNumber(raw.totals?.total_actual_cost);
  const estimated = toNumber(raw.totals?.total_estimated_cost);

  return {
    periodDays: toNumber(raw.period_days),
    totals: {
      inputTokens: toNumber(raw.totals?.total_input),
      outputTokens: toNumber(raw.totals?.total_output),
      // Providers that bill exactly report actual; the rest only estimate, and
      // the widget must be able to say which it is showing.
      cost: actual && actual > 0 ? actual : estimated,
      costIsEstimate: !(actual && actual > 0),
      sessions: toNumber(raw.totals?.total_sessions),
      apiCalls: toNumber(raw.totals?.total_api_calls),
    },
    daily: (raw.daily ?? []).map((entry) => ({
      day: entry.day ?? '',
      inputTokens: toNumber(entry.input_tokens) ?? 0,
      outputTokens: toNumber(entry.output_tokens) ?? 0,
      cost: toNumber(entry.actual_cost) || (toNumber(entry.estimated_cost) ?? 0),
    })),
    byModel: (raw.by_model ?? [])
      .map((entry) => ({
        model: entry.model ?? 'unbekannt',
        tokens: (toNumber(entry.input_tokens) ?? 0) + (toNumber(entry.output_tokens) ?? 0),
        cost: toNumber(entry.estimated_cost) ?? 0,
        apiCalls: toNumber(entry.api_calls) ?? 0,
      }))
      .sort((a, b) => b.tokens - a.tokens),
    topTools: (raw.tools ?? [])
      .map((entry) => ({ tool: entry.tool ?? 'unbekannt', count: toNumber(entry.count) ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  };
}

// --- Sessions ---------------------------------------------------------------

export const sessionsSchema = z.looseObject({
  sessions: z
    .array(
      z.looseObject({
        id: z.string().nullish(),
        source: z.string().nullish(),
        model: z.string().nullish(),
        display_name: z.string().nullish(),
        started_at: numeric,
        ended_at: numeric,
        end_reason: z.string().nullish(),
        message_count: numeric,
        profile_name: z.string().nullish(),
      }),
    )
    .nullish(),
  total: numeric,
});

export interface SessionSummary {
  id: string;
  source: string | null;
  model: string | null;
  /** Null means the launch profile — that is Hermes' own convention for the column. */
  profile: string | null;
  title: string | null;
  /** Epoch milliseconds. Hermes reports seconds, which would be 1970 if passed on. */
  startedAt: number | null;
  messages: number | null;
  endReason: string | null;
}

/**
 * Hermes timestamps arrive in seconds. Anything below this threshold cannot be
 * a plausible millisecond timestamp, so it is scaled up rather than rendered as
 * 1970.
 */
const SECONDS_CEILING = 100_000_000_000;

export function toEpochMs(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null || parsed <= 0) return null;
  return parsed < SECONDS_CEILING ? Math.round(parsed * 1000) : Math.round(parsed);
}

export function normalizeSessions(raw: z.infer<typeof sessionsSchema>): {
  total: number | null;
  sessions: SessionSummary[];
} {
  return {
    total: toNumber(raw.total),
    sessions: (raw.sessions ?? []).map((session, index) => ({
      id: session.id ?? `session-${index}`,
      source: session.source ?? null,
      model: session.model ?? null,
      profile: session.profile_name ?? null,
      title: session.display_name?.trim() || null,
      startedAt: toEpochMs(session.started_at),
      messages: toNumber(session.message_count),
      endReason: session.end_reason ?? null,
    })),
  };
}

// --- Session transcript -----------------------------------------------------

export const sessionMessagesSchema = z.looseObject({
  messages: z
    .array(
      z.looseObject({
        role: z.string().nullish(),
        content: z.string().nullish(),
      }),
    )
    .nullish(),
});

export interface TranscriptMessage {
  role: string;
  text: string;
}

/**
 * Reduces a stored transcript to the {role, text} the chat thread renders.
 * Only user and assistant turns with text survive: tool-call turns and internal
 * roles would show as blank bubbles.
 */
export function normalizeSessionMessages(
  raw: z.infer<typeof sessionMessagesSchema>,
): TranscriptMessage[] {
  return (raw.messages ?? [])
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      text: message.content?.trim() ?? '',
      keep: (message.role === 'user' || message.role === 'assistant') && !!message.content?.trim(),
    }))
    .filter((message) => message.keep)
    .map(({ role, text }) => ({ role, text }));
}

// --- Memory / knowledge -----------------------------------------------------

export const memorySchema = z.looseObject({
  active: z.string().nullish(),
  providers: z
    .array(
      z.looseObject({
        name: z.string().nullish(),
        description: z.string().nullish(),
        available: z.boolean().nullish(),
        configured: z.boolean().nullish(),
        status: z.string().nullish(),
      }),
    )
    .nullish(),
  builtin_files: z.record(z.string(), numeric).nullish(),
});

export interface MemoryProvider {
  name: string;
  description: string | null;
  available: boolean;
  configured: boolean;
  status: string | null;
}

export interface MemorySummary {
  active: string | null;
  configured: { name: string; status: string | null }[];
  availableCount: number;
  files: { name: string; entries: number }[];
  /** Every provider Hermes knows about, for the full knowledge page. */
  providers: MemoryProvider[];
}

/** Usable first (ready and available), then the rest, so the page leads with what works. */
function memoryProviderRank(provider: MemoryProvider): number {
  if (provider.available && provider.status === 'ready') return 0;
  if (provider.available) return 1;
  if (provider.configured) return 2;
  return 3;
}

export function normalizeMemory(raw: z.infer<typeof memorySchema>): MemorySummary {
  const providers = raw.providers ?? [];

  const all: MemoryProvider[] = providers
    .map((provider) => ({
      name: provider.name ?? 'unbekannt',
      description: provider.description?.trim() || null,
      available: provider.available === true,
      configured: provider.configured === true,
      status: provider.status ?? null,
    }))
    .sort((a, b) => memoryProviderRank(a) - memoryProviderRank(b) || a.name.localeCompare(b.name));

  return {
    // Hermes reports an empty string when nothing is active; make that explicit.
    active: raw.active?.trim() || null,
    configured: providers
      .filter((provider) => provider.configured === true)
      .map((provider) => ({ name: provider.name ?? 'unbekannt', status: provider.status ?? null })),
    availableCount: providers.filter((provider) => provider.available === true).length,
    files: Object.entries(raw.builtin_files ?? {}).map(([name, entries]) => ({
      name,
      entries: toNumber(entries) ?? 0,
    })),
    providers: all,
  };
}

// --- Messaging platforms ----------------------------------------------------

export const messagingPlatformsSchema = z.looseObject({
  platforms: z
    .array(
      z.looseObject({
        id: z.string().nullish(),
        name: z.string().nullish(),
        description: z.string().nullish(),
        docs_url: z.string().nullish(),
        enabled: z.boolean().nullish(),
        configured: z.boolean().nullish(),
        state: z.string().nullish(),
        error_message: z.string().nullish(),
        // Older Hermes returns a plain chat id; 0.19 returns an object. Accept both.
        home_channel: z
          .union([
            z.string(),
            z.looseObject({
              platform: z.string().nullish(),
              chat_id: z.string().nullish(),
              name: z.string().nullish(),
            }),
          ])
          .nullish(),
        env_vars: z
          .array(
            z.looseObject({
              key: z.string().nullish(),
              required: z.boolean().nullish(),
              is_set: z.boolean().nullish(),
              description: z.string().nullish(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
});

export interface MessagingEnvVar {
  key: string;
  required: boolean;
  isSet: boolean;
  description: string | null;
}

export interface MessagingPlatform {
  id: string;
  name: string;
  description: string | null;
  docsUrl: string | null;
  enabled: boolean;
  configured: boolean;
  state: string | null;
  errorMessage: string | null;
  homeChannel: string | null;
  /** How many required secrets the platform still needs, so setup can be nudged. */
  requiredTotal: number;
  requiredMissing: number;
  envVars: MessagingEnvVar[];
}

export interface MessagingOverview {
  platforms: MessagingPlatform[];
  configuredCount: number;
  enabledCount: number;
}

/** Running first, then set up, then the long tail of possible platforms. */
function messagingRank(platform: MessagingPlatform): number {
  if (platform.enabled) return 0;
  if (platform.configured) return 1;
  return 2;
}

export function normalizeMessagingPlatforms(
  raw: z.infer<typeof messagingPlatformsSchema>,
): MessagingOverview {
  const platforms: MessagingPlatform[] = (raw.platforms ?? [])
    .map((platform, index) => {
      // Never carry the redacted secret value into the UI — only whether it is set.
      const envVars: MessagingEnvVar[] = (platform.env_vars ?? []).map((v) => ({
        key: v.key ?? '',
        required: v.required === true,
        isSet: v.is_set === true,
        description: v.description?.trim() || null,
      }));
      const required = envVars.filter((v) => v.required);

      // home_channel is either a bare id or an object; show a human label for both.
      const homeChannel =
        typeof platform.home_channel === 'string'
          ? platform.home_channel.trim() || null
          : platform.home_channel?.name?.trim() || platform.home_channel?.chat_id?.trim() || null;

      return {
        id: platform.id ?? `platform-${index}`,
        name: platform.name ?? platform.id ?? `Plattform ${index + 1}`,
        description: platform.description?.trim() || null,
        docsUrl: platform.docs_url?.trim() || null,
        enabled: platform.enabled === true,
        configured: platform.configured === true,
        state: platform.state ?? null,
        errorMessage: platform.error_message?.trim() || null,
        homeChannel,
        requiredTotal: required.length,
        requiredMissing: required.filter((v) => !v.isSet).length,
        envVars,
      };
    })
    .sort((a, b) => messagingRank(a) - messagingRank(b) || a.name.localeCompare(b.name));

  return {
    platforms,
    configuredCount: platforms.filter((p) => p.configured).length,
    enabledCount: platforms.filter((p) => p.enabled).length,
  };
}

// --- Webhooks ---------------------------------------------------------------

export const webhooksSchema = z.looseObject({
  enabled: z.boolean().nullish(),
  base_url: z.string().nullish(),
  subscriptions: z
    .array(
      z.looseObject({
        name: z.string().nullish(),
        url: z.string().nullish(),
        enabled: z.boolean().nullish(),
        events: z.array(z.string()).nullish(),
      }),
    )
    .nullish(),
});

export interface WebhookSubscription {
  name: string | null;
  url: string | null;
  enabled: boolean;
  events: string[];
}

export interface WebhooksOverview {
  enabled: boolean;
  baseUrl: string | null;
  subscriptions: WebhookSubscription[];
}

export function normalizeWebhooks(raw: z.infer<typeof webhooksSchema>): WebhooksOverview {
  return {
    enabled: raw.enabled === true,
    baseUrl: raw.base_url?.trim() || null,
    subscriptions: (raw.subscriptions ?? []).map((sub) => ({
      name: sub.name?.trim() || null,
      url: sub.url?.trim() || null,
      enabled: sub.enabled !== false,
      events: sub.events ?? [],
    })),
  };
}

// --- Pairing ----------------------------------------------------------------

const pairedUserSchema = z.looseObject({
  platform: z.string().nullish(),
  user_id: z.string().nullish(),
  user_name: z.string().nullish(),
  approved_at: numeric,
  requested_at: numeric,
});

export const pairingSchema = z.looseObject({
  pending: z.array(pairedUserSchema).nullish(),
  approved: z.array(pairedUserSchema).nullish(),
});

export interface PairedUser {
  platform: string | null;
  userId: string | null;
  userName: string | null;
  /** Epoch milliseconds; Hermes reports seconds. */
  at: number | null;
}

export interface PairingOverview {
  pending: PairedUser[];
  approved: PairedUser[];
}

function normalizePairedUser(user: z.infer<typeof pairedUserSchema>): PairedUser {
  return {
    platform: user.platform ?? null,
    userId: user.user_id ?? null,
    userName: user.user_name?.trim() || null,
    at: toEpochMs(user.approved_at ?? user.requested_at),
  };
}

export function normalizePairing(raw: z.infer<typeof pairingSchema>): PairingOverview {
  return {
    pending: (raw.pending ?? []).map(normalizePairedUser),
    approved: (raw.approved ?? []).map(normalizePairedUser),
  };
}
