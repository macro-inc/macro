import { queryStateFrom } from '@app/features/next-soup/filters/filter-store';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { buildSoupSearchRequest } from '@app/features/next-soup/soup-view/search-request';
import { createSearchState } from '@app/features/soup/search';
import type { Accessor } from 'solid-js';
import { getCategorySearchFilters } from '../category-search-filters';
import type { EntitySearchCategory } from './entity-search';

/** Transient category-only search; never reads saved view facets or mailbox selections. */
export function createMobileFullTextSearch(
  text: Accessor<string>,
  category: Accessor<EntitySearchCategory>
) {
  return createSearchState({
    text,
    disableLocalSearch: () => true,
    enabled: () => category() !== 'projects' && !!text().trim(),
    buildRequest: (search) =>
      buildSoupSearchRequest(
        queryStateFrom(
          getCategorySearchFilters(category())?.filters ??
            getViewPreset('search')?.filters ??
            {}
        ),
        search
      ),
  });
}
