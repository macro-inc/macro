import type { FilterID } from '@app/component/next-soup/filters';
import type { Query } from '@app/component/next-soup/filters/filter-store';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { batch } from 'solid-js';

export const TASK_STATUS_FILTER_IDS: FilterID[] = [
  'task-not-started',
  'task-in-progress',
  'task-in-review',
  'task-completed',
  'task-canceled',
];

/**
 * Shared mechanics for the task-status multi-select, used by both the status
 * chip and the filter menu so they behave identically. Toggling a status is a
 * plain toggle, so unchecking the last one leaves the selection empty (no
 * filter). "Only" narrows to a single status, flipping to "All" — which, like
 * the chip's clear, re-enables every status.
 */
export function useTaskStatusFilter() {
  const { soup, queryFilters } = useSoupView();

  const statusQuery = (id: FilterID): Query | undefined => {
    const query = soup.predicates.getConfig(id)?.query;
    return query ? (query as Query) : undefined;
  };

  // `wasActive` is the pre-toggle state, which decides the add/remove direction.
  const setStatus = (id: FilterID, wasActive: boolean) => {
    soup.predicates.toggle({ or: [id] });
    const query = statusQuery(id);
    if (!query) return;
    if (wasActive) queryFilters.remove(query);
    else queryFilters.add(query);
  };

  const isActive = (id: FilterID) => soup.predicates.isActive(id);
  const activeIds = () => TASK_STATUS_FILTER_IDS.filter(isActive);
  const isSoleActive = (id: FilterID) => {
    const ids = activeIds();
    return ids.length === 1 && ids[0] === id;
  };

  const enableAll = () =>
    batch(() => {
      for (const id of TASK_STATUS_FILTER_IDS) {
        if (!isActive(id)) setStatus(id, false);
      }
    });

  const toggle = (id: FilterID) => {
    const active = isActive(id);
    batch(() => setStatus(id, active));
  };

  const selectOnly = (id: FilterID) => {
    if (isSoleActive(id)) {
      enableAll();
      return;
    }
    batch(() => {
      for (const sid of TASK_STATUS_FILTER_IDS) {
        const active = isActive(sid);
        if (active !== (sid === id)) setStatus(sid, active);
      }
    });
  };

  return { isActive, activeIds, isSoleActive, toggle, selectOnly, enableAll };
}
