import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.js';
import { UpstreamError } from '../hermes/client.js';

/**
 * Read-only projections of the Hermes dashboard's inventory and telemetry.
 *
 * Each route normalises upstream data into the small shape a widget needs, so
 * the browser never sees a raw Hermes payload and a version difference is
 * absorbed here rather than in a component.
 *
 * Responses are cached briefly: several widgets on one dashboard ask for the
 * same thing, and a page load should not become a burst of upstream requests.
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

class ResponseCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly ttlMs: number) {}

  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) return cached.value as T;

    // Single-flight: three widgets mounting at once must cause one upstream call.
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = load()
      .then((value) => {
        this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }
}

const CACHE_TTL_MS = 5000;

function readLimit(value: unknown, fallback: number, max: number): number {
  const parsed =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

export async function registerInventoryRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  const cache = new ResponseCache(CACHE_TTL_MS);

  /** Turns an upstream failure into an honest status instead of a blank 500. */
  const guard = async <T>(reply: FastifyReply, work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof UpstreamError) {
        void reply.code(error.clientStatus).send(error.toJSON());
        return undefined;
      }
      throw error;
    }
  };

  app.get('/api/hermes/skills', async (_request, reply) =>
    guard(reply, () => cache.get('skills', () => ctx.dashboard.skills())),
  );

  app.get('/api/hermes/mcp', async (_request, reply) =>
    guard(reply, () => cache.get('mcp', () => ctx.dashboard.mcpServers())),
  );

  app.get('/api/hermes/cron', async (_request, reply) =>
    guard(reply, () => cache.get('cron', () => ctx.dashboard.cronJobs())),
  );

  app.get('/api/hermes/model', async (_request, reply) =>
    guard(reply, () => cache.get('model', () => ctx.dashboard.modelInfo())),
  );

  app.get('/api/hermes/analytics', async (_request, reply) =>
    guard(reply, () => cache.get('analytics', () => ctx.dashboard.analytics())),
  );

  app.get('/api/hermes/memory', async (_request, reply) =>
    guard(reply, () => cache.get('memory', () => ctx.dashboard.memory())),
  );

  app.get('/api/hermes/logs', async (request, reply) => {
    const query = request.query as { lines?: string } | undefined;
    const lines = readLimit(query?.lines, 100, 1000);
    return guard(reply, () => cache.get(`logs:${lines}`, () => ctx.dashboard.logs(lines)));
  });

  app.get('/api/hermes/sessions', async (request, reply) => {
    const query = request.query as { limit?: string } | undefined;
    const limit = readLimit(query?.limit, 10, 100);
    return guard(reply, () => cache.get(`sessions:${limit}`, () => ctx.dashboard.sessions(limit)));
  });
}
