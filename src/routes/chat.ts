import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { GatewayError } from '../hermes/gateway.js';
import { toEpochMs, type SessionSummary } from '../hermes/inventory.js';
import { log } from '../log.js';
import { SESSIONS_CACHE_PREFIX, sessionsCacheKey, type ResponseCache } from './cache.js';

/**
 * Chat with the agent over the dashboard's tui_gateway WebSocket. The browser
 * gets three plain HTTP calls plus one SSE stream; the WebSocket to Hermes and
 * its session token stay entirely server-side.
 *
 * No API server and no gateway restart are involved: this rides the dashboard
 * that is already running, so enabling chat changes nothing about the agent.
 */

const KEEPALIVE_MS = 20_000;

/**
 * Platform tag stamped on the conversations we open.
 *
 * Without one, the gateway defaults to `tui`, and Hermes documents what that
 * costs: the agent then believes it is talking to a terminal user and offers
 * TUI-only slash commands that do not exist here. We are what its own comment
 * describes as `desktop` — a graphical surface, not a terminal.
 *
 * It also makes our conversations identifiable, which is what lets the browser
 * reuse an empty one of ours instead of stacking up a new session per visit —
 * and, critically, keeps it from ever adopting an empty Telegram session,
 * where the source decides which channel a reply is routed back to.
 */
const CHAT_SOURCE = 'desktop';

/**
 * Automation sources that must never show up as a "conversation" in the
 * Chats list. Hermes' own `session.list` deliberately includes them (its
 * resume picker treats every human-facing source as fair game, deny-listing
 * only truly internal noise like `tool`/`kanban` — see
 * `tui_gateway/methods_session.py`), and its own desktop app is the one that
 * does this separation, keeping `source === 'cron'` sessions in their own
 * sidebar section instead of the recents list. `workflow` is this app's own
 * equivalent: every prompt step (manual or, later, scheduled) opens a session
 * this same way, and none of those are something a user created by hand here.
 */
const AUTOMATION_SOURCES = new Set(['cron', 'workflow']);

/**
 * How many stored rows are consulted to learn which model a conversation runs
 * on. The gateway's own `session.list` does not report the model, so the list is
 * joined against the dashboard's session table; anything older than this window
 * simply shows no model rather than a guessed one.
 */
const MODEL_LOOKUP_LIMIT = 100;

/**
 * What `session.create` and `session.resume` answer with.
 *
 * The two ids are not interchangeable and mixing them up is silent: the gateway
 * keeps live sessions in a map keyed by `session_id`, a short-lived handle it
 * mints per attach, while `stored_session_id` (`session_key`) names the row in
 * the database. Prompts, streamed events and model switches all speak the live
 * id; listing, transcripts and deletes all speak the stored one. Reopening a
 * conversation mints a *new* live id for the same row.
 */
interface GatewaySessionResult {
  session_id?: string;
  stored_session_id?: string;
  session_key?: string;
  resumed?: string;
}

const promptSchema = z.object({
  sessionId: z.string().trim().min(1),
  text: z.string().trim().min(1).max(100_000),
});

const interruptSchema = z.object({
  sessionId: z.string().trim().min(1),
});

const modelSwitchSchema = z.object({
  /** The live id — `config.set` looks the session up without resolving. */
  sessionId: z.string().trim().min(1),
  model: z.string().trim().min(1).max(200),
  provider: z.string().trim().max(200).optional(),
  /** Repeat the call with this after Hermes asked about an expensive model. */
  confirm: z.boolean().optional(),
});

/**
 * A profile name, or nothing.
 *
 * Empty means "the profile the running dashboard was launched with" — which is
 * exactly what omitting the parameter does upstream, so the two agree.
 */
const profileSchema = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => value || undefined);

const createSchema = z.object({
  /** Per-session model override, honoured by `session.create`; never a config write. */
  model: z.string().trim().max(200).optional(),
  provider: z.string().trim().max(200).optional(),
  profile: profileSchema,
  /**
   * The working directory the agent starts in. `session.create` takes it, checks
   * it with `os.path.isdir` and marks the session as having an explicit cwd;
   * without one Hermes falls back to the profile's configured `terminal.cwd`.
   *
   * Confined to the workspace root like every other path this server sends, so
   * the chat cannot be used to point the agent somewhere the workspace area
   * refuses to show.
   */
  cwd: z.string().trim().max(4096).optional(),
});

const resumeSchema = z.object({
  sessionId: z.string().trim().min(1),
  profile: profileSchema,
});

const attachSchema = z.object({
  liveId: z.string().trim().min(1),
  dataUrl: z
    .string()
    .trim()
    .min(1)
    .max(14 * 1024 * 1024, 'attachment too large')
    .refine((v) => v.startsWith('data:'), { message: 'must be a data URL' }),
  name: z.string().trim().min(1).max(255),
});

/** Usage for a stored conversation; null fields mean Hermes reported none. */
interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

interface ChatSession {
  id: string;
  title: string;
  preview: string;
  startedAt: number | null;
  messageCount: number;
  source: string;
  /** From the stored row; null when the conversation is outside the lookup window. */
  model: string | null;
  pinned: boolean;
  /** Same lookup-window caveat as `model`; null when the row wasn't found. */
  tokens: TokenUsage | null;
}

/** Reduces a gateway session.list result to the list the sidebar renders. */
function normalizeSessions(
  result: unknown,
  models: Map<string, string | null>,
  pins: Set<string>,
  tokens: Map<string, TokenUsage>,
): ChatSession[] {
  const raw = result as { sessions?: unknown } | null;
  const list = Array.isArray(raw?.sessions) ? raw.sessions : [];
  return list.map((entry) => {
    const s = entry as Record<string, unknown>;
    const id = typeof s.id === 'string' ? s.id : '';
    return {
      id,
      title: typeof s.title === 'string' ? s.title.trim() : '',
      preview: typeof s.preview === 'string' ? s.preview.trim() : '',
      startedAt: toEpochMs(s.started_at),
      messageCount: typeof s.message_count === 'number' ? s.message_count : 0,
      source: typeof s.source === 'string' ? s.source : '',
      model: models.get(id) ?? null,
      pinned: pins.has(id),
      tokens: tokens.get(id) ?? null,
    };
  });
}

export async function registerChatRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  cache: ResponseCache,
): Promise<void> {
  app.get('/api/chat/sessions', async (request, reply) => {
    const profile = readProfile((request.query as Record<string, unknown> | undefined)?.profile);
    try {
      // The two calls answer different questions — which conversations exist
      // (gateway, which also filters out internal sub-agent runs) and what each
      // one runs on (stored rows). A failure of the second must not cost the
      // list, so it degrades to "model unknown".
      const [result, stored] = await Promise.all([
        ctx.gateway.request('session.list', { limit: 50, ...(profile ? { profile } : {}) }),
        cache
          .get(sessionsCacheKey(MODEL_LOOKUP_LIMIT, profile), () =>
            ctx.dashboard.sessions(MODEL_LOOKUP_LIMIT, profile),
          )
          .catch(() => ({ sessions: [] as SessionSummary[] })),
      ]);
      const models = new Map(stored.sessions.map((s) => [s.id, s.model]));
      const pins = new Set(stored.sessions.filter((s) => s.pinned).map((s) => s.id));
      const tokens = new Map(
        stored.sessions.map((s) => [
          s.id,
          {
            inputTokens: s.inputTokens,
            outputTokens: s.outputTokens,
            cacheReadTokens: s.cacheReadTokens,
            cacheWriteTokens: s.cacheWriteTokens,
          },
        ]),
      );
      return {
        sessions: normalizeSessions(result, models, pins, tokens)
          .filter((s) => s.id !== '' && !AUTOMATION_SOURCES.has(s.source.trim().toLowerCase()))
          // Pinned first; within each group the gateway's own recency order is
          // kept, so nothing else about the list shifts.
          .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
      };
    } catch (error) {
      return reply.code(503).send({ error: 'gateway_error', message: describeGatewayError(error) });
    }
  });

  app.post('/api/chat/resume', async (request, reply) => {
    const parsed = resumeSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'missing_session' });
    try {
      const result = await ctx.gateway.request<GatewaySessionResult>('session.resume', {
        session_id: parsed.data.sessionId,
        cols: 80,
        ...(parsed.data.profile ? { profile: parsed.data.profile } : {}),
      });
      // Reopening mints a NEW live id; the stored one only names the row.
      // Returning it is what lets the browser prompt into this conversation.
      return {
        ok: true,
        liveId: result.session_id ?? null,
        storedId: result.session_key ?? result.resumed ?? parsed.data.sessionId,
      };
    } catch (error) {
      return reply.code(503).send({ error: 'gateway_error', message: describeGatewayError(error) });
    }
  });

  app.post('/api/chat/attach', { bodyLimit: 15 * 1024 * 1024 }, async (request, reply) => {
    const parsed = attachSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    // ~10 MB of raw bytes is roughly 13.3 MB base64 — reject well before Fastify's
    // own body-size limit so the failure reads as "too big" and not "server error".
    if (parsed.data.dataUrl.length > 14_000_000) {
      return reply
        .code(413)
        .send({ error: 'too_large', message: 'File is too large (max 10 MB).' });
    }
    try {
      const result = await ctx.gateway.request<{
        name?: string;
        ref_text?: string;
      }>('file.attach', {
        session_id: parsed.data.liveId,
        data_url: parsed.data.dataUrl,
        name: parsed.data.name,
      });
      if (!result.ref_text) {
        return reply
          .code(503)
          .send({ error: 'gateway_error', message: 'Attachment was not accepted.' });
      }
      return { name: result.name ?? parsed.data.name, refText: result.ref_text };
    } catch (error) {
      return reply.code(503).send({ error: 'gateway_error', message: describeGatewayError(error) });
    }
  });

  app.post('/api/chat/session', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_session', message: parsed.error.issues[0]?.message ?? 'invalid' });
    }
    const { model, provider, profile, cwd } = parsed.data;

    /*
     * The same boundary the workspace area enforces. Without it the chat would
     * be a way around it: pick any directory, and the agent starts there.
     */
    let workingDir: string | undefined;
    if (cwd) {
      const resolved = ctx.resolveWorkspacePath(cwd);
      if (resolved === null) {
        return reply.code(403).send({
          error: 'outside_workspace',
          message: 'Working directory is outside the workspace root.',
        });
      }
      workingDir = resolved;
    }

    try {
      const result = await ctx.gateway.request<GatewaySessionResult>('session.create', {
        cols: 80,
        source: CHAT_SOURCE,
        // Each of these is a per-session override in Hermes' own words: it is
        // "built into the agent below — never a global config write, so picking
        // a model for a new chat can't mutate the profile default".
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {}),
        ...(profile ? { profile } : {}),
        ...(workingDir ? { cwd: workingDir } : {}),
      });
      if (!result.session_id) {
        return reply
          .code(502)
          .send({ error: 'no_session', message: 'Keine Sitzungs-ID erhalten.' });
      }
      // The new conversation is not in the cached session list yet, and the
      // sidebar reloads right after the first message lands.
      cache.invalidatePrefix(SESSIONS_CACHE_PREFIX);
      return { liveId: result.session_id, storedId: result.stored_session_id ?? null };
    } catch (error) {
      return reply
        .code(503)
        .send({ error: 'gateway_unreachable', message: describeGatewayError(error) });
    }
  });

  app.post('/api/chat/prompt', async (request, reply) => {
    const parsed = promptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_prompt',
        message: parsed.error.issues[0]?.message ?? 'invalid request',
      });
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

  /**
   * Stop a live turn.
   *
   * Without this, the only way to unstick a long-running turn was killing the
   * dashboard process — which does not cancel it. Hermes' own recovery treats
   * a dropped connection as an interruption and auto-continues the same turn
   * on the next attach, so the "hang" just came back. `session.interrupt` is
   * the real cancel: it stops the turn server-side instead of merely hiding it
   * from this connection.
   */
  app.post('/api/chat/interrupt', async (request, reply) => {
    const parsed = interruptSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      await ctx.gateway.request('session.interrupt', { session_id: parsed.data.sessionId });
      return { ok: true };
    } catch (error) {
      return reply.code(503).send({ error: 'gateway_error', message: describeGatewayError(error) });
    }
  });

  /**
   * Repoint a live conversation at another model.
   *
   * `config.set` parses `value` the way the `/model` command line is parsed, so
   * the flags matter more than they look:
   *
   * - `--session` is not optional decoration. Without it the decision falls to
   *   `model.persist_switch_by_default` in the user's config.yaml, and a user
   *   who set that to true would have their agent's default rewritten by what
   *   looks like a per-chat pick. The promise this control center makes is that
   *   picking a model here changes this conversation and nothing else.
   * - `--provider` is only sent when the slug survives the whitespace split the
   *   parser does; otherwise the model name alone resolves it.
   *
   * Hermes refuses mid-turn (its own comment: the worker thread reads the model
   * and base URL on every iteration, so a swap mid-flight can send the new URL
   * with the old model), and can demand confirmation for an expensive model.
   * Both come back as an honest state rather than a thrown error.
   *
   * The `session.status` probe first is not ceremony. `config.set` looks the id
   * up with a plain map read and, finding nothing, quietly switches a throwaway
   * dictionary instead — it answers `ok` with `scope: "session"` for a session
   * that does not exist. Verified against the running server. Without the probe
   * a stale id (a reaped or expired session) would be reported to the user as a
   * completed switch that never happened.
   */
  app.post('/api/chat/model', async (request, reply) => {
    const parsed = modelSwitchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_model', message: parsed.error.issues[0]?.message ?? 'invalid' });
    }
    const { sessionId, model, provider, confirm } = parsed.data;
    const flags = provider && !/\s/.test(provider) ? ` --provider ${provider}` : '';
    try {
      try {
        await ctx.gateway.request('session.status', { session_id: sessionId });
      } catch {
        return reply
          .code(409)
          .send({ error: 'session_not_live', message: 'This conversation is no longer attached.' });
      }
      const result = await ctx.gateway.request<{
        value?: string;
        scope?: string;
        warning?: string;
        confirm_required?: boolean;
        confirm_message?: string;
      }>('config.set', {
        session_id: sessionId,
        key: 'model',
        value: `${model}${flags} --session`,
        ...(confirm ? { confirm_expensive_model: true } : {}),
      });
      return {
        ok: result.confirm_required !== true,
        model: result.value ?? model,
        scope: result.scope ?? null,
        warning: result.warning || null,
        confirmRequired: result.confirm_required === true,
        confirmMessage: result.confirm_message || null,
      };
    } catch (error) {
      return reply.code(503).send({ error: 'gateway_error', message: describeGatewayError(error) });
    }
  });

  app.get('/api/chat/history', async (request, reply) => {
    const query = request.query as { sessionId?: string; profile?: unknown } | undefined;
    const sessionId = query?.sessionId;
    if (!sessionId) return reply.code(400).send({ error: 'missing_session' });
    try {
      // The stored transcript (dashboard REST) is authoritative and needs no
      // resume; the gateway's own history only holds a live session's turns.
      const messages = await ctx.dashboard.sessionMessages(sessionId, readProfile(query?.profile));
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
      if (reply.raw.writableEnded) {
        log.debug(
          `SSE dropped ${event.type} for ${event.sessionId ?? '-'}: response already ended`,
        );
        return;
      }
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

/** Reads a profile from a query string, treating blank as "not scoped". */
function readProfile(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function describeGatewayError(error: unknown): string {
  if (error instanceof GatewayError) return error.message;
  return error instanceof Error ? error.message : 'Unknown error';
}
