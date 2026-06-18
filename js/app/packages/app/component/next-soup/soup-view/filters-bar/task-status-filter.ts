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

export function useTaskStatusFilter() {
  const { soup, queryFilters } = useSoupView();

  const statusQuery = (id: FilterID): Query | undefined => {
    const query = soup.predicates.getConfig(id)?.query;
    return query ? (query as Query) : undefined;
  };

  const setStatus = (id: FilterID, wasActive: boolean) => {
    soup.predicates.toggle({ or: [id] });
    const query = statusQuery(id);
    if (!query) return;
    if (wasActive) queryFilters.remove(query);
    else queryFilters.add(query);
  };

  const isActive = (id: FilterID) => soup.predicates.isActive(id);

  const clear = () =>
    batch(() => {
      for (const id of TASK_STATUS_FILTER_IDS) {
        if (isActive(id)) setStatus(id, true);
      }
    });

  const toggle = (id: FilterID) => {
    const active = isActive(id);
    batch(() => setStatus(id, active));
  };

  return { isActive, toggle, clear };
}
