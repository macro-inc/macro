import type { Client } from '@urql/core';

/** Null means every mounted activity query needs a fresh authorized read. */
export type ActivityInvalidation = ReadonlySet<string> | null;
type Revalidator = {
  client: () => Client | undefined;
  refresh: (entities: ActivityInvalidation) => Promise<unknown> | void;
  /**
   * True when the query's reads carry `FOLLOWS_LIVE_UPDATES` and reach the
   * network on mount: its first read waits for the websocket's subscriptions,
   * or goes out early and is read again once they are live, so the first
   * connection need not refresh it. A `cache-first` query, whose cached
   * result may predate them, leaves it unset.
   */
  followsLiveUpdates?: boolean;
};
const revalidators = new Set<Revalidator>();

/** Registers a mounted query, scoped to the client that owns its session. */
export function registerActivityRevalidator(
  revalidator: Revalidator
): () => void {
  revalidators.add(revalidator);
  return () => revalidators.delete(revalidator);
}

/**
 * Each mounted observer recovers its own variables and pagination chain.
 * `refreshNonFollowers` also refreshes every query that does not follow live
 * updates in full, as the first connection's subscriptions go live.
 */
export async function revalidateActivityQueries(
  client: Pick<Client, 'subscription' | 'query'>,
  entities: ActivityInvalidation,
  options: { refreshNonFollowers?: boolean } = {}
): Promise<void> {
  await Promise.all(
    [...revalidators].map(async (entry) => {
      if (!revalidators.has(entry) || entry.client() !== client) return;
      const invalidation =
        options.refreshNonFollowers && !entry.followsLiveUpdates
          ? null
          : entities;
      if (invalidation?.size === 0) return;
      try {
        await entry.refresh(invalidation);
      } catch (error) {
        console.warn('Activity query revalidation failed', error);
      }
    })
  );
}
