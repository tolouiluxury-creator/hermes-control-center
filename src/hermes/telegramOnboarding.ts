/**
 * Client for Hermes' own Telegram "Managed Bots" onboarding service.
 *
 * This is not BotFather automation — it talks to the same Nous-hosted
 * pairing API Hermes' own CLI uses (`hermes_cli/telegram_managed_bot.py`),
 * which brokers Telegram's own Managed Bots feature. The user completes
 * the pairing by opening a `t.me/newbot/...` deep link in their own
 * Telegram client; this server never sees their Telegram credentials, only
 * the resulting bot token and the id of whoever completed it.
 */

const DEFAULT_API_URL = 'https://setup.hermes-agent.nousresearch.com';
const DEFAULT_BOT_NAME = 'Hermes Control Center';
const REQUEST_TIMEOUT_MS = 10_000;

/** Matches Hermes' own validation (`_TELEGRAM_BOT_TOKEN_RE`). */
const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;

export class TelegramOnboardingError extends Error {}

export interface TelegramOnboardingPairing {
  pairingId: string;
  pollToken: string;
  deepLink: string;
  qrPayload: string;
  expiresAt: string | null;
}

export interface TelegramOnboardingResult {
  token: string;
  botUsername: string | null;
  ownerUserId: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Starts a pairing. The returned deep link is what the user opens in Telegram. */
export async function createTelegramOnboardingPairing(
  botName: string = DEFAULT_BOT_NAME,
): Promise<TelegramOnboardingPairing> {
  let response: Response;
  try {
    response = await fetch(`${DEFAULT_API_URL}/v1/telegram/pairings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bot_name: botName }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TelegramOnboardingError(
      `Could not reach the Telegram onboarding service: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new TelegramOnboardingError(`Onboarding service returned HTTP ${response.status}.`);
  }
  const data = asRecord(await response.json().catch(() => null));
  const required = ['pairing_id', 'poll_token', 'deep_link'] as const;
  for (const key of required) {
    if (typeof data[key] !== 'string' || !data[key]) {
      throw new TelegramOnboardingError('Onboarding service returned an incomplete pairing.');
    }
  }
  return {
    pairingId: data.pairing_id as string,
    pollToken: data.poll_token as string,
    deepLink: data.deep_link as string,
    qrPayload: typeof data.qr_payload === 'string' ? data.qr_payload : (data.deep_link as string),
    expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
  };
}

/**
 * Polls once. `null` means the user has not finished the Telegram side yet —
 * the caller is expected to call again after a short delay, not treat this
 * as failure.
 */
export async function pollTelegramOnboarding(
  pairingId: string,
  pollToken: string,
): Promise<TelegramOnboardingResult | null> {
  let response: Response;
  try {
    response = await fetch(
      `${DEFAULT_API_URL}/v1/telegram/pairings/${encodeURIComponent(pairingId)}`,
      {
        headers: { authorization: `Bearer ${pollToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw new TelegramOnboardingError(
      `Could not reach the Telegram onboarding service: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // The pairing expired or was never valid — same "start over" outcome either way.
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) {
    throw new TelegramOnboardingError(`Onboarding service returned HTTP ${response.status}.`);
  }
  const data = asRecord(await response.json().catch(() => null));
  if (data.status !== 'ready') return null;

  const token = data.token;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new TelegramOnboardingError('Onboarding service returned a malformed bot token.');
  }
  const ownerUserId = data.owner_user_id;
  return {
    token,
    botUsername: typeof data.bot_username === 'string' ? data.bot_username : null,
    ownerUserId:
      typeof ownerUserId === 'number'
        ? String(ownerUserId)
        : typeof ownerUserId === 'string' && /^\d+$/.test(ownerUserId)
          ? ownerUserId
          : null,
  };
}
