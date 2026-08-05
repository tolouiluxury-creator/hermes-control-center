import { statSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolveSpaRequest } from './util/spa.js';
import type { AppContext } from './context.js';
import { registerAuthGuard, registerAuthRoutes } from './routes/auth.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerInventoryRoutes } from './routes/inventory.js';
import { registerActionRoutes } from './routes/actions.js';
import { registerTelegramSetupRoutes } from './routes/telegramSetup.js';
import { ResponseCache, CACHE_TTL_MS } from './routes/cache.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerFileRoutes } from './routes/files.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerStatusRoutes } from './routes/status.js';
import { registerStreamRoutes } from './routes/stream.js';
import { UpstreamError } from './hermes/client.js';
import { describeError, log } from './log.js';
import { resolveWebRoot } from './util/pkg.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function isRegularFile(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: false,
  });

  /**
   * Bodyless POSTs must not fail on content negotiation. Several clients send a
   * default content type even with no body (PowerShell picks form-urlencoded),
   * which Fastify answers with 415 — breaking side-effect-free calls such as
   * /api/auth/logout. Empty bodies are accepted for any content type; a
   * non-empty body with an unsupported type is still refused.
   */
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body: Buffer, done) => {
    if (body.length === 0) {
      done(null, undefined);
      return;
    }
    const error = new Error('Unsupported content type') as Error & { statusCode?: number };
    error.statusCode = 415;
    done(error, undefined);
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', CSP);
    return payload;
  });

  // Registered before the routes so nothing can be reached without passing it.
  registerAuthGuard(app, ctx.auth);
  await registerAuthRoutes(app, ctx.auth);

  // One cache shared by the read routes (which populate it) and the action
  // routes (which invalidate the keys a write touches).
  const cache = new ResponseCache(CACHE_TTL_MS);

  await registerMetaRoutes(app, ctx.options);
  await registerStatusRoutes(app, ctx);
  await registerDashboardRoutes(app, ctx);
  await registerInventoryRoutes(app, ctx, cache);
  await registerActionRoutes(app, ctx, cache);
  await registerTelegramSetupRoutes(app, ctx, cache);
  await registerWorkspaceRoutes(app, ctx);
  await registerFileRoutes(app, ctx);
  await registerChatRoutes(app, ctx, cache);
  await registerStreamRoutes(app, ctx);

  const webRoot = resolveWebRoot();
  if (webRoot) {
    // serve:false gives us reply.sendFile without any route of the plugin's own.
    // We resolve files per request against the disk: @fastify/static's wildcard:false
    // mode snapshots the directory at boot, which serves stale 404s (and therefore
    // index.html) for any asset written afterwards — exactly what a rebuild does.
    await app.register(fastifyStatic, { root: webRoot, serve: false });

    // index.html must never be cached: it names the hashed asset bundles.
    const sendSpa = (reply: FastifyReply) =>
      reply
        .header('cache-control', 'no-cache, must-revalidate')
        .type('text/html')
        .sendFile('index.html', { cacheControl: false });

    const serveFile = async (request: FastifyRequest, reply: FastifyReply) => {
      const resolution = resolveSpaRequest(webRoot, request.url, isRegularFile);
      if (resolution.kind === 'spa') return sendSpa(reply);

      // sendFile writes its own cache-control, so the policy goes through its
      // options rather than a header set beforehand.
      return reply.sendFile(
        resolution.relative,
        resolution.immutable
          ? { maxAge: ONE_YEAR_MS, immutable: true }
          : { cacheControl: true, maxAge: 0 },
      );
    };

    app.get('/', serveFile);
    app.get('/*', serveFile);

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found', path: request.url });
      }
      return sendSpa(reply);
    });
  } else {
    log.warn('No built frontend found (dist/web). Run `npm run build:web`, or use `npm run dev`.');
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found', path: request.url });
      }
      return reply
        .code(503)
        .type('text/plain')
        .send('Frontend not built. Run `npm run build:web` or use `npm run dev`.\n');
    });
  }

  app.setErrorHandler((error: unknown, request, reply) => {
    // Upstream problems are expected operating conditions, not server bugs.
    if (error instanceof UpstreamError) {
      log.debug(`${request.method} ${request.url}: ${error.message}`);
      return reply.code(error.clientStatus).send(error.toJSON());
    }

    const message = describeError(error);
    const rawStatus = (error as { statusCode?: unknown }).statusCode;
    const status = typeof rawStatus === 'number' && rawStatus >= 400 ? rawStatus : 500;
    log.error(`${request.method} ${request.url} failed: ${message}`);
    return reply.code(status).send({ error: 'internal_error', message });
  });

  return app;
}
