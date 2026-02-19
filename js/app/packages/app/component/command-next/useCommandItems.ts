import {
  useQuickAccess,
  type QuickAccessItem,
  type Bucket,
  isEntityItem,
  isUserItem,
  isCommandItem,
} from '@core/context/quickAccess';
import { createFreshSearch } from '@core/util/freshSort';
import { createMemo } from 'solid-js';
import type { CategoryFilter } from './types';

/**
 * Map from our CategoryFilter to QuickAccess buckets
 */
const CATEGORY_TO_BUCKETS: Record<CategoryFilter, Bucket[] | 'all'> = {
  all: 'all',
  documents: ['document', 'note', 'task', 'project'],
  channels: ['channel', 'dm'],
  chats: ['chat'],
  people: ['person'],
  commands: ['command'],
};

/** Get searchable text from a QuickAccessItem */
function getItemSearchText(item: QuickAccessItem): string {
  return item.searchText;
}

/** Get timestamp info for sorting */
function getItemTimestamp(item: QuickAccessItem) {
  return {
    updatedAt: item.timestamps.updatedAt,
    viewedAt: item.timestamps.viewedAt,
    lastInteraction: item.timestamps.lastInteraction,
  };
}

/** Check if item is a channel type (for search boosting) */
function isChannelItem(item: QuickAccessItem): boolean {
  return item.bucket === 'channel' || item.bucket === 'dm';
}

/** Create search config based on whether there's a query */
function createSearchConfig(hasQuery: boolean) {
  return {
    useViewedAt: true,
    channelBoost: hasQuery ? 1.5 : 1.0,
    fuzzyWeight: hasQuery ? 0.7 : 0.1,
    timeWeight: hasQuery ? 0.3 : 0.9,
    minFuzzyThreshold: hasQuery ? 0.1 : 0,
    commaSeparatedChannelMatch: true,
  };
}

/**
 * Hook to get items from QuickAccess organized by category.
 * Items are already sorted by recency from QuickAccess.
 */
export function useCommandItems() {
  const quickAccess = useQuickAccess();

  // Get all items from QuickAccess (already sorted by recency)
  const allItems = quickAccess.useList();

  // Individual bucket accessors for convenience
  const documents = quickAccess.useList('document', 'note', 'task', 'project');
  const channels = quickAccess.useList('channel', 'dm');
  const chats = quickAccess.useList('chat');
  const commands = quickAccess.useList('command');
  const people = quickAccess.useList('person');

  return {
    allItems,
    documents,
    channels,
    chats,
    commands,
    people,
    isLoading: quickAccess.isLoading,
    getById: quickAccess.getById,
  };
}

/**
 * Hook to search and filter QuickAccess items.
 * Uses freshSearch for fuzzy matching when there's a query,
 * otherwise returns items in their natural recency order.
 */
export function useFilteredItems(
  query: () => string,
  categoryFilter: () => CategoryFilter
) {
  const quickAccess = useQuickAccess();

  // Get the appropriate items based on category filter
  const categoryItems = createMemo(() => {
    const filter = categoryFilter();
    const buckets = CATEGORY_TO_BUCKETS[filter];

    if (buckets === 'all') {
      return quickAccess.useList()();
    }

    // Use the appropriate bucket list
    switch (filter) {
      case 'documents':
        return quickAccess.useList('document', 'note', 'task', 'project')();
      case 'channels':
        return quickAccess.useList('channel', 'dm')();
      case 'chats':
        return quickAccess.useList('chat')();
      case 'people':
        return quickAccess.useList('person')();
      case 'commands':
        return quickAccess.useList('command')();
      default:
        return quickAccess.useList()();
    }
  });

  // Create fresh search function
  const search = createMemo(() => {
    const q = query();
    const hasQuery = q.trim().length > 0;
    return createFreshSearch<QuickAccessItem>(
      createSearchConfig(hasQuery),
      getItemSearchText,
      isChannelItem,
      getItemTimestamp
    );
  });

  // Apply search or return items sorted by recency
  const filteredItems = createMemo(() => {
    const q = query().trim();
    const items = categoryItems();

    if (!q) {
      // No query - items are already sorted by recency from QuickAccess
      return items;
    }

    // Apply fuzzy search
    return search()(items, q).map((result) => result.item);
  });

  return filteredItems;
}

// Re-export type guards for convenience
export { isEntityItem, isUserItem, isCommandItem };
export type { QuickAccessItem, Bucket };
