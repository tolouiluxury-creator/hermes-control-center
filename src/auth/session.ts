import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Stateless session tokens: `<payload-b64url>.<hmac-b64url>`.
 *
 * Stateless keeps the server free of session storage, and rotating the secret
 * (or setting a new password) invalidates every outstanding session at once.
 */

export const SESSION_COOKIE = 'hcc_session';
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface SessionPayload {
  /** Expiry, epoch milliseconds. */
  exp: number;
  /** Issued at, epoch milliseconds. */
  iat: number;
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

function sign(secret: string, payload: string): string {
  return base64url(createHmac('sha256', secret).update(payload).digest());
}

export function generateSessionSecret(): string {
  return randomBytes(32).toString('base64');
}

export function createSessionToken(
  secret: string,
  ttlMs: number = DEFAULT_SESSION_TTL_MS,
  now: number = Date.now(),
): string {
  const payload: SessionPayload = { iat: now, exp: now + ttlMs };
  const encoded = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${encoded}.${sign(secret, encoded)}`;
}

export type SessionCheck =
  | { valid: true; expiresAt: number }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifySessionToken(
  secret: string,
  token: string | undefined,
  now: number = Date.now(),
): SessionCheck {
  if (!token) return { valid: false, reason: 'malformed' };

  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) {
    return { valid: false, reason: 'malformed' };
  }

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(secret, encoded);

  // Compare via fixed-length digests so length differences leak nothing.
  const provided = Buffer.from(signature, 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return { valid: false, reason: 'malformed' };
  }
  if (payload.exp <= now) return { valid: false, reason: 'expired' };

  return { valid: true, expiresAt: payload.exp };
}

/** Reads one cookie value out of a raw Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

export interface CookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

export function buildSessionCookie(token: string, options: CookieOptions): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function buildClearedSessionCookie(secure: boolean): string {
  const attributes = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}
