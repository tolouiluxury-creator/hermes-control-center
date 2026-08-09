import { describe, expect, it, vi } from 'vitest';
import { isNewerVersion, UpdateChecker, type FetchLike } from './updateCheck.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('isNewerVersion', () => {
  it('compares major/minor/patch', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('a release beats any prerelease of the same version', () => {
    expect(isNewerVersion('0.1.0', '0.1.0-beta.3')).toBe(true);
    expect(isNewerVersion('0.1.0-beta.3', '0.1.0')).toBe(false);
  });

  it('compares prerelease numbers within the same channel', () => {
    expect(isNewerVersion('0.1.0-beta.4', '0.1.0-beta.3')).toBe(true);
    expect(isNewerVersion('0.1.0-beta.3', '0.1.0-beta.3')).toBe(false);
    expect(isNewerVersion('0.1.0-beta.2', '0.1.0-beta.3')).toBe(false);
  });

  it('tolerates a leading "v" and is false for equal versions', () => {
    expect(isNewerVersion('v0.1.0-beta.4', '0.1.0-beta.3')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
  });
});

describe('UpdateChecker', () => {
  it('reports an available update from the newest release, tag "v" stripped', async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([
          { tag_name: 'v0.1.0-beta.4', html_url: 'https://example.test/releases/v0.1.0-beta.4' },
        ]),
      );
    const checker = new UpdateChecker(fetchImpl, '0.1.0-beta.3');

    const result = await checker.check();

    expect(result).toEqual({
      currentVersion: '0.1.0-beta.3',
      latestVersion: '0.1.0-beta.4',
      updateAvailable: true,
      releaseUrl: 'https://example.test/releases/v0.1.0-beta.4',
    });
  });

  it('reports no update when already current', async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([{ tag_name: 'v0.1.0-beta.3', html_url: 'https://example.test' }]),
      );
    const checker = new UpdateChecker(fetchImpl, '0.1.0-beta.3');

    const result = await checker.check();

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe('0.1.0-beta.3');
  });

  it('caches the result and does not call fetch again before the TTL', async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([{ tag_name: 'v0.1.0-beta.4', html_url: 'https://example.test' }]),
      );
    const checker = new UpdateChecker(fetchImpl, '0.1.0-beta.3');
    const now = Date.now();

    await checker.check(now);
    await checker.check(now + 1000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache expires', async () => {
    const fetchImpl: FetchLike = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([{ tag_name: 'v0.1.0-beta.4', html_url: 'https://example.test' }]),
      );
    const checker = new UpdateChecker(fetchImpl, '0.1.0-beta.3');
    const now = Date.now();

    await checker.check(now);
    await checker.check(now + 61 * 60_000);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails closed — no update reported — on a network error or a non-ok response', async () => {
    const rejecting = new UpdateChecker(
      vi.fn().mockRejectedValue(new Error('boom')),
      '0.1.0-beta.3',
    );
    const rejected = await rejecting.check();
    expect(rejected).toEqual({
      currentVersion: '0.1.0-beta.3',
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
    });

    const notOk = new UpdateChecker(
      vi.fn().mockResolvedValue(jsonResponse([], false, 403)),
      '0.1.0-beta.3',
    );
    expect((await notOk.check()).updateAvailable).toBe(false);
  });

  it('collapses concurrent calls onto one fetch', async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchImpl: FetchLike = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const checker = new UpdateChecker(fetchImpl, '0.1.0-beta.3');

    const first = checker.check();
    const second = checker.check();
    resolveFetch(jsonResponse([{ tag_name: 'v0.1.0-beta.4', html_url: 'https://example.test' }]));
    await Promise.all([first, second]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
