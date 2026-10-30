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

  createEffect(
    on(
      () =>
        [
          options.tab(),
          search.layout,
          search.sort,
          search.sortReversed,
          search.groupBy,
          options.nonListLayoutsEnabled?.() ?? true,
          search.savedView,
          state.savedViewActive,
        ] as const,
      ([tab, layout, sort, sortReversed, groupBy, nonListLayoutsEnabled]) => {
        if (!options.enabled) return;
        const savedViewActive = Boolean(
          search.savedView || state.savedViewActive
        );
        const requestedLayout =
          layout ?? (savedViewActive ? state.layout : entryLayout);

        options.setState(
          produce((draft) => {
            if (
              !search.savedView &&
              !draft.savedViewActive &&
              draft.tab !== tab
            ) {
              draft.tab = tab;
              draft.facets = normalizeFacetSelection(
                DEFAULT_TASK_FACET_SELECTION
              );
              draft.collapsedGroupIds = [];
            }

            draft.layout =
              savedViewActive || nonListLayoutsEnabled
                ? requestedLayout
                : 'list';
            draft.groupBy =
              groupBy ??
              (draft.savedViewActive || search.savedView
                ? draft.groupBy
                : tab === entryTab
                  ? entryGroupBy
                  : TASK_DEFAULT_GROUP_BY[tab]);
            if (!savedViewActive) {
              draft.sort = sort
                ? [{ id: sort, reversed: sortReversed === 'true' }]
                : entrySort.map((item) => ({ ...item }));
            } else if (
              sort &&
              (draft.sort[0]?.id !== sort ||
                !!draft.sort[0]?.reversed !== (sortReversed === 'true'))
            ) {
              draft.sort = [{ id: sort, reversed: sortReversed === 'true' }];
            }
          })
        );

        if (
          !savedViewActive &&
          !nonListLayoutsEnabled &&
          requestedLayout !== 'list'
        ) {
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
    },
  });

  const setPrimarySort = (id: TaskSortId) => {
    const current = state.sort[0];
    const reversed = current?.id === id ? !current.reversed : false;

    options.setState('sort', [{ id, reversed }]);
    if (!options.enabled) return;

    options.setSearch({ sort: id, sortReversed: reversed ? 'true' : 'false' });
  };

  return { setState, setPrimarySort };
}
