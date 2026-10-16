import { debouncedDependent } from '@core/util/debounce';
import type { EntityData } from '@entity';
import { queryReadyGate } from '@queries/gate';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';

const SCOPED_SEARCH_DEBOUNCE_MS = 300;

/** Text a task name must contain; a quoted phrase matches without quotes. */
export function scopedTaskSearchText(text: string): string {
  const trimmed = text.trim();
  const quoted =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
  return quoted ? trimmed.slice(1, -1).trim() : trimmed;
}

/**
 * Task search for a list whose membership only the server can resolve, such
 * as tasks associated with a CRM record. The search service cannot express
 * that scope, so the list's own Soup query runs again with a name filter and
 * pages through its cursor; matches never come from unscoped results.
 */
export function createScopedTaskSearch(options: {
  text: Accessor<string>;
  args: (nameContains: string) => SoupAstItemsQueryArgs;
  enabled: Accessor<boolean>;
}) {
  const text = createMemo(() => scopedTaskSearchText(options.text()));
  const debouncedText = debouncedDependent(text, SCOPED_SEARCH_DEBOUNCE_MS);
  const isSearching = () => text().length > 0;
  const isSettled = () => text() === debouncedText();
  const queryEnabled = () =>
    options.enabled() && isSearching() && debouncedText().length > 0;

  const query = useSoupAstItemsQuery(
    () => {
      const { groupBy: _flat, ...args } = options.args(debouncedText());
      return args;
    },
    () => ({ enabled: queryEnabled() })
  );

  const isQueryLoading = () =>
    isSearching() &&
    (!isSettled() ||
      (queryEnabled() && (query.isPending || query.isPlaceholderData)));
  // Results for an earlier term are never shown for the current one.
  const data = createMemo<EntityData[]>(() =>
    queryEnabled() &&
    isSettled() &&
    !query.isPlaceholderData &&
    queryReadyGate(query)
      ? query.data.entities
      : []
  );

  return {
    isSearching,
    data,
    // Results are only shown once the debounced query settles.
    isLocalSearchSettling: () => isSearching() && !isSettled(),
    isSettling: () => isQueryLoading(),
    usesServiceSearch: isSearching,
    isLoading: () => isQueryLoading() && data().length === 0,
    isFetching: () => isQueryLoading() || (queryEnabled() && query.isFetching),
    error: () => (queryEnabled() ? (query.error ?? undefined) : undefined),
    hasNextPage: () => queryEnabled() && query.hasNextPage,
    isFetchingNextPage: () => queryEnabled() && query.isFetchingNextPage,
    fetchNextPage: () => query.fetchNextPage(),
    refetch: () => query.refetch(),
  };
}
