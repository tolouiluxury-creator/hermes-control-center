import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { exec as execCb } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BotCreateInput, BotDetails, BotOperationResult } from '../hermes/bots.js';
import type { BotPatch, BotRoutineInput, BotState } from '../store/bots.js';

const execAsync = promisify(execCb);
/** Quote a string for a single shell word. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

/** Accent colors the UI offers (web/src/pages/BotsPage.tsx ACCENTS). Anything
 * else would be stored but never rendered — reject it at the boundary. */
const ACCENT_KEYS = new Set(['green', 'blue', 'purple', 'amber', 'rose']);

const createSchema = z
  .object({
    profileName: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    description: z.string().optional(),
    avatarKey: z.string().nullable().optional(),
    accent: z.string().nullable().optional(),
    cloneFrom: z.string().trim().min(1).optional(),
    cloneAll: z.boolean().optional(),
    noSkills: z.boolean().optional(),
    model: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1).optional(),
  })
  .refine((input) => Boolean(input.model) === Boolean(input.provider), {
    message: 'Model and provider must be selected together.',
  });

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    avatarKey: z.string().trim().max(16).nullable().optional(),
    accent: z
      .string()
      .trim()
      .max(32)
      .nullable()
      .refine((v) => v === null || ACCENT_KEYS.has(v), {
        message: 'Unknown accent color.',
      })
      .optional(),
    lastSeenAt: z.number().int().nonnegative().nullable().optional(),
    model: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1).optional(),
  })
  .refine(
    (input) =>
      (input.model === undefined && input.provider === undefined) ||
      Boolean(input.model) === Boolean(input.provider),
    {
      message: 'Model and provider must be selected together.',
    },
  );

const routineSchema = z.object({
  type: z.enum(['workflow', 'cron']),
  routineId: z.string().trim().min(1),
  enabled: z.boolean(),
});

/** Remove a link — the enabled flag is meaningless for deletion. */
const routineUnlinkSchema = routineSchema.omit({ enabled: true });

/** Bot↔Bot DM: from one bot to another bot's own chat. */
const dmSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  toBotId: z.string().trim().min(1).optional(),
  toBotIds: z.array(z.string().trim().min(1)).min(1).max(10).optional(),
});

const chatSessionSchema = z.object({ sessionId: z.string().trim().min(1) });

export interface BotRoutesService {
  list(includeHidden?: boolean): Promise<BotDetails[]>;
  get(id: string): Promise<BotDetails | null>;
  create(input: BotCreateInput): Promise<BotDetails['bot']>;
  update(id: string, patch: BotPatch): Promise<BotDetails['bot'] | null>;
  delete(id: string): Promise<BotDetails['bot'] | null>;
  setCanonicalChatSession(id: string, sessionId: string): BotDetails['bot'] | null;
  setHidden(id: string, hidden: boolean): Promise<BotDetails['bot'] | null>;
  setState(id: string, state: BotState): Promise<BotOperationResult>;
  linkRoutine(id: string, routine: BotRoutineInput): void;
  setRoutineEnabled(id: string, routine: BotRoutineInput, enabled: boolean): void;
  unlinkRoutine(id: string, routine: BotRoutineInput): void;
  /** Optional run-history hook (Runs page). Injected by context. */
  recordActivity?(
    label: string,
    output: string,
    options?: { status?: 'completed' | 'failed'; workflowId?: string },
  ): unknown;
}

function notFound(reply: FastifyReply): unknown {
  return reply.code(404).send({ error: 'bot_not_found', message: 'Bot not found.' });
}

export async function registerBotRoutes(
  app: FastifyInstance,
  service: BotRoutesService,
): Promise<void> {
  app.get('/api/bots', async (request) => {
    const query = request.query as { includeHidden?: string | string[] };
    const raw = Array.isArray(query.includeHidden) ? query.includeHidden[0] : query.includeHidden;
    return { bots: await service.list(raw === '1' || raw === 'true') };
  });

  app.post('/api/bots', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'Invalid Bot creation request.' });
    return service.create(parsed.data);
  });

  app.get('/api/bots/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await service.get(id);
    return result ?? notFound(reply);
  });

  app.patch('/api/bots/:id', async (request, reply) => {
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'Invalid Bot update request.' });
    const { id } = request.params as { id: string };
    const result = await service.update(id, parsed.data);
    return result ?? notFound(reply);
  });

  app.post('/api/bots/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await service.setHidden(id, true);
    return result ?? notFound(reply);
  });

  app.delete('/api/bots/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await service.delete(id);
      return result ?? notFound(reply);
    } catch (error) {
      if (error instanceof Error && error.message.includes('launch profile')) {
        return reply.code(409).send({ error: 'protected_profile', message: error.message });
      }
      throw error;
    }
  });

  app.post('/api/bots/:id/chat-session', async (request, reply) => {
    const parsed = chatSessionSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'A stored chat session ID is required.' });
    const { id } = request.params as { id: string };
    const result = service.setCanonicalChatSession(id, parsed.data.sessionId);
    return result ?? notFound(reply);
  });

  app.post('/api/bots/:id/pause', async (request, reply) => {
    const { id } = request.params as { id: string };
    return service.setState(id, 'paused').catch((error: unknown) => {
      if (error instanceof Error && error.message === 'Bot not found.') return notFound(reply);
      throw error;
    });
  });

  app.post('/api/bots/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    return service.setState(id, 'active').catch((error: unknown) => {
      if (error instanceof Error && error.message === 'Bot not found.') return notFound(reply);
      throw error;
    });
  });

  for (const [path, hidden] of [
    ['hide', true],
    ['unhide', false],
  ] as const) {
    app.post(`/api/bots/:id/${path}`, async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await service.setHidden(id, hidden);
      return result ?? notFound(reply);
    });
  }

  app.put('/api/bots/:id/routines', async (request, reply) => {
    const parsed = routineSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'Invalid Bot routine request.' });
    const { id } = request.params as { id: string };
    const routine = { type: parsed.data.type, routineId: parsed.data.routineId };
    service.setRoutineEnabled(id, routine, parsed.data.enabled === true);
    return { ok: true };
  });

  app.delete('/api/bots/:id/routines', async (request, reply) => {
      const parsed = routineUnlinkSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'invalid_request', message: 'Invalid Bot routine request.' });
      const { id } = request.params as { id: string };
      const routine = { type: parsed.data.type, routineId: parsed.data.routineId };
      service.unlinkRoutine(id, routine);
      return { ok: true };
    });

    /** Bot↔Bot DM: hand a message to another bot's own chat via the CLI
     * handoff (`hermes -p <target> chat --in <dir> -q …`), the same mechanism
     * the Hermes desktop bot mode uses. The target bot answers in its own
     * profile chat; the sender's identity is embedded in the message. */
    app.post('/api/bots/:id/dm', async (request, reply) => {
      const parsed = dmSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'invalid_request', message: 'A message text and a target bot are required.' });
      const { id } = request.params as { id: string };
      const sender = await service.get(id);
      if (!sender) return notFound(reply);
      const senderName = sender.bot.name;
      const prompt = `[Von @${senderName}]: ${parsed.data.text}`;

      // Fan-out: several targets at once. Each handoff runs in its own
      // temp inbox; failures are collected per-bot instead of failing all.
      const targets = parsed.data.toBotIds ?? (parsed.data.toBotId ? [parsed.data.toBotId] : []);
      if (targets.length === 0)
        return reply
          .code(400)
          .send({ error: 'invalid_request', message: 'A target bot is required.' });
      const results = await Promise.all(
        targets.map(async (toBotId) => {
          const target = await service.get(toBotId);
          if (!target) return { botId: toBotId, ok: false, error: 'not_found' };
          const inboxDir = mkdtempSync(join(tmpdir(), 'cc-dm-'));
          try {
            const queryFile = join(inboxDir, 'msg.txt');
            writeFileSync(queryFile, prompt, 'utf8');
            const { stdout } = await execAsync(
              `hermes -p ${shellQuote(target.bot.profileName)} chat --in ${shellQuote(inboxDir)} -q "$(cat ${shellQuote(queryFile)})"`,
              { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
            );
            // The CLI prints the agent's answer inside a box header/footer; the
            // tail beyond it is resume hints. Extract the boxed answer if present.
            const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
            const boxStart = lines.findIndex((line) => line.includes('╭'));
            const boxEnd = lines.findIndex((line) => line.includes('╰'));
            const replyText =
              boxStart >= 0 && boxEnd > boxStart
                ? lines.slice(boxStart + 1, boxEnd).join(' ').replace(/\s+/g, ' ').trim()
                : lines.slice(-4).join(' ');
            return { botId: toBotId, botName: target.bot.name, ok: true, reply: replyText };
          } catch (error) {
            request.log.error({ err: error }, 'bot dm handoff failed');
            return {
              botId: toBotId,
              botName: target.bot.name,
              ok: false,
              error: error instanceof Error ? error.message : 'DM handoff failed.',
            };
          } finally {
            rmSync(inboxDir, { recursive: true, force: true });
          }
        }),
      );
      const failed = results.filter((r) => !r.ok);
      if (results.length === 1 && failed.length === 1) {
        service.recordActivity?.(
          `DM @${senderName} → ${results[0]?.botName ?? '?'}`,
          failed[0]?.error ?? 'DM handoff failed.',
          { status: 'failed' },
        );
        return reply
          .code(502)
          .send({ error: 'dm_failed', message: failed[0]?.error ?? 'DM handoff failed.' });
      }
      service.recordActivity?.(
        `DM @${senderName} → ${results.map((r) => r.botName ?? r.botId).join(', ')}`,
        results
          .filter((r) => r.ok)
          .map((r) => `${r.botName}: ${r.reply}`)
          .join('\n') || 'keine erfolgreiche Antwort',
        { status: failed.length > 0 ? 'failed' : 'completed' },
      );
      return { ok: failed.length === 0, results };
    });
}
