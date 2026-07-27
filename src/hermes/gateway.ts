import { describeError } from '../log.js';
import type { TokenProvider } from './sessionToken.js';

/**
 * Client for the Hermes dashboard's tui_gateway, the JSON-RPC-over-WebSocket
 * protocol its own chat UI speaks at `/api/ws`. Using it means the control
 * center can chat with the agent through the dashboard that is already running,
 * with no need to enable the optional API server or restart the gateway — so
 * nothing about the user's Hermes has to change.
 *
 * The wire format (verified against the Hermes source):
 *   - request:  {id, method, params}          → {id, result} | {id, error}
 *   - event:    {method:"event", params:{type, session_id, payload}}
 *
 * The browser never talks to Hermes directly; this lives server-side so the
 * dashboard session token never reaches the client.
 */

export interface GatewayEvent {
  type: string;
  sessionId: string | null;
  payload: Record<string, unknown> | null;
}

export type GatewayEventListener = (event: GatewayEvent) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayError';
  }
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<GatewayEventListener>();

  constructor(
    private readonly dashboardUrl: string,
    private readonly tokenProvider: TokenProvider,
  ) {}

  /** Subscribe to streaming events; returns an unsubscribe function. */
  onEvent(listener: GatewayEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private wsUrl(token: string): string {
    const url = new URL(this.dashboardUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/api/ws';
    url.searchParams.set('token', token);
    return url.toString();
  }

  private async openSocket(): Promise<void> {
    const token = await this.tokenProvider.get();
    if (!token) throw new GatewayError('No dashboard session token available.');

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.wsUrl(token));

      socket.addEventListener('open', () => {
        settled = true;
        this.ws = socket;
        resolve();
      });

      socket.addEventListener('message', (event) => this.onMessage(event.data));

      socket.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          reject(new GatewayError('WebSocket connection to the dashboard failed.'));
        }
      });

      socket.addEventListener('close', () => {
        if (this.ws === socket) this.ws = null;
        // A drop mid-flight is not silently swallowed: callers see it at once.
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new GatewayError('WebSocket closed before a reply arrived.'));
        }
        this.pending.clear();
        if (!settled) {
          settled = true;
          reject(new GatewayError('WebSocket closed during connect.'));
        }
      });
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    // Single-flight: concurrent callers share one connect attempt.
    this.connecting ??= this.openSocket()
      .catch((error: unknown) => {
        // A stale token surfaces as a failed upgrade; refresh for the next try.
        this.tokenProvider.invalidate();
        throw error instanceof Error ? error : new GatewayError(describeError(error));
      })
      .finally(() => {
        this.connecting = null;
      });
    await this.connecting;
  }

  private onMessage(data: unknown): void {
    const text =
      typeof data === 'string' ? data : data instanceof Buffer ? data.toString('utf8') : null;
    if (text === null) return;

    // The transport is line-oriented; a frame may carry more than one object.
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (message.method === 'event') {
        const params = (message.params ?? {}) as Record<string, unknown>;
        const event: GatewayEvent = {
          type: typeof params.type === 'string' ? params.type : 'unknown',
          sessionId: typeof params.session_id === 'string' ? params.session_id : null,
          payload: (params.payload as Record<string, unknown> | undefined) ?? null,
        };
        for (const listener of this.listeners) listener(event);
        continue;
      }

      const id = message.id;
      if (id !== undefined && id !== null) {
        const pending = this.pending.get(String(id));
        if (!pending) continue;
        this.pending.delete(String(id));
        clearTimeout(pending.timer);
        if (message.error !== undefined && message.error !== null) {
          const detail =
            typeof message.error === 'string' ? message.error : JSON.stringify(message.error);
          pending.reject(new GatewayError(detail));
        } else {
          pending.resolve(message.result ?? {});
        }
      }
    }
  }

  /** Send a JSON-RPC request and await its result. */
  async request<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    await this.ensureConnected();
    const socket = this.ws;
    if (!socket) throw new GatewayError('WebSocket is not connected.');

    const id = `cc-${this.nextId++}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GatewayError(`Gateway did not answer "${method}" within 30 s.`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      try {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new GatewayError(describeError(error)));
      }
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
