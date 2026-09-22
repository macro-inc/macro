import { queryClient } from '@queries/client';
import { emailKeys } from './keys';

const listeners = new Set<(linkId: string) => void>();

/** Subscribe a mounted thread regardless of its REST or GraphQL transport. */
export function onEmailThreadRefresh(listener: (linkId: string) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mark inactive REST caches stale; mounted hosts refresh their own transport. */
export function refreshEmailThreads(linkId: string) {
  void queryClient.invalidateQueries({
    queryKey: emailKeys.threadMessages._def,
    refetchType: 'none',
  });
  for (const listener of listeners) listener(linkId);
}
