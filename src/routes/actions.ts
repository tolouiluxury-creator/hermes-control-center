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
}
