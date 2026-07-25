/**
 * Login throttle. A control center reachable from the internet must not let an
 * attacker try passwords as fast as the network allows, and scrypt alone is not
 * enough — each attempt would still cost the server real CPU.
 *
 * Deliberately in-memory: a restart clearing the counters is acceptable, and it
 * keeps the login path free of database writes.
 */

export interface ThrottleDecision {
  allowed: boolean;
  retryAfterMs: number;
  attemptsRemaining: number;
}

interface Entry {
  failures: number;
  blockedUntil: number;
  lastFailure: number;
}

export interface ThrottleOptions {
  /** Free attempts before delays begin. */
  freeAttempts?: number;
  /** Base delay, doubled per failure beyond the free ones. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Counters reset after this long without a failure. */
  resetAfterMs?: number;
  /** Safety cap on tracked keys, so the map cannot grow without bound. */
  maxKeys?: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly freeAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly resetAfterMs: number;
  private readonly maxKeys: number;

  constructor(options: ThrottleOptions = {}) {
    this.freeAttempts = options.freeAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 5 * 60 * 1000;
    this.resetAfterMs = options.resetAfterMs ?? 15 * 60 * 1000;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  check(key: string, now: number = Date.now()): ThrottleDecision {
    const entry = this.entries.get(key);
    if (!entry) {
      return { allowed: true, retryAfterMs: 0, attemptsRemaining: this.freeAttempts };
    }

    if (now - entry.lastFailure > this.resetAfterMs) {
      this.entries.delete(key);
      return { allowed: true, retryAfterMs: 0, attemptsRemaining: this.freeAttempts };
    }

    if (entry.blockedUntil > now) {
      return {
        allowed: false,
        retryAfterMs: entry.blockedUntil - now,
        attemptsRemaining: 0,
      };
    }

    return {
      allowed: true,
      retryAfterMs: 0,
      attemptsRemaining: Math.max(0, this.freeAttempts - entry.failures),
    };
  }

  recordFailure(key: string, now: number = Date.now()): ThrottleDecision {
    this.evictIfNeeded(now);

    const existing = this.entries.get(key);
    const failures =
      (existing && now - existing.lastFailure <= this.resetAfterMs ? existing.failures : 0) + 1;

    const excess = failures - this.freeAttempts;
    const delay = excess <= 0 ? 0 : Math.min(this.baseDelayMs * 2 ** (excess - 1), this.maxDelayMs);

    this.entries.set(key, { failures, blockedUntil: now + delay, lastFailure: now });

    return {
      allowed: delay === 0,
      retryAfterMs: delay,
      attemptsRemaining: Math.max(0, this.freeAttempts - failures),
    };
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  /** Drops expired entries; falls back to clearing everything if still too big. */
  private evictIfNeeded(now: number): void {
    if (this.entries.size < this.maxKeys) return;

    for (const [key, entry] of this.entries) {
      if (now - entry.lastFailure > this.resetAfterMs) this.entries.delete(key);
    }
    if (this.entries.size >= this.maxKeys) this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
