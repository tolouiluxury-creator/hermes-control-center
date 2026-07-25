import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { CliOptions } from './options.js';
import { registerMetaRoutes } from './routes/meta.js';
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

export async function buildServer(options: CliOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: false,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', CSP);
    return payload;
  });

  await registerMetaRoutes(app, options);

  const webRoot = resolveWebRoot();
  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot, index: false, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      // API misses stay JSON; everything else is a client-side route.
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found', path: request.url });
      }
      return reply.type('text/html').sendFile('index.html', webRoot);
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
    const message = describeError(error);
    const rawStatus = (error as { statusCode?: unknown }).statusCode;
    const status = typeof rawStatus === 'number' && rawStatus >= 400 ? rawStatus : 500;
    log.error(`${request.method} ${request.url} failed: ${message}`);
    return reply.code(status).send({ error: 'internal_error', message });
  });

  return app;
}
