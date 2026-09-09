import { useSoupAstItemsQuery } from '@queries/soup/items';
import { buildEmailQuery } from './email-query';

/**
 * Count unread Signal rows across every linked inbox, independently of the
 * open Email view's search, filters, and pagination. Group totals come from
 * the server; the single hydrated row is not the count.
 *
 * The Soup facade selects REST/TanStack or GraphQL using the same rollout
 * controls as the Email view and participates in their cache updates.
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
      params: { ...args.params, limit: 1 },
      groupBy: { type: 'entity_type' as const },
    };
  });

  return (): number | undefined => {
    // Do not suspend the outer sidebar, or turn an unavailable count into zero.
    if (query.isLoading || query.error || query.isPlaceholderData) return;
    const groups = query.data?.groups;
    if (!groups) return;
    return groups.reduce((total, group) => total + group.totalCount, 0);
  };
}
