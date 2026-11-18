import type { ListFilterGroup } from '@app/components/view-shell';
import { useContactFilterOptions } from '@core/user/use-contact-filter-options';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { createMemo } from 'solid-js';
import { reconcile, type SetStoreFunction, type Store } from 'solid-js/store';
import { CALL_AUDIENCES } from '../calls-view/core/call-filters';
import { createEmailFilters } from '../email-view/filters/use-email-filters';
import type { ActivityFilters } from './context/crm-context';
import type { CrmActivityViewState } from './core/activity-view';
import type { CrmActivityTab } from './core/navigation';

/** Normal Email facets and the applicable Notes/Calls filters, with local intent. */
export function createCrmActivityFilters(
  tab: CrmActivityTab,
  state: Store<CrmActivityViewState>,
  setState: SetStoreFunction<CrmActivityViewState>
): ActivityFilters {
  if (tab === 'email') {
    return createEmailFilters(
      () => state.facets,
      (facets) => setState('facets', reconcile(facets))
    );
  }
  const tags = useTagFilterGroup();
  const groups = createMemo((): ListFilterGroup<string, string>[] => [
    ...(tab === 'notes'
      ? [
          {
            id: 'created-by',
            label: 'Created by',
            searchPlaceholder: 'Search creators...',
            options: [],
            createSource: useContactFilterOptions,
          },
        ]
      : []),
    ...(tab === 'calls'
      ? [
          {
            id: 'audience',
            label: 'Audience',
            selectionMode: 'single' as const,
            defaultOptionId: 'all',
            options: [{ id: 'all', label: 'All' }, ...CALL_AUDIENCES],
          },
        ]
      : []),
    ...(tags().options.length ? [tags()] : []),
  ]);
  return {
    groups,
    activeCount: () =>
      Object.values(state.facets).reduce((count, ids) => count + ids.length, 0),
    selectedIds: (group) => state.facets[group] ?? [],
    isSelected: (group, option) =>
      option === 'all'
        ? !state.facets[group]?.length
        : (state.facets[group] ?? []).includes(option),
    setSelected: (group, option, selected) => {
      const previous = state.facets[group] ?? [];
      const next =
        group === 'audience'
          ? option === 'all' || !selected
            ? []
            : [option]
          : selected
            ? [...previous.filter((id) => id !== option), option]
            : previous.filter((id) => id !== option);
      setState('facets', { ...state.facets, [group]: next });
    },
    clear: () => setState('facets', reconcile({})),
  };
}
