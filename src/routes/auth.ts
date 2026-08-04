import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.js';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  generateSessionSecret,
} from '../auth/session.js';
import { hashPassword, validatePasswordStrength } from '../auth/password.js';
import { loadControlCenterConfig, updateControlCenterConfig } from '../config.js';
import { log } from '../log.js';

/** Paths reachable without a session; everything else under /api is gated. */
const PUBLIC_API_PATHS = new Set(['/api/auth/status', '/api/auth/login', '/api/auth/logout']);

/**
 * True when the connection reached the client over TLS. Behind Cloudflare or a
 * reverse proxy the hop to us is plain HTTP, so the forwarded header decides —
 * this only controls the cookie's Secure flag, never an access decision.
 */
function isSecureRequest(request: FastifyRequest): boolean {
  const forwarded = request.headers['x-forwarded-proto'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof value === 'string' && value.length > 0) {
    return value.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  return request.protocol === 'https';
}

function clientKey(request: FastifyRequest): string {
  return request.ip || 'unknown';
}

export async function registerAuthRoutes(app: FastifyInstance, auth: AuthService): Promise<void> {
  /** Lets the SPA decide between the login screen and the app. */
  app.get('/api/auth/status', async (request) => ({
    required: auth.required,
    authenticated: auth.isAuthenticated(request.headers.cookie),
  }));

  app.post('/api/auth/login', async (request, reply) => {
    if (!auth.required) {
      return reply.code(400).send({
        error: 'not_configured',
        message: 'No password is configured, so there is nothing to log in to.',
      });
    }

    const body = request.body as { password?: unknown } | undefined;
    const password = typeof body?.password === 'string' ? body.password : '';

    if (password === '') {
      return reply.code(400).send({ error: 'missing_password', message: 'Password is required.' });
    }

    const outcome = auth.login(password, clientKey(request));

    if (!outcome.ok) {
      if (outcome.reason === 'throttled') {
        const seconds = Math.ceil(outcome.retryAfterMs / 1000);
        log.warn(`Login throttled for ${clientKey(request)} (${seconds}s)`);
        return reply
          .code(429)
          .header('retry-after', String(seconds))
          .send({
            error: 'throttled',
            message: `Too many attempts. Try again in ${seconds} seconds.`,
            retryAfterMs: outcome.retryAfterMs,
          });
      }

      log.warn(`Failed login attempt from ${clientKey(request)}`);
      // Deliberately vague: no hint about whether a password even exists.
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Wrong password.' });
    }

    const token = auth.issueToken();
    reply.header(
      'set-cookie',
      buildSessionCookie(token, {
        secure: isSecureRequest(request),
        maxAgeSeconds: Math.floor(auth.sessionTtlMs / 1000),
      }),
    );
    log.info(`Login succeeded from ${clientKey(request)}`);
    return { ok: true };
  });

  app.post('/api/auth/change-password', async (request, reply) => {
    if (!auth.required) {
      return reply.code(400).send({
        error: 'not_configured',
        message:
          'No password is configured yet — set one with hermes-control-center --set-password.',
      });
    }

    const body = request.body as { currentPassword?: unknown; newPassword?: unknown } | undefined;
    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

    if (currentPassword === '' || newPassword === '') {
      return reply.code(400).send({
        error: 'missing_fields',
        message: 'Both the current and the new password are required.',
      });
    }

    // Reuses the login throttle, so this endpoint cannot be used to brute-force
    // the current password either.
    const outcome = auth.login(currentPassword, clientKey(request));
    if (!outcome.ok) {
      if (outcome.reason === 'throttled') {
        const seconds = Math.ceil(outcome.retryAfterMs / 1000);
        log.warn(`Password-change throttled for ${clientKey(request)} (${seconds}s)`);
        return reply
          .code(429)
          .header('retry-after', String(seconds))
          .send({
            error: 'throttled',
            message: `Too many attempts. Try again in ${seconds} seconds.`,
            retryAfterMs: outcome.retryAfterMs,
          });
      }

      log.warn(`Password change rejected (wrong current password) from ${clientKey(request)}`);
      return reply
        .code(401)
        .send({ error: 'wrong_password', message: 'Current password is wrong.' });
    }

    const problem = validatePasswordStrength(newPassword);
    if (problem) {
      return reply.code(400).send({ error: 'weak_password', message: problem });
    }

    const passwordHash = hashPassword(newPassword);
    // Keep the existing session secret — a password change should not silently
    // log out other devices, matching `--set-password`'s own behaviour.
    const existing = loadControlCenterConfig().config.auth;
    updateControlCenterConfig({
      auth: { passwordHash, sessionSecret: existing?.sessionSecret ?? generateSessionSecret() },
    });
    // Applies to the already-running process too — otherwise only the old
    // password would work until the next restart, even though the new hash is
    // already on disk.
    auth.updatePasswordHash(passwordHash);

    log.info(`Password changed from ${clientKey(request)}`);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    reply.header('set-cookie', buildClearedSessionCookie(isSecureRequest(request)));
    return { ok: true };
  });
}

/**
 * Gate for everything else. Registered as an onRequest hook so no route can
 * forget it — including the SSE stream, which would otherwise leak live agent
 * data to an unauthenticated client.
 */
export function registerAuthGuard(app: FastifyInstance, auth: AuthService): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!auth.required) return;

    const path = request.url.split(/[?#]/, 1)[0] ?? '/';
    if (!path.startsWith('/api/')) return; // The SPA shell renders the login form.
    if (PUBLIC_API_PATHS.has(path)) return;

    if (!auth.isAuthenticated(request.headers.cookie)) {
      return reply.code(401).send({
        error: 'unauthenticated',
        message: 'Sign in to use the control center.',
      });
    }
  });
}
