import type { QueryKey } from '@tanstack/solid-query';
import { queryClient } from '../client';

/** Update one cached query now and restore it if the save fails; never blank it. */
export interface CachedQuerySnapshot<T> {
  previous: T | undefined;
}

export async function replaceCachedQuery<T>(
  queryKey: QueryKey,
  update: (current: T) => T
): Promise<CachedQuerySnapshot<T>> {
  await queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueryData<T>(queryKey);
  if (previous !== undefined)
    queryClient.setQueryData<T>(queryKey, update(previous));
  return { previous };
}

/**
 * Saves of one setting share a scope, so their requests reach the server in
 * order. Only the last pending save rolls back or refetches; an earlier one
 * would overwrite the newer optimistic choice.
 */
export const isLastPendingSave = (mutationKey: QueryKey) =>
  queryClient.isMutating({ mutationKey }) === 1;
