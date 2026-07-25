import { parseArgs } from 'node:util';
import type { LogLevel } from './log.js';

export interface CliOptions {
  port: number;
  host: string;
  open: boolean;
  profile: string | null;
  hermesApiUrl: string | null;
  hermesDashboardUrl: string | null;
  apiKey: string | null;
  logLevel: LogLevel;
  mode: 'serve' | 'doctor' | 'help' | 'version';
}

export const DEFAULT_PORT = 7777;
export const DEFAULT_HOST = '127.0.0.1';

export class OptionsError extends Error {}

function toPort(raw: string | undefined, flag: string): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new OptionsError(`${flag} expects a port between 1 and 65535, got "${raw}".`);
  }
  return value;
}

function toUrl(raw: string | undefined, flag: string): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new OptionsError(`${flag} must be an http(s) URL, got "${raw}".`);
    }
  } catch (error) {
    if (error instanceof OptionsError) throw error;
    throw new OptionsError(`${flag} is not a valid URL: "${raw}".`);
  }
  return trimmed;
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function toLogLevel(raw: string | undefined): LogLevel | null {
  if (raw === undefined) return null;
  if (!LOG_LEVELS.includes(raw as LogLevel)) {
    throw new OptionsError(`--log-level expects one of ${LOG_LEVELS.join(', ')}, got "${raw}".`);
  }
  return raw as LogLevel;
}

/**
 * Pure argv parser so the CLI surface is unit-testable. Environment variables
 * act as fallbacks; explicit flags always win.
 */
export function parseOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        port: { type: 'string' },
        host: { type: 'string' },
        'no-open': { type: 'boolean' },
        open: { type: 'boolean' },
        profile: { type: 'string', short: 'p' },
        'hermes-api': { type: 'string' },
        'hermes-dashboard': { type: 'string' },
        'api-key': { type: 'string' },
        'log-level': { type: 'string' },
        doctor: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new OptionsError(error instanceof Error ? error.message : String(error));
  }

  const values = parsed.values;

  const mode: CliOptions['mode'] = values.help
    ? 'help'
    : values.version
      ? 'version'
      : values.doctor
        ? 'doctor'
        : 'serve';

  const port =
    toPort(values.port, '--port') ?? toPort(env.HERMES_CC_PORT, 'HERMES_CC_PORT') ?? DEFAULT_PORT;
  const host = values.host?.trim() || env.HERMES_CC_HOST?.trim() || DEFAULT_HOST;

  // --no-open wins over --open; both default to opening a browser on serve.
  const open = values['no-open'] ? false : values.open !== undefined ? values.open : true;

  return {
    port,
    host,
    open,
    profile: values.profile?.trim() || null,
    hermesApiUrl:
      toUrl(values['hermes-api'], '--hermes-api') ??
      toUrl(env.HERMES_CC_API_URL, 'HERMES_CC_API_URL'),
    hermesDashboardUrl:
      toUrl(values['hermes-dashboard'], '--hermes-dashboard') ??
      toUrl(env.HERMES_CC_DASHBOARD_URL, 'HERMES_CC_DASHBOARD_URL'),
    apiKey: values['api-key']?.trim() || env.HERMES_CC_API_KEY?.trim() || null,
    logLevel: toLogLevel(values['log-level']) ?? 'info',
    mode,
  };
}

export const HELP_TEXT = `
  hermes-control-center — dashboard-first web cockpit for Hermes Agent

  Usage
    $ hermes-control-center [options]

  Options
    --port <n>               Port to listen on (default ${DEFAULT_PORT}, next free port if taken)
    --host <addr>            Bind address (default ${DEFAULT_HOST})
    --no-open                Do not open a browser on start
    -p, --profile <name>     Hermes profile to scope requests to
    --hermes-api <url>       Override Hermes API server URL (default http://127.0.0.1:8642)
    --hermes-dashboard <url> Override Hermes dashboard URL (default http://127.0.0.1:9119)
    --api-key <key>          Hermes API_SERVER_KEY (auto-detected from ~/.hermes/.env)
    --log-level <level>      debug | info | warn | error (default info)
    --doctor                 Check the Hermes connection and exit
    -h, --help               Show this help
    -v, --version            Show version

  Environment
    HERMES_HOME              Hermes state directory (auto-detected)
    HERMES_CC_HOME           Control center state directory (default ~/.hermes-cc)
    HERMES_CC_PORT           Same as --port
    HERMES_CC_HOST           Same as --host
    HERMES_CC_API_KEY        Same as --api-key
`.trimStart();
