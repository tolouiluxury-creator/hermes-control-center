import type { AuthConfig } from '../config.js';
import { verifyPassword } from './password.js';
import {
  DEFAULT_SESSION_TTL_MS,
  SESSION_COOKIE,
  createSessionToken,
  readCookie,
  verifySessionToken,
} from './session.js';
import { LoginThrottle } from './throttle.js';

export interface LoginOutcome {
  ok: boolean;
  /** Set when the attempt was refused before the password was even checked. */
  retryAfterMs: number;
  reason: 'ok' | 'wrong_password' | 'throttled' | 'not_configured';
}

/**
 * The single place that answers "is this request allowed?".
 *
 * When no password is configured the service reports `required === false`, and
 * the server only permits that on a loopback bind — see `assertBindIsSafe`.
 */
export class AuthService {
  private readonly throttle = new LoginThrottle();

  constructor(private config: AuthConfig | null) {}

  /** True when a password is configured, i.e. requests must be authenticated. */
  get required(): boolean {
    return this.config !== null;
  }

  /**
   * Applies a new password hash to the live service, so a change made through
   * the web UI takes effect immediately. Without this the process would keep
   * accepting only the old password until restarted, even though the new hash
   * is already on disk.
   */
  updatePasswordHash(passwordHash: string): void {
    if (!this.config) throw new Error('Cannot change a password before one is configured.');
    this.config = { ...this.config, passwordHash };
  }

  get sessionTtlMs(): number {
    return DEFAULT_SESSION_TTL_MS;
  }

  /**
   * Attempts a login. `clientKey` scopes the throttle — the remote address, so
   * one hostile client cannot lock out another.
   */
  login(password: string, clientKey: string, now: number = Date.now()): LoginOutcome {
    if (!this.config) {
      return { ok: false, retryAfterMs: 0, reason: 'not_configured' };
    }

    const decision = this.throttle.check(clientKey, now);
    if (!decision.allowed) {
      return { ok: false, retryAfterMs: decision.retryAfterMs, reason: 'throttled' };
    }

    if (!verifyPassword(password, this.config.passwordHash)) {
      const failure = this.throttle.recordFailure(clientKey, now);
      return { ok: false, retryAfterMs: failure.retryAfterMs, reason: 'wrong_password' };
    }

    this.throttle.recordSuccess(clientKey);
    return { ok: true, retryAfterMs: 0, reason: 'ok' };
  }

  issueToken(now: number = Date.now()): string {
    if (!this.config)
      throw new Error('Cannot issue a session token without a configured password.');
    return createSessionToken(this.config.sessionSecret, this.sessionTtlMs, now);
  }

  /** Validates the session cookie on an incoming request. */
  isAuthenticated(cookieHeader: string | undefined, now: number = Date.now()): boolean {
    if (!this.config) return true;
    const token = readCookie(cookieHeader, SESSION_COOKIE);
    return verifySessionToken(this.config.sessionSecret, token, now).valid;
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/**
 * Refuses to expose an unauthenticated control center beyond this machine. The
 * app can restart the gateway, write environment variables and chat as the user,
 * so an open bind without a password is never an acceptable default.
 */
export function assertBindIsSafe(host: string, authRequired: boolean, configPath: string): void {
  if (authRequired || isLoopbackHost(host)) return;

  throw new Error(
    `Refusing to listen on ${host} without a password.\n` +
      '  Anyone who can reach that address could control your Hermes agent.\n' +
      '  Set a password first:  hermes-control-center --set-password\n' +
      `  It is stored as a scrypt hash in ${configPath}.`,
  );
}
