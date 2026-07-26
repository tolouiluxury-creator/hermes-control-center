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
}

export interface CronJobSummary {
  id: string;
  name: string;
  schedule: string | null;
  paused: boolean;
  nextRun: number | null;
  lastRun: number | null;
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

export interface SessionSummary {
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  startedAt: number | null;
  messages: number | null;
  endReason: string | null;
}

export interface SessionsResponse {
  total: number | null;
  sessions: SessionSummary[];
}

export interface MemorySummary {
  active: string | null;
  configured: { name: string; status: string | null }[];
  availableCount: number;
  files: { name: string; entries: number }[];
}
