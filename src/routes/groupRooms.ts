import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { BotRoutesService } from './bots.js';
import { botHandoff } from '../hermes/botHandoff.js';
import type { GroupRoomsRepo, GroupRoomWithMembers } from '../store/groupRooms.js';

export interface GroupRoomsRoutesDeps {
  rooms: GroupRoomsRepo;
  bots: BotRoutesService;
}

const roomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberBotIds: z.array(z.string().trim().min(1)).min(1).max(20),
});

const messageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

const membersSchema = z.object({
  memberBotIds: z.array(z.string().trim().min(1)).min(1).max(20),
});

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: 'room_not_found', message: 'Room not found.' });
}

/** Room shape the UI needs: members expanded to bot names via the bots service. */
async function toRoomWithBots(
  deps: GroupRoomsRoutesDeps,
  room: GroupRoomWithMembers,
): Promise<{ room: GroupRoomWithMembers; members: { botId: string; name: string }[] }> {
  const members = await Promise.all(
    room.memberBotIds.map(async (botId) => {
      const bot = await deps.bots.get(botId);
      return { botId, name: bot?.bot.name ?? botId };
    }),
  );
  return { room, members };
}

export async function registerGroupRoomsRoutes(
  app: FastifyInstance,
  deps: GroupRoomsRoutesDeps,
): Promise<void> {
  app.get('/api/rooms', async (_request, reply) => {
    const rooms = await Promise.all(
      deps.rooms.listRooms().map((room) => toRoomWithBots(deps, room)),
    );
    return { rooms };
  });

  app.get('/api/rooms/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const room = deps.rooms.getRoom(id);
    if (!room) return notFound(reply);
    const messages = deps.rooms
      .messages(id)
      .map((m) => ({
        ...m,
        senderBotName: null as string | null,
      }));
    // Resolve sender names for stored messages.
    const withNames = await Promise.all(
      messages.map(async (m) => {
        if (!m.senderBotId) return { ...m, senderBotName: null };
        const bot = await deps.bots.get(m.senderBotId);
        return { ...m, senderBotName: bot?.bot.name ?? m.senderBotId };
      }),
    );
    return { room: await toRoomWithBots(deps, room), messages: withNames };
  });

  app.post('/api/rooms', async (request, reply) => {
    const parsed = roomSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'A room name and at least one bot are required.' });
    const room = deps.rooms.createRoom(parsed.data.name, parsed.data.memberBotIds);
    return toRoomWithBots(deps, room);
  });

  app.delete('/api/rooms/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return deps.rooms.deleteRoom(id) ? { ok: true } : notFound(reply);
  });

  app.put('/api/rooms/:id/members', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = membersSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_request', message: 'At least one bot is required.' });
    const room = deps.rooms.setMembers(id, parsed.data.memberBotIds);
    if (!room) return notFound(reply);
    return toRoomWithBots(deps, room);
  });

  /**
   * Deliberation round: feed the room's latest replies back to every member so
   * they can react to each other — the start of a real multi-bot discussion.
   * Uses the last few assistant messages as discussion context.
   */
  app.post('/api/rooms/:id/deliberate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const room = deps.rooms.getRoom(id);
    if (!room) return notFound(reply);

    const history = deps.rooms.messages(id, 10);
    const recent = history.filter((m) => m.kind === 'assistant').slice(-3);
    const context =
      recent.length > 0
        ? recent
            .map((m) => {
              const sender = m.senderBotId ? `Bot ${m.senderBotId.slice(0, 8)}` : 'Unbekannt';
              return `${sender}: ${m.text}`;
            })
            .join('\n')
        : 'Es gibt noch keine früheren Antworten.';

    const results = await Promise.all(
      room.memberBotIds.map(async (botId) => {
        const bot = await deps.bots.get(botId);
        if (!bot) return { botId, ok: false as const, error: 'not_found' };
        const prompt = `[Raum-Diskussion – Runde: reagiere auf die anderen]\nBisher gesagt:\n${context}\n\nDeine Reaktion (kurz, 1-2 Sätze):`;
        const outcome = await botHandoff(bot.bot.profileName, prompt);
        if (outcome.ok) {
          deps.rooms.addMessage(id, outcome.reply, 'assistant', botId);
          return { botId, botName: bot.bot.name, ok: true as const, reply: outcome.reply };
        }
        return { botId, botName: bot.bot.name, ok: false as const, error: outcome.error };
      }),
    );

    deps.bots.recordActivity?.(
      `Deliberation ${room.name}`,
      results
        .filter((r) => r.ok)
        .map((r) => `${r.botName}: ${r.reply}`)
        .join('\n') || 'keine erfolgreiche Antwort',
      { status: results.every((r) => r.ok) ? 'completed' : 'failed' },
    );
    return { results, messages: deps.rooms.messages(id) };
  });

  /**
   * Post a message to a room: store the user message, fan out to every member
   * via the CLI handoff, store each member's reply as an assistant message,
   * and return the whole transcript.
   */
  app.post('/api/rooms/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_request', message: 'A message text is required.' });
    const room = deps.rooms.getRoom(id);
    if (!room) return notFound(reply);

    const userMsg = deps.rooms.addMessage(id, parsed.data.text, 'user');

    // Fire-and-forget: Die Bot-Antworten laufen im Hintergrund weiter, die
    // Antwort kommt SOFORT — so fühlt sich das Senden nicht blockierend an.
    // Die UI pollt die Nachrichten (refetchInterval), bis alle Bots fertig sind.
    void (async () => {
      try {
        const results = await Promise.all(
          room.memberBotIds.map(async (botId) => {
            const bot = await deps.bots.get(botId);
            if (!bot) return { botId, ok: false as const, error: 'not_found' };
            const prompt = `[Raum-Diskussion – von @${bot.bot.name} an den Raum]: ${parsed.data.text}`;
            const outcome = await botHandoff(bot.bot.profileName, prompt);
            if (outcome.ok) {
              deps.rooms.addMessage(id, outcome.reply, 'assistant', botId);
              return { botId, botName: bot.bot.name, ok: true as const, reply: outcome.reply };
            }
            return { botId, botName: bot.bot.name, ok: false as const, error: outcome.error };
          }),
        );
        deps.bots.recordActivity?.(
          `Raum ${room.name}: ${parsed.data.text.slice(0, 60)}`,
          results
            .filter((r) => r.ok)
            .map((r) => `${r.botName}: ${r.reply}`)
            .join('\n') || 'keine erfolgreiche Antwort',
          { status: results.every((r) => r.ok) ? 'completed' : 'failed' },
        );
      } catch (error) {
        deps.rooms.addMessage(
          id,
          `Fehler bei der Raum-Verarbeitung: ${error instanceof Error ? error.message : String(error)}`,
          'assistant',
        );
      }
    })();

    return { userMessage: userMsg, messages: deps.rooms.messages(id) };
  });
}