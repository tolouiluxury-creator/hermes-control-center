/**
 * Development fixture: a fake Hermes Agent.
 *
 * It serves both HTTP surfaces the control center talks to, with payload shapes
 * taken from the official Hermes documentation, so the UI and the upstream
 * clients can be developed and tested without a real agent installed.
 *
 *   node --experimental-strip-types dev/mock-hermes.ts     (or: npm run mock:hermes)
 *
 * This file is NOT part of the published package.
 */
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

const dashboardRoutes: Record<string, Handler> = {
  'GET /api/status': (_request, response, url) =>
    json(response, 200, {
      version: '0.7.4',
      profile: url.searchParams.get('profile') ?? 'default',
      gateway: { running: true, status: 'running', pid: 4242 },
      platforms: {
        telegram: { enabled: true, connected: true },
        discord: { enabled: true, connected: true },
        slack: { enabled: false, connected: false },
      },
      active_sessions: 3,
      model: { provider: 'nous-portal', name: 'Hermes-4-405B' },
    }),

  'GET /api/system/stats': (_request, response) =>
    json(response, 200, {
      os: 'Ubuntu 24.04 LTS',
      cpu_percent: wobble(23, 12, 60_000),
      cpu_count: 12,
      memory_percent: wobble(46, 8, 90_000),
      memory_total: 34_359_738_368,
      memory_used: Math.round(34_359_738_368 * (wobble(46, 8, 90_000) / 100)),
      disk_percent: 62,
      disk_total: 2_199_023_255_552,
      disk_used: 1_363_396_418_437,
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000) + 453_600,
    }),
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
  process.stdout.write(`Mock Hermes dashboard    http://127.0.0.1:${DASHBOARD_PORT}\n\n`);
});
