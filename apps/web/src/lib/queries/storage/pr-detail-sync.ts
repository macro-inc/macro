import {
  prForeignEntityQueryKey,
  prMergeabilityQueryKey,
} from '@app/features/block-pr/data/keys';
import type { QueryClient } from '@tanstack/solid-query';

type PrRefetch = { trailing: boolean };
const ACTIVE_PR_REFETCHES = new WeakMap<QueryClient, Map<string, PrRefetch>>();

async function invalidateActivePrQuery(
  client: QueryClient,
  queryKey: readonly string[]
): Promise<void> {
  let active = ACTIVE_PR_REFETCHES.get(client);
  if (!active) {
    active = new Map();
    ACTIVE_PR_REFETCHES.set(client, active);
  }
  const key = JSON.stringify(queryKey);
  const existing = active.get(key);
  if (existing) {
    existing.trailing = true;
    return;
  }
  const refetch = { trailing: false };
  active.set(key, refetch);
  try {
    // An earlier read can already contain stale data. Invalidate after it settles,
    // so active readers fetch again and inactive readers retain their stale flag.
    const earlierReads = client
      .getQueryCache()
      .findAll({ queryKey })
      .flatMap((query) =>
        query.state.fetchStatus === 'fetching' && query.promise
          ? [query.promise]
          : []
      );
    if (earlierReads.length > 0) await Promise.allSettled(earlierReads);
    // Each running read has at most one pending read. Pushes during a trailing read
    // need another read too; a lifetime two-read cap would discard those updates.
    do {
      refetch.trailing = false;
      await client.invalidateQueries(
        { queryKey, refetchType: 'active' },
        { cancelRefetch: false }
      );
    } while (refetch.trailing);
  } finally {
    active.delete(key);
    if (active.size === 0) ACTIVE_PR_REFETCHES.delete(client);
  }
}

/** Refresh independently so a slow GitHub mergeability read cannot hold up checks. */
export async function invalidateActivePrDetail(
  client: QueryClient,
  id: string
): Promise<void> {
  await Promise.all([
    invalidateActivePrQuery(client, prForeignEntityQueryKey(id)),
    invalidateActivePrQuery(client, prMergeabilityQueryKey(id)),
  ]);
}
