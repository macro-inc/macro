import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import type { Query } from '@app/features/next-soup/filters/filter-store/types';
import {
  SEARCH_INDEX_SEEDS,
  type SearchIndexId,
} from '@app/features/next-soup/soup-view/filters-bar/search/search-index-seeds';
import type { EntitySearchCategory } from './queries/entity-search';

type CategorySearchFilters = {
  filters: Query;
  clientFilters: SetPredicatesInput<string>;
};

// Each Cmd+K category maps to a search-view index type so the resulting
// Type: chip behaves the same as one picked from the filter row. Cmd+K DMs
// maps to the same channels index as Channels for now; channelType-based
// narrowing (DMs vs non-DMs) is left for a follow-up once the search
// backend honors it.
const CATEGORY_TO_INDEX: Partial<
  Record<EntitySearchCategory | 'commands', SearchIndexId>
> = {
  email: 'email',
  people: 'channels',
  channels: 'channels',
  dms: 'channels',
  documents: 'document-or-file',
  tasks: 'task',
  chats: 'agent',
};

export function getCategorySearchFilters(
  category: EntitySearchCategory | 'commands'
): CategorySearchFilters | undefined {
  const indexValue = CATEGORY_TO_INDEX[category];
  if (!indexValue) return undefined;

  return {
    filters: SEARCH_INDEX_SEEDS[indexValue],
    clientFilters: { and: ['search-supported'], or: [indexValue] },
  };
}
