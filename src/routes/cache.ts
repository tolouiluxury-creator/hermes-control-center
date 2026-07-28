/**
 * A tiny read-through cache shared by the inventory read routes and the action
 * routes. Reads populate it; writes invalidate the keys they affect, so a
 * successful mutation is reflected on the next poll instead of lingering for the
 * cache's lifetime.
 *
 * Single-flight collapses a burst of identical reads (several widgets mounting
 * at once) onto one upstream round trip.
 */
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export class ResponseCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly ttlMs: number) {}

  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) return cached.value as T;

    // Single-flight: three widgets mounting at once must cause one upstream call.
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = load()
      .then((value) => {
        this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  /** Drops specific cached reads after a write so the change shows up at once. */
  invalidate(...keys: string[]): void {
    for (const key of keys) this.entries.delete(key);
  }

  /**
   * Drops every read whose key starts with `prefix`.
   *
   * Parameterised reads are cached per parameter — `sessions:12` and
   * `sessions:50` are separate entries — so deleting a conversation has to
   * clear all of them, not just the one width the caller happened to use.
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export const CACHE_TTL_MS = 5000;

/**
 * The fixed cache keys for the inventory reads. Shared so a write route
 * invalidates exactly the key a read populated — a typo would silently leave
 * stale data on screen. Parameterised reads (logs, sessions) are not listed
 * because no write touches them.
 */
export const CACHE_KEYS = {
  skills: 'skills',
  skillList: 'skills:list',
  models: 'models',
  mcp: 'mcp',
  cron: 'cron',
  model: 'model',
  analytics: 'analytics',
  memory: 'memory',
  messaging: 'messaging',
  webhooks: 'webhooks',
  pairing: 'pairing',
  env: 'env',
  configRaw: 'config:raw',
  curator: 'curator',
  update: 'update',
  toolsets: 'toolsets',
} as const;

/**
 * Prefix for the parameterised session reads (`sessions:12`, `sessions:50`, …).
 * Deleting a conversation invalidates all of them at once.
 */
export const SESSIONS_CACHE_PREFIX = 'sessions:';
