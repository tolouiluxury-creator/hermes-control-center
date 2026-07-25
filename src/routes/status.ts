import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { UpstreamError } from '../hermes/client.js';
import { METRIC_RETENTION_MS } from '../store/metrics.js';
import { toPublicConnection } from '../hermes/discovery.js';

const KNOWN_METRICS = ['cpu', 'memory', 'disk', 'api_latency', 'dashboard_latency'] as const;

export async function registerStatusRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  /**
   * Aggregated health of both Hermes surfaces plus host metrics. Never fails as
   * a whole: unreachable upstreams are reported inside the payload so the UI can
   * show setup guidance instead of an error page.
   */
  app.get('/api/status', async (request) => {
    const fresh = (request.query as { fresh?: string } | undefined)?.fresh === '1';
    return ctx.getStatus(fresh ? 0 : undefined);
  });

  /** Connection details with secrets stripped — used by the setup screen. */
  app.get('/api/connection', async () => toPublicConnection(ctx.connection));

  /** History for sparklines, sourced from our own ring buffer. */
  app.get('/api/metrics/series', async (request, reply) => {
    const query = request.query as { metric?: string; windowMs?: string } | undefined;
    const metric = query?.metric;

    if (!metric) {
      return reply.code(400).send({
        error: 'missing_metric',
        message: `Query parameter "metric" is required. Known metrics: ${KNOWN_METRICS.join(', ')}.`,
      });
    }

    const requested = Number(query?.windowMs);
    const windowMs =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, METRIC_RETENTION_MS)
        : METRIC_RETENTION_MS;

    return {
      metric,
      windowMs,
      samples: ctx.metrics.series(metric, windowMs),
    };
  });

  /** Latest value for several metrics at once. */
  app.get('/api/metrics/latest', async (request) => {
    const query = request.query as { metrics?: string } | undefined;
    const metrics = query?.metrics
      ? query.metrics
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [...KNOWN_METRICS];
    return { values: ctx.metrics.latest(metrics) };
  });

  /**
   * Readiness detail straight from Hermes. Kept separate from /api/status so a
   * missing API key surfaces as a 401 here rather than emptying the snapshot.
   */
  app.get('/api/hermes/health', async (_request, reply) => {
    try {
      return await ctx.api.healthDetailed();
    } catch (error) {
      if (error instanceof UpstreamError) {
        return reply.code(error.clientStatus).send(error.toJSON());
      }
      throw error;
    }
  });
}
