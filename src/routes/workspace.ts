import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { deriveInsights, type Insight } from '../insights.js';
import { PromptsRepo } from '../store/prompts.js';
import { log } from '../log.js';

/**
 * The control center's own data: the prompt library, and the rule-based
 * insights derived from everything else. None of this exists in Hermes, which
 * is why it lives here.
 */

const promptInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(100_000),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  const prompts = new PromptsRepo(ctx.store);

  app.get('/api/prompts', async () => ({ prompts: prompts.list() }));

  app.post('/api/prompts', async (request, reply) => {
    const parsed = promptInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_prompt', message: parsed.error.issues[0]?.message ?? 'ungültig' });
    }
    return reply.code(201).send({ prompt: prompts.create(parsed.data) });
  });

  app.put('/api/prompts/:id', async (request, reply) => {
    const parsed = promptInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_prompt', message: parsed.error.issues[0]?.message ?? 'ungültig' });
    }

    const { id } = request.params as { id: string };
    const updated = prompts.update(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { prompt: updated };
  });

  app.delete('/api/prompts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!prompts.delete(id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.post('/api/prompts/:id/use', async (request, reply) => {
    const { id } = request.params as { id: string };
    const uses = prompts.recordUse(id);
    if (uses === null) return reply.code(404).send({ error: 'not_found' });
    return { uses };
  });

  /**
   * Insights are computed on demand from whatever is reachable right now.
   * Sources that fail are simply absent: a rule with no data produces no
   * insight, rather than an insight about missing data.
   */
  app.get('/api/insights', async () => {
    const snapshot = ctx.lastStatus() ?? (await ctx.refreshStatus());

    const settle = async <T>(work: Promise<T>): Promise<T | null> => {
      try {
        return await work;
      } catch (error) {
        log.debug(`Insight source unavailable: ${String(error)}`);
        return null;
      }
    };

    const [logs, skills, analytics, cron, memory] = await Promise.all([
      settle(ctx.dashboard.logs(200)),
      settle(ctx.dashboard.skills()),
      settle(ctx.dashboard.analytics()),
      settle(ctx.dashboard.cronJobs()),
      settle(ctx.dashboard.memory()),
    ]);

    const insights: Insight[] = deriveInsights({
      host: snapshot.host,
      agent: snapshot.agent,
      readiness: snapshot.readiness,
      apiServerReachable: snapshot.apiServer.reachable,
      logs: logs?.lines ?? null,
      skills,
      analytics,
      cron,
      memory,
    });

    return { insights, generatedAt: Date.now() };
  });
}
