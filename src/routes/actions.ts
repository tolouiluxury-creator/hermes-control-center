import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { UpstreamError } from '../hermes/client.js';
import { CACHE_KEYS, type ResponseCache } from './cache.js';

/**
 * Write actions against the Hermes dashboard. Each one validates its input,
 * performs the upstream write, and invalidates the read-cache keys it affects
 * so the change is visible on the next poll rather than after the TTL. Upstream
 * failures come back as honest statuses, never a blank 500 — these routes touch
 * a live agent, so the UI must be able to say exactly what went wrong.
 */

const skillToggleSchema = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean(),
});

const enabledSchema = z.object({ enabled: z.boolean() });

const modelSetSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
});

const providerSchema = z.object({ provider: z.string().trim().min(1) });

const cronActions = new Set(['pause', 'resume', 'trigger']);

export async function registerActionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  cache: ResponseCache,
): Promise<void> {
  /** Runs an upstream write and translates its failure into a client status. */
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

  /** Rejects a malformed body with the first validation message. */
  const parse = <T>(reply: FastifyReply, schema: z.ZodType<T>, body: unknown): T | undefined => {
    const result = schema.safeParse(body);
    if (result.success) return result.data;
    void reply
      .code(400)
      .send({ error: 'invalid_request', message: result.error.issues[0]?.message ?? 'ungültig' });
    return undefined;
  };

  app.put('/api/hermes/skills/toggle', async (request, reply) => {
    const input = parse(reply, skillToggleSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.toggleSkill(input.name, input.enabled);
      // The summary widget and the full list both read the skill state.
      cache.invalidate(CACHE_KEYS.skills, CACHE_KEYS.skillList);
      return result;
    });
  });

  // --- Scheduled jobs (cron) ------------------------------------------------

  app.post('/api/hermes/cron/:id/:action', async (request, reply) => {
    const { id, action } = request.params as { id: string; action: string };
    if (!cronActions.has(action)) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Unbekannte Aktion' });
    }
    return guard(reply, async () => {
      const result = await ctx.dashboard.cronAction(id, action as 'pause' | 'resume' | 'trigger');
      cache.invalidate(CACHE_KEYS.cron);
      return result;
    });
  });

  app.delete('/api/hermes/cron/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return guard(reply, async () => {
      const result = await ctx.dashboard.deleteCron(id);
      cache.invalidate(CACHE_KEYS.cron);
      return result;
    });
  });

  // --- Model ----------------------------------------------------------------

  app.post('/api/hermes/model/set', async (request, reply) => {
    const input = parse(reply, modelSetSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setMainModel(input.provider, input.model);
      cache.invalidate(CACHE_KEYS.model, CACHE_KEYS.models);
      return result;
    });
  });

  // --- MCP servers ----------------------------------------------------------

  app.put('/api/hermes/mcp/:name/enabled', async (request, reply) => {
    const { name } = request.params as { name: string };
    const input = parse(reply, enabledSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setMcpEnabled(name, input.enabled);
      cache.invalidate(CACHE_KEYS.mcp);
      return result;
    });
  });

  /** A connection test changes nothing, so it invalidates no cache. */
  app.post('/api/hermes/mcp/:name/test', async (request, reply) => {
    const { name } = request.params as { name: string };
    return guard(reply, () => ctx.dashboard.testMcp(name));
  });

  app.delete('/api/hermes/mcp/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    return guard(reply, async () => {
      const result = await ctx.dashboard.deleteMcp(name);
      cache.invalidate(CACHE_KEYS.mcp);
      return result;
    });
  });

  // --- Memory (RAG) provider ------------------------------------------------

  app.put('/api/hermes/memory/provider', async (request, reply) => {
    const input = parse(reply, providerSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setMemoryProvider(input.provider);
      cache.invalidate(CACHE_KEYS.memory);
      return result;
    });
  });

  // --- Messaging platforms --------------------------------------------------

  app.put('/api/hermes/messaging/:id/enabled', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(reply, enabledSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setPlatformEnabled(id, input.enabled);
      cache.invalidate(CACHE_KEYS.messaging);
      return result;
    });
  });

  app.post('/api/hermes/messaging/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    return guard(reply, () => ctx.dashboard.testPlatform(id));
  });
}
