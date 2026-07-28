import pc from 'picocolors';
import type { CliOptions } from './options.js';
import { controlCenterHome } from './paths.js';
import { log } from './log.js';
import { discoverHermes, type HermesConnection, type ValueSource } from './hermes/discovery.js';
import { API_HEALTH_PATH, DASHBOARD_STATUS_PATH } from './hermes/endpoints.js';
import { describeError } from './log.js';

export interface ProbeResult {
  name: string;
  url: string;
  reachable: boolean;
  status: number | null;
  detail: string;
  remedy: string[];
  /** False for surfaces the control center works fine without. */
  required: boolean;
}

const PROBE_TIMEOUT_MS = 2500;

/*
 * Optional, and genuinely so: nothing in the control center calls the API
 * server. Chat included — that runs over the dashboard's own WebSocket. These
 * lines are for someone who wants it for something else, not a fix-this list.
 */
const API_REMEDY = [
  'Optional — nothing in the control center needs it. To enable it anyway:',
  'Add to ~/.hermes/.env:  API_SERVER_ENABLED=true',
  'Add to ~/.hermes/.env:  API_SERVER_KEY=<a-long-random-string>',
  'Then start it:          hermes gateway',
];

const DASHBOARD_REMEDY = [
  'Install the web extra:  cd ~/.hermes/hermes-agent && uv pip install -e ".[web]"',
  'Then start it:          hermes dashboard --no-open',
];

async function probe(
  name: string,
  url: string,
  remedy: string[],
  required: boolean,
): Promise<ProbeResult> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    return {
      name,
      url,
      reachable: response.ok,
      status: response.status,
      detail: response.ok ? 'responding' : `HTTP ${response.status}`,
      remedy: response.ok ? [] : remedy,
      required,
    };
  } catch (error) {
    return {
      name,
      url,
      reachable: false,
      status: null,
      detail: describeError(error),
      remedy,
      required,
    };
  }
}

export async function probeUpstreams(connection: HermesConnection): Promise<ProbeResult[]> {
  return Promise.all([
    probe(
      'Hermes dashboard',
      `${connection.dashboard.url}${DASHBOARD_STATUS_PATH}`,
      DASHBOARD_REMEDY,
      true,
    ),
    probe('Hermes API server', `${connection.apiServer.url}${API_HEALTH_PATH}`, API_REMEDY, false),
  ]);
}

function describeSource(source: ValueSource | null): string {
  switch (source) {
    case 'flag':
      return 'from command line';
    case 'env':
      return 'from environment';
    case 'cc-config':
      return 'from control center config';
    case 'profile-config':
      return 'from profile config';
    case 'config':
      return 'from Hermes config';
    case 'default':
      return 'default';
    default:
      return 'not set';
  }
}

/** Prints a human-readable report. Returns a process exit code. */
export async function runDoctor(options: CliOptions): Promise<number> {
  log.plain();
  log.heading('  hermes-control-center doctor');
  log.plain();

  const connection = discoverHermes(options);

  if (connection.homeExists) {
    log.ok(`Hermes home: ${connection.hermesHome}`);
  } else if (connection.configuredRemotely) {
    // Expected for a remote agent reached over an SSH tunnel or a VPN.
    log.info(`No local Hermes home — using the connection from ${connection.configPath}`);
  } else {
    log.error(`Hermes home not found: ${connection.hermesHome}`);
    log.plain(`     ${pc.dim('Set HERMES_HOME if your installation lives elsewhere,')}`);
    log.plain(`     ${pc.dim('or run --init-config for a Hermes on another machine.')}`);
  }
  log.ok(`Control center state: ${controlCenterHome()}`);

  if (connection.profiles.length > 0) {
    log.info(`Profiles found: ${connection.profiles.join(', ')}`);
  }
  if (options.profile) {
    log.info(`Using profile: ${options.profile}`);
  }

  log.plain();
  log.plain(
    `  ${pc.dim('API server URL')}   ${connection.apiServer.url} ${pc.dim(`(${describeSource(connection.apiServer.source)})`)}`,
  );
  log.plain(
    `  ${pc.dim('Dashboard URL')}    ${connection.dashboard.url} ${pc.dim(`(${describeSource(connection.dashboard.source)})`)}`,
  );
  log.plain(
    // Not red when absent: both belong to the optional API server.
    `  ${pc.dim('API key')}          ${
      connection.apiServer.key
        ? pc.green(`present ${pc.dim(`(${describeSource(connection.apiServer.keySource)})`)}`)
        : pc.dim('not set')
    }`,
  );
  log.plain(
    `  ${pc.dim('API enabled flag')} ${
      connection.apiServer.enabled === null
        ? pc.dim('unknown')
        : connection.apiServer.enabled
          ? pc.green('true')
          : pc.dim('false')
    }`,
  );
  log.plain();

  for (const warning of connection.warnings) {
    if (!warning.includes('Hermes home not found')) log.warn(warning);
  }
  if (connection.warnings.length > 0) log.plain();

  const results = await probeUpstreams(connection);
  for (const result of results) {
    if (result.reachable) {
      log.ok(`${result.name} — ${result.detail}  ${pc.dim(result.url)}`);
    } else if (result.required) {
      log.error(`${result.name} — ${result.detail}  ${pc.dim(result.url)}`);
      for (const line of result.remedy) log.plain(`     ${pc.dim(line)}`);
    } else {
      // Not a failure: reporting an optional surface with a red cross trains
      // people to ignore the report, and this one is unreachable by default.
      log.info(`${result.name} — ${result.detail} ${pc.dim('(optional)')}  ${pc.dim(result.url)}`);
      for (const line of result.remedy) log.plain(`     ${pc.dim(line)}`);
    }
  }
  log.plain();

  const failures = results.filter((result) => !result.reachable && result.required);

  if (failures.length === 0) {
    log.ok('Everything the control center needs is reachable.');
    log.plain();
    return 0;
  }

  log.warn(
    `${failures.length} required Hermes surface${failures.length === 1 ? '' : 's'} unreachable. ` +
      'The control center still starts and shows a setup screen.',
  );
  log.plain();
  return 1;
}
