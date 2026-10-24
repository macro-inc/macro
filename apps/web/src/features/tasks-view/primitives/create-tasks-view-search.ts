import { normalizeFacetSelection } from '@app/features/soup/filters/facets';
import { type Accessor, createEffect, on } from 'solid-js';
import { produce, type SetStoreFunction, type Store } from 'solid-js/store';
import { TASK_DEFAULT_GROUP_BY } from '../constants';
import { DEFAULT_TASK_FACET_SELECTION } from '../filters/task-facets';
import type { TasksTabSearchParams } from '../tasks-tab-search';
import type { TaskSortId, TasksTab, TasksViewState } from '../types';

/** Coordinates one host's URL controls without knowing its route or namespace. */
export function createTasksViewSearch(options: {
  state: Store<TasksViewState>;
  setState: SetStoreFunction<TasksViewState>;
  search: TasksTabSearchParams;
  setSearch: (
    patch: Partial<TasksTabSearchParams>,
    options?: { history: 'replace' }
  ) => void;
  tab: Accessor<TasksTab>;
  enabled: boolean;
  nonListLayoutsEnabled?: Accessor<boolean>;
}) {
  const { state, search } = options;
  // Missing URL controls restore the entry snapshot, not the latest selection.
  const entrySort = state.sort.map((item) => ({ ...item }));
  const entryTab = state.tab;
  const entryGroupBy = state.groupBy;
  const entryLayout = state.layout;
  const entryDueDate = state.dueDate ? { ...state.dueDate } : undefined;

  createEffect(
    on(
      () =>
        [
          options.tab(),
          search.layout,
          search.sort,
          search.sortReversed,
          search.groupBy,
          search.dueDate,
          search.dueStart,
          search.dueEnd,
          options.nonListLayoutsEnabled?.() ?? true,
        ] as const,
      ([
        tab,
        layout,
        sort,
        sortReversed,
        groupBy,
        dueDate,
        dueStart,
        dueEnd,
        nonListLayoutsEnabled,
      ]) => {
        if (!options.enabled) return;
        const requestedLayout = layout ?? entryLayout;

        options.setState(
          produce((draft) => {
            if (draft.tab !== tab) {
              draft.tab = tab;
              draft.facets = normalizeFacetSelection(
                DEFAULT_TASK_FACET_SELECTION
              );
              draft.collapsedGroupIds = [];
              draft.dueDate = undefined;
            }

            draft.layout = nonListLayoutsEnabled ? requestedLayout : 'list';
            draft.groupBy =
              groupBy ??
              (tab === entryTab ? entryGroupBy : TASK_DEFAULT_GROUP_BY[tab]);
            draft.sort = sort
              ? [
                  {
                    id: sort,
                    reversed:
                      !sort.startsWith('due_date_') && sortReversed === 'true',
                  },
                ]
              : entrySort.map((item) => ({ ...item }));
            draft.dueDate =
              dueDate === 'range'
                ? (dueStart || dueEnd) &&
                  (!dueStart || !dueEnd || dueStart <= dueEnd)
                  ? { type: 'range', start: dueStart, end: dueEnd }
                  : undefined
                : dueDate === 'any'
                  ? undefined
                  : dueDate
                    ? { type: dueDate }
                    : tab === entryTab && entryDueDate
                      ? { ...entryDueDate }
                      : undefined;
          })
        );

        if (!nonListLayoutsEnabled && requestedLayout !== 'list') {
          options.setSearch({ layout: 'list' }, { history: 'replace' });
        }
      }
    )
  );

  const setState = new Proxy(options.setState, {
    apply(target, thisArg, args: unknown[]) {
      Reflect.apply(target, thisArg, args);
      if (!options.enabled) return;

      if (args[0] === 'layout') {
        if (options.nonListLayoutsEnabled?.() === false) {
          options.setState('layout', 'list');
        }
        options.setSearch({ layout: state.layout });
      }

      if (args[0] === 'groupBy') {
        options.setSearch({ groupBy: state.groupBy });
      }

      if (args[0] === 'dueDate') {
        const filter = state.dueDate;
        options.setSearch({
          dueDate: filter?.type ?? 'any',
          dueStart: filter?.type === 'range' ? filter.start : undefined,
          dueEnd: filter?.type === 'range' ? filter.end : undefined,
        });
      }
    },
  });

  const setPrimarySort = (id: TaskSortId) => {
    const current = state.sort[0];
    const reversed =
      !id.startsWith('due_date_') && current?.id === id
        ? !current.reversed
        : false;

    options.setState('sort', [{ id, reversed }]);
    if (!options.enabled) return;

    options.setSearch({ sort: id, sortReversed: reversed ? 'true' : 'false' });
  };

  return { setState, setPrimarySort };
}
