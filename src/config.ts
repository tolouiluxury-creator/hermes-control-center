import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { controlCenterConfigPath } from './paths.js';
import { describeError, log } from './log.js';

/**
 * Our own config file, `~/.hermes-cc/config.json`.
 *
 * It exists mainly for remote Hermes installations: when the agent runs on a
 * server (reached through an SSH tunnel or a VPN), there is no local `~/.hermes`
 * to read the key and ports from. Putting them here means the user never has to
 * pass secrets on a command line, where they would land in shell history.
 */
const authSchema = z.looseObject({
  /** scrypt hash written by `--set-password`; never the password itself. */
  passwordHash: z.string().min(1),
  /** HMAC key for session cookies. Rotating it logs everyone out. */
  sessionSecret: z.string().min(1),
});

const configSchema = z.looseObject({
  hermesApiUrl: z.string().url().nullish(),
  hermesDashboardUrl: z.string().url().nullish(),
  apiKey: z.string().min(1).nullish(),
  profile: z.string().min(1).nullish(),
  port: z.number().int().min(1).max(65535).nullish(),
  host: z.string().min(1).nullish(),
  auth: authSchema.nullish(),
});

export type AuthConfig = z.infer<typeof authSchema>;

export type ControlCenterConfig = z.infer<typeof configSchema>;

export interface LoadedConfig {
  path: string;
  exists: boolean;
  config: ControlCenterConfig;
  /** Problems worth telling the user about; the tool still starts. */
  notes: string[];
}

const EMPTY: ControlCenterConfig = {};

/** The value `--init-config` writes. Treated as "no key", not as a key. */
export const PLACEHOLDER_API_KEY = 'PASTE_YOUR_API_SERVER_KEY_HERE';

/** Never throws: a broken config file must not stop the tool from starting. */
export function loadControlCenterConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const path = controlCenterConfigPath(env);

  if (!existsSync(path)) {
    return { path, exists: false, config: EMPTY, notes: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = `Could not read ${path}: ${describeError(error)}`;
    log.warn(message);
    return { path, exists: true, config: EMPTY, notes: [message] };
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? first.path.join('.') : '(root)';
    const message = `Ignoring ${path}: invalid value at ${where} — ${first?.message ?? 'validation failed'}`;
    log.warn(message);
    return { path, exists: true, config: EMPTY, notes: [message] };
  }

  const notes: string[] = [];
  const config = { ...parsed.data };

  // The template ships a placeholder. Counting it as a real key would make the
  // doctor claim everything is fine right up until the first 401.
  if (config.apiKey === PLACEHOLDER_API_KEY) {
    config.apiKey = null;
    notes.push(`${path} still contains the placeholder API key — replace it with your real key.`);
  }

  return { path, exists: true, config, notes };
}

/** Template written by `--init-config`, with placeholders rather than secrets. */
export const CONFIG_TEMPLATE = {
  $comment:
    'hermes-control-center configuration. Remove any key you do not need — command line flags and environment variables win over this file.',
  hermesApiUrl: 'http://127.0.0.1:8642',
  hermesDashboardUrl: 'http://127.0.0.1:9119',
  apiKey: PLACEHOLDER_API_KEY,
} as const;

export interface InitResult {
  path: string;
  created: boolean;
}

/**
 * Creates the config file if it is absent. Deliberately refuses to overwrite an
 * existing file — it may hold the user's only copy of a key.
 */
export function initControlCenterConfig(env: NodeJS.ProcessEnv = process.env): InitResult {
  const path = controlCenterConfigPath(env);
  if (existsSync(path)) return { path, created: false };

  writeConfigFile(path, CONFIG_TEMPLATE);
  return { path, created: true };
}

function writeConfigFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    // Owner-only where the platform honours it; a no-op on Windows.
    mode: 0o600,
  });
}

/**
 * Merges a patch into the config file, preserving keys we do not know about.
 * Reads the raw JSON rather than the validated shape so an unrelated invalid
 * field cannot silently erase the user's other settings.
 */
export function updateControlCenterConfig(
  patch: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const path = controlCenterConfigPath(env);

  let current: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        current = raw as Record<string, unknown>;
      }
    } catch (error) {
      throw new Error(
        `Refusing to overwrite ${path}: it is not valid JSON (${describeError(error)}). ` +
          'Fix or delete the file, then try again.',
        { cause: error },
      );
    }
  }

  writeConfigFile(path, { ...current, ...patch });
  return path;
}
