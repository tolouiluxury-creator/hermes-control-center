import { describe, expect, it } from 'vitest';
import { ResponseCache } from './cache.js';

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
