import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { UpstreamError } from '../hermes/client.js';
import { CACHE_KEYS, SESSIONS_CACHE_PREFIX, type ResponseCache } from './cache.js';

/**
 * Write actions against the Hermes dashboard. Each one validates its input,
 * performs the upstream write, and invalidates the read-cache keys it affects
 * so the change is visible on the next poll rather than after the TTL. Upstream
 * failures come back as honest statuses, never a blank 500 — these routes touch
 * a live agent, so the UI must be able to say exactly what went wrong.
 */

const skillToggleSchema = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean(),
});

const enabledSchema = z.object({ enabled: z.boolean() });

/**
 * Hermes caps a batch at 500 and answers 400 above it. Rejecting here keeps the
 * failure local and specific rather than surfacing an upstream error.
 */
const sessionIdsSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(500),
  /** Which profile's database the ids live in; empty means the launch profile. */
  profile: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value || undefined),
});

const modelSetSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
});

const providerSchema = z.object({ provider: z.string().trim().min(1) });

const cronActions = new Set(['pause', 'resume', 'trigger']);

const envSetSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
});
const envDeleteSchema = z.object({ key: z.string().trim().min(1) });
const configRawSchema = z.object({ yaml: z.string() });
const pausedSchema = z.object({ paused: z.boolean() });

/**
 * Profile names become directory names under `~/.hermes/profiles`, so the shape
 * is constrained here rather than left to Hermes' 400. Same character set the
 * CLI accepts.
 */
const profileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);

const profileCreateSchema = z.object({
  name: profileNameSchema,
  cloneFrom: z.string().trim().max(64).optional(),
  cloneAll: z.boolean().optional(),
  noSkills: z.boolean().optional(),
  description: z.string().trim().max(500).optional(),
});

const profileRenameSchema = z.object({ newName: profileNameSchema });
const profileActiveSchema = z.object({ name: profileNameSchema });
const profileDescriptionSchema = z.object({ description: z.string().max(500) });
const profileSoulSchema = z.object({ content: z.string().max(200_000) });

export async function registerActionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  cache: ResponseCache,
): Promise<void> {
  /** Runs an upstream write and translates its failure into a client status. */
  const guard = async <T>(reply: FastifyReply, work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof UpstreamError) {
        void reply.code(error.clientStatus).send(error.toJSON());
        return undefined;
      }
      throw error;
    }
  };

  /** Rejects a malformed body with the first validation message. */
  const parse = <T>(reply: FastifyReply, schema: z.ZodType<T>, body: unknown): T | undefined => {
    const result = schema.safeParse(body);
    if (result.success) return result.data;
    void reply
      .code(400)
      .send({ error: 'invalid_request', message: result.error.issues[0]?.message ?? 'ungültig' });
    return undefined;
  };

  app.put('/api/hermes/skills/toggle', async (request, reply) => {
    const input = parse(reply, skillToggleSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.toggleSkill(input.name, input.enabled);
      // The summary widget and the full list both read the skill state.
      cache.invalidate(CACHE_KEYS.skills, CACHE_KEYS.skillList);
      return result;
    });
  });

  // --- Scheduled jobs (cron) ------------------------------------------------

  app.post('/api/hermes/cron/:id/:action', async (request, reply) => {
    const { id, action } = request.params as { id: string; action: string };
    if (!cronActions.has(action)) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Unbekannte Aktion' });
    }
    return guard(reply, async () => {
      const result = await ctx.dashboard.cronAction(id, action as 'pause' | 'resume' | 'trigger');
      cache.invalidate(CACHE_KEYS.cron);
      return result;
    });
  });

  app.delete('/api/hermes/cron/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return guard(reply, async () => {
      const result = await ctx.dashboard.deleteCron(id);
      cache.invalidate(CACHE_KEYS.cron);
      return result;
    });
  });

  // --- Model ----------------------------------------------------------------

  app.post('/api/hermes/model/set', async (request, reply) => {
    const input = parse(reply, modelSetSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setMainModel(input.provider, input.model);
      cache.invalidate(CACHE_KEYS.model, CACHE_KEYS.models);
      return result;
    });
  });

  // --- MCP servers ----------------------------------------------------------

  app.put('/api/hermes/mcp/:name/enabled', async (request, reply) => {
    const { name } = request.params as { name: string };
    const input = parse(reply, enabledSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setMcpEnabled(name, input.enabled);
      cache.invalidate(CACHE_KEYS.mcp);
      return result;
    });
  });

  /** A connection test changes nothing, so it invalidates no cache. */
  app.post('/api/hermes/mcp/:name/test', async (request, reply) => {
    const { name } = request.params as { name: string };
    return guard(reply, () => ctx.dashboard.testMcp(name));
  });

  app.delete('/api/hermes/mcp/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    return guard(reply, async () => {
      const result = await ctx.dashboard.deleteMcp(name);
      cache.invalidate(CACHE_KEYS.mcp);
      return result;
    });
  });

  // --- Memory (RAG) provider ------------------------------------------------

  app.put('/api/hermes/memory/provider', async (request, reply) => {
    const input = parse(reply, providerSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setMemoryProvider(input.provider);
      cache.invalidate(CACHE_KEYS.memory);
      return result;
    });
  });

  // --- Messaging platforms --------------------------------------------------

  app.put('/api/hermes/messaging/:id/enabled', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(reply, enabledSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setPlatformEnabled(id, input.enabled);
      cache.invalidate(CACHE_KEYS.messaging);
      return result;
    });
  });

  app.post('/api/hermes/messaging/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    return guard(reply, () => ctx.dashboard.testPlatform(id));
  });

  // --- Environment variables and secrets ------------------------------------

  app.put('/api/hermes/env', async (request, reply) => {
    const input = parse(reply, envSetSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setEnv(input.key, input.value);
      cache.invalidate(CACHE_KEYS.env);
      return result;
    });
  });

  app.delete('/api/hermes/env', async (request, reply) => {
    const input = parse(reply, envDeleteSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.deleteEnv(input.key);
      cache.invalidate(CACHE_KEYS.env);
      return result;
    });
  });

  // --- Raw config -----------------------------------------------------------

  app.put('/api/hermes/config/raw', async (request, reply) => {
    const input = parse(reply, configRawSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.saveConfigRaw(input.yaml);
      // A config change can ripple into almost anything the dashboard reports.
      cache.clear();
      return result;
    });
  });

  // --- Memory curator -------------------------------------------------------

  app.put('/api/hermes/curator/paused', async (request, reply) => {
    const input = parse(reply, pausedSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setCuratorPaused(input.paused);
      cache.invalidate(CACHE_KEYS.curator);
      return result;
    });
  });

  app.post('/api/hermes/curator/run', async (_request, reply) =>
    guard(reply, async () => {
      const result = await ctx.dashboard.runCurator();
      cache.invalidate(CACHE_KEYS.curator);
      return result;
    }),
  );

  // --- Toolsets -------------------------------------------------------------

  app.put('/api/hermes/toolsets/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const input = parse(reply, enabledSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.toggleToolset(name, input.enabled);
      cache.invalidate(CACHE_KEYS.toolsets);
      return result;
    });
  });

  // --- Profiles -------------------------------------------------------------
  // A profile is a whole installation of the agent: its own config, skills,
  // memory and conversations. Every write here invalidates the profile list, and
  // the model ones also invalidate the model reads, because a profile carries a
  // model and the chat toolbar shows it.

  app.post('/api/hermes/profiles', async (request, reply) => {
    const input = parse(reply, profileCreateSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.createProfile(input);
      cache.invalidate(CACHE_KEYS.profiles);
      return result;
    });
  });

  app.patch('/api/hermes/profiles/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const input = parse(reply, profileRenameSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.renameProfile(name, input.newName);
      cache.invalidate(CACHE_KEYS.profiles);
      // Conversations are listed per profile; the old name's entries are stale.
      cache.invalidatePrefix(SESSIONS_CACHE_PREFIX);
      return result;
    });
  });

  app.delete('/api/hermes/profiles/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    return guard(reply, async () => {
      const result = await ctx.dashboard.deleteProfile(name);
      cache.invalidate(CACHE_KEYS.profiles);
      cache.invalidatePrefix(SESSIONS_CACHE_PREFIX);
      return result;
    });
  });

  /** The sticky profile for new terminal commands. Does not move the running dashboard. */
  app.post('/api/hermes/profiles/active', async (request, reply) => {
    const input = parse(reply, profileActiveSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setActiveProfile(input.name);
      cache.invalidate(CACHE_KEYS.profiles);
      return result;
    });
  });

  app.put('/api/hermes/profiles/:name/description', async (request, reply) => {
    const { name } = request.params as { name: string };
    const input = parse(reply, profileDescriptionSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setProfileDescription(name, input.description);
      cache.invalidate(CACHE_KEYS.profiles);
      return result;
    });
  });

  app.put('/api/hermes/profiles/:name/model', async (request, reply) => {
    const { name } = request.params as { name: string };
    const input = parse(reply, modelSetSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setProfileModel(name, input.provider, input.model);
      cache.invalidate(CACHE_KEYS.profiles, CACHE_KEYS.models, CACHE_KEYS.model);
      return result;
    });
  });

  app.get('/api/hermes/profiles/:name/soul', async (request, reply) => {
    const { name } = request.params as { name: string };
    // Not cached: it is opened to be edited, and a stale copy would be
    // overwritten with what the editor had when it loaded.
    return guard(reply, () => ctx.dashboard.profileSoul(name));
  });

  app.put('/api/hermes/profiles/:name/soul', async (request, reply) => {
    const { name } = request.params as { name: string };
    const input = parse(reply, profileSoulSchema, request.body);
    if (!input) return reply;
    return guard(reply, () => ctx.dashboard.saveProfileSoul(name, input.content));
  });

  // --- Sessions -------------------------------------------------------------

  /** POST, not DELETE: the ids travel in a body, which DELETE cannot carry reliably. */
  app.post('/api/hermes/sessions/delete', async (request, reply) => {
    const input = parse(reply, sessionIdsSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.deleteSessions(input.ids, input.profile);
      cache.invalidatePrefix(SESSIONS_CACHE_PREFIX);
      return result;
    });
  });
}
