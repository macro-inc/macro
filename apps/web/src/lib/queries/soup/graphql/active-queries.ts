import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import { createRequest } from '@urql/core';

type ActiveGraphqlSoupQuery = {
  isEnabled: () => boolean;
  refresh: () => Promise<void>;
  /** Readers that omit this are refreshed for agent-session changes. */
  mayContainAgentSessions?: () => boolean;
};

const activeQueries = new Set<ActiveGraphqlSoupQuery>();
const revalidationSources = new Set<() => readonly QueryRevalidation[]>();

/** Each reader supplies its enabled, loaded pages for durable mutation replay. */
export function registerGraphqlSoupRevalidations(
  queries: () => readonly QueryRevalidation[]
): () => void {
  revalidationSources.add(queries);
  return () => revalidationSources.delete(queries);
}

/** Snapshot query descriptors without fetching or waiting on the cache. */
export function getActiveGraphqlSoupRevalidations(): QueryRevalidation[] {
  const queries = new Map<number, QueryRevalidation>();
  for (const source of revalidationSources) {
    for (const query of source()) {
      queries.set(createRequest(query.document, query.variables).key, query);
    }
  }
  return [...queries.values()];
}

/** Registers a mounted GraphQL Soup query for mutation-driven revalidation. */
export function registerActiveGraphqlSoupQuery(
  query: ActiveGraphqlSoupQuery
): () => void {
  activeQueries.add(query);
  return () => activeQueries.delete(query);
}

/** Network-refreshes every mounted and enabled GraphQL Soup query, or only
 * readers that can show agent sessions when `agentSessionListsOnly` is set.
 * Strict callers may only release optimistic state after every active reader
 * succeeded. Other callers retain the existing best-effort behavior.
 */
export async function refreshActiveGraphqlSoupQueries(
  options: { throwOnError?: boolean; agentSessionListsOnly?: boolean } = {}
): Promise<void> {
  const targeted = (query: ActiveGraphqlSoupQuery) =>
    query.isEnabled() &&
    (!options.agentSessionListsOnly ||
      (query.mayContainAgentSessions?.() ?? true));
  const refreshed = new Set<ActiveGraphqlSoupQuery>();
  await Promise.all(
    [...activeQueries].map(async (query) => {
      if (!targeted(query)) return;
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
    [...activeQueries].some((query) => targeted(query) && !refreshed.has(query))
  ) {
    throw new Error(
      'GraphQL Soup revalidation did not succeed for every active query'
    );
  }
}
