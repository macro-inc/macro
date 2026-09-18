type ActiveGraphqlSoupQuery = {
  isEnabled: () => boolean;
  refresh: () => Promise<void>;
};

const activeQueries = new Set<ActiveGraphqlSoupQuery>();

/** Registers a mounted GraphQL Soup query for mutation-driven revalidation. */
export function registerActiveGraphqlSoupQuery(
  query: ActiveGraphqlSoupQuery
): () => void {
  activeQueries.add(query);
  return () => activeQueries.delete(query);
}

/** Network-refreshes every mounted and enabled GraphQL Soup query.
 * Strict callers may only release optimistic state after every active reader
 * succeeded. Other callers retain the existing best-effort behavior.
 */
export async function refreshActiveGraphqlSoupQueries(
  options: { throwOnError?: boolean } = {}
): Promise<void> {
  const refreshed = new Set<ActiveGraphqlSoupQuery>();
  await Promise.all(
    [...activeQueries].map(async (query) => {
      if (!query.isEnabled()) return;
      try {
        await query.refresh();
        refreshed.add(query);
      } catch (error) {
        console.error('[graphql-soup] failed to refresh active query', error);
      }
    })
  );
  // A reader enabled/registered during this pass also needs a fresh result.
  // Conversely, a failed reader that unmounted no longer blocks completion.
  if (
    options.throwOnError &&
    [...activeQueries].some(
      (query) => query.isEnabled() && !refreshed.has(query)
    )
  ) {
    throw new Error(
      'GraphQL Soup revalidation did not succeed for every active query'
    );
  }
}
