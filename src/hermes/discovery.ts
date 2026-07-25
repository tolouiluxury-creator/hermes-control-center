import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CliOptions } from '../options.js';
import { loadControlCenterConfig, type LoadedConfig } from '../config.js';
import { hermesHome, hermesProfileHome } from '../paths.js';
import { asBoolean, asPort, readDotEnv } from './env.js';
import {
  DEFAULT_API_SERVER_PORT,
  DEFAULT_API_SERVER_URL,
  DEFAULT_DASHBOARD_PORT,
  DEFAULT_DASHBOARD_URL,
} from './endpoints.js';

/** Where a resolved value came from — surfaced in the UI so setup is debuggable. */
export type ValueSource = 'flag' | 'env' | 'cc-config' | 'profile-config' | 'config' | 'default';

export interface UpstreamTarget {
  url: string;
  source: ValueSource;
}

export interface HermesConnection {
  hermesHome: string;
  homeExists: boolean;
  profile: string | null;
  /** Profile names found under <hermesHome>/profiles. */
  profiles: string[];
  /** Path of our own config file, shown in setup guidance. */
  configPath: string;
  /** True when our config file supplies the connection — i.e. Hermes runs elsewhere. */
  configuredRemotely: boolean;
  apiServer: UpstreamTarget & {
    key: string | null;
    keySource: ValueSource | null;
    /** Whether Hermes' own config says the API server is switched on. */
    enabled: boolean | null;
  };
  dashboard: UpstreamTarget;
  warnings: string[];
}

interface HermesConfigFile {
  gateway?: {
    api_server?: {
      enabled?: unknown;
      port?: unknown;
      host?: unknown;
      key?: unknown;
    };
    platforms?: {
      api_server?: {
        enabled?: unknown;
        port?: unknown;
        host?: unknown;
        key?: unknown;
      };
    };
  };
}

function readConfigYaml(dir: string, warnings: string[]): HermesConfigFile {
  const path = join(dir, 'config.yaml');
  if (!existsSync(path)) return {};
  try {
    const parsed = parseYaml(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as HermesConfigFile) : {};
  } catch (error) {
    warnings.push(
      `Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
}

/**
 * Hermes has moved the api_server block between `gateway.api_server` and
 * `gateway.platforms.api_server` across versions, so read both.
 */
function apiServerConfig(config: HermesConfigFile) {
  return config.gateway?.api_server ?? config.gateway?.platforms?.api_server ?? {};
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function buildUrl(host: string, port: number): string {
  // 0.0.0.0 means "all interfaces" on the server side; we still connect via loopback.
  const target = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const bracketed = target.includes(':') && !target.startsWith('[') ? `[${target}]` : target;
  return `http://${bracketed}:${port}`;
}

function listProfiles(home: string): string[] {
  const dir = join(home, 'profiles');
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Works out how to reach Hermes, in this precedence order: explicit CLI flags,
 * our own process environment, the profile's config, then the root config,
 * then documented defaults. Never throws — an unreachable Hermes is a UI state,
 * not a startup failure.
 */
export function discoverHermes(
  options: CliOptions,
  env: NodeJS.ProcessEnv = process.env,
  loadedConfig: LoadedConfig = loadControlCenterConfig(env),
): HermesConnection {
  const warnings: string[] = [];
  const fileConfig = loadedConfig.config;
  const home = hermesHome(env);
  const homeExists = existsSync(home);

  // A config file that supplies the connection details is the normal shape for a
  // remote Hermes (SSH tunnel, VPN), where no local ~/.hermes exists at all.
  const configuredRemotely = Boolean(
    fileConfig.apiKey ?? fileConfig.hermesApiUrl ?? fileConfig.hermesDashboardUrl,
  );

  warnings.push(...loadedConfig.notes);

  if (!homeExists && !configuredRemotely) {
    warnings.push(
      `Hermes home not found at ${home}. Set HERMES_HOME if your installation lives elsewhere, ` +
        `or put the connection details in ${loadedConfig.path} for a remote Hermes.`,
    );
  }

  const profile = options.profile ?? fileConfig.profile ?? null;

  const rootEnv = readDotEnv(join(home, '.env'));
  const rootConfig = readConfigYaml(home, warnings);

  const profileDir = profile ? hermesProfileHome(profile, env) : null;
  if (profileDir && !existsSync(profileDir) && homeExists) {
    warnings.push(`Profile "${profile}" not found at ${profileDir}.`);
  }
  const profileEnv = profileDir ? readDotEnv(join(profileDir, '.env')) : {};
  const profileConfig = profileDir ? readConfigYaml(profileDir, warnings) : {};

  const rootApi = apiServerConfig(rootConfig);
  const profileApi = apiServerConfig(profileConfig);

  // --- API server URL -----------------------------------------------------
  let apiUrl: string;
  let apiSource: ValueSource;

  if (options.hermesApiUrl) {
    apiUrl = options.hermesApiUrl;
    apiSource = 'flag';
  } else if (fileConfig.hermesApiUrl) {
    apiUrl = fileConfig.hermesApiUrl.replace(/\/+$/, '');
    apiSource = 'cc-config';
  } else {
    const portFromProfileEnv = asPort(profileEnv.API_SERVER_PORT);
    const portFromRootEnv = asPort(rootEnv.API_SERVER_PORT ?? env.API_SERVER_PORT);
    const portFromProfileConfig = asPort(profileApi.port as string | number | undefined);
    const portFromRootConfig = asPort(rootApi.port as string | number | undefined);

    const hostFromProfileEnv = asNonEmptyString(profileEnv.API_SERVER_HOST);
    const hostFromRootEnv = asNonEmptyString(rootEnv.API_SERVER_HOST ?? env.API_SERVER_HOST);
    const hostFromProfileConfig = asNonEmptyString(profileApi.host);
    const hostFromRootConfig = asNonEmptyString(rootApi.host);

    if (
      portFromProfileEnv ??
      hostFromProfileEnv ??
      portFromProfileConfig ??
      hostFromProfileConfig
    ) {
      apiSource = 'profile-config';
    } else if (portFromRootEnv ?? hostFromRootEnv) {
      apiSource = 'env';
    } else if (portFromRootConfig ?? hostFromRootConfig) {
      apiSource = 'config';
    } else {
      apiSource = 'default';
    }

    const port =
      portFromProfileEnv ??
      portFromProfileConfig ??
      portFromRootEnv ??
      portFromRootConfig ??
      DEFAULT_API_SERVER_PORT;
    const host =
      hostFromProfileEnv ??
      hostFromProfileConfig ??
      hostFromRootEnv ??
      hostFromRootConfig ??
      '127.0.0.1';

    apiUrl = apiSource === 'default' ? DEFAULT_API_SERVER_URL : buildUrl(host, port);
  }

  // --- API server key -----------------------------------------------------
  let key: string | null = null;
  let keySource: ValueSource | null = null;

  if (options.apiKey) {
    key = options.apiKey;
    keySource = 'flag';
  } else if (fileConfig.apiKey) {
    key = fileConfig.apiKey;
    keySource = 'cc-config';
  } else if (asNonEmptyString(profileEnv.API_SERVER_KEY)) {
    key = asNonEmptyString(profileEnv.API_SERVER_KEY);
    keySource = 'profile-config';
  } else if (asNonEmptyString(rootEnv.API_SERVER_KEY)) {
    key = asNonEmptyString(rootEnv.API_SERVER_KEY);
    keySource = 'config';
  } else if (asNonEmptyString(env.API_SERVER_KEY)) {
    key = asNonEmptyString(env.API_SERVER_KEY);
    keySource = 'env';
  } else if (asNonEmptyString(profileApi.key) ?? asNonEmptyString(rootApi.key)) {
    key = asNonEmptyString(profileApi.key) ?? asNonEmptyString(rootApi.key);
    keySource = 'config';
  }

  const enabled =
    asBoolean(profileEnv.API_SERVER_ENABLED) ??
    asBoolean(rootEnv.API_SERVER_ENABLED) ??
    asBoolean(env.API_SERVER_ENABLED) ??
    (typeof profileApi.enabled === 'boolean' ? profileApi.enabled : null) ??
    (typeof rootApi.enabled === 'boolean' ? rootApi.enabled : null);

  if (enabled === false) {
    warnings.push(
      'Hermes reports API_SERVER_ENABLED=false. Chat, sessions and runs stay unavailable until it is enabled.',
    );
  }
  if (!key) {
    warnings.push(
      `No API_SERVER_KEY found. Put it in ${loadedConfig.path} as "apiKey", or in ~/.hermes/.env, ` +
        'to reach the Hermes API server.',
    );
  }

  // --- Dashboard URL ------------------------------------------------------
  let dashboardUrl: string;
  let dashboardSource: ValueSource;

  if (options.hermesDashboardUrl) {
    dashboardUrl = options.hermesDashboardUrl;
    dashboardSource = 'flag';
  } else if (fileConfig.hermesDashboardUrl) {
    dashboardUrl = fileConfig.hermesDashboardUrl.replace(/\/+$/, '');
    dashboardSource = 'cc-config';
  } else {
    const port = asPort(env.HERMES_DASHBOARD_PORT);
    const host = asNonEmptyString(env.HERMES_DASHBOARD_HOST);
    if (port ?? host) {
      dashboardUrl = buildUrl(host ?? '127.0.0.1', port ?? DEFAULT_DASHBOARD_PORT);
      dashboardSource = 'env';
    } else {
      dashboardUrl = DEFAULT_DASHBOARD_URL;
      dashboardSource = 'default';
    }
  }

  return {
    hermesHome: home,
    homeExists,
    profile,
    profiles: listProfiles(home),
    configPath: loadedConfig.path,
    configuredRemotely,
    apiServer: { url: apiUrl, source: apiSource, key, keySource, enabled },
    dashboard: { url: dashboardUrl, source: dashboardSource },
    warnings,
  };
}

/** Connection info with every secret stripped — safe to send to the browser. */
export interface PublicHermesConnection {
  hermesHome: string;
  homeExists: boolean;
  profile: string | null;
  profiles: string[];
  configPath: string;
  configuredRemotely: boolean;
  apiServer: {
    url: string;
    source: ValueSource;
    hasKey: boolean;
    keySource: ValueSource | null;
    enabled: boolean | null;
  };
  dashboard: UpstreamTarget;
  warnings: string[];
}

export function toPublicConnection(connection: HermesConnection): PublicHermesConnection {
  return {
    hermesHome: connection.hermesHome,
    homeExists: connection.homeExists,
    profile: connection.profile,
    profiles: connection.profiles,
    configPath: connection.configPath,
    configuredRemotely: connection.configuredRemotely,
    apiServer: {
      url: connection.apiServer.url,
      source: connection.apiServer.source,
      hasKey: connection.apiServer.key !== null,
      keySource: connection.apiServer.keySource,
      enabled: connection.apiServer.enabled,
    },
    dashboard: connection.dashboard,
    warnings: connection.warnings,
  };
}
