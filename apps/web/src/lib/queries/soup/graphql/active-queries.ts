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

/** Network-refreshes every mounted and enabled GraphQL Soup query. */
export async function refreshActiveGraphqlSoupQueries(): Promise<void> {
  await Promise.all(
    [...activeQueries].map(async (query) => {
      if (!query.isEnabled()) return;
      try {
        await query.refresh();
      } catch (error) {
        console.error('[graphql-soup] failed to refresh active query', error);
      }
    })
  );
}
