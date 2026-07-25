import { describe, expect, it, vi } from 'vitest';
import { DashboardSessionToken, extractSessionToken } from './sessionToken.js';

/** Trimmed copy of the shell Hermes 0.19.0 actually serves at `/`. */
const REAL_SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<script>window.__HERMES_SESSION_TOKEN__="1jZw62tS1dZZZonns8rY5WMU9MFvFE39N772VneCW28";window.__HERMES_DASHBOARD_EMBEDDED_CHAT__=true;window.__HERMES_BASE_PATH__="";window.__HERMES_AUTH_REQUIRED__=false;</script>
</head><body><div id="root"></div></body></html>`;

describe('extractSessionToken', () => {
  it('reads the token out of the real dashboard shell', () => {
    expect(extractSessionToken(REAL_SHELL)).toBe('1jZw62tS1dZZZonns8rY5WMU9MFvFE39N772VneCW28');
  });

  it('accepts single quotes and extra whitespace', () => {
    expect(extractSessionToken("window.__HERMES_SESSION_TOKEN__ = 'abc123';")).toBe('abc123');
  });

  it('returns null when the marker is absent or empty', () => {
    expect(extractSessionToken('<html><body>no token here</body></html>')).toBeNull();
    expect(extractSessionToken('window.__HERMES_SESSION_TOKEN__="";')).toBeNull();
  });
});

describe('DashboardSessionToken', () => {
  it('fetches once and caches the result', async () => {
    const loadHtml = vi.fn().mockResolvedValue(REAL_SHELL);
    const provider = new DashboardSessionToken('http://127.0.0.1:9119', { loadHtml });

    expect(await provider.get()).toBe('1jZw62tS1dZZZonns8rY5WMU9MFvFE39N772VneCW28');
    expect(await provider.get()).toBe('1jZw62tS1dZZZonns8rY5WMU9MFvFE39N772VneCW28');
    expect(loadHtml).toHaveBeenCalledTimes(1);
  });

  /** A cold start fires several status calls at once; one bootstrap must serve all. */
  it('coalesces concurrent lookups into a single fetch', async () => {
    const loadHtml = vi
      .fn()
      .mockImplementation(
        () => new Promise<string>((resolve) => setTimeout(() => resolve(REAL_SHELL), 10)),
      );
    const provider = new DashboardSessionToken('http://127.0.0.1:9119', { loadHtml });

    const results = await Promise.all([provider.get(), provider.get(), provider.get()]);

    expect(new Set(results).size).toBe(1);
    expect(loadHtml).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after invalidation, which is how a dashboard restart heals', async () => {
    const loadHtml = vi
      .fn()
      .mockResolvedValueOnce('window.__HERMES_SESSION_TOKEN__="first";')
      .mockResolvedValueOnce('window.__HERMES_SESSION_TOKEN__="second";');
    const provider = new DashboardSessionToken('http://127.0.0.1:9119', { loadHtml });

    expect(await provider.get()).toBe('first');
    provider.invalidate();
    expect(await provider.get()).toBe('second');
    expect(loadHtml).toHaveBeenCalledTimes(2);
  });

  it('warns instead of throwing when the dashboard is unreachable', async () => {
    const onWarn = vi.fn();
    const provider = new DashboardSessionToken('http://127.0.0.1:9119', {
      loadHtml: () => Promise.reject(new Error('connect ECONNREFUSED')),
      onWarn,
    });

    expect(await provider.get()).toBeNull();
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('warns when the shell carries no token', async () => {
    const onWarn = vi.fn();
    const provider = new DashboardSessionToken('http://127.0.0.1:9119', {
      loadHtml: () => Promise.resolve('<html></html>'),
      onWarn,
    });

    expect(await provider.get()).toBeNull();
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('0.19'));
  });

  it('retries after a failure rather than caching it', async () => {
    const loadHtml = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(REAL_SHELL);
    const provider = new DashboardSessionToken('http://127.0.0.1:9119', { loadHtml });

    expect(await provider.get()).toBeNull();
    expect(await provider.get()).toBe('1jZw62tS1dZZZonns8rY5WMU9MFvFE39N772VneCW28');
  });
});
