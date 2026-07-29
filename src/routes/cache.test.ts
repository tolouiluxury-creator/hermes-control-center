import { describe, expect, it } from 'vitest';
import { ResponseCache, SESSIONS_CACHE_PREFIX, sessionsCacheKey } from './cache.js';

describe('ResponseCache', () => {
  it('serves a cached value without calling the loader again', async () => {
    const cache = new ResponseCache(10_000);
    let calls = 0;
    const load = () => {
      calls += 1;
      return Promise.resolve('value');
    };

    expect(await cache.get('k', load)).toBe('value');
    expect(await cache.get('k', load)).toBe('value');
    expect(calls).toBe(1);
  });

  it('collapses concurrent reads of the same key onto one load (single-flight)', async () => {
    const cache = new ResponseCache(10_000);
    let calls = 0;
    const load = () =>
      new Promise<number>((resolve) => {
        calls += 1;
        setTimeout(() => resolve(calls), 5);
      });

    const [a, b] = await Promise.all([cache.get('k', load), cache.get('k', load)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(calls).toBe(1);
  });

  it('reloads after the touched key is invalidated', async () => {
    const cache = new ResponseCache(10_000);
    let calls = 0;
    const load = () => {
      calls += 1;
      return Promise.resolve(calls);
    };

    expect(await cache.get('k', load)).toBe(1);
    cache.invalidate('other');
    expect(await cache.get('k', load)).toBe(1); // untouched key stays cached
    cache.invalidate('k');
    expect(await cache.get('k', load)).toBe(2); // reloaded after invalidation
  });

  /*
   * Sessions are cached per requested width — the widget asks for 12, the chat
   * list for 50. Deleting a conversation has to clear every width, or the two
   * views disagree about what still exists.
   */
  it('invalidates every parameterised read behind a prefix', async () => {
    const cache = new ResponseCache(10_000);
    const counters = { 'sessions:12': 0, 'sessions:50': 0, 'logs:100': 0 };
    const load = (key: keyof typeof counters) => () => Promise.resolve((counters[key] += 1));

    await cache.get('sessions:12', load('sessions:12'));
    await cache.get('sessions:50', load('sessions:50'));
    await cache.get('logs:100', load('logs:100'));

    cache.invalidatePrefix('sessions:');

    expect(await cache.get('sessions:12', load('sessions:12'))).toBe(2);
    expect(await cache.get('sessions:50', load('sessions:50'))).toBe(2);
    // A different prefix must survive, or one delete would clear the whole cache.
    expect(await cache.get('logs:100', load('logs:100'))).toBe(1);
  });

  it('gives each profile its own session key, still behind the shared prefix', () => {
    // Two profiles are two databases. Sharing an entry would show one profile's
    // conversations under the other; falling outside the prefix would leave them
    // on screen after a delete.
    expect(sessionsCacheKey(50, 'sunrise')).not.toBe(sessionsCacheKey(50));
    expect(sessionsCacheKey(50, 'sunrise').startsWith(SESSIONS_CACHE_PREFIX)).toBe(true);
    expect(sessionsCacheKey(50)).toBe(sessionsCacheKey(50, ''));
  });

  it('does not cache a rejected load', async () => {
    const cache = new ResponseCache(10_000);
    let calls = 0;
    const load = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok');
    };

    await expect(cache.get('k', load)).rejects.toThrow('boom');
    expect(await cache.get('k', load)).toBe('ok');
    expect(calls).toBe(2);
  });
});
