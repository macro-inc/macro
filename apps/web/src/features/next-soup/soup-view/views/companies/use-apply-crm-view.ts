import type { Query } from '@app/features/next-soup/filters/filter-store';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import type { CrmViewConfig } from '@companies/crm/saved-views';
import { batch } from 'solid-js';

/**
 * Applies a saved CRM view config to the current Customers view. Mirrors the
 * init/applyTabPreset path: replace filters + predicates atomically, then
 * re-derive the stage/owner predicate active state from the saved sub-filter
 * selections (same rule as handleStageChange / handleOwnerChange in
 * unified-filter-dropdown).
 */
export function useApplyCrmView() {
  const {
    soup,
    queryFilters,
    setSearchText,
    setStageFilter,
    setOwnerFilter,
    setActiveTab,
    setViewMode,
  } = useSoupView();

  return (config: CrmViewConfig) => {
    batch(() => {
      queryFilters.replace((config.filters as Query | undefined) ?? null);
      soup.predicates.set(config.clientFilters ?? {});
      setSearchText(config.searchText ?? '');
      // `groupBy: null` records an explicit "no grouping"; the grouping
      // store expresses that as `undefined` (same as the init path).
      soup.grouping.setActiveGroupId(config.groupBy ?? undefined);
      soup.sort.setAll(
        (config.sort?.length ? config.sort : ['updated_at']) as Parameters<
          typeof soup.sort.setAll
        >[0]
      );
      const stages = config.stageFilter ?? [];
      setStageFilter(stages);
      if (stages.length > 0 !== soup.predicates.isActive('company-stage')) {
        soup.predicates.toggle({ and: ['company-stage'] });
      }
      const owners = config.ownerFilter ?? [];
      setOwnerFilter(owners);
      if (owners.length > 0 !== soup.predicates.isActive('company-owner')) {
        soup.predicates.toggle({ and: ['company-owner'] });
      }
      setViewMode(config.viewMode ?? 'board');
      if (config.activeTab !== undefined) setActiveTab(config.activeTab);
    });
  };
}
