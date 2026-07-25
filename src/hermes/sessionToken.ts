import { describeError } from '../log.js';

/**
 * The Hermes dashboard guards most of its API with a session token that it
 * injects into the HTML shell it serves:
 *
 *   <script>window.__HERMES_SESSION_TOKEN__="…";…</script>
 *
 * Its own web UI reads that global and sends it on every request. There is no
 * documented endpoint to mint one — `/api/auth/*` is itself behind the guard —
 * so we bootstrap exactly like the browser does: fetch `/`, read the token, and
 * send it as a bearer.
 *
 * The token changes whenever the dashboard restarts, which surfaces as a sudden
 * 401. Callers invalidate and retry once, so a dashboard restart heals itself
 * without the user noticing.
 */

export interface TokenProvider {
  get(): Promise<string | null>;
  invalidate(): void;
}

const TOKEN_PATTERN = /__HERMES_SESSION_TOKEN__\s*=\s*(["'])([^"']+)\1/;

export function extractSessionToken(html: string): string | null {
  return TOKEN_PATTERN.exec(html)?.[2] ?? null;
}

export interface DashboardSessionTokenOptions {
  timeoutMs?: number;
  /** Injectable for tests; defaults to fetching the dashboard's HTML shell. */
  loadHtml?: () => Promise<string>;
  onWarn?: (message: string) => void;
}

export class DashboardSessionToken implements TokenProvider {
  private cached: string | null = null;
  /** Single-flight guard: a cold start fires many requests at once. */
  private inflight: Promise<string | null> | null = null;

  private readonly timeoutMs: number;
  private readonly loadHtml: () => Promise<string>;
  private readonly onWarn: (message: string) => void;

  constructor(
    private readonly baseUrl: string,
    options: DashboardSessionTokenOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.loadHtml = options.loadHtml ?? (() => this.fetchShell());
    this.onWarn = options.onWarn ?? (() => {});
  }

  async get(): Promise<string | null> {
    if (this.cached) return this.cached;

    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });

    return this.inflight;
  }

  invalidate(): void {
    this.cached = null;
  }

  private async load(): Promise<string | null> {
    let html: string;
    try {
      html = await this.loadHtml();
    } catch (error) {
      // Not fatal: the dashboard may simply be down, which the status probe
      // reports separately and more accurately than we could here.
      this.onWarn(`Could not read the dashboard session token: ${describeError(error)}`);
      return null;
    }

    const token = extractSessionToken(html);
    if (!token) {
      this.onWarn(
        'The dashboard did not include a session token in its HTML. ' +
          'Most dashboard data will stay unavailable — this build expects Hermes 0.19 or newer.',
      );
      return null;
    }

    this.cached = token;
    return token;
  }

  private async fetchShell(): Promise<string> {
    const response = await fetch(new URL('/', this.baseUrl), {
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`dashboard returned HTTP ${response.status} for its HTML shell`);
    }
    return response.text();
  }
}
