import type { SetPredicatesInput } from '@app/component/next-soup/filters/filter-store/predicates-store';
import type { Query } from '@app/component/next-soup/filters/filter-store/types';
import { INDEX_OPTIONS } from '@app/component/next-soup/soup-view/filters-bar/search-filter-controls';
import type { CategoryFilter } from './types';

type CategorySearchFilters = {
  filters: Query;
  clientFilters: SetPredicatesInput<string>;
};

// Each Cmd+K category maps to a search-view INDEX_OPTIONS value so the
// resulting Type: chip behaves the same as one picked from the filter
// dropdown. Cmd+K DMs maps to the same channels index as Channels for now;
// channelType-based narrowing (DMs vs non-DMs) is left for a follow-up once
// the search backend honors it.
const CATEGORY_TO_INDEX: Partial<Record<CategoryFilter, string>> = {
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
  const option = INDEX_OPTIONS.find((o) => o.value === indexValue);
  if (!option) return undefined;

  return {
    filters: option.queryFilters,
    clientFilters: { or: [indexValue] },
  };
}
