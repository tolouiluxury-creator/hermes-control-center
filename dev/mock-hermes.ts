/**
 * Development fixture: a fake Hermes Agent.
 *
 * It serves both HTTP surfaces the control center talks to, so the UI and the
 * upstream clients can be developed and tested without a real agent installed.
 *
 *   node --experimental-strip-types dev/mock-hermes.ts     (or: npm run mock:hermes)
 *
 * Payload shapes are copied from a real Hermes 0.19.0, not from the docs — the
 * two differ. In particular the dashboard guards its API with a session token
 * injected into the HTML shell, which the mock reproduces so the bootstrap path
 * is exercised locally rather than only against a live server.
 *
 * This file is NOT part of the published package.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const API_PORT = Number(process.env.MOCK_API_PORT ?? 8642);
const DASHBOARD_PORT = Number(process.env.MOCK_DASHBOARD_PORT ?? 9119);
const API_KEY = process.env.MOCK_API_KEY ?? 'mock-key';
/** Set MOCK_REQUIRE_AUTH=0 to exercise the "no key needed" path. */
const REQUIRE_AUTH = process.env.MOCK_REQUIRE_AUTH !== '0';

const startedAt = Date.now();

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => void | Promise<void>;

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

/** Slow drift so charts show movement instead of a flat line. */
function wobble(base: number, spread: number, periodMs: number, offset = 0): number {
  const phase = ((Date.now() + offset) % periodMs) / periodMs;
  return Math.round((base + Math.sin(phase * Math.PI * 2) * spread) * 10) / 10;
}

function authorized(request: IncomingMessage): boolean {
  if (!REQUIRE_AUTH) return true;
  return request.headers.authorization === `Bearer ${API_KEY}`;
}

// --------------------------------------------------------------------------
// API server (default :8642)
// --------------------------------------------------------------------------

const apiRoutes: Record<string, Handler> = {
  'GET /health': (_request, response) => json(response, 200, { status: 'ok' }),
  'GET /v1/health': (_request, response) => json(response, 200, { status: 'ok' }),

  'GET /health/detailed': (request, response) => {
    if (!authorized(request)) return json(response, 401, { error: 'unauthorized' });
    json(response, 200, {
      status: 'ok',
      readiness: {
        status: 'ready',
        checks: {
          profile_config: 'ok',
          database: 'ok',
          model: 'ok',
          disk: { status: 'ok', detail: '62% used' },
          gateway: 'ok',
          browser: 'ok',
          scheduler: 'ok',
          telegram: 'degraded',
        },
      },
      active_runs: 2,
      pending_processes: 0,
      delegations: 1,
    });
  },

  'GET /v1/capabilities': (request, response) => {
    if (!authorized(request)) return json(response, 401, { error: 'unauthorized' });
    json(response, 200, {
      object: 'hermes.api_server.capabilities',
      platform: 'hermes-agent',
      version: '0.7.4',
      features: {
        chat_completions: true,
        responses_api: true,
        run_submission: true,
        sessions_api: true,
        jobs_api: true,
        session_key_header: 'X-Hermes-Session-Key',
      },
      endpoints: {
        chat_completions: '/v1/chat/completions',
        responses: '/v1/responses',
        runs: '/v1/runs',
        sessions: '/api/sessions',
        jobs: '/api/jobs',
        skills: '/v1/skills',
        toolsets: '/v1/toolsets',
      },
    });
  },

  'GET /v1/models': (request, response) => {
    if (!authorized(request)) return json(response, 401, { error: 'unauthorized' });
    json(response, 200, {
      object: 'list',
      data: [{ id: 'hermes-agent', object: 'model', owned_by: 'nousresearch' }],
    });
  },
};

// --------------------------------------------------------------------------
// Dashboard backend (default :9119)
// --------------------------------------------------------------------------

/**
 * Regenerated on every mock start, exactly like the real dashboard does — that
 * is what makes a stale token a realistic failure to develop against.
 */
const SESSION_TOKEN = randomBytes(32).toString('base64url');

const DASHBOARD_SHELL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Hermes Agent - Dashboard</title>
<script>window.__HERMES_SESSION_TOKEN__="${SESSION_TOKEN}";window.__HERMES_BASE_PATH__="";window.__HERMES_AUTH_REQUIRED__=false;</script>
</head><body><div id="root">Mock dashboard</div></body></html>`;

/** The dashboard accepts its session token as a bearer or a custom header. */
function dashboardAuthorized(request: IncomingMessage): boolean {
  const header = request.headers.authorization;
  if (header === `Bearer ${SESSION_TOKEN}`) return true;
  return request.headers['x-hermes-session-token'] === SESSION_TOKEN;
}

function guarded(handler: Handler): Handler {
  return (request, response, url) => {
    if (!dashboardAuthorized(request)) {
      return json(response, 401, { detail: 'Unauthorized' });
    }
    return handler(request, response, url);
  };
}

const dashboardRoutes: Record<string, Handler> = {
  'GET /': (_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(DASHBOARD_SHELL);
  },

  // Open without a token, exactly like the real dashboard: this is what the
  // reachability probe uses.
  'GET /api/status': (_request, response, url) =>
    json(response, 200, {
      version: '0.19.0',
      release_date: '2026.7.20',
      config_version: 33,
      latest_config_version: 33,
      gateway_running: true,
      gateway_state: 'running',
      gateway_exit_reason: null,
      gateway_platforms: {},
      active_agents: 0,
      active_sessions: 3,
      auth_required: false,
      components: {
        gateway: { status: 'ok', state: 'running' },
        dashboard: { status: 'ok', recent_unhandled_errors: 0, selftest: 'ok' },
        storage: { status: 'ok' },
        platforms: { status: 'ok', configured: 2, connected: 2 },
      },
      overall: 'ok',
      profiles: url.searchParams.get('profile')
        ? [url.searchParams.get('profile') as string]
        : ['default', 'sunrise'],
      hermes_home: '/root/.hermes',
      config_path: '/root/.hermes/config.yaml',
      env_path: '/root/.hermes/.env',
    }),

  'GET /api/system/stats': guarded((_request, response) => {
    const memoryTotal = 8_267_022_336;
    const memoryPercent = wobble(41, 8, 90_000);
    return json(response, 200, {
      os: 'Linux',
      os_release: '6.8.0-136-generic',
      arch: 'x86_64',
      hostname: 'mock-host',
      hermes_version: '0.19.0',
      cpu_count: 6,
      cpu_percent: wobble(17, 12, 60_000),
      memory: {
        total: memoryTotal,
        available: Math.round(memoryTotal * (1 - memoryPercent / 100)),
        used: Math.round(memoryTotal * (memoryPercent / 100)),
        percent: memoryPercent,
      },
      disk: { total: 248_505_155_584, used: 19_128_717_312, free: 229_376_438_272, percent: 7.7 },
      load_avg: [0.21, 0.2, 0.18],
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000) + 610_000,
      process: { pid: process.pid, rss: 302_407_680, num_threads: 11 },
      psutil: true,
    });
  }),

  'GET /api/sessions/stats': guarded((_request, response) =>
    json(response, 200, {
      total: 57,
      active_store: 57,
      archived: 0,
      messages: 3287,
      by_source: { cli: 21, webui: 14, cron: 10, telegram: 1 },
    }),
  ),
};

// --------------------------------------------------------------------------

function makeServer(name: string, routes: Record<string, Handler>) {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const key = `${request.method ?? 'GET'} ${url.pathname}`;
    const handler = routes[key];

    process.stdout.write(`  ${name}  ${key}${handler ? '' : '  (unhandled)'}\n`);

    if (!handler) {
      return json(response, 404, {
        error: 'not_found',
        detail: `${key} is not implemented by the mock yet.`,
      });
    }

    void Promise.resolve(handler(request, response, url)).catch((error: unknown) => {
      json(response, 500, { error: 'mock_failure', detail: String(error) });
    });
  });
}

makeServer('api      ', apiRoutes).listen(API_PORT, '127.0.0.1', () => {
  process.stdout.write(`Mock Hermes API server   http://127.0.0.1:${API_PORT}\n`);
  process.stdout.write(`  bearer key: ${REQUIRE_AUTH ? API_KEY : '(auth disabled)'}\n`);
});

makeServer('dashboard', dashboardRoutes).listen(DASHBOARD_PORT, '127.0.0.1', () => {
  process.stdout.write(`Mock Hermes dashboard    http://127.0.0.1:${DASHBOARD_PORT}\n`);
  process.stdout.write(`  session token served in the HTML shell at /\n\n`);
});
