import { z } from 'zod';

/**
 * Schemas and normalisers for the settings surfaces of the Hermes dashboard:
 * environment variables and secrets, the raw config file, the memory curator,
 * the update check, and toolsets. Captured from a real Hermes 0.19.0.
 *
 * Secrets never leave redacted: only whether a variable is set, and the
 * dashboard's own masked preview, ever reach the browser.
 */

function isoToEpochMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// --- Environment variables --------------------------------------------------

export const envSchema = z.record(
  z.string(),
  z.looseObject({
    is_set: z.boolean().nullish(),
    redacted_value: z.string().nullish(),
    description: z.string().nullish(),
    url: z.string().nullish(),
    category: z.string().nullish(),
    is_password: z.boolean().nullish(),
    advanced: z.boolean().nullish(),
    provider_label: z.string().nullish(),
  }),
);

export interface EnvVar {
  key: string;
  isSet: boolean;
  /** The dashboard's own masked preview (e.g. "1111…zzzz"); never the real value. */
  redactedValue: string | null;
  description: string | null;
  url: string | null;
  category: string;
  isPassword: boolean;
  advanced: boolean;
  providerLabel: string | null;
}

export function normalizeEnv(raw: z.infer<typeof envSchema>): EnvVar[] {
  return (
    Object.entries(raw)
      .map(([key, info]) => ({
        key,
        isSet: info.is_set === true,
        redactedValue: info.redacted_value?.trim() || null,
        description: info.description?.trim() || null,
        url: info.url?.trim() || null,
        category: info.category?.trim() || 'sonstige',
        isPassword: info.is_password === true,
        advanced: info.advanced === true,
        providerLabel: info.provider_label?.trim() || null,
      }))
      // Set variables first, then alphabetical, so what is configured leads.
      .sort((a, b) => Number(b.isSet) - Number(a.isSet) || a.key.localeCompare(b.key))
  );
}

// --- Raw config -------------------------------------------------------------

export const configRawSchema = z.looseObject({
  yaml: z.string().nullish(),
  path: z.string().nullish(),
});

export interface ConfigRaw {
  yaml: string;
  path: string | null;
}

export function normalizeConfigRaw(raw: z.infer<typeof configRawSchema>): ConfigRaw {
  return { yaml: raw.yaml ?? '', path: raw.path?.trim() || null };
}

// --- Memory curator ---------------------------------------------------------

export const curatorSchema = z.looseObject({
  enabled: z.boolean().nullish(),
  paused: z.boolean().nullish(),
  interval_hours: z.union([z.number(), z.string()]).nullish(),
  last_run_at: z.string().nullish(),
  min_idle_hours: z.union([z.number(), z.string()]).nullish(),
  stale_after_days: z.union([z.number(), z.string()]).nullish(),
  archive_after_days: z.union([z.number(), z.string()]).nullish(),
});

export interface CuratorStatus {
  enabled: boolean;
  paused: boolean;
  intervalHours: number | null;
  /** Epoch milliseconds; Hermes reports an ISO timestamp. */
  lastRunAt: number | null;
  staleAfterDays: number | null;
  archiveAfterDays: number | null;
}

export function normalizeCurator(raw: z.infer<typeof curatorSchema>): CuratorStatus {
  return {
    enabled: raw.enabled === true,
    paused: raw.paused === true,
    intervalHours: toNumber(raw.interval_hours),
    lastRunAt: isoToEpochMs(raw.last_run_at),
    staleAfterDays: toNumber(raw.stale_after_days),
    archiveAfterDays: toNumber(raw.archive_after_days),
  };
}

// --- Update check -----------------------------------------------------------

export const updateSchema = z.looseObject({
  install_method: z.string().nullish(),
  current_version: z.string().nullish(),
  behind: z.union([z.number(), z.string()]).nullish(),
  update_available: z.boolean().nullish(),
  can_apply: z.boolean().nullish(),
  update_command: z.string().nullish(),
  message: z.string().nullish(),
});

export interface UpdateStatus {
  installMethod: string | null;
  currentVersion: string | null;
  behind: number | null;
  updateAvailable: boolean;
  canApply: boolean;
  updateCommand: string | null;
  message: string | null;
}

export function normalizeUpdate(raw: z.infer<typeof updateSchema>): UpdateStatus {
  return {
    installMethod: raw.install_method?.trim() || null,
    currentVersion: raw.current_version?.trim() || null,
    behind: toNumber(raw.behind),
    updateAvailable: raw.update_available === true,
    canApply: raw.can_apply === true,
    updateCommand: raw.update_command?.trim() || null,
    message: raw.message?.trim() || null,
  };
}

// --- Toolsets ---------------------------------------------------------------

export const toolsetsSchema = z.array(
  z.looseObject({
    name: z.string().nullish(),
    label: z.string().nullish(),
    description: z.string().nullish(),
    platform_label: z.string().nullish(),
    enabled: z.boolean().nullish(),
    configured: z.boolean().nullish(),
    tools: z.array(z.string()).nullish(),
  }),
);

/**
 * A configurable toolset.
 *
 * Hermes also sends an `available` flag, and it is deliberately dropped here:
 * the endpoint assigns `"available": is_enabled` — the same value as `enabled`,
 * not an independent fact (`web_server.py:15819`). Carrying it forward invited
 * reading it as "may be switched on", which locked every toolset off the moment
 * it was switched off. `configured` is the real capability signal: it reports
 * whether the toolset's required API keys are present.
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

export function normalizeToolsets(raw: z.infer<typeof toolsetsSchema>): Toolset[] {
  return raw
    .map((toolset, index) => ({
      name: toolset.name ?? `toolset-${index}`,
      label: toolset.label ?? toolset.name ?? `Werkzeugsatz ${index + 1}`,
      description: toolset.description?.trim() || null,
      platformLabel: toolset.platform_label?.trim() || null,
      enabled: toolset.enabled === true,
      configured: toolset.configured === true,
      tools: toolset.tools ?? [],
    }))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.label.localeCompare(b.label));
}
