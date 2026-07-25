import type { StatusSnapshot } from './status.js';
import type { Sample } from './store/metrics.js';

/**
 * Everything the browser learns about without asking. Hermes has no outbound
 * event push (its webhooks are inbound), so the server polls and fans out here.
 */
export type ControlCenterEvent =
  | { type: 'status'; snapshot: StatusSnapshot }
  | { type: 'metrics'; ts: number; values: Record<string, number> }
  | { type: 'notification'; id: string; severity: string; title: string; body: string }
  | { type: 'invalidate'; keys: string[] };

export type EventListener = (event: ControlCenterEvent) => void;

export class EventBus {
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Number of connected SSE clients. The poller idles when this is zero. */
  get subscriberCount(): number {
    return this.listeners.size;
  }

  publish(event: ControlCenterEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken client must not take down the publisher.
      }
    }
  }
}

/** Convenience for the poller: turn a metric batch into an event. */
export function metricsEvent(
  ts: number,
  samples: Record<string, Sample | null>,
): ControlCenterEvent {
  const values: Record<string, number> = {};
  for (const [metric, sample] of Object.entries(samples)) {
    if (sample) values[metric] = sample.value;
  }
  return { type: 'metrics', ts, values };
}
