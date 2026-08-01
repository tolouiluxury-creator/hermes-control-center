/**
 * Shapes returned by the control center's own /api/hermes/* projections.
 *
 * These mirror the normalisers in src/hermes/inventory.ts. They are written out
 * by hand rather than imported from the server so the browser bundle never
 * pulls in server code, and so a change on either side shows up as a type
 * error rather than as a widget rendering undefined.
 */

export interface SkillSummary {
  total: number;
  enabled: number;
  categories: { name: string; count: number }[];
  top: { name: string; usage: number; enabled: boolean; category: string | null }[];
}

export interface SkillEntry {
  name: string;
  description: string | null;
  category: string | null;
  enabled: boolean;
  usage: number;
  provenance: string | null;
}

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

export interface McpServerSummary {
  name: string;
  enabled: boolean;
  status: string | null;
  toolCount: number | null;
  transport: string | null;
  url: string | null;
  command: string | null;
  args: string[];
  /** Variable names only. The values in `maskedEnv` are redacted upstream. */
  envKeys: string[];
  maskedEnv: Record<string, string>;
  auth: string | null;
}

export interface CronJobSummary {
  id: string;
  name: string;
  schedule: string | null;
  paused: boolean;
  nextRun: number | null;
  lastRun: number | null;
  /** `"error"`, `"ok"`, … as Hermes reports it; null when the job never ran. */
  lastStatus: string | null;
  lastError: string | null;
  /** Which profile owns the job. The list spans all profiles by default. */
  profile: string | null;
  /**
   * The instruction the job runs. Carried so the edit form can start from the
   * real text — an empty field there would overwrite the prompt with nothing.
   */
  prompt: string | null;
  /** Where the output goes: `local`, `telegram`, … */
  deliver: string | null;
}

/**
 * The editable fields of a scheduled job. `schedule` accepts what Hermes'
 * `parse_schedule` accepts: `"30m"`, `"2h"`, `"every 30m"`, a five-field cron
 * expression, or an ISO timestamp.
 */
export interface CronJobInput {
  schedule?: string;
  name?: string;
  prompt?: string;
  deliver?: string;
  skills?: string[];
  model?: string;
  provider?: string;
  workdir?: string;
}

export interface CronDeliveryTarget {
  id: string;
  name: string;
  /** False when the platform is configured but has no home channel yet. */
  homeTargetSet: boolean;
  homeEnvVar: string | null;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'plain';

export interface LogsResponse {
  file: string | null;
  lines: { text: string; level: LogLevel }[];
}

export interface ModelSummary {
  model: string | null;
  provider: string | null;
  contextLength: number | null;
  capabilities: string[];
}

export interface AnalyticsSummary {
  periodDays: number | null;
  totals: {
    inputTokens: number | null;
    outputTokens: number | null;
    cost: number | null;
    costIsEstimate: boolean;
    sessions: number | null;
    apiCalls: number | null;
  };
  daily: { day: string; inputTokens: number; outputTokens: number; cost: number }[];
  byModel: { model: string; tokens: number; cost: number; apiCalls: number }[];
  topTools: { tool: string; count: number }[];
}

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
  /** The sticky default for new CLI commands — not necessarily the running one. */
  active: string | null;
  /** The profile the running dashboard uses, and therefore an unscoped chat. */
  current: string | null;
}

export interface SessionSummary {
  id: string;
  source: string | null;
  model: string | null;
  profile: string | null;
  /** Who the conversation is with; for Telegram, the person's name. */
  title: string | null;
  conversationTitle: string | null;
  preview: string | null;
  lastActive: number | null;
  chatId: string | null;
  chatType: string | null;
  startedAt: number | null;
  messages: number | null;
  endReason: string | null;
}

export interface SessionsResponse {
  total: number | null;
  sessions: SessionSummary[];
}

export type InsightSeverity = 'info' | 'warn' | 'critical';

/** A label or value is either our copy (a key) or Hermes' own data (verbatim). */
export interface InsightEvidence {
  labelKey?: string;
  label?: string;
  valueKey?: string;
  value?: string | number;
}

export interface Insight {
  id: string;
  severity: InsightSeverity;
  /** The server reports what it found; this side decides the wording. */
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
  evidence: InsightEvidence[];
  action?: string;
}

export interface Prompt {
  id: string;
  title: string;
  body: string;
  variables: string[];
  tags: string[];
  uses: number;
  createdAt: number;
  updatedAt: number;
}

export interface PromptInput {
  title: string;
  body: string;
  tags?: string[];
}

export type WorkflowStepKind = 'prompt' | 'cron' | 'note';

export interface WorkflowStep {
  id: string;
  kind: WorkflowStepKind;
  ref: string | null;
  label: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStepInput {
  kind: WorkflowStepKind;
  ref?: string | null;
  label: string;
}

export interface WorkflowInput {
  name: string;
  description?: string;
  enabled?: boolean;
  steps?: WorkflowStepInput[];
}

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
  providers: MemoryProvider[];
}

/** One configurable field, exactly as the provider declares it. */
export interface MemoryProviderField {
  key: string;
  label: string;
  /** `text`, `secret`, `select`, … Anything unknown is treated as text. */
  kind: string;
  description: string | null;
  placeholder: string | null;
  required: boolean;
  /** Empty for secrets — Hermes never sends one back. */
  value: string;
  /** Whether a value exists upstream. The only signal a secret gives. */
  isSet: boolean;
  /** Where to get the credential, when the provider says so. */
  url: string | null;
  options: { value: string; label: string }[];
}

export interface MemoryProviderConfig {
  name: string;
  label: string;
  fields: MemoryProviderField[];
}

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
  requiredTotal: number;
  requiredMissing: number;
  envVars: MessagingEnvVar[];
}

export interface MessagingOverview {
  platforms: MessagingPlatform[];
  configuredCount: number;
  enabledCount: number;
}

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

export interface PairedUser {
  platform: string | null;
  userId: string | null;
  userName: string | null;
  at: number | null;
  /** First 8 characters of the code's hash — never the code itself. */
  codeHint: string | null;
  ageMinutes: number | null;
}

export interface PairingOverview {
  pending: PairedUser[];
  approved: PairedUser[];
}

export interface EnvVar {
  key: string;
  isSet: boolean;
  redactedValue: string | null;
  description: string | null;
  url: string | null;
  category: string;
  isPassword: boolean;
  advanced: boolean;
  providerLabel: string | null;
}

export interface ConfigRaw {
  yaml: string;
  path: string | null;
}

export interface CuratorStatus {
  enabled: boolean;
  paused: boolean;
  intervalHours: number | null;
  lastRunAt: number | null;
  staleAfterDays: number | null;
  archiveAfterDays: number | null;
}

export interface UpdateStatus {
  installMethod: string | null;
  currentVersion: string | null;
  behind: number | null;
  updateAvailable: boolean;
  canApply: boolean;
  updateCommand: string | null;
  message: string | null;
}

/**
 * A configurable toolset. No `available` field on purpose — upstream sets it to
 * the same value as `enabled`, so it says nothing about whether the toolset can
 * be switched on. `configured` reports whether its API keys are present.
 */
export interface Toolset {
  name: string;
  label: string;
  description: string | null;
  platformLabel: string | null;
  enabled: boolean;
  configured: boolean;
  tools: string[];
}
