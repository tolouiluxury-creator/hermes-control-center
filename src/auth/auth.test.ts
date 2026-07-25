import { describe, expect, it } from 'vitest';
import {
  hasUntypeableCharacter,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from './password.js';
import { stripBom } from '../util/prompt.js';
import {
  SESSION_COOKIE,
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
  generateSessionSecret,
  readCookie,
  verifySessionToken,
} from './session.js';
import { LoginThrottle } from './throttle.js';
import { AuthService, assertBindIsSafe, isLoopbackHost } from './service.js';

// Cheap scrypt parameters: these tests assert behaviour, not cost.
const FAST = { N: 1024, r: 8, p: 1 };

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', () => {
    const stored = hashPassword('correct horse battery', FAST);
    expect(verifyPassword('correct horse battery', stored)).toBe(true);
    expect(verifyPassword('Correct horse battery', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('salts each hash, so identical passwords differ on disk', () => {
    expect(hashPassword('same', FAST)).not.toBe(hashPassword('same', FAST));
  });

  it('normalises unicode so an equivalent password still matches', () => {
    // "é" as one code point vs. e + combining acute.
    const stored = hashPassword('café', FAST);
    expect(verifyPassword('café', stored)).toBe(true);
  });

  it('returns false for malformed hashes instead of throwing', () => {
    for (const bad of [
      '',
      'nonsense',
      'scrypt$1024$8',
      'bcrypt$1024$8$1$c2FsdA==$aGFzaA==',
      'scrypt$abc$8$1$c2FsdA==$aGFzaA==',
    ]) {
      expect(verifyPassword('anything', bad), bad).toBe(false);
    }
  });

  it('refuses hashes with absurd parameters rather than allocating gigabytes', () => {
    const bomb = 'scrypt$8388608$32$16$c2FsdA==$aGFzaA==';
    expect(verifyPassword('anything', bomb)).toBe(false);
  });

  it('rejects weak passwords', () => {
    expect(validatePasswordStrength('short')).toContain('8 characters');
    expect(validatePasswordStrength('        ')).toContain('blank');
    expect(validatePasswordStrength('long-enough-password')).toBeNull();
  });

  /**
   * Regression guard: Windows PowerShell prepends a UTF-8 BOM when piping into a
   * native command, so `"pw" | ... --set-password` silently stored BOM + pw —
   * a password that can never be typed into the login form again.
   */
  it('rejects passwords carrying encoding artefacts', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(hasUntypeableCharacter(`${bom}dev-password-1234`)).toBe(true);
    expect(validatePasswordStrength(`${bom}dev-password-1234`)).toContain('byte-order mark');

    expect(validatePasswordStrength('dev-password\r')).toContain('control character');
    expect(validatePasswordStrength('dev-password\n1234')).toContain('control character');
    expect(validatePasswordStrength(`dev-password${String.fromCharCode(0x7f)}`)).toContain(
      'control character',
    );

    expect(hasUntypeableCharacter('an-ordinary-päßword')).toBe(false);
    expect(validatePasswordStrength('an-ordinary-päßword')).toBeNull();
  });

  it('strips a byte-order mark from piped input', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(stripBom(`${bom}secret`)).toBe('secret');
    expect(stripBom('secret')).toBe('secret');
    expect(stripBom('')).toBe('');
  });
});

describe('session tokens', () => {
  const secret = generateSessionSecret();

  it('round-trips a freshly issued token', () => {
    const token = createSessionToken(secret, 60_000);
    const check = verifySessionToken(secret, token);
    expect(check.valid).toBe(true);
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken(generateSessionSecret(), 60_000);
    expect(verifySessionToken(secret, token)).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejects a tampered payload', () => {
    const now = Date.now();
    const token = createSessionToken(secret, 60_000, now);
    const forgedPayload = Buffer.from(JSON.stringify({ iat: now, exp: now + 10 ** 9 })).toString(
      'base64url',
    );
    const forged = `${forgedPayload}.${token.split('.')[1]}`;
    expect(verifySessionToken(secret, forged)).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejects an expired token', () => {
    const now = Date.now();
    const token = createSessionToken(secret, 1000, now);
    expect(verifySessionToken(secret, token, now + 2000)).toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('rejects missing and malformed tokens', () => {
    expect(verifySessionToken(secret, undefined).valid).toBe(false);
    expect(verifySessionToken(secret, 'no-dot').valid).toBe(false);
    expect(verifySessionToken(secret, '.sig').valid).toBe(false);
    expect(verifySessionToken(secret, 'payload.').valid).toBe(false);
  });
});

describe('cookies', () => {
  it('reads one value out of a cookie header', () => {
    expect(readCookie('a=1; hcc_session=abc.def; b=2', SESSION_COOKIE)).toBe('abc.def');
    expect(readCookie('other=1', SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
  });

  it('always sets HttpOnly, SameSite and Path, and Secure only over TLS', () => {
    const insecure = buildSessionCookie('t', { secure: false, maxAgeSeconds: 60 });
    expect(insecure).toContain('HttpOnly');
    expect(insecure).toContain('SameSite=Lax');
    expect(insecure).toContain('Path=/');
    expect(insecure).not.toContain('Secure');

    expect(buildSessionCookie('t', { secure: true, maxAgeSeconds: 60 })).toContain('Secure');
    expect(buildClearedSessionCookie(false)).toContain('Max-Age=0');
  });
});

describe('LoginThrottle', () => {
  it('allows the free attempts, then delays with a growing backoff', () => {
    const throttle = new LoginThrottle({ freeAttempts: 2, baseDelayMs: 1000 });
    const now = 0;

    expect(throttle.recordFailure('ip', now).retryAfterMs).toBe(0);
    expect(throttle.recordFailure('ip', now).retryAfterMs).toBe(0);
    expect(throttle.recordFailure('ip', now).retryAfterMs).toBe(1000);
    expect(throttle.recordFailure('ip', now).retryAfterMs).toBe(2000);
    expect(throttle.recordFailure('ip', now).retryAfterMs).toBe(4000);
  });

  it('caps the delay', () => {
    const throttle = new LoginThrottle({ freeAttempts: 0, baseDelayMs: 1000, maxDelayMs: 3000 });
    for (let attempt = 0; attempt < 10; attempt += 1) throttle.recordFailure('ip', 0);
    expect(throttle.check('ip', 0).retryAfterMs).toBeLessThanOrEqual(3000);
  });

  it('blocks while the delay is active and allows afterwards', () => {
    const throttle = new LoginThrottle({ freeAttempts: 0, baseDelayMs: 1000 });
    throttle.recordFailure('ip', 0);
    expect(throttle.check('ip', 500).allowed).toBe(false);
    expect(throttle.check('ip', 1500).allowed).toBe(true);
  });

  it('keys attempts per client, so one cannot lock out another', () => {
    const throttle = new LoginThrottle({ freeAttempts: 0, baseDelayMs: 1000 });
    throttle.recordFailure('attacker', 0);
    expect(throttle.check('attacker', 0).allowed).toBe(false);
    expect(throttle.check('victim', 0).allowed).toBe(true);
  });

  it('forgets counters after the reset window and on success', () => {
    const throttle = new LoginThrottle({ freeAttempts: 1, baseDelayMs: 1000, resetAfterMs: 5000 });
    throttle.recordFailure('ip', 0);
    throttle.recordFailure('ip', 0);
    expect(throttle.check('ip', 0).allowed).toBe(false);
    expect(throttle.check('ip', 10_000).allowed).toBe(true);

    throttle.recordFailure('ip2', 0);
    throttle.recordSuccess('ip2');
    expect(throttle.size).toBe(0);
  });
});

describe('AuthService', () => {
  const config = {
    passwordHash: hashPassword('a-good-password', FAST),
    sessionSecret: generateSessionSecret(),
  };

  it('treats every request as authenticated when no password is configured', () => {
    const service = new AuthService(null);
    expect(service.required).toBe(false);
    expect(service.isAuthenticated(undefined)).toBe(true);
    expect(service.login('x', 'ip').reason).toBe('not_configured');
  });

  it('accepts the right password and issues a usable session', () => {
    const service = new AuthService(config);
    expect(service.login('a-good-password', 'ip').ok).toBe(true);

    const token = service.issueToken();
    expect(service.isAuthenticated(`${SESSION_COOKIE}=${token}`)).toBe(true);
  });

  it('rejects a wrong password and an absent cookie', () => {
    const service = new AuthService(config);
    expect(service.login('wrong', 'ip').reason).toBe('wrong_password');
    expect(service.isAuthenticated(undefined)).toBe(false);
    expect(service.isAuthenticated(`${SESSION_COOKIE}=garbage`)).toBe(false);
  });

  it('throttles after repeated failures', () => {
    const service = new AuthService(config);
    for (let attempt = 0; attempt < 6; attempt += 1) service.login('wrong', 'ip');
    const outcome = service.login('a-good-password', 'ip');
    // Even the correct password is refused while blocked.
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('throttled');
    expect(outcome.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('assertBindIsSafe', () => {
  it('recognises loopback addresses', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });

  it('permits an unauthenticated bind only on loopback', () => {
    expect(() => assertBindIsSafe('127.0.0.1', false, '/cfg')).not.toThrow();
    expect(() => assertBindIsSafe('0.0.0.0', true, '/cfg')).not.toThrow();
    expect(() => assertBindIsSafe('0.0.0.0', false, '/cfg')).toThrow(/without a password/);
    expect(() => assertBindIsSafe('192.168.1.10', false, '/cfg')).toThrow(/--set-password/);
  });
});
