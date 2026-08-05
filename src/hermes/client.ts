import type { ZodType } from 'zod';
import { describeError } from '../log.js';
import type { TokenProvider } from './sessionToken.js';

export type UpstreamName = 'api-server' | 'dashboard';

export type UpstreamFailure =
  | 'unreachable'
  | 'unauthorized'
  | 'not_found'
  | 'http_error'
  | 'invalid_json'
  | 'schema_mismatch'
  | 'timeout';

/**
 * Every upstream problem funnels through this type so routes can translate it
 * into an honest UI state instead of a generic 500.
 */
export class UpstreamError extends Error {
  constructor(
    readonly upstream: UpstreamName,
    readonly failure: UpstreamFailure,
    readonly path: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }

  /** HTTP status the control center should answer with. */
  get clientStatus(): number {
    switch (this.failure) {
      case 'unauthorized':
        return 401;
      case 'not_found':
        return 404;
      case 'unreachable':
      case 'timeout':
        return 503;
      default:
        return 502;
    }
  }

  toJSON() {
    return {
      error: this.failure,
      upstream: this.upstream,
      path: this.path,
      message: this.message,
      status: this.status,
    };
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
  /** Extra headers, e.g. Hermes session scoping. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Send the bearer token. Defaults to true; the dashboard needs no auth on loopback. */
  auth?: boolean;
}

export interface HermesClientConfig {
  name: UpstreamName;
  baseUrl: string;
  apiKey?: string | null;
  /** Appended as ?profile= to dashboard requests. */
  profile?: string | null;
  defaultTimeoutMs?: number;
  /**
   * Supplies a bearer token that can expire — the dashboard's session token.
   * Takes precedence over apiKey, and a 401 triggers one refresh and retry.
   */
  tokenProvider?: TokenProvider;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export class HermesClient {
  constructor(private readonly config: HermesClientConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  get hasKey(): boolean {
    return Boolean(this.config.apiKey);
  }

  /** The profile this client was launched with, e.g. as a body fallback for
   * writes that Hermes scopes by profile but won't infer from the query
   * string (see {@link DashboardClient.setSessionPinned}). */
  get profile(): string | null {
    return this.config.profile ?? null;
  }

  buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path, this.config.baseUrl);
    if (this.config.profile) url.searchParams.set('profile', this.config.profile);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async headers(options: RequestOptions): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...options.headers,
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    if (options.auth !== false) {
      const token = (await this.config.tokenProvider?.get()) ?? this.config.apiKey;
      if (token) headers.authorization = `Bearer ${token}`;
    }
    return headers;
  }

  /** Raw request. Used for streaming passthrough and non-JSON payloads. */
  async fetch(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = this.buildUrl(path, options.query);
    const timeoutMs = options.timeoutMs ?? this.config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
    if (options.signal) signals.push(options.signal);

    try {
      return await fetch(url, {
        method: options.method ?? 'GET',
        headers: await this.headers(options),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.any(signals),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new UpstreamError(
          this.config.name,
          'timeout',
          path,
          `${this.config.name} did not respond within ${timeoutMs} ms`,
        );
      }
      throw new UpstreamError(
        this.config.name,
        'unreachable',
        path,
        `${this.config.name} unreachable at ${this.config.baseUrl}: ${describeError(error)}`,
      );
    }
  }

  /** Request + validate. Throws UpstreamError for every failure mode. */
  async json<T>(schema: ZodType<T>, path: string, options: RequestOptions = {}): Promise<T> {
    let response = await this.fetch(path, options);

    // A rotating token (the dashboard mints a new one on every restart) shows up
    // as a sudden 401. Refresh once and retry, so a restart heals itself.
    if (response.status === 401 && this.config.tokenProvider && options.auth !== false) {
      this.config.tokenProvider.invalidate();
      response = await this.fetch(path, options);
    }

    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      const failure: UpstreamFailure =
        response.status === 401 || response.status === 403
          ? 'unauthorized'
          : response.status === 404
            ? 'not_found'
            : 'http_error';
      throw new UpstreamError(
        this.config.name,
        failure,
        path,
        failure === 'unauthorized'
          ? `${this.config.name} rejected the API key (HTTP ${response.status})`
          : `${this.config.name} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new UpstreamError(
        this.config.name,
        'invalid_json',
        path,
        `${this.config.name} returned a non-JSON body: ${describeError(error)}`,
        response.status,
      );
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.length ? first.path.join('.') : '(root)';
      throw new UpstreamError(
        this.config.name,
        'schema_mismatch',
        path,
        `Unexpected response shape from ${this.config.name} at ${where}: ${first?.message ?? 'validation failed'}. ` +
          'This usually means the Hermes version differs from what this build supports.',
        response.status,
      );
    }

    return parsed.data;
  }

  private async readErrorDetail(response: Response): Promise<string | null> {
    try {
      const text = (await response.text()).trim();
      if (text === '') return null;
      return text.length > 300 ? `${text.slice(0, 300)}…` : text;
    } catch {
      return null;
    }
  }
}
