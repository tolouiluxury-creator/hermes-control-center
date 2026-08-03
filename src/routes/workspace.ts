import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { deriveInsights, type Insight } from '../insights.js';
import { PromptsRepo } from '../store/prompts.js';
import { TodosRepo } from '../store/todos.js';
import { WorkflowsRepo } from '../store/workflows.js';
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

const todoCreateSchema = z.object({
  sessionId: z.string().trim().min(1),
  text: z.string().trim().min(1).max(2000),
});

const todoUpdateSchema = z
  .object({
    done: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((data) => data.done !== undefined || data.pinned !== undefined, {
    message: 'at least one of done or pinned is required',
  });

const workflowInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  steps: z
    .array(
      z.object({
        kind: z.enum(['prompt', 'cron', 'note']),
        ref: z.string().max(200).nullish(),
        label: z.string().trim().min(1).max(500),
      }),
    )
    .max(100)
    .optional(),
});

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  const prompts = new PromptsRepo(ctx.store);
  const todos = new TodosRepo(ctx.store);
  const workflows = new WorkflowsRepo(ctx.store);

  app.get('/api/prompts', async () => ({ prompts: prompts.list() }));

  app.post('/api/prompts', async (request, reply) => {
    const parsed = promptInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_prompt',
        message: parsed.error.issues[0]?.message ?? 'invalid request',
      });
    }
    return reply.code(201).send({ prompt: prompts.create(parsed.data) });
  });

  app.put('/api/prompts/:id', async (request, reply) => {
    const parsed = promptInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_prompt',
        message: parsed.error.issues[0]?.message ?? 'invalid request',
      });
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

  // --- ToDos -----------------------------------------------------------------

  app.get('/api/todos', async (request, reply) => {
    const query = request.query as { sessionId?: string } | undefined;
    const sessionId = query?.sessionId?.trim();
    if (!sessionId) return reply.code(400).send({ error: 'missing_session_id' });
    return { todos: todos.listForSession(sessionId) };
  });

  app.post('/api/todos', async (request, reply) => {
    const parsed = todoCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_todo',
        message: parsed.error.issues[0]?.message ?? 'invalid request',
      });
    }
    return reply
      .code(201)
      .send({ todo: todos.create(parsed.data.sessionId, { text: parsed.data.text }) });
  });

  app.put('/api/todos/:id', async (request, reply) => {
    const parsed = todoUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_todo',
        message: parsed.error.issues[0]?.message ?? 'invalid request',
      });
    }
    const { id } = request.params as { id: string };
    let updated = null;
    if (parsed.data.done !== undefined) updated = todos.setDone(id, parsed.data.done);
    if (parsed.data.pinned !== undefined) updated = todos.setPinned(id, parsed.data.pinned);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { todo: updated };
  });

  app.delete('/api/todos/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!todos.delete(id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // --- Workflows ------------------------------------------------------------

  app.get('/api/workflows', async () => ({ workflows: workflows.list() }));

  app.post('/api/workflows', async (request, reply) => {
    const parsed = workflowInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_workflow',
        message: parsed.error.issues[0]?.message ?? 'invalid request',
      });
    }
    return reply.code(201).send({ workflow: workflows.create(parsed.data) });
  });

  app.put('/api/workflows/:id', async (request, reply) => {
    const parsed = workflowInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_workflow',
        message: parsed.error.issues[0]?.message ?? 'invalid request',
      });
    }
    const { id } = request.params as { id: string };
    const updated = workflows.update(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { workflow: updated };
  });

  app.post('/api/workflows/:id/enabled', async (request, reply) => {
    const body = request.body as { enabled?: unknown } | undefined;
    if (typeof body?.enabled !== 'boolean') {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'enabled is required and must be a boolean' });
    }
    const { id } = request.params as { id: string };
    const updated = workflows.setEnabled(id, body.enabled);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { workflow: updated };
  });

  app.delete('/api/workflows/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!workflows.delete(id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
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
      logs: logs?.lines ?? null,
      skills,
      analytics,
      cron,
      memory,
    });

    return { insights, generatedAt: Date.now() };
  });
}
