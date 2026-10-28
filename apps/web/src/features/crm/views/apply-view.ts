import type { Query } from '../../next-soup/filters/filter-store';
import { useCrmWorkspace } from '../context/workspace-context';
import { createApplyCrmView } from '../primitives/apply-view';
export function useApplyCrmView() {
  const view = useCrmWorkspace();
  return createApplyCrmView({
    setActiveTab: view.setActiveTab,
    replaceFilters: (filters) =>
      view.queryFilters.replace((filters as Query | undefined) ?? null),
    replacePredicates: view.soup.predicates.set,
    setSearchText: view.setSearchText,
    setGroupBy: view.soup.grouping.setActiveGroupId,
    setSort: (ids) =>
      view.soup.sort.setAll(ids as Parameters<typeof view.soup.sort.setAll>[0]),
    setStageFilter(ids) {
      view.setStageFilter(ids);
      if (ids.length > 0 !== view.soup.predicates.isActive('company-stage'))
        view.soup.predicates.toggle({ and: ['company-stage'] });
    },
    setOwnerFilter(ids) {
      view.setOwnerFilter(ids);
      if (ids.length > 0 !== view.soup.predicates.isActive('company-owner'))
        view.soup.predicates.toggle({ and: ['company-owner'] });
    },
  });
}
