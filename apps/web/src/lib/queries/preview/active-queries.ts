type ActiveGraphqlPreviewQuery = {
  itemId: () => string;
  isEnabled: () => boolean;
  refresh: () => Promise<void>;
};

const activeQueries = new Set<ActiveGraphqlPreviewQuery>();

/** Registers a mounted GraphQL preview for targeted revalidation. */
export function registerActiveGraphqlPreviewQuery(
  query: ActiveGraphqlPreviewQuery
): () => void {
  activeQueries.add(query);
  return () => activeQueries.delete(query);
}

/** Network-refreshes mounted GraphQL previews, optionally for one entity. */
export async function refreshActiveGraphqlPreviewQueries(
  itemId?: string
): Promise<void> {
  await Promise.all(
    [...activeQueries].map(async (query) => {
      if (
        !query.isEnabled() ||
        (itemId !== undefined && query.itemId() !== itemId)
      ) {
        return;
      }
      try {
        await query.refresh();
      } catch (error) {
        console.error('[graphql-preview] failed to refresh query', error);
      }
    })
  );
}
