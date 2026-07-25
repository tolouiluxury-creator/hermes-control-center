import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSpaRequest } from './spa.js';

const WEB_ROOT = resolve('/srv/app/dist/web');

const existing = new Set(
  ['index.html', 'favicon.ico', 'assets/index-abc123.js', 'assets/index-abc123.css'].map(
    (relative) => resolve(WEB_ROOT, relative),
  ),
);

const isFile = (absolute: string): boolean => existing.has(absolute);
const resolveRequest = (url: string) => resolveSpaRequest(WEB_ROOT, url, isFile);

describe('resolveSpaRequest', () => {
  it('serves an existing asset and marks it immutable', () => {
    expect(resolveRequest('/assets/index-abc123.js')).toEqual({
      kind: 'file',
      relative: 'assets/index-abc123.js',
      immutable: true,
    });
  });

  it('serves non-hashed files without immutable caching', () => {
    expect(resolveRequest('/favicon.ico')).toEqual({
      kind: 'file',
      relative: 'favicon.ico',
      immutable: false,
    });
  });

  it('ignores query strings and fragments', () => {
    expect(resolveRequest('/assets/index-abc123.css?v=2')).toMatchObject({ kind: 'file' });
    expect(resolveRequest('/assets/index-abc123.css#top')).toMatchObject({ kind: 'file' });
  });

  it('returns the SPA for the root and for client-side routes', () => {
    expect(resolveRequest('/')).toEqual({ kind: 'spa' });
    expect(resolveRequest('/agenten')).toEqual({ kind: 'spa' });
    expect(resolveRequest('/workflows/42')).toEqual({ kind: 'spa' });
  });

  /**
   * Regression guard: a build writes new hashed assets while the server runs.
   * Resolution must consult the disk per request, not a boot-time snapshot —
   * otherwise fresh assets fall through to index.html and the browser refuses
   * to execute HTML as a module, leaving a blank page.
   */
  it('picks up a file that appeared after startup', () => {
    const fresh = resolve(WEB_ROOT, 'assets/index-new999.js');
    const seen = new Set(existing);
    const resolution = resolveSpaRequest(WEB_ROOT, '/assets/index-new999.js', (path) =>
      seen.has(path),
    );
    expect(resolution).toEqual({ kind: 'spa' });

    seen.add(fresh);
    expect(
      resolveSpaRequest(WEB_ROOT, '/assets/index-new999.js', (path) => seen.has(path)),
    ).toEqual({ kind: 'file', relative: 'assets/index-new999.js', immutable: true });
  });

  it('never escapes the bundle directory', () => {
    for (const url of [
      '/../package.json',
      '/assets/../../package.json',
      '/%2e%2e%2fpackage.json',
      '/assets/%2e%2e%2f%2e%2e%2fpackage.json',
      '/....//package.json',
    ]) {
      expect(resolveRequest(url), url).toEqual({ kind: 'spa' });
    }
  });

  it('rejects malformed encoding and NUL bytes', () => {
    expect(resolveRequest('/assets/%E0%A4%A')).toEqual({ kind: 'spa' });
    expect(resolveRequest('/index.html%00.js')).toEqual({ kind: 'spa' });
  });
});
