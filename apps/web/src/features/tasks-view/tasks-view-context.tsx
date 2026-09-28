import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import {
  createListController,
  type ListActivation,
  type ListController,
  listOwnedSlotName,
} from '@app/components/list';
import { setSidebarSectionCollapsed } from '@app/components/view-shell';
import { normalizeFacetSelection } from '@app/features/soup';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableProjects } from '@app/lib/core/constant/featureFlags';
import { makePersistedState } from '@app/lib/persistence';
import {
  createSearchParams,
  useNavigate,
  useParams,
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
  mergeProps,
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
  type UseTasksDataSourceOptions,
  useTasksDataSource,
} from './queries/use-tasks-query';
import { taskDetailRoute, tasksProjectsRoute, tasksSplitRoute } from './route';
import { tasksTabSearch, tasksTabSearchCodec } from './tasks-tab-search';
import type {
  TaskDetailTarget,
  TaskSortId,
  TasksTab,
  TasksViewState,
  TasksViewStateOptions,
} from './types';

export type TasksViewProviderProps = ContextProviderProps & {
  initialState?: TasksViewStateOptions;
  restoreEntryState?: boolean;
  scopeKey?: string;
  sourceFactory?: (
    state: Store<TasksViewState>,
    options: UseTasksDataSourceOptions
  ) => TasksDataSource;
  onOpenTask?: (
    task: TaskDetailTarget,
    options?: EntityDetailNavigationOptions
  ) => boolean;
  onCloseTask?: () => void;
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
  scopeKey?: string;
  state: Store<TasksViewState>;
  projectsEnabled: Accessor<boolean>;
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
  setTab: (tab: TasksTab) => void;
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
  const routeParams = useParams<{
    taskId?: string;
    projectId?: string;
    projectsTab?: 'projects';
  }>();
  const [tabSearch] = createSearchParams(tasksTabSearch);
  const selectPreview = createPreviewSelectionGuard();
  const userId = useUserId();
  const tagSets = useTagSets();
  const tagSetsReady = useTagSetsReady();
  const projectsFlag = useFeatureFlag(enableProjects);
  const projectsEnabled = () => projectsFlag().enabled;

  const initial = props.initialState ?? {};
  const initialTab = initial.tab ?? 'my-tasks';

  const ownedSlot = (name: string) =>
    listOwnedSlotName(props.scopeKey ? `${props.scopeKey}:${name}` : name);
  const createState = () =>
    makePersistedState(
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
        restoreEntryState:
          props.restoreEntryState ?? props.initialState === undefined,
        restorePreferences: initial.collapsedSidebarSectionIds === undefined,
        scopeKey: props.scopeKey,
      })
    );
  const [persistedState, setState] = props.scopeKey
    ? withSplitPanelOwner(ownedSlot('view-state'), createState)
    : createState();
  // A pending or disabled rollout must not overwrite the saved Projects tab.
  const state = mergeProps(persistedState, {
    get tab(): TasksTab {
      return persistedState.tab === 'projects' && !projectsEnabled()
        ? 'my-tasks'
        : persistedState.tab;
    },
  });

  const routeTab = (): TasksTab =>
    routeParams.projectId || routeParams.projectsTab
      ? 'projects'
      : tabSearch.tab;
  createEffect(
    on(routeTab, (tab) => {
      if (props.scopeKey || persistedState.tab === tab) return;
      setState(
        produce((draft) => {
          draft.tab = tab;
          draft.groupBy = TASK_DEFAULT_GROUP_BY[tab];
          draft.facets = normalizeFacetSelection(DEFAULT_TASK_FACET_SELECTION);
          draft.collapsedGroupIds = [];
        })
      );
    })
  );
  const isGroupExpanded = (groupId: string) =>
    !state.collapsedGroupIds.includes(groupId);
  const source = withSplitPanelOwner(ownedSlot('data-source'), () =>
    (props.sourceFactory ?? useTasksDataSource)(state, {
      userId,
      tagSets,
      tagSetsReady,
      isGroupExpanded,
    })
  );
  type ActivationHandler = (
    activation: ListActivation<TasksDataSourceItem, TasksListActivationMetadata>
  ) => void;
  const activation = withSplitPanelOwner(ownedSlot('activation'), () => ({
    current: undefined as ActivationHandler | undefined,
  }));
  const list = withSplitPanelOwner(ownedSlot('controller'), () =>
    createListController<TasksDataSourceItem, TasksListActivationMetadata>({
      items: source.items,
      getKey: (row) => row.id,
      selection: {
        getKey: (row) => (row.kind === 'entity' ? row.entity.id : row.id),
      },
      isNavigable: (row) => row.kind !== 'section-header',
      isSelectable: (row) => row.kind === 'entity',
      onActivate: (value) => activation.current?.(value),
    })
  );
  const registerListActivationHandler = (handler: ActivationHandler) => {
    activation.current = handler;
    onCleanup(() => {
      if (activation.current === handler) activation.current = undefined;
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
  const closeTask = () => {
    if (props.onCloseTask) return props.onCloseTask();
    navigate(
      {
        route: state.tab === 'projects' ? tasksProjectsRoute : tasksSplitRoute,
        params: {},
      },
      {
        search: {
          [tasksTabSearch.namespace]: tasksTabSearchCodec.serialize({
            tab: state.tab,
          }),
        },
      }
    );
  };
  const openTask = (
    task: TaskDetailTarget,
    options?: EntityDetailNavigationOptions
  ) => {
    if (props.onOpenTask) return props.onOpenTask(task, options);
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
      if (props.scopeKey || routeParams.projectId) return;
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
            {
              route:
                state.tab === 'projects' ? tasksProjectsRoute : tasksSplitRoute,
              params: {},
            },
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

  const setTab = (tab: TasksTab) => {
    if (tab === 'projects' && !projectsEnabled()) return;
    if (persistedState.tab === tab) {
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
    scopeKey: props.scopeKey,
    state,
    projectsEnabled,
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
