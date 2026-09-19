import { normalizeFacetSelection } from '@app/features/soup';
import { makePersistedState } from '@app/lib/persistence';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import type { ContextProviderProps } from '@solid-primitives/context';
import {
  createStore,
  produce,
  reconcile,
  type SetStoreFunction,
  type Store,
} from 'solid-js/store';
import { TASK_DEFAULT_GROUP_BY } from './constants';
import { DEFAULT_TASK_FACET_SELECTION } from './filters/task-facets';
import { createTasksViewPersistence } from './persistence';
import type {
  TaskSortId,
  TasksViewState,
  TasksViewStateOptions,
  TaskTab,
} from './types';

type TasksViewProviderProps = ContextProviderProps & {
  initialState?: TasksViewStateOptions;
};

export type TasksViewContext = {
  state: Store<TasksViewState>;
  setState: SetStoreFunction<TasksViewState>;
  setTab: (tab: TaskTab) => void;
  setFacets: (facets: TasksViewState['facets']) => void;
  setPrimarySort: (id: TaskSortId) => void;
};

export const [TasksViewProvider, useTasksView] = createAssertedContextProvider<
  TasksViewContext,
  TasksViewProviderProps
>('TasksView', (props) => {
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();

  const initial = props.initialState ?? {};
  const initialTab = initial.tab ?? 'my-tasks';

  const [state, setState] = makePersistedState(
    createStore<TasksViewState>({
      tab: initialTab,
      search: initial.search ?? '',
      groupBy: initial.groupBy ?? TASK_DEFAULT_GROUP_BY[initialTab],
      sort: (initial.sort ?? [{ id: 'updated_at' }]).map((item) => ({
        ...item,
      })),
      facets: normalizeFacetSelection(
        initial.facets ?? DEFAULT_TASK_FACET_SELECTION
      ),
      collapsedGroupIds: [...(initial.collapsedGroupIds ?? [])],
      collapsedSidebarSectionIds: [
        ...(initial.collapsedSidebarSectionIds ?? []),
      ],
    }),
    createTasksViewPersistence({
      handle: panel.handle,
      userId,
      restoreEntryState: props.initialState === undefined,
      restorePreferences: initial.collapsedSidebarSectionIds === undefined,
    })
  );

  const setTab = (tab: TaskTab) => {
    if (state.tab === tab) return;

    setState(
      produce((draft) => {
        draft.tab = tab;
        draft.groupBy = TASK_DEFAULT_GROUP_BY[tab];
        draft.facets = normalizeFacetSelection(DEFAULT_TASK_FACET_SELECTION);
        draft.collapsedGroupIds = [];
      })
    );
  };

  const setFacets = (facets: TasksViewState['facets']) => {
    setState('facets', reconcile(normalizeFacetSelection(facets)));
  };

  const setPrimarySort = (id: TaskSortId) => {
    const current = state.sort[0];
    const reversed = current?.id === id ? !current.reversed : false;

    setState('sort', [{ id, reversed }]);
  };

  return {
    state,
    setState,
    setTab,
    setFacets,
    setPrimarySort,
  };
});
