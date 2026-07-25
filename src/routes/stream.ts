import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { ControlCenterEvent } from '../events.js';
import { log } from '../log.js';

/** Comment frames keep proxies and browsers from closing an idle stream. */
const KEEPALIVE_MS = 20_000;

/**
 * Single push channel to the browser. The client maps event types onto query
 * cache invalidations, so adding a new event never needs a new endpoint.
 */
export async function registerStreamRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/stream', (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable buffering in any reverse proxy sitting in front of us.
      'x-accel-buffering': 'no',
    });
    // Take the socket over from Fastify: this response never "finishes".
    reply.hijack();

    const send = (event: ControlCenterEvent): void => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    reply.raw.write(': connected\n\n');

    const unsubscribe = ctx.bus.subscribe(send);

    const keepalive = setInterval(() => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(': keepalive\n\n');
    }, KEEPALIVE_MS);
    keepalive.unref?.();

    const cleanup = (): void => {
      clearInterval(keepalive);
      unsubscribe();
      log.debug(`SSE client disconnected (${ctx.bus.subscriberCount} left)`);
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    // Send the current state immediately so the UI paints without waiting for
    // the next poll tick.
    const cachedStatus = ctx.lastStatus();
    if (cachedStatus) {
      send({ type: 'status', snapshot: cachedStatus });
    } else {
      void ctx
        .getStatus()
        .then((snapshot) => send({ type: 'status', snapshot }))
        .catch(() => {
          // Status failures are represented inside the snapshot; nothing to do.
        });
    }

    log.debug(`SSE client connected (${ctx.bus.subscriberCount} total)`);
  });
}
