import type { Meta, MetricSeries, PublicHermesConnection, StatusSnapshot } from './types';
import type { DashboardLayout } from '@/widgets/types';
import type {
  AnalyticsSummary,
  AuxiliaryModels,
  CronJobSummary,
  Insight,
  LogsResponse,
  Prompt,
  PromptInput,
  ConfigRaw,
  CuratorStatus,
  EnvVar,
  McpServerSummary,
  MemorySummary,
  MessagingOverview,
  ModelOptions,
  ModelSummary,
  PairingOverview,
  ProfileOverview,
  SessionsResponse,
  SkillEntry,
  SkillSummary,
  Toolset,
  UpdateStatus,
  WebhooksOverview,
  Workflow,
  WorkflowInput,
} from './hermesTypes';

/**
 * Thin fetch wrapper for the control-center backend. The backend is the only
 * thing the browser talks to — Hermes credentials never reach this code.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { accept: 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // Non-JSON error body: fall back to the status text.
    }
    throw new ApiError(
      body.message ?? response.statusText ?? 'Request failed',
      response.status,
      body.error,
    );
  }

  return (await response.json()) as T;
}

export const getMeta = (): Promise<Meta> => apiRequest<Meta>('/meta');

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
}

export const getAuthStatus = (): Promise<AuthStatus> => apiRequest<AuthStatus>('/auth/status');

export const login = (password: string): Promise<{ ok: boolean }> =>
  apiRequest<{ ok: boolean }>('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });

export const logout = (): Promise<{ ok: boolean }> =>
  apiRequest<{ ok: boolean }>('/auth/logout', { method: 'POST' });

export const getSkills = (): Promise<SkillSummary> => apiRequest<SkillSummary>('/hermes/skills');

export const getSkillList = (): Promise<SkillEntry[]> =>
  apiRequest<SkillEntry[]>('/hermes/skills/list');

export interface ActionResult {
  ok?: boolean;
}

export interface TestResult {
  ok?: boolean;
  state?: string | null;
  message?: string | null;
}

/** Enable or disable a skill on the agent. Returns once Hermes confirms. */
export const toggleSkill = (name: string, enabled: boolean): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/skills/toggle', {
    method: 'PUT',
    ...jsonBody({ name, enabled }),
  });

export const cronAction = (
  id: string,
  action: 'pause' | 'resume' | 'trigger',
): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/cron/${encodeURIComponent(id)}/${action}`, { method: 'POST' });

export const deleteCronJob = (id: string): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/cron/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const setMainModel = (provider: string, model: string): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/model/set', {
    method: 'POST',
    ...jsonBody({ provider, model }),
  });

export const setMcpEnabled = (name: string, enabled: boolean): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/mcp/${encodeURIComponent(name)}/enabled`, {
    method: 'PUT',
    ...jsonBody({ enabled }),
  });

export const testMcpServer = (name: string): Promise<TestResult> =>
  apiRequest<TestResult>(`/hermes/mcp/${encodeURIComponent(name)}/test`, { method: 'POST' });

export interface McpServerInput {
  name: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth?: 'none' | 'oauth' | 'header';
  bearerToken?: string;
}

export const createMcpServer = (input: McpServerInput): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/mcp', { method: 'POST', ...jsonBody(input) });

/**
 * Change one server's fields. Only what is sent is written — env variables left
 * out keep their real values, which is why this never posts a full server map.
 */
export const updateMcpServer = (
  name: string,
  patch: { url?: string; command?: string; args?: string[]; env?: Record<string, string> },
): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/mcp/${encodeURIComponent(name)}`, {
    method: 'PUT',
    ...jsonBody(patch),
  });

export const deleteMcpServer = (name: string): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const setMemoryProvider = (provider: string): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/memory/provider', { method: 'PUT', ...jsonBody({ provider }) });

export const setPlatformEnabled = (
  id: string,
  enabled: boolean,
  profile?: string | null,
): Promise<ActionResult> =>
  apiRequest<ActionResult>(
    withProfile(`/hermes/messaging/${encodeURIComponent(id)}/enabled`, profile),
    { method: 'PUT', ...jsonBody({ enabled }) },
  );

export const testPlatform = (id: string, profile?: string | null): Promise<TestResult> =>
  apiRequest<TestResult>(withProfile(`/hermes/messaging/${encodeURIComponent(id)}/test`, profile), {
    method: 'POST',
  });

// --- Settings ---------------------------------------------------------------

export const getEnv = (): Promise<EnvVar[]> => apiRequest<EnvVar[]>('/hermes/env');
export const getConfigRaw = (): Promise<ConfigRaw> => apiRequest<ConfigRaw>('/hermes/config/raw');
export const getCurator = (): Promise<CuratorStatus> =>
  apiRequest<CuratorStatus>('/hermes/curator');
export const getUpdate = (): Promise<UpdateStatus> => apiRequest<UpdateStatus>('/hermes/update');
export const getToolsets = (): Promise<Toolset[]> => apiRequest<Toolset[]>('/hermes/toolsets');

export const setEnv = (key: string, value: string): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/env', { method: 'PUT', ...jsonBody({ key, value }) });

export const deleteEnv = (key: string): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/env', { method: 'DELETE', ...jsonBody({ key }) });

export const saveConfigRaw = (yaml: string): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/config/raw', { method: 'PUT', ...jsonBody({ yaml }) });

export const setCuratorPaused = (paused: boolean): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/curator/paused', { method: 'PUT', ...jsonBody({ paused }) });

export const runCurator = (): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/curator/run', { method: 'POST' });

export const toggleToolset = (name: string, enabled: boolean): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/toolsets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    ...jsonBody({ enabled }),
  });

export const getModelOptions = (): Promise<ModelOptions> =>
  apiRequest<ModelOptions>('/hermes/models');

export const getMcpServers = (): Promise<McpServerSummary[]> =>
  apiRequest<McpServerSummary[]>('/hermes/mcp');

export const getCronJobs = (): Promise<CronJobSummary[]> =>
  apiRequest<CronJobSummary[]>('/hermes/cron');

export const getModelInfo = (): Promise<ModelSummary> => apiRequest<ModelSummary>('/hermes/model');

export const getAnalytics = (): Promise<AnalyticsSummary> =>
  apiRequest<AnalyticsSummary>('/hermes/analytics');

export const getMemory = (): Promise<MemorySummary> => apiRequest<MemorySummary>('/hermes/memory');

export const getMessaging = (profile?: string | null): Promise<MessagingOverview> =>
  apiRequest<MessagingOverview>(
    profile ? `/hermes/messaging?profile=${encodeURIComponent(profile)}` : '/hermes/messaging',
  );

export const getWebhooks = (): Promise<WebhooksOverview> =>
  apiRequest<WebhooksOverview>('/hermes/webhooks');

export const getPairing = (): Promise<PairingOverview> =>
  apiRequest<PairingOverview>('/hermes/pairing');

/**
 * Turn the webhook platform on. Restarts the gateway upstream, which takes
 * every messaging platform down for a moment — warn before calling.
 */
export const enableWebhooks = (): Promise<{ ok?: boolean; needs_restart?: boolean }> =>
  apiRequest<{ ok?: boolean; needs_restart?: boolean }>('/hermes/webhooks/enable', {
    method: 'POST',
  });

export interface WebhookCreated {
  name?: string | null;
  url?: string | null;
  /** Returned exactly once, on create. Every later read masks it away. */
  secret?: string | null;
}

export const createWebhook = (input: {
  name: string;
  description?: string;
  events?: string[];
  prompt?: string;
}): Promise<WebhookCreated> =>
  apiRequest<WebhookCreated>('/hermes/webhooks', { method: 'POST', ...jsonBody(input) });

export const deleteWebhook = (name: string): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/webhooks/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const setWebhookEnabled = (name: string, enabled: boolean): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/webhooks/${encodeURIComponent(name)}/enabled`, {
    method: 'PUT',
    ...jsonBody({ enabled }),
  });

/** The code is the one the person was shown; the list only holds a hash prefix. */
export const approvePairing = (platform: string, code: string): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/pairing/approve', {
    method: 'POST',
    ...jsonBody({ platform, code }),
  });

export const revokePairing = (platform: string, userId: string): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/pairing/revoke', {
    method: 'POST',
    ...jsonBody({ platform, userId }),
  });

export const clearPendingPairing = (): Promise<{ cleared?: number }> =>
  apiRequest<{ cleared?: number }>('/hermes/pairing/clear-pending', { method: 'POST' });

export const getLogs = (lines = 100): Promise<LogsResponse> =>
  apiRequest<LogsResponse>(`/hermes/logs?lines=${lines}`);

export const getSessions = (limit = 10): Promise<SessionsResponse> =>
  apiRequest<SessionsResponse>(`/hermes/sessions?limit=${limit}`);

/** Conversations from one platform, in one profile. */
export const getSessionsBySource = (
  source: string,
  profile?: string | null,
  limit = 50,
): Promise<SessionsResponse> => {
  const params = new URLSearchParams({ source, limit: String(limit) });
  if (profile) params.set('profile', profile);
  return apiRequest<SessionsResponse>(`/hermes/sessions/by-source?${params.toString()}`);
};

// --- Workspace (files on the Hermes host) -----------------------------------

export interface WorkspaceRootInfo {
  configured: boolean;
  root: string | null;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number | null;
  modified: number | null;
  mimeType: string | null;
}

export interface WorkspaceListing {
  path: string;
  display: string;
  atRoot: boolean;
  entries: WorkspaceEntry[];
  /** Null means Hermes confines nothing and only this control center does. */
  hermesLockedRoot: string | null;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  size: number | null;
  mimeType: string | null;
  text: string | null;
  binary: boolean;
}

export const getWorkspaceRoot = (): Promise<WorkspaceRootInfo> =>
  apiRequest<WorkspaceRootInfo>('/workspace/root');

export const listWorkspace = (path?: string): Promise<WorkspaceListing> =>
  apiRequest<WorkspaceListing>(
    path ? `/workspace/list?path=${encodeURIComponent(path)}` : '/workspace/list',
  );

export const readWorkspaceFile = (path: string): Promise<WorkspaceFile> =>
  apiRequest<WorkspaceFile>(`/workspace/read?path=${encodeURIComponent(path)}`);

export const createWorkspaceDirectory = (path: string): Promise<ActionResult> =>
  apiRequest<ActionResult>('/workspace/mkdir', { method: 'POST', ...jsonBody({ path }) });

/** `recursive` is what makes a non-empty folder go; the caller confirms first. */
export const deleteWorkspaceEntry = (path: string, recursive: boolean): Promise<ActionResult> =>
  apiRequest<ActionResult>('/workspace/file', {
    method: 'DELETE',
    ...jsonBody({ path, recursive }),
  });

export const getInsights = (): Promise<{ insights: Insight[]; generatedAt: number }> =>
  apiRequest<{ insights: Insight[]; generatedAt: number }>('/insights');

export const getPrompts = (): Promise<{ prompts: Prompt[] }> =>
  apiRequest<{ prompts: Prompt[] }>('/prompts');

const jsonBody = (value: unknown) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});

export const createPrompt = (input: PromptInput): Promise<{ prompt: Prompt }> =>
  apiRequest<{ prompt: Prompt }>('/prompts', { method: 'POST', ...jsonBody(input) });

export const updatePrompt = (id: string, input: PromptInput): Promise<{ prompt: Prompt }> =>
  apiRequest<{ prompt: Prompt }>(`/prompts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    ...jsonBody(input),
  });

export const deletePrompt = (id: string): Promise<{ ok: boolean }> =>
  apiRequest<{ ok: boolean }>(`/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const recordPromptUse = (id: string): Promise<{ uses: number }> =>
  apiRequest<{ uses: number }>(`/prompts/${encodeURIComponent(id)}/use`, { method: 'POST' });

export const getWorkflows = (): Promise<{ workflows: Workflow[] }> =>
  apiRequest<{ workflows: Workflow[] }>('/workflows');

export const createWorkflow = (input: WorkflowInput): Promise<{ workflow: Workflow }> =>
  apiRequest<{ workflow: Workflow }>('/workflows', { method: 'POST', ...jsonBody(input) });

export const updateWorkflow = (id: string, input: WorkflowInput): Promise<{ workflow: Workflow }> =>
  apiRequest<{ workflow: Workflow }>(`/workflows/${encodeURIComponent(id)}`, {
    method: 'PUT',
    ...jsonBody(input),
  });

export const setWorkflowEnabled = (id: string, enabled: boolean): Promise<{ workflow: Workflow }> =>
  apiRequest<{ workflow: Workflow }>(`/workflows/${encodeURIComponent(id)}/enabled`, {
    method: 'POST',
    ...jsonBody({ enabled }),
  });

export const deleteWorkflow = (id: string): Promise<{ ok: boolean }> =>
  apiRequest<{ ok: boolean }>(`/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const getDashboardLayout = (): Promise<{ layout: DashboardLayout | null }> =>
  apiRequest<{ layout: DashboardLayout | null }>('/dashboard/layout');

export const saveDashboardLayout = (layout: DashboardLayout): Promise<{ ok: boolean }> =>
  apiRequest<{ ok: boolean }>('/dashboard/layout', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(layout),
  });

export const resetDashboardLayout = (): Promise<{ ok: boolean }> =>
  apiRequest<{ ok: boolean }>('/dashboard/layout', { method: 'DELETE' });

export const getStatus = (fresh = false): Promise<StatusSnapshot> =>
  apiRequest<StatusSnapshot>(`/status${fresh ? '?fresh=1' : ''}`);

export const getConnection = (): Promise<PublicHermesConnection> =>
  apiRequest<PublicHermesConnection>('/connection');

// --- Chat (dashboard tui_gateway) -------------------------------------------

export interface ChatMessage {
  role: string;
  text: string;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  preview: string;
  startedAt: number | null;
  messageCount: number;
  source: string;
  /** What the conversation actually runs on; null when it cannot be determined. */
  model: string | null;
  /** Hermes' keep flag: a pinned conversation is exempt from auto-archive. */
  pinned: boolean;
}

/**
 * The profile a chat call is scoped to. Every profile has its own conversation
 * database, so this decides which conversations are listed, where a new one is
 * created, and which one a delete reaches. Empty means the profile the running
 * dashboard was launched with.
 */
export type ChatProfile = string | null | undefined;

const withProfile = (path: string, profile: ChatProfile): string =>
  profile ? `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}` : path;

export const getChatSessions = (
  profile?: ChatProfile,
): Promise<{ sessions: ChatSessionSummary[] }> =>
  apiRequest<{ sessions: ChatSessionSummary[] }>(withProfile('/chat/sessions', profile));

/**
 * A conversation has two ids and they are not interchangeable.
 *
 * `liveId` is the gateway's handle for the attached session — prompts, streamed
 * events and model switches speak it, and reopening a conversation mints a new
 * one. `storedId` names the row: the list, the transcript and deleting speak
 * that. Sending the stored id where the live one belongs fails silently as
 * "session not found".
 */
export interface ChatSessionIds {
  liveId: string | null;
  storedId: string | null;
}

export const resumeChatSession = (
  sessionId: string,
  profile?: ChatProfile,
): Promise<ChatSessionIds & { ok: boolean }> =>
  apiRequest<ChatSessionIds & { ok: boolean }>('/chat/resume', {
    method: 'POST',
    ...jsonBody({ sessionId, profile: profile ?? undefined }),
  });

export interface CreateChatSessionInput {
  /** Per-session model override. Applies to this conversation only. */
  model?: string;
  provider?: string;
  profile?: ChatProfile;
}

export const createChatSession = (input: CreateChatSessionInput = {}): Promise<ChatSessionIds> =>
  apiRequest<ChatSessionIds>('/chat/session', {
    method: 'POST',
    ...jsonBody({
      model: input.model || undefined,
      provider: input.provider || undefined,
      profile: input.profile ?? undefined,
    }),
  });

export interface ModelSwitchResult {
  ok: boolean;
  model: string;
  /** "session" when the change stayed local, which is the only value we ask for. */
  scope: string | null;
  warning: string | null;
  confirmRequired: boolean;
  confirmMessage: string | null;
}

/** Repoint a live conversation at another model. Never writes the agent's default. */
export const switchChatModel = (
  liveId: string,
  model: string,
  provider?: string,
  confirm?: boolean,
): Promise<ModelSwitchResult> =>
  apiRequest<ModelSwitchResult>('/chat/model', {
    method: 'POST',
    ...jsonBody({ sessionId: liveId, model, provider, confirm }),
  });

export interface SkillContent {
  name: string;
  content: string;
  path: string | null;
}

export const getSkillContent = (name: string): Promise<SkillContent> =>
  apiRequest<SkillContent>(`/hermes/skills/content?name=${encodeURIComponent(name)}`);

export const createSkill = (
  name: string,
  content: string,
  category?: string,
): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/skills', {
    method: 'POST',
    ...jsonBody({ name, content, category }),
  });

export const updateSkillContent = (name: string, content: string): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/skills/content', {
    method: 'PUT',
    ...jsonBody({ name, content }),
  });

/**
 * Start removing a skill.
 *
 * Hermes spawns its CLI and answers immediately, so `started` is all this can
 * honestly report — the list has to be re-read to see whether it worked.
 */
export const uninstallSkill = (name: string): Promise<{ started: boolean }> =>
  apiRequest<{ started: boolean }>('/hermes/skills/uninstall', {
    method: 'POST',
    ...jsonBody({ name }),
  });

export const getAuxiliaryModels = (): Promise<AuxiliaryModels> =>
  apiRequest<AuxiliaryModels>('/hermes/models/auxiliary');

/** `provider: "auto"` hands a slot back to the main model; `task: "__reset__"` resets all. */
export const setAuxiliaryModel = (
  task: string,
  provider: string,
  model?: string,
): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/model/auxiliary', {
    method: 'POST',
    ...jsonBody({ task, provider, model }),
  });

export const getProfiles = (): Promise<ProfileOverview> =>
  apiRequest<ProfileOverview>('/hermes/profiles');

export interface ProfileCreateInput {
  name: string;
  /** Copy an existing profile's config, skills and SOUL instead of starting bare. */
  cloneFrom?: string;
  /** Copy its whole state as well, conversations included. */
  cloneAll?: boolean;
  noSkills?: boolean;
  description?: string;
}

export const createProfile = (input: ProfileCreateInput): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/profiles', { method: 'POST', ...jsonBody(input) });

export const renameProfile = (name: string, newName: string): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/profiles/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    ...jsonBody({ newName }),
  });

export const deleteProfile = (name: string): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' });

/** Sets the sticky profile for new terminal commands; the running dashboard stays put. */
export const setActiveProfile = (name: string): Promise<ActionResult> =>
  apiRequest<ActionResult>('/hermes/profiles/active', { method: 'POST', ...jsonBody({ name }) });

export const setProfileDescription = (name: string, description: string): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/profiles/${encodeURIComponent(name)}/description`, {
    method: 'PUT',
    ...jsonBody({ description }),
  });

export const setProfileModel = (
  name: string,
  provider: string,
  model: string,
): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/profiles/${encodeURIComponent(name)}/model`, {
    method: 'PUT',
    ...jsonBody({ provider, model }),
  });

export interface ProfileSoul {
  content: string;
  exists: boolean;
}

export const getProfileSoul = (name: string): Promise<ProfileSoul> =>
  apiRequest<ProfileSoul>(`/hermes/profiles/${encodeURIComponent(name)}/soul`);

export const saveProfileSoul = (name: string, content: string): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/profiles/${encodeURIComponent(name)}/soul`, {
    method: 'PUT',
    ...jsonBody({ content }),
  });

/** Reports how many rows really went — Hermes skips ids it no longer knows. */
export interface DeleteSessionsResult {
  ok?: boolean | null;
  deleted?: number | null;
}

export const deleteChatSessions = (
  ids: string[],
  profile?: ChatProfile,
): Promise<DeleteSessionsResult> =>
  apiRequest<DeleteSessionsResult>('/hermes/sessions/delete', {
    method: 'POST',
    ...jsonBody({ ids, profile: profile ?? undefined }),
  });

/** Pin or unpin a conversation. Not only ordering — it also stops auto-archive. */
export const setSessionPinned = (
  sessionId: string,
  pinned: boolean,
  profile?: ChatProfile,
): Promise<ActionResult> =>
  apiRequest<ActionResult>(`/hermes/sessions/${encodeURIComponent(sessionId)}/pinned`, {
    method: 'PATCH',
    ...jsonBody({ pinned, profile: profile ?? undefined }),
  });

export const sendChatPrompt = (sessionId: string, text: string): Promise<{ ok: boolean }> =>
  apiRequest<{ ok: boolean }>('/chat/prompt', { method: 'POST', ...jsonBody({ sessionId, text }) });

export const getChatHistory = (
  sessionId: string,
  profile?: ChatProfile,
): Promise<{ messages: ChatMessage[] }> =>
  apiRequest<{ messages: ChatMessage[] }>(
    withProfile(`/chat/history?sessionId=${encodeURIComponent(sessionId)}`, profile),
  );

export const getMetricSeries = (metric: string, windowMs?: number): Promise<MetricSeries> => {
  const params = new URLSearchParams({ metric });
  if (windowMs) params.set('windowMs', String(windowMs));
  return apiRequest<MetricSeries>(`/metrics/series?${params.toString()}`);
};

/** Query keys used across the app, so invalidation stays consistent. */
export const queryKeys = {
  meta: ['meta'] as const,
  auth: ['auth'] as const,
  dashboardLayout: ['dashboard', 'layout'] as const,
  insights: ['insights'] as const,
  prompts: ['prompts'] as const,
  workflows: ['workflows'] as const,
  skills: ['hermes', 'skills'] as const,
  skillList: ['hermes', 'skills', 'list'] as const,
  models: ['hermes', 'models'] as const,
  profiles: ['hermes', 'profiles'] as const,
  auxiliary: ['hermes', 'models', 'auxiliary'] as const,
  skillContent: (name: string) => ['hermes', 'skills', 'content', name] as const,
  profileSoul: (name: string) => ['hermes', 'profiles', name, 'soul'] as const,
  workspaceRoot: ['workspace', 'root'] as const,
  workspaceList: (path: string) => ['workspace', 'list', path] as const,
  workspaceFile: (path: string) => ['workspace', 'file', path] as const,
  sessionsBySource: (source: string, profile: string | null) =>
    ['hermes', 'sessions', 'source', source, profile ?? ''] as const,
  mcp: ['hermes', 'mcp'] as const,
  cron: ['hermes', 'cron'] as const,
  model: ['hermes', 'model'] as const,
  analytics: ['hermes', 'analytics'] as const,
  memory: ['hermes', 'memory'] as const,
  messaging: ['hermes', 'messaging'] as const,
  messagingFor: (profile: string | null) => ['hermes', 'messaging', profile ?? ''] as const,
  webhooks: ['hermes', 'webhooks'] as const,
  pairing: ['hermes', 'pairing'] as const,
  env: ['hermes', 'env'] as const,
  configRaw: ['hermes', 'config', 'raw'] as const,
  curator: ['hermes', 'curator'] as const,
  update: ['hermes', 'update'] as const,
  toolsets: ['hermes', 'toolsets'] as const,
  logs: (lines: number) => ['hermes', 'logs', lines] as const,
  sessions: (limit: number) => ['hermes', 'sessions', limit] as const,
  status: ['status'] as const,
  connection: ['connection'] as const,
  metricSeries: (metric: string) => ['metrics', 'series', metric] as const,
};
