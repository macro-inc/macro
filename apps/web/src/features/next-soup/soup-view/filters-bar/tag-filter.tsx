import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';

/**
 * The caller's tags as pickable options, plus availability gating.
 * Shared by every tag-filter surface (search facet, filter dropdown, chip bar)
 * so option labels, colors, and the owning-definition mapping stay in sync.
 */
export function useTagOptions() {
  return useSoupView().tagFilter;
}

/**
 * Tag-filter state for the list-view surfaces (the filter dropdown and the
 * active-filters chip bar). Tags are written to `queryFilters.tagFilters` as
 * PropertyFilters carrying their owning definition id (soup needs it for the
 * literal); the search request maps them to option ids alone. Multiple tags OR
 * together across definitions.
 */
export function useTagFilter() {
  return useSoupView().tagFilter;
}
