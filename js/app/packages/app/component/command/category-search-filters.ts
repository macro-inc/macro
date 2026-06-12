import type { SetPredicatesInput } from '@app/component/next-soup/filters/filter-store/predicates-store';
import type { Query } from '@app/component/next-soup/filters/filter-store/types';
import {
  SEARCH_INDEX_SEEDS,
  type SearchIndexId,
} from '@app/component/next-soup/soup-view/filters-bar/search/search-filters-state';
import type { CategoryFilter } from './types';

type CategorySearchFilters = {
  filters: Query;
  clientFilters: SetPredicatesInput<string>;
};

// Each Cmd+K category maps to a search-view index type so the resulting
// Type: chip behaves the same as one picked from the filter row. Cmd+K DMs
// maps to the same channels index as Channels for now; channelType-based
// narrowing (DMs vs non-DMs) is left for a follow-up once the search
// backend honors it.
const CATEGORY_TO_INDEX: Partial<Record<CategoryFilter, SearchIndexId>> = {
  channels: 'channels',
  dms: 'channels',
  documents: 'document-or-file',
  tasks: 'task',
  chats: 'agent',
  projects: 'folders',
};

export function getCategorySearchFilters(
  category: CategoryFilter
): CategorySearchFilters | undefined {
  const indexValue = CATEGORY_TO_INDEX[category];
  if (!indexValue) return undefined;

  return {
    filters: SEARCH_INDEX_SEEDS[indexValue],
    clientFilters: { and: ['search-supported'], or: [indexValue] },
  };
}
