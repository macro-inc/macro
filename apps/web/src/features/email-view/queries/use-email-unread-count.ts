import { boundedCount } from '@queries/soup/bounded-count';
import { createBoundedCountPagination } from '@queries/soup/bounded-count-pagination';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { buildEmailQuery } from './email-query';

/**
 * Read enough unread Signal rows to display the sidebar badge. A complete
 * result gives an exact count; 100 confirmed unread rows establish `99+`.
 * A shorter, incomplete result is unknown while subsequent pages load.
 *
 * The Soup facade selects REST/TanStack or GraphQL using the same rollout
 * controls as the Email view. Do not use grouped totals: the grouped backend
 * does not include email. Replace this bounded row query with the general
 * count capability once that is available.
 */
export function useEmailUnreadCount() {
  const query = useSoupAstItemsQuery(() => {
    const args = buildEmailQuery({
      tab: 'important',
      inboxIds: undefined,
      facets: { read: ['unread'] },
    });
    return {
      ...args,
      params: { ...args.params, limit: 100 },
    };
  });

  const count = (): number | '99+' | undefined => {
    // Do not suspend the outer sidebar, or turn an unavailable count into zero.
    if (query.isLoading || query.error || query.isPlaceholderData) return;
    const entities = query.data?.entities;
    if (!entities) return;
    // Cached rows can remain after a read mutation. Count live unread state,
    // not the query's page size, and count each thread only once.
    const unreadIds = new Set(
      entities
        .filter((entity) => entity.type === 'email' && !entity.isRead)
        .map((entity) => entity.id)
    );
    return boundedCount(unreadIds, !query.hasNextPage);
  };
  createBoundedCountPagination(query, count);
  return count;
}
