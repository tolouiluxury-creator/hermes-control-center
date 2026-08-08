import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { WorkflowRunnerValidationError } from '../hermes/workflowRunner.js';

/**
 * Stage 1 only supports running the whole chain unattended-to-completion;
 * step-by-step mode and the pause/resolve dance arrive in a later stage.
 */
const startRunSchema = z.object({
  mode: z.literal('chain'),
});

export async function registerWorkflowRunRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.post('/api/workflows/:id/runs', async (request, reply) => {
    const parsed = startRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Step-by-step mode isn\'t available yet — pass { "mode": "chain" }.',
      });
    }
    const { id } = request.params as { id: string };
    try {
      const { runId } = ctx.workflowRunner.start(id);
      return reply.code(201).send({ runId });
    } catch (error) {
      if (error instanceof WorkflowRunnerValidationError) {
        const status = error.code === 'workflow_not_found' ? 404 : 409;
        return reply.code(status).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get('/api/workflows/:id/runs', async (request) => {
    const { id } = request.params as { id: string };
    return { runs: ctx.workflowRuns.listByWorkflow(id) };
  });
}
