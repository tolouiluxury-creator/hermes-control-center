import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { GatewayError } from '../hermes/gateway.js';
import { log } from '../log.js';

/**
 * Chat with the agent over the dashboard's tui_gateway WebSocket. The browser
 * gets three plain HTTP calls plus one SSE stream; the WebSocket to Hermes and
 * its session token stay entirely server-side.
 *
 * No API server and no gateway restart are involved: this rides the dashboard
 * that is already running, so enabling chat changes nothing about the agent.
 */

const KEEPALIVE_MS = 20_000;

const promptSchema = z.object({
  sessionId: z.string().trim().min(1),
  text: z.string().trim().min(1).max(100_000),
});

interface HistoryMessage {
  role: string;
  text: string;
}

/** Reduces a gateway history result to the {role, text} the thread renders. */
function normalizeHistory(result: unknown): HistoryMessage[] {
  const raw = result as { history?: unknown; messages?: unknown } | null;
  const list = Array.isArray(raw?.history)
    ? raw.history
    : Array.isArray(raw?.messages)
      ? raw.messages
      : [];
  return list
    .map((entry) => {
      const message = entry as { role?: unknown; text?: unknown };
      return {
        role: typeof message.role === 'string' ? message.role : 'assistant',
        text: typeof message.text === 'string' ? message.text : '',
      };
    })
    .filter((message) => message.text !== '' || message.role === 'assistant');
}

export async function registerChatRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/api/chat/session', async (_request, reply) => {
    try {
      const result = await ctx.gateway.request<{ session_id?: string }>('session.create', {
        cols: 80,
      });
      if (!result.session_id) {
        return reply
          .code(502)
          .send({ error: 'no_session', message: 'Keine Sitzungs-ID erhalten.' });
      }
      return { sessionId: result.session_id };
    } catch (error) {
      return reply
        .code(503)
        .send({ error: 'gateway_unreachable', message: describeGatewayError(error) });
    }
  });

  app.post('/api/chat/prompt', async (request, reply) => {
    const parsed = promptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_prompt', message: parsed.error.issues[0]?.message ?? 'ungültig' });
    }
    try {
      await ctx.gateway.request('prompt.submit', {
        session_id: parsed.data.sessionId,
        text: parsed.data.text,
      });
      return { ok: true };
    } catch (error) {
      return reply.code(503).send({ error: 'gateway_error', message: describeGatewayError(error) });
    }
  });

  app.get('/api/chat/history', async (request, reply) => {
    const sessionId = (request.query as { sessionId?: string } | undefined)?.sessionId;
    if (!sessionId) return reply.code(400).send({ error: 'missing_session' });
    try {
      const result = await ctx.gateway.request('session.history', { session_id: sessionId });
      return { messages: normalizeHistory(result) };
    } catch (error) {
      return reply.code(503).send({ error: 'gateway_error', message: describeGatewayError(error) });
    }
  });

  /**
   * Streams the agent's tokens. Gateway events (message.start/delta/complete and
   * anything else) are forwarded verbatim; the browser filters by its session id
   * and only acts on the types it knows, so new event types never break it.
   */
  app.get('/api/chat/events', (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.hijack();
    reply.raw.write(': connected\n\n');

    const unsubscribe = ctx.gateway.onEvent((event) => {
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
      log.debug('Chat SSE client disconnected');
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}

function describeGatewayError(error: unknown): string {
  if (error instanceof GatewayError) return error.message;
  return error instanceof Error ? error.message : 'Unbekannter Fehler';
}
