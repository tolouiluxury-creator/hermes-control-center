import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { UpstreamError } from '../hermes/client.js';
import {
  createTelegramOnboardingPairing,
  pollTelegramOnboarding,
  TelegramOnboardingError,
} from '../hermes/telegramOnboarding.js';
import { CACHE_KEYS, type ResponseCache } from './cache.js';

/**
 * The "automatic" half of Telegram setup: a thin proxy in front of Hermes'
 * own Managed Bots onboarding service (see telegramOnboarding.ts). The poll
 * token never reaches the browser — only a pairing id does — and once the
 * pairing completes, the token and owner id are written straight into
 * Hermes' env via the same path Settings uses, never round-tripped through
 * the client.
 */

interface StoredPairing {
  pollToken: string;
  profile: string | null;
  expiresAt: number;
}

// Generous over the service's own pairing window: worst case a stale entry
// just answers "expired" a bit early, never wrong in the other direction.
const PAIRING_TTL_MS = 15 * 60 * 1000;

const startSchema = z.object({
  profile: z.string().trim().max(120).optional(),
});

export async function registerTelegramSetupRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  cache: ResponseCache,
): Promise<void> {
  const pairings = new Map<string, StoredPairing>();

  const sweep = (): void => {
    const now = Date.now();
    for (const [id, pairing] of pairings) {
      if (pairing.expiresAt < now) pairings.delete(id);
    }
  };

  const guard = async <T>(reply: FastifyReply, work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof UpstreamError) {
        void reply.code(error.clientStatus).send(error.toJSON());
        return undefined;
      }
      if (error instanceof TelegramOnboardingError) {
        void reply.code(502).send({ error: 'onboarding_unreachable', message: error.message });
        return undefined;
      }
      throw error;
    }
  };

  app.post('/api/hermes/telegram/setup/start', async (request, reply) => {
    sweep();
    const parsed = startSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    return guard(reply, async () => {
      const pairing = await createTelegramOnboardingPairing();
      pairings.set(pairing.pairingId, {
        pollToken: pairing.pollToken,
        profile: parsed.data.profile ?? null,
        expiresAt: Date.now() + PAIRING_TTL_MS,
      });
      return {
        pairingId: pairing.pairingId,
        deepLink: pairing.deepLink,
        qrPayload: pairing.qrPayload,
      };
    });
  });

  app.get('/api/hermes/telegram/setup/:id', async (request, reply) => {
    sweep();
    const { id } = request.params as { id: string };
    const stored = pairings.get(id);
    if (!stored) return { status: 'expired' as const };
    return guard(reply, async () => {
      const result = await pollTelegramOnboarding(id, stored.pollToken);
      if (!result) return { status: 'pending' as const };

      pairings.delete(id);
      const profile = stored.profile ?? undefined;
      await ctx.dashboard.setEnv('TELEGRAM_BOT_TOKEN', result.token, profile);
      if (result.ownerUserId) {
        await ctx.dashboard.setEnv('TELEGRAM_ALLOWED_USERS', result.ownerUserId, profile);
      }
      cache.invalidatePrefix(CACHE_KEYS.env);
      cache.invalidatePrefix(CACHE_KEYS.messaging);

      return {
        status: 'ready' as const,
        botUsername: result.botUsername,
        ownerUserId: result.ownerUserId,
      };
    });
  });

  /** Lets the UI give up early — e.g. the user closed the QR dialog. */
  app.delete('/api/hermes/telegram/setup/:id', async (request) => {
    const { id } = request.params as { id: string };
    pairings.delete(id);
    return { ok: true };
  });
}
