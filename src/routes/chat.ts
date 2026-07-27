import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { GatewayError } from '../hermes/gateway.js';
import { toEpochMs } from '../hermes/inventory.js';
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

interface ChatSession {
  id: string;
  title: string;
  preview: string;
  startedAt: number | null;
  messageCount: number;
  source: string;
}

/** Reduces a gateway session.list result to the list the sidebar renders. */
function normalizeSessions(result: unknown): ChatSession[] {
  const raw = result as { sessions?: unknown } | null;
  const list = Array.isArray(raw?.sessions) ? raw.sessions : [];
  return list.map((entry) => {
    const s = entry as Record<string, unknown>;
    return {
      id: typeof s.id === 'string' ? s.id : '',
      title: typeof s.title === 'string' ? s.title.trim() : '',
      preview: typeof s.preview === 'string' ? s.preview.trim() : '',
      startedAt: toEpochMs(s.started_at),
      messageCount: typeof s.message_count === 'number' ? s.message_count : 0,
      source: typeof s.source === 'string' ? s.source : '',
    };
  });
}

export async function registerChatRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/chat/sessions', async (_request, reply) => {
    try {
      const result = await ctx.gateway.request('session.list', { limit: 50 });
      return { sessions: normalizeSessions(result).filter((s) => s.id !== '') };
    } catch (error) {
      return reply.code(503).send({ error: 'gateway_error', message: describeGatewayError(error) });
    }
  });

  app.post('/api/chat/resume', async (request, reply) => {
    const sessionId = (request.body as { sessionId?: unknown } | undefined)?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      return reply.code(400).send({ error: 'missing_session' });
    }
    try {
      await ctx.gateway.request('session.resume', { session_id: sessionId, cols: 80 });
      return { ok: true };
    } catch (error) {
      return reply.code(503).send({ error: 'gateway_error', message: describeGatewayError(error) });
    }
  });

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
      // The stored transcript (dashboard REST) is authoritative and needs no
      // resume; the gateway's own history only holds a live session's turns.
      const messages = await ctx.dashboard.sessionMessages(sessionId);
      return { messages };
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
