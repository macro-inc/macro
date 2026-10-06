import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import type { Query } from '@app/features/next-soup/filters/filter-store/types';
import {
  SEARCH_INDEX_SEEDS,
  type SearchIndexId,
} from '@app/features/next-soup/soup-view/filters-bar/search/search-filters-state';
import type { CategoryFilter } from './types';

type CategorySearchFilters = {
  filters: Query;
  clientFilters: SetPredicatesInput<string>;
};

// Each Cmd+K category maps to a search-view index type so the resulting
// Type: chip behaves the same as one picked from the filter row. People
// (`dms`) lists conversations and CRM contacts; only the unscoped All search
// covers both, so it keeps the search preset rather than an index.
const CATEGORY_TO_INDEX: Partial<Record<CategoryFilter, SearchIndexId>> = {
  channels: 'channels',
  documents: 'document-or-file',
  tasks: 'task',
  chats: 'agent',
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
