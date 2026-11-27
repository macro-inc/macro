import {
  prForeignEntityQueryKey,
  prMergeabilityQueryKey,
} from '@app/features/block-pr/data/keys';
import type { QueryClient } from '@tanstack/solid-query';

type PrRefetch = { trailing: boolean };
const ACTIVE_PR_REFETCHES = new WeakMap<QueryClient, Map<string, PrRefetch>>();

/** Bursts share the current fetch, then read once more for pushes received during it. */
export async function invalidateActivePrDetail(
  client: QueryClient,
  id: string
): Promise<void> {
  let active = ACTIVE_PR_REFETCHES.get(client);
  if (!active) {
    active = new Map();
    ACTIVE_PR_REFETCHES.set(client, active);
  }
  const existing = active.get(id);
  if (existing) {
    existing.trailing = true;
    return;
  }
  const refetch = { trailing: false };
  active.set(id, refetch);
  try {
    // A read started before the push can already contain stale data. Let it finish
    // before invalidating, so active readers fetch again and inactive ones stay stale.
    const earlierReads = [
      prForeignEntityQueryKey(id),
      prMergeabilityQueryKey(id),
    ]
      .flatMap((queryKey) => client.getQueryCache().findAll({ queryKey }))
      .flatMap((query) =>
        query.state.fetchStatus === 'fetching' && query.promise
          ? [query.promise]
          : []
      );
    if (earlierReads.length > 0) await Promise.allSettled(earlierReads);
    do {
      refetch.trailing = false;
      await Promise.all([
        client.invalidateQueries(
          { queryKey: prForeignEntityQueryKey(id), refetchType: 'active' },
          { cancelRefetch: false }
        ),
        client.invalidateQueries(
          { queryKey: prMergeabilityQueryKey(id), refetchType: 'active' },
          { cancelRefetch: false }
        ),
      ]);
    } while (refetch.trailing);
  } finally {
    active.delete(id);
    if (active.size === 0) ACTIVE_PR_REFETCHES.delete(client);
  }
}
