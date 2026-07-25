import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './api';
import type { ControlCenterEvent, StatusSnapshot } from './types';

export type StreamState = 'connecting' | 'open' | 'closed';

interface UseControlCenterStreamResult {
  state: StreamState;
  /** Latest pushed snapshot, or null before the first event arrives. */
  snapshot: StatusSnapshot | null;
  /** Latest pushed metric values, keyed by metric name. */
  metrics: Record<string, number>;
}

/**
 * Subscribes to the server's single SSE channel and feeds the React Query cache.
 * The browser never polls: every live value arrives here.
 *
 * EventSource reconnects on its own, so there is no retry logic to write; the
 * state is exposed only so the UI can show a "reconnecting" hint.
 */
export function useControlCenterStream(): UseControlCenterStreamResult {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const metricsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const source = new EventSource('/api/stream');

    source.onopen = () => setState('open');
    source.onerror = () => {
      setState('closed');
      // The stream is gated by the same session as everything else, so a drop
      // may mean the session ended rather than a network blip.
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth });
    };

    const handle = (event: MessageEvent<string>): void => {
      let parsed: ControlCenterEvent;
      try {
        parsed = JSON.parse(event.data) as ControlCenterEvent;
      } catch {
        return;
      }

      switch (parsed.type) {
        case 'status':
          setSnapshot(parsed.snapshot);
          // Keep the cache authoritative so components that read it directly agree.
          queryClient.setQueryData(queryKeys.status, parsed.snapshot);
          break;
        case 'metrics':
          metricsRef.current = { ...metricsRef.current, ...parsed.values };
          setMetrics(metricsRef.current);
          break;
        case 'invalidate':
          for (const key of parsed.keys) {
            void queryClient.invalidateQueries({ queryKey: key.split('.') });
          }
          break;
        case 'notification':
          void queryClient.invalidateQueries({ queryKey: ['notifications'] });
          break;
      }
    };

    for (const type of ['status', 'metrics', 'invalidate', 'notification']) {
      source.addEventListener(type, handle as EventListener);
    }

    return () => {
      source.close();
      setState('closed');
    };
  }, [queryClient]);

  return { state, snapshot, metrics };
}
