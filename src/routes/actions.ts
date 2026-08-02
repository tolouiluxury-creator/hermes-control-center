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
 * A skill's name is also its directory name. Hermes validates it properly on
 * the way in; this keeps an obviously wrong one from travelling at all. The
 * 100 kB ceiling matches the size limit its own writer enforces.
 */
const skillNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/),
});

const skillCreateSchema = skillNameSchema.extend({
  content: z.string().min(1).max(100_000),
  category: z.string().trim().max(64).optional(),
});

const skillContentSchema = skillNameSchema.extend({
  content: z.string().min(1).max(100_000),
});

/**
 * An MCP server is reached over http (`url`) or by running a process
 * (`command`) — never both, and never neither. Hermes rejects the ambiguous
 * case too; catching it here keeps the message specific.
 */
const mcpCreateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/),
    url: z.string().trim().max(2000).optional(),
    command: z.string().trim().max(500).optional(),
    args: z.array(z.string().max(500)).max(50).optional(),
    env: z.record(z.string(), z.string().max(4000)).optional(),
    auth: z.enum(['none', 'oauth', 'header']).optional(),
    bearerToken: z.string().max(4000).optional(),
  })
  .refine((value) => Boolean(value.url) !== Boolean(value.command), {
    message: 'Give either a URL or a command, not both.',
  });

/**
 * Hermes lowercases the name and rejects anything outside this shape; matching
 * it here means the user sees the rule while typing, not after a 400.
 */
const webhookCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  description: z.string().trim().max(500).optional(),
  events: z.array(z.string().trim().max(120)).max(50).optional(),
  prompt: z.string().max(10_000).optional(),
});

const pairingApproveSchema = z.object({
  platform: z.string().trim().min(1).max(64),
  code: z.string().trim().min(1).max(64),
});

const pairingRevokeSchema = z.object({
  platform: z.string().trim().min(1).max(64),
  userId: z.string().trim().min(1).max(200),
});

/** Only the fields being changed. Omitted ones are left alone upstream. */
const mcpUpdateSchema = z.object({
  url: z.string().trim().max(2000).optional(),
  command: z.string().trim().max(500).optional(),
  args: z.array(z.string().max(500)).max(50).optional(),
  env: z.record(z.string(), z.string().max(4000)).optional(),
});

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

const sessionPinSchema = z.object({
  pinned: z.boolean(),
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

/**
 * A memory provider's own field keys, so the shape cannot be pinned here. Values
 * travel as strings; Hermes coerces each one against the field's declared kind.
 * An omitted key keeps its stored value, which is how a blank secret is left
 * alone rather than cleared.
 */
const memoryConfigSchema = z.object({
  values: z.record(z.string().min(1).max(120), z.string().max(4000)),
});

/**
 * An auxiliary slot. `task` may be Hermes' `__reset__` sentinel or empty (all
 * slots), so it is not required to name a known task; `model` may be empty when
 * the provider is `auto`.
 */
const auxiliarySetSchema = z.object({
  task: z.string().trim().max(64),
  provider: z.string().trim().min(1).max(200),
  model: z.string().trim().max(200).optional(),
});

const cronActions = new Set(['pause', 'resume', 'trigger']);

/**
 * Creating a scheduled job. `schedule` is the only field Hermes insists on, but
 * an agent job also needs something to do, so prompt-or-skills is required here
 * rather than letting Hermes answer 400 with its own wording.
 *
 * `profile` is required on purpose: every cron endpoint takes one, and without
 * it Hermes falls back to its own current profile — a job created from the view
 * of one profile would then quietly land in another.
 *
 * Deliberately not exposed: `script` and `no_agent` (running a sandboxed script
 * on the host is a different kind of permission than scheduling a prompt),
 * `context_from`, `enabled_toolsets`, `base_url` and `repeat`.
 */
const cronCreateSchema = z
  .object({
    profile: z.string().trim().min(1),
    schedule: z.string().trim().min(1).max(200),
    name: z.string().trim().max(200).optional(),
    prompt: z.string().max(100_000).optional(),
    deliver: z.string().trim().max(100).optional(),
    skills: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    model: z.string().trim().max(200).optional(),
    provider: z.string().trim().max(200).optional(),
    workdir: z.string().trim().max(1000).optional(),
  })
  .refine((body) => (body.prompt?.trim() ?? '') !== '' || (body.skills?.length ?? 0) > 0, {
    message: 'A job needs a prompt or at least one skill.',
  });

/**
 * Editing sends only what changed: Hermes takes a free-form `updates` map and
 * leaves every key it is not given alone. The allowed keys are pinned so a typo
 * cannot travel and be stored as a new field.
 */
const cronUpdateSchema = z.object({
  profile: z.string().trim().min(1),
  updates: z
    .object({
      schedule: z.string().trim().min(1).max(200).optional(),
      name: z.string().trim().max(200).optional(),
      prompt: z.string().max(100_000).optional(),
      deliver: z.string().trim().max(100).optional(),
      skills: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
      model: z.string().trim().max(200).nullable().optional(),
      provider: z.string().trim().max(200).nullable().optional(),
      workdir: z.string().trim().max(1000).nullable().optional(),
    })
    .refine((updates) => Object.keys(updates).length > 0, { message: 'Nothing to change.' }),
});

const envSetSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
});
const envDeleteSchema = z.object({ key: z.string().trim().min(1) });
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
    void reply.code(400).send({
      error: 'invalid_request',
      message: result.error.issues[0]?.message ?? 'invalid request',
    });
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
      return reply.code(400).send({ error: 'invalid_request', message: 'Unknown action' });
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

  app.post('/api/hermes/cron', async (request, reply) => {
    const body = parse(reply, cronCreateSchema, request.body);
    if (!body) return undefined;
    const { profile, ...job } = body;
    return guard(reply, async () => {
      const result = await ctx.dashboard.createCron(job, profile);
      cache.invalidate(CACHE_KEYS.cron);
      return result;
    });
  });

  app.put('/api/hermes/cron/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parse(reply, cronUpdateSchema, request.body);
    if (!body) return undefined;
    return guard(reply, async () => {
      const result = await ctx.dashboard.updateCron(id, body.updates, body.profile);
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

  /*
   * Writing a provider's config also makes it the active one — that is Hermes'
   * own behaviour, not ours to hide. The memory cache is invalidated for exactly
   * that reason.
   */
  app.put('/api/hermes/memory/providers/:name/config', async (request, reply) => {
    const { name } = request.params as { name: string };
    const input = parse(reply, memoryConfigSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setMemoryProviderConfig(name, input.values);
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
      const profile = (request.query as { profile?: string } | undefined)?.profile?.trim();
      const result = await ctx.dashboard.setPlatformEnabled(id, input.enabled, profile);
      cache.invalidatePrefix(CACHE_KEYS.messaging);
      return result;
    });
  });

  app.post('/api/hermes/messaging/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const profile = (request.query as { profile?: string } | undefined)?.profile?.trim();
    return guard(reply, () => ctx.dashboard.testPlatform(id, profile));
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

  /**
   * Pin one auxiliary slot to a model, or hand it back to the main one.
   *
   * `provider: "auto"` is how Hermes spells "follow the main model", and the
   * task name `__reset__` puts every slot back at once — both are its own
   * sentinels, passed through rather than reinvented here.
   */
  app.post('/api/hermes/model/auxiliary', async (request, reply) => {
    const input = parse(reply, auxiliarySetSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setAuxiliaryModel(
        input.task,
        input.provider,
        input.model ?? '',
      );
      cache.invalidate(CACHE_KEYS.auxiliary, CACHE_KEYS.models, CACHE_KEYS.model);
      return result;
    });
  });

  // --- Webhooks and pairing -------------------------------------------------

  /** Restarts the gateway upstream — the UI warns before it gets here. */
  app.post('/api/hermes/webhooks/enable', async (_request, reply) =>
    guard(reply, async () => {
      const result = await ctx.dashboard.enableWebhooks();
      cache.invalidate(CACHE_KEYS.webhooks);
      cache.invalidatePrefix(CACHE_KEYS.messaging);
      return result;
    }),
  );

  app.post('/api/hermes/webhooks', async (request, reply) => {
    const input = parse(reply, webhookCreateSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.createWebhook(input);
      cache.invalidate(CACHE_KEYS.webhooks);
      // The secret rides back to the browser once and is never stored here.
      return result;
    });
  });

  app.delete('/api/hermes/webhooks/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    return guard(reply, async () => {
      const result = await ctx.dashboard.deleteWebhook(name);
      cache.invalidate(CACHE_KEYS.webhooks);
      return result;
    });
  });

  app.put('/api/hermes/webhooks/:name/enabled', async (request, reply) => {
    const { name } = request.params as { name: string };
    const input = parse(reply, enabledSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setWebhookEnabled(name, input.enabled);
      cache.invalidate(CACHE_KEYS.webhooks);
      return result;
    });
  });

  app.post('/api/hermes/pairing/approve', async (request, reply) => {
    const input = parse(reply, pairingApproveSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.approvePairing(input.platform, input.code);
      cache.invalidate(CACHE_KEYS.pairing);
      return result;
    });
  });

  app.post('/api/hermes/pairing/revoke', async (request, reply) => {
    const input = parse(reply, pairingRevokeSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.revokePairing(input.platform, input.userId);
      cache.invalidate(CACHE_KEYS.pairing);
      return result;
    });
  });

  app.post('/api/hermes/pairing/clear-pending', async (_request, reply) =>
    guard(reply, async () => {
      const result = await ctx.dashboard.clearPendingPairing();
      cache.invalidate(CACHE_KEYS.pairing);
      return result;
    }),
  );

  // --- MCP: authoring -------------------------------------------------------

  app.post('/api/hermes/mcp', async (request, reply) => {
    const input = parse(reply, mcpCreateSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.createMcpServer(input);
      cache.invalidate(CACHE_KEYS.mcp);
      return result;
    });
  });

  /**
   * Edit a server. The body carries only what changed; anything omitted keeps
   * its value upstream, which is the whole point — see `updateMcpServer` for
   * why a full replace would destroy the env secrets it cannot read back.
   */
  app.put('/api/hermes/mcp/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const input = parse(reply, mcpUpdateSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.updateMcpServer(name, input);
      cache.invalidate(CACHE_KEYS.mcp);
      return result;
    });
  });

  // --- Skills: authoring ----------------------------------------------------

  app.get('/api/hermes/skills/content', async (request, reply) => {
    const name = (request.query as { name?: string } | undefined)?.name;
    if (!name) return reply.code(400).send({ error: 'missing_name' });
    // Not cached: it is fetched to be edited, and a stale copy would be saved
    // back over whatever changed in between.
    return guard(reply, () => ctx.dashboard.skillContent(name));
  });

  app.post('/api/hermes/skills', async (request, reply) => {
    const input = parse(reply, skillCreateSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.createSkill(input.name, input.content, input.category);
      cache.invalidate(CACHE_KEYS.skills, CACHE_KEYS.skillList);
      return result;
    });
  });

  app.put('/api/hermes/skills/content', async (request, reply) => {
    const input = parse(reply, skillContentSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.updateSkillContent(input.name, input.content);
      cache.invalidate(CACHE_KEYS.skills, CACHE_KEYS.skillList);
      return result;
    });
  });

  /**
   * Remove a skill. Hermes has no delete endpoint — it spawns
   * `hermes skills uninstall` and answers with the child's pid, so this reports
   * that the removal started, not that it succeeded. The cache is cleared all
   * the same, because the next read is how anyone finds out.
   */
  app.post('/api/hermes/skills/uninstall', async (request, reply) => {
    const input = parse(reply, skillNameSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.uninstallSkill(input.name);
      cache.invalidate(CACHE_KEYS.skills, CACHE_KEYS.skillList);
      return { ...result, started: true };
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

  app.patch('/api/hermes/sessions/:id/pinned', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(reply, sessionPinSchema, request.body);
    if (!input) return reply;
    return guard(reply, async () => {
      const result = await ctx.dashboard.setSessionPinned(id, input.pinned, input.profile);
      cache.invalidatePrefix(SESSIONS_CACHE_PREFIX);
      return result;
    });
  });

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
