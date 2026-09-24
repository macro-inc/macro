import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/EntityDetailNavigationStack';
import {
  createListController,
  type ListActivation,
  type ListController,
  listOwnedSlotName,
} from '@app/components/list';
import { setSidebarSectionCollapsed } from '@app/components/view-shell';
import { normalizeFacetSelection } from '@app/features/soup';
import { makePersistedState } from '@app/lib/persistence';
import {
  createSearchParams,
  useNavigate,
  useRouteParams,
} from '@app/lib/split-router';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import type { ContextProviderProps } from '@solid-primitives/context';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';
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
import {
  type TasksDataSource,
  type TasksDataSourceItem,
  useTasksDataSource,
} from './queries/use-tasks-query';
import { taskDetailRoute, tasksSplitRoute } from './route';
import { tasksTabSearch, tasksTabSearchCodec } from './tasks-tab-search';
import type {
  TaskDetailTarget,
  TaskSortId,
  TasksViewState,
  TasksViewStateOptions,
  TaskTab,
} from './types';

type TasksViewProviderProps = ContextProviderProps & {
  initialState?: TasksViewStateOptions;
};

export type TasksListActivationMetadata = {
  event?: MouseEvent;
  newSplit?: boolean;
};

type TasksListController = ListController<
  TasksDataSourceItem,
  TasksListActivationMetadata
>;

export type TasksViewContext = {
  state: Store<TasksViewState>;
  setState: SetStoreFunction<TasksViewState>;
  selectedTask: Accessor<TaskDetailTarget | undefined>;
  source: TasksDataSource;
  list: TasksListController;
  registerListActivationHandler: (
    handler: (
      activation: ListActivation<
        TasksDataSourceItem,
        TasksListActivationMetadata
      >
    ) => void
  ) => void;
  /** Returns false when inline detail is unavailable so the caller opens a split instead. */
  openTask: (
    task: TaskDetailTarget,
    options?: EntityDetailNavigationOptions
  ) => boolean;
  closeTask: () => void;
  setTab: (tab: TaskTab) => void;
  setFacets: (facets: TasksViewState['facets']) => void;
  setPrimarySort: (id: TaskSortId) => void;
  isSidebarSectionOpen: (id: string) => boolean;
  setSidebarSectionOpen: (id: string, open: boolean) => void;
};

export const [TasksViewProvider, useTasksView] = createAssertedContextProvider<
  TasksViewContext,
  TasksViewProviderProps
>('TasksView', (props) => {
  const panel = useSplitPanelOrThrow();
  const navigate = useNavigate();
  const routeParams = useRouteParams(taskDetailRoute);
  const [tabSearch] = createSearchParams(tasksTabSearch);
  const selectPreview = createPreviewSelectionGuard();
  const userId = useUserId();
  const tagSets = useTagSets();
  const tagSetsReady = useTagSetsReady();

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

  createEffect(
    on(
      () => tabSearch.tab,
      (tab) => {
        if (state.tab === tab) return;
        setState(
          produce((draft) => {
            draft.tab = tab;
            draft.groupBy = TASK_DEFAULT_GROUP_BY[tab];
            draft.facets = normalizeFacetSelection(
              DEFAULT_TASK_FACET_SELECTION
            );
            draft.collapsedGroupIds = [];
          })
        );
      }
    )
  );

  const isGroupExpanded = (groupId: string) =>
    !state.collapsedGroupIds.includes(groupId);
  const source = withSplitPanelOwner(listOwnedSlotName('data-source'), () =>
    useTasksDataSource(state, {
      userId,
      tagSets,
      tagSetsReady,
      isGroupExpanded,
    })
  );
  let listActivationHandler:
    | ((
        activation: ListActivation<
          TasksDataSourceItem,
          TasksListActivationMetadata
        >
      ) => void)
    | undefined;
  const list = withSplitPanelOwner(listOwnedSlotName('controller'), () =>
    createListController<TasksDataSourceItem, TasksListActivationMetadata>({
      items: source.items,
      getKey: (row) => row.id,
      selection: {
        getKey: (row) => (row.kind === 'entity' ? row.entity.id : row.id),
      },
      isNavigable: (row) => row.kind !== 'section-header',
      isSelectable: (row) => row.kind === 'entity',
      onActivate: (activation) => listActivationHandler?.(activation),
    })
  );
  const registerListActivationHandler = (
    handler: NonNullable<typeof listActivationHandler>
  ) => {
    listActivationHandler = handler;
    onCleanup(() => {
      if (listActivationHandler === handler) listActivationHandler = undefined;
    });
  };

  const selectedTask = createMemo<TaskDetailTarget | undefined>(() => {
    const taskId = routeParams.taskId;
    return typeof taskId === 'string' ? { id: taskId } : undefined;
  });
  const taskSelection = (taskId: string) => ({
    type: 'document' as const,
    id: taskId,
    fileType: 'md' as const,
    subType: { type: 'task' as const },
  });
  const opensInline = (options?: EntityDetailNavigationOptions) => {
    const event = options?.event;
    return (
      !isTouchDevice() &&
      !(event?.shiftKey || event?.metaKey || event?.ctrlKey || event?.altKey)
    );
  };
  const closeTask = () =>
    navigate(
      { route: tasksSplitRoute, params: {} },
      {
        search: {
          [tasksTabSearch.namespace]: tasksTabSearchCodec.serialize({
            tab: state.tab,
          }),
        },
      }
    );
  const openTask = (
    task: TaskDetailTarget,
    options?: EntityDetailNavigationOptions
  ) => {
    if (!opensInline(options)) return false;
    if (!selectPreview.canSelect(taskSelection(task.id))) return true;
    navigate(
      { route: taskDetailRoute, params: { taskId: task.id } },
      {
        search: {
          [tasksTabSearch.namespace]: tasksTabSearchCodec.serialize({
            tab: state.tab,
          }),
        },
      }
    );
    return true;
  };

  createEffect(
    on(selectedTask, (task, previous) => {
      if (!selectPreview(task ? taskSelection(task.id) : undefined)) {
        if (previous) {
          navigate(
            { route: taskDetailRoute, params: { taskId: previous.id } },
            {
              replace: true,
              search: {
                [tasksTabSearch.namespace]: tasksTabSearchCodec.serialize({
                  tab: state.tab,
                }),
              },
            }
          );
        } else {
          navigate(
            { route: tasksSplitRoute, params: {} },
            {
              replace: true,
              search: {
                [tasksTabSearch.namespace]: tasksTabSearchCodec.serialize({
                  tab: state.tab,
                }),
              },
            }
          );
        }
        return;
      }
      if (!task) return;
      const row = source
        .items()
        .find((item) => item.kind === 'entity' && item.entity.id === task.id);
      if (!row) return;
      list.focus.set(row.id, { reason: 'programmatic', force: true });
      list.selection.setAnchor(row.id);
    })
  );

  const setTab = (tab: TaskTab) => {
    if (state.tab === tab) {
      closeTask();
      return;
    }
    setState(
      produce((draft) => {
        draft.tab = tab;
        draft.groupBy = TASK_DEFAULT_GROUP_BY[tab];
        draft.facets = normalizeFacetSelection(DEFAULT_TASK_FACET_SELECTION);
        draft.collapsedGroupIds = [];
      })
    );
    closeTask();
  };

  const setFacets = (facets: TasksViewState['facets']) => {
    closeTask();
    setState('facets', reconcile(normalizeFacetSelection(facets)));
  };

  const setPrimarySort = (id: TaskSortId) => {
    const current = state.sort[0];
    const reversed = current?.id === id ? !current.reversed : false;

    setState('sort', [{ id, reversed }]);
  };

  const isSidebarSectionOpen = (id: string) =>
    !state.collapsedSidebarSectionIds.includes(id);

  const setSidebarSectionOpen = (id: string, open: boolean) =>
    setState(
      'collapsedSidebarSectionIds',
      setSidebarSectionCollapsed(id, open)
    );

  return {
    state,
    setState,
    selectedTask,
    source,
    list,
    registerListActivationHandler,
    openTask,
    closeTask,
    setTab,
    setFacets,
    setPrimarySort,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
  };
});
