import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { WorkflowRunnerValidationError } from '../hermes/workflowRunner.js';

const startRunSchema = z.object({
  mode: z.enum(['chain', 'single_step']),
});

const resolveRunSchema = z.object({
  action: z.enum(['continue', 'stop']),
});

function sendValidationError(reply: FastifyReply, error: WorkflowRunnerValidationError): unknown {
  const status = error.code === 'workflow_not_found' || error.code === 'run_not_found' ? 404 : 409;
  return reply.code(status).send({ error: error.code, message: error.message });
}

export async function registerWorkflowRunRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.post('/api/workflows/:id/runs', async (request, reply) => {
    const parsed = startRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Body must be { "mode": "chain" | "single_step" }.',
      });
    }
    const { id } = request.params as { id: string };
    try {
      const { runId } = ctx.workflowRunner.start(id, parsed.data.mode);
      return reply.code(201).send({ runId });
    } catch (error) {
      if (error instanceof WorkflowRunnerValidationError) return sendValidationError(reply, error);
      throw error;
    }
  });

  app.get('/api/workflows/:id/runs', async (request) => {
    const { id } = request.params as { id: string };
    return { runs: ctx.workflowRuns.listByWorkflow(id) };
  });

  /**
   * Single-step mode's "nothing to decide, just go" case: the step that just
   * finished succeeded, there's simply a next one to start.
   */
  app.post('/api/workflows/runs/:runId/advance', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    try {
      ctx.workflowRunner.resume(runId, 'continue');
      return { ok: true };
    } catch (error) {
      if (error instanceof WorkflowRunnerValidationError) return sendValidationError(reply, error);
      throw error;
    }
  });

  /** Answers a `waiting_for_user` pause after a failed step (manual runs only). */
  app.post('/api/workflows/runs/:runId/resolve', async (request, reply) => {
    const parsed = resolveRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Body must be { "action": "continue" | "stop" }.',
      });
    }
    const { runId } = request.params as { runId: string };
    try {
      ctx.workflowRunner.resume(runId, parsed.data.action);
      return { ok: true };
    } catch (error) {
      if (error instanceof WorkflowRunnerValidationError) return sendValidationError(reply, error);
      throw error;
    }
  });
}
