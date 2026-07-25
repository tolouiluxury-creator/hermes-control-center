import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { log } from '../log.js';

/**
 * Dashboard layout persistence.
 *
 * The layout is the user's own arrangement, so it lives in the control center's
 * database rather than in Hermes. Widget ids are deliberately not validated
 * against a list here: which widgets exist is the browser's business, and a
 * server that policed it would need redeploying for every new widget. The shape
 * and the limits are validated, which is what protects the database.
 */

const LAYOUT_KEY = 'dashboard.layout';

/** Grid geometry limits. 12 columns, matching the frontend's grid. */
const placementSchema = z.object({
  i: z.string().min(1).max(120),
  widget: z.string().min(1).max(80),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(400),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(40),
});

const layoutSchema = z.object({
  version: z.literal(1),
  // A generous cap: enough for any real dashboard, small enough that a runaway
  // client cannot grow the row without bound.
  widgets: z.array(placementSchema).max(60),
});

export type DashboardLayout = z.infer<typeof layoutSchema>;

export async function registerDashboardRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/api/dashboard/layout', async () => {
    const stored = ctx.settings.get<unknown>(LAYOUT_KEY, null);
    if (stored === null) return { layout: null };

    const parsed = layoutSchema.safeParse(stored);
    if (!parsed.success) {
      // A layout we can no longer read must not brick the dashboard: report it
      // as absent and let the client fall back to its defaults.
      log.warn(`Stored dashboard layout is unreadable, falling back to defaults.`);
      return { layout: null };
    }

    return { layout: parsed.data };
  });

  app.put('/api/dashboard/layout', async (request, reply) => {
    const parsed = layoutSchema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return reply.code(400).send({
        error: 'invalid_layout',
        message: `Layout rejected at ${first?.path.join('.') || '(root)'}: ${first?.message ?? 'validation failed'}`,
      });
    }

    const seen = new Set<string>();
    for (const widget of parsed.data.widgets) {
      if (seen.has(widget.i)) {
        return reply.code(400).send({
          error: 'invalid_layout',
          message: `Duplicate widget instance id: ${widget.i}`,
        });
      }
      seen.add(widget.i);
    }

    ctx.settings.set(LAYOUT_KEY, parsed.data);
    return { ok: true };
  });

  /** Removing the layout returns the dashboard to its defaults. */
  app.delete('/api/dashboard/layout', async () => {
    ctx.settings.delete(LAYOUT_KEY);
    return { ok: true };
  });
}
