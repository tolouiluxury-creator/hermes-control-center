import { existsSync } from 'node:fs';
import pc from 'picocolors';
import type { CliOptions } from './options.js';
import { controlCenterHome, hermesHome } from './paths.js';
import { log, describeError } from './log.js';
import {
  API_HEALTH_PATH,
  DASHBOARD_STATUS_PATH,
  DEFAULT_API_SERVER_URL,
  DEFAULT_DASHBOARD_URL,
} from './hermes/endpoints.js';

export interface ProbeResult {
  name: string;
  url: string;
  reachable: boolean;
  status: number | null;
  detail: string;
  /** Fix instructions shown when the probe fails. */
  remedy: string[];
}

const PROBE_TIMEOUT_MS = 2500;

async function probe(name: string, url: string, remedy: string[]): Promise<ProbeResult> {
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
    };
  } catch (error) {
    return {
      name,
      url,
      reachable: false,
      status: null,
      detail: describeError(error),
      remedy,
    };
  }
}

export async function probeUpstreams(options: CliOptions): Promise<ProbeResult[]> {
  const apiBase = options.hermesApiUrl ?? DEFAULT_API_SERVER_URL;
  const dashboardBase = options.hermesDashboardUrl ?? DEFAULT_DASHBOARD_URL;

  return Promise.all([
    probe('Hermes API server', `${apiBase}${API_HEALTH_PATH}`, [
      'Add to ~/.hermes/.env:  API_SERVER_ENABLED=true',
      'Add to ~/.hermes/.env:  API_SERVER_KEY=<a-long-random-string>',
      'Then start it:          hermes gateway',
    ]),
    probe('Hermes dashboard', `${dashboardBase}${DASHBOARD_STATUS_PATH}`, [
      'Install the web extra:  cd ~/.hermes/hermes-agent && uv pip install -e ".[web]"',
      'Then start it:          hermes dashboard --no-open',
    ]),
  ]);
}

/** Prints a human-readable report. Returns a process exit code. */
export async function runDoctor(options: CliOptions): Promise<number> {
  log.plain();
  log.heading('hermes-control-center doctor');
  log.plain();

  const home = hermesHome();
  const homeExists = existsSync(home);
  if (homeExists) {
    log.ok(`Hermes home: ${home}`);
  } else {
    log.warn(`Hermes home not found: ${home}`);
    log.plain(`     Set HERMES_HOME if your installation lives elsewhere.`);
  }
  log.ok(`Control center state: ${controlCenterHome()}`);
  if (options.profile) log.info(`Profile: ${options.profile}`);
  log.plain();

  const results = await probeUpstreams(options);
  for (const result of results) {
    if (result.reachable) {
      log.ok(`${result.name} — ${result.detail}  ${pc.dim(result.url)}`);
    } else {
      log.error(`${result.name} — ${result.detail}  ${pc.dim(result.url)}`);
      for (const line of result.remedy) log.plain(`     ${pc.dim(line)}`);
    }
  }
  log.plain();

  const failures = results.filter((result) => !result.reachable);
  if (failures.length === 0) {
    log.ok('Both Hermes surfaces are reachable.');
    log.plain();
    return 0;
  }

  log.warn(
    `${failures.length} of ${results.length} Hermes surfaces unreachable. ` +
      'The control center still starts and shows a setup screen.',
  );
  log.plain();
  return 1;
}
