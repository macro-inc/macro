import type { SearchIndexId } from '@app/features/next-soup/core/search-filters';
import { SEARCH_INDEX_SEEDS } from '@app/features/next-soup/core/search-query';
import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import type { Query } from '@app/features/next-soup/filters/filter-store/types';
import type { EntitySearchCategory } from './queries/entity-search';

type CategorySearchFilters = {
  filters: Query;
  clientFilters: SetPredicatesInput<string>;
};

// Each Cmd+K category maps to a search-view index type: the `type:` the
// Search field opens with, and the type the phone's search narrows to. Cmd+K DMs
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

/** The Search view type a Cmd+K category searches, if it has one. */
export function categorySearchIndex(
  category: EntitySearchCategory | 'commands'
): SearchIndexId | undefined {
  return CATEGORY_TO_INDEX[category];
}

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
