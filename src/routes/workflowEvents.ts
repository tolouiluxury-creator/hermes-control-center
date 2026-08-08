import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { log } from '../log.js';

const KEEPALIVE_MS = 20_000;

/**
 * Streams workflow run progress. One shared connection for the whole app
 * (same pattern as `/api/chat/events`) — the browser filters by `runId` and
 * only acts on the event types it knows, so new event types never break it.
 */
export async function registerWorkflowEventRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/api/workflows/events', (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.hijack();
    reply.raw.write(': connected\n\n');

    const unsubscribe = ctx.workflowRunner.onEvent((event) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const keepalive = setInterval(() => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(': keepalive\n\n');
    }, KEEPALIVE_MS);
    keepalive.unref?.();

    const cleanup = (): void => {
      clearInterval(keepalive);
      unsubscribe();
      log.debug('Workflow events SSE client disconnected');
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}
