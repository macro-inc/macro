import { type Accessor, createEffect, untrack } from 'solid-js';
import type { boundedCount } from './bounded-count';
import type { SoupAstItemsQuery } from './items';

type CountPageSource = Pick<
  SoupAstItemsQuery,
  | 'isEnabled'
  | 'isLoading'
  | 'isFetching'
  | 'isFetchingNextPage'
  | 'isPlaceholderData'
  | 'error'
  | 'hasNextPage'
  | 'fetchNextPage'
>;

/**
 * Continue an incomplete badge query until its count is known or capped.
 * Fetching is driven by the query's loading/error state, not by whether the
 * corresponding list view is open. Read mutations can make a capped count
 * unknown again; the same rule then resumes pagination.
 */
export function createBoundedCountPagination(
  query: CountPageSource,
  count: Accessor<ReturnType<typeof boundedCount>>
) {
  const fetchNextPage = async () => {
    try {
      await query.fetchNextPage();
    } catch (error) {
      // The query retains its error state; do not start a separate retry loop.
      console.error('Failed to load the next unread-count page', error);
    }
  };

  // This effect synchronizes the external query with the count's data needs;
  // the count itself remains a pure derivation of the loaded rows.
  createEffect(() => {
    if (
      !query.isEnabled ||
      query.isLoading ||
      query.isFetching ||
      query.isFetchingNextPage ||
      query.isPlaceholderData ||
      query.error ||
      !query.hasNextPage ||
      count() !== undefined
    ) {
      return;
    }
    untrack(() => void fetchNextPage());
  });
}
