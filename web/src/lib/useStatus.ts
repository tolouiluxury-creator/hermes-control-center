import { useQuery } from '@tanstack/react-query';
import { getStatus, queryKeys } from './api';
import type { StatusSnapshot } from './types';

/**
 * The status snapshot every page reads from.
 *
 * The SSE channel writes fresh snapshots straight into this cache entry, so the
 * query exists only to seed the first paint and to recover if the stream is
 * down. Nothing here polls.
 */
export function useStatus() {
  return useQuery<StatusSnapshot>({
    queryKey: queryKeys.status,
    queryFn: () => getStatus(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
