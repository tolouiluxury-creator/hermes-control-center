import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.js';
import { UpstreamError } from '../hermes/client.js';
import { CACHE_KEYS, sessionsCacheKey, type ResponseCache } from './cache.js';

/**
 * Read-only projections of the Hermes dashboard's inventory and telemetry.
 *
 * Each route normalises upstream data into the small shape a widget needs, so
 * the browser never sees a raw Hermes payload and a version difference is
 * absorbed here rather than in a component.
 *
 * Responses are cached briefly (see {@link ResponseCache}): several widgets on
 * one dashboard ask for the same thing, and a page load should not become a
 * burst of upstream requests. The cache is shared with the action routes, which
 * invalidate the keys a write touches.
 */

function readLimit(value: unknown, fallback: number, max: number): number {
  const parsed =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

export async function registerInventoryRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  cache: ResponseCache,
): Promise<void> {
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
    guard(reply, () => cache.get(CACHE_KEYS.skills, () => ctx.dashboard.skills())),
  );

  /** The full list backing the skills page; the widget uses the summary above. */
  app.get('/api/hermes/skills/list', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.skillList, () => ctx.dashboard.skillList())),
  );

  app.get('/api/hermes/models', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.models, () => ctx.dashboard.modelOptions())),
  );

  app.get('/api/hermes/profiles', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.profiles, () => ctx.dashboard.profiles())),
  );

  app.get('/api/hermes/mcp', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.mcp, () => ctx.dashboard.mcpServers())),
  );

  app.get('/api/hermes/cron', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.cron, () => ctx.dashboard.cronJobs())),
  );

  app.get('/api/hermes/model', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.model, () => ctx.dashboard.modelInfo())),
  );

  app.get('/api/hermes/analytics', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.analytics, () => ctx.dashboard.analytics())),
  );

  app.get('/api/hermes/memory', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.memory, () => ctx.dashboard.memory())),
  );

  app.get('/api/hermes/messaging', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.messaging, () => ctx.dashboard.messagingPlatforms())),
  );

  app.get('/api/hermes/webhooks', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.webhooks, () => ctx.dashboard.webhooks())),
  );

  app.get('/api/hermes/pairing', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.pairing, () => ctx.dashboard.pairing())),
  );

  app.get('/api/hermes/env', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.env, () => ctx.dashboard.env())),
  );

  app.get('/api/hermes/config/raw', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.configRaw, () => ctx.dashboard.configRaw())),
  );

  app.get('/api/hermes/curator', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.curator, () => ctx.dashboard.curator())),
  );

  app.get('/api/hermes/update', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.update, () => ctx.dashboard.updateCheck())),
  );

  app.get('/api/hermes/toolsets', async (_request, reply) =>
    guard(reply, () => cache.get(CACHE_KEYS.toolsets, () => ctx.dashboard.toolsets())),
  );

  app.get('/api/hermes/logs', async (request, reply) => {
    const query = request.query as { lines?: string } | undefined;
    const lines = readLimit(query?.lines, 100, 1000);
    return guard(reply, () => cache.get(`logs:${lines}`, () => ctx.dashboard.logs(lines)));
  });

  app.get('/api/hermes/sessions', async (request, reply) => {
    const query = request.query as { limit?: string } | undefined;
    const limit = readLimit(query?.limit, 10, 100);
    return guard(reply, () =>
      cache.get(sessionsCacheKey(limit), () => ctx.dashboard.sessions(limit)),
    );
  });
}
