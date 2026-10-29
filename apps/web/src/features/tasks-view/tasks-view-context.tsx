import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import {
  createListController,
  type ListActivation,
  type ListController,
  listOwnedSlotName,
} from '@app/components/list';
import { setSidebarSectionCollapsed } from '@app/components/view-shell';
import type {
  SavedViewSource,
  SavedViewsSource,
} from '@app/features/saved-views/context/saved-views-source';
import { normalizeFacetSelection } from '@app/features/soup';
import { createTagFacetContext } from '@app/features/soup/filters/facets/tag-facet';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableGantt,
  enableProjects,
} from '@app/lib/core/constant/featureFlags';
import { makePersistedState } from '@app/lib/persistence';
import {
  createSearchParams,
  useNavigate,
  useParams,
} from '@app/lib/split-router';
import {
  taskDetailRoute,
  tasksProjectsRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import {
  useSplitPanelOrThrow,
  withSplitPanelOwner,
} from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import type { ContextProviderProps } from '@solid-primitives/context';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
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
import { toTaskBoardGrouping } from './core/task-board';
import type { TaskFacetContext } from './filters/task-facets';
import { DEFAULT_TASK_FACET_SELECTION } from './filters/task-facets';
import { createTasksViewPersistence } from './persistence';
import {
  createTaskSavedViewDraft,
  type TaskSavedViewDraft,
} from './primitives/create-task-saved-view-draft';
import { createTasksViewSearch } from './primitives/create-tasks-view-search';
import {
  type TasksDataSource,
  type TasksDataSourceItem,
  type UseTasksDataSourceOptions,
  useTasksDataSource,
} from './queries/use-tasks-query';
import { tasksTabSearch, tasksTabSearchCodec } from './tasks-tab-search';
import type {
  TaskCreateOptions,
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
  /** Enables URL controls for an embedded view without sharing the parent namespace. */
  searchNamespace?: string;
  sourceFactory?: (
    state: Store<TasksViewState>,
    options: UseTasksDataSourceOptions
  ) => TasksDataSource;
  onOpenTask?: (
    task: TaskDetailTarget,
    options?: EntityDetailNavigationOptions
  ) => boolean;
  onCloseTask?: () => void;
  /** Host-owned task creation, including scope and permissions for embedded views. */
  onCreateTask?: (options?: TaskCreateOptions) => void;
  /** Hides each task's project when every task shares the host's project. */
  hideTaskProject?: boolean;
  savedViewTeam?: Accessor<{ id: string; name: string } | undefined>;
  /** Main Tasks supplies independent queries; embedded lists leave them out. */
  savedViewsSource?: () => SavedViewsSource;
  savedViewSource?: (
    selectedId: Accessor<string | undefined>
  ) => SavedViewSource;
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
  savedViews?: TaskSavedViewDraft;
  savedViewsList?: SavedViewsSource;
  savedViewSource?: SavedViewSource;
  savedViewScope: Accessor<
    { id: string | undefined; viewerId: string | undefined } | undefined
  >;
  startSavedView: () => void;
  selectSavedView: (id: string) => void;
  selectCreatedSavedView: (id: string) => void;
  leaveSavedView: () => void;
  savedViewTeam?: Accessor<{ id: string; name: string } | undefined>;
  facetContext: Accessor<TaskFacetContext>;
  createTask?: TasksViewProviderProps['onCreateTask'];
  projectsEnabled: Accessor<boolean>;
  showTaskProject: Accessor<boolean>;
  ganttEnabled: Accessor<boolean>;
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
  /**
   * Filters by a single tag without changing tabs. Used by the inline
   * "filter by tag" button on entity rows.
   */
  filterByTag: (optionId: string) => void;
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
  const searchNamespace = props.searchNamespace ?? tasksTabSearch.namespace;
  const syncSearch = !props.scopeKey || !!props.searchNamespace;
  const [tabSearch, setTabSearch] = createSearchParams({
    ...tasksTabSearch,
    namespace: searchNamespace,
  });
  const selectPreview = createPreviewSelectionGuard();
  const userId = useUserId();
  const tagSets = useTagSets();
  const tagSetsReady = useTagSetsReady();
  const [newSavedView, setNewSavedView] = createSignal<boolean | string>(false);
  const [savedViewNavigation, setSavedViewNavigation] = createSignal({});
  const projectsFlag = useFeatureFlag(enableProjects);
  const projectsEnabled = () => projectsFlag().enabled;
  const showTaskProject = () => projectsEnabled() && !props.hideTaskProject;
  const ganttFlag = useFeatureFlag(enableGantt);
  const ganttEnabled = () => ganttFlag().enabled;

  const initial = props.initialState ?? {};
  const initialTab = initial.tab ?? 'my-tasks';

  const ownedSlot = (name: string) =>
    listOwnedSlotName(props.scopeKey ? `${props.scopeKey}:${name}` : name);
  const createState = () =>
    makePersistedState(
      createStore<TasksViewState>({
        layout: initial.layout ?? 'list',
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
  // Rollout fallbacks must not overwrite saved tab or layout selections.
  const state = mergeProps(persistedState, {
    get savedViewActive() {
      return Boolean(
        props.savedViewSource && (newSavedView() || tabSearch.savedView)
      );
    },
    get layout() {
      if (
        isTouchDevice() ||
        (persistedState.layout === 'gantt' && !ganttEnabled())
      ) {
        return 'list';
      }
      return persistedState.layout;
    },
    get groupBy() {
      if (persistedState.groupBy === 'project' && !projectsEnabled()) {
        return 'status';
      }
      if (state.layout !== 'board') {
        return persistedState.groupBy;
      }

      return toTaskBoardGrouping(persistedState.groupBy);
    },
    get tab(): TasksTab {
      return persistedState.tab === 'projects' && !projectsEnabled()
        ? 'my-tasks'
        : persistedState.tab;
    },
  });

  const routeTab = (): TasksTab => {
    if (props.scopeKey) return initialTab;
    if (routeParams.projectId || routeParams.projectsTab) return 'projects';

    return tabSearch.tab;
  };
  const { setState: setStateWithSearch, setPrimarySort } =
    createTasksViewSearch({
      state: persistedState,
      setState,
      search: tabSearch,
      setSearch: setTabSearch,
      tab: routeTab,
      enabled: syncSearch,
      nonListLayoutsEnabled: () => !isTouchDevice(),
    });
  const currentSearch = () =>
    tasksTabSearchCodec.serialize({
      tab: state.tab,
      savedView: tabSearch.savedView,
      // Saved views retain their desktop layout through mobile task navigation.
      layout:
        isTouchDevice() && !state.savedViewActive
          ? 'list'
          : persistedState.layout,
      sort: state.sort[0]?.id,
      sortReversed: state.sort[0]
        ? state.sort[0].reversed
          ? 'true'
          : 'false'
        : undefined,
      // Layout and rollout fallbacks must not overwrite the selected grouping.
      groupBy: persistedState.groupBy,
    });
  const isGroupExpanded = (groupId: string) =>
    !state.collapsedGroupIds.includes(groupId);

  let savedViews: TaskSavedViewDraft | undefined;
  const facetContext = (): TaskFacetContext => {
    const tags = new Map(
      createTagFacetContext(tagSets()).tagPropertyDefinitionByOptionId
    );
    for (const [option, property] of savedViews?.tagBindings() ?? [])
      tags.set(option, property);
    return { tagPropertyDefinitionByOptionId: tags, viewerId: userId() };
  };
  const savedViewsList = props.savedViewsSource?.();
  const savedView = props.savedViewSource?.(() => tabSearch.savedView);
  const applyTaskFacets = (tab: TasksTab, facets: TasksViewState['facets']) =>
    setState(
      produce((draft) => {
        draft.tab = tab;
        draft.facets = normalizeFacetSelection(facets);
        draft.collapsedGroupIds = [];
      })
    );
  const navigateSavedView = (id: string | undefined) => {
    setSavedViewNavigation({});
    setTabSearch(
      {
        savedView: id,
        tab: persistedState.tab,
        layout: persistedState.layout,
        groupBy: persistedState.groupBy,
        sort: persistedState.sort[0]?.id,
        sortReversed: persistedState.sort[0]?.reversed ? 'true' : 'false',
      },
      { history: 'replace' }
    );
    closeTask();
  };
  const selectSavedView = (id: string) =>
    batch(() => {
      setNewSavedView(false);
      navigateSavedView(id);
    });
  const selectCreatedSavedView = (id: string) =>
    batch(() => {
      // Keep the created draft active until the router installs its ID.
      setNewSavedView(id);
      navigateSavedView(id);
    });
  const startSavedView = () =>
    batch(() => {
      setNewSavedView(true);
      applyTaskFacets('team-tasks', DEFAULT_TASK_FACET_SELECTION);
      setState('search', '');
      navigateSavedView(undefined);
    });
  const leaveSavedView = () =>
    batch(() => {
      savedViews?.reset();
      setNewSavedView(false);
      applyTaskFacets('my-tasks', DEFAULT_TASK_FACET_SELECTION);
      navigateSavedView(undefined);
    });
  if (savedView) {
    savedViews = createTaskSavedViewDraft({
      source: savedView,
      selectedId: () => tabSearch.savedView,
      viewerId: userId,
      creating: () => Boolean(newSavedView()),
      state: persistedState,
      facetContext,
      apply: ({ facets, layout, groupBy, sort }) =>
        batch(() => {
          applyTaskFacets('team-tasks', facets);
          setState('layout', layout);
          setState('groupBy', groupBy);
          setState(
            'sort',
            sort.map((item) => ({ ...item }))
          );
          setTabSearch(
            {
              layout,
              groupBy,
              sort: sort[0]?.id,
              sortReversed: sort[0]?.reversed ? 'true' : 'false',
            },
            { history: 'replace' }
          );
        }),
    });
  }
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const requestScope = createMemo(() => ({
    id: tabSearch.savedView,
    viewerId: userId(),
    taskId: routeParams.taskId,
    tab: state.tab,
    creating: newSavedView(),
    navigation: savedViewNavigation(),
  }));
  const savedViewScope = () => (disposed ? undefined : requestScope());
  let priorSavedView: string | undefined;
  let priorSavedViewViewer: string | undefined;
  createEffect(
    on(
      () => [tabSearch.savedView, userId(), newSavedView()] as const,
      ([id, viewer, creating]) => {
        const accountChanged =
          priorSavedViewViewer !== undefined && viewer !== priorSavedViewViewer;
        if (accountChanged) setNewSavedView(false);
        if (creating && !accountChanged) {
          if (creating !== id) return;
          setNewSavedView(false);
        }
        const changed =
          id !== priorSavedView || viewer !== priorSavedViewViewer;
        const wasSelected = Boolean(priorSavedView);
        priorSavedView = id;
        priorSavedViewViewer = viewer;
        if (changed) setState('search', '');
        if (accountChanged || (!id && wasSelected)) {
          applyTaskFacets(
            accountChanged ? 'my-tasks' : state.tab,
            DEFAULT_TASK_FACET_SELECTION
          );
        }
      }
    )
  );
  createEffect(
    on(
      () => routeParams.taskId,
      (id, previous) => {
        if (id === previous || !state.savedViewActive) return;
        if (typeof newSavedView() !== 'string') savedViews?.reset();
        if (id === undefined && savedView)
          fireAndForget(savedView.refresh(), 'saved-views');
      }
    )
  );

  const source = withSplitPanelOwner(ownedSlot('data-source'), () =>
    (props.sourceFactory ?? useTasksDataSource)(state, {
      userId,
      tagSets,
      tagSetsReady,
      isGroupExpanded,
      facetContext,
      enabled: () => {
        const kind = savedViews?.view().kind;
        return kind !== 'loading' && kind !== 'unavailable';
      },
      board: () => state.layout === 'board',
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
    fireAndForget(
      navigate(
        {
          route:
            state.tab === 'projects' ? tasksProjectsRoute : tasksSplitRoute,
          params: {},
        },
        {
          search: {
            [searchNamespace]: currentSearch(),
          },
        }
      ),
      'tasks-view'
    );
  };
  const openTask = (
    task: TaskDetailTarget,
    options?: EntityDetailNavigationOptions
  ) => {
    if (props.onOpenTask) return props.onOpenTask(task, options);
    if (!opensInline(options)) return false;
    if (!selectPreview.canSelect(taskSelection(task.id))) return true;
    fireAndForget(
      navigate(
        { route: taskDetailRoute, params: { taskId: task.id } },
        {
          search: {
            [searchNamespace]: currentSearch(),
          },
        }
      ),
      'tasks-view'
    );
    return true;
  };

  createEffect(
    on(selectedTask, (task, previous) => {
      if (props.scopeKey || routeParams.projectId) return;
      if (!selectPreview(task ? taskSelection(task.id) : undefined)) {
        if (previous) {
          fireAndForget(
            navigate(
              { route: taskDetailRoute, params: { taskId: previous.id } },
              {
                replace: true,
                search: {
                  [searchNamespace]: currentSearch(),
                },
              }
            ),
            'tasks-view'
          );
        } else {
          fireAndForget(
            navigate(
              {
                route:
                  state.tab === 'projects'
                    ? tasksProjectsRoute
                    : tasksSplitRoute,
                params: {},
              },
              {
                replace: true,
                search: {
                  [searchNamespace]: currentSearch(),
                },
              }
            ),
            'tasks-view'
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
    const leavingSavedView = state.savedViewActive;
    if (leavingSavedView) leaveSavedView();
    if (persistedState.tab === tab && !leavingSavedView) {
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

  // Filters by a single tag without changing tabs. Used by the inline
  // "filter by tag" button on entity rows.
  const filterByTag = (optionId: string) => {
    closeTask();
    setState(
      'facets',
      reconcile(normalizeFacetSelection({ tags: [optionId] }))
    );
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
    savedViews,
    savedViewsList,
    savedViewSource: savedView,
    savedViewScope,
    startSavedView,
    selectSavedView,
    selectCreatedSavedView,
    leaveSavedView,
    savedViewTeam: props.savedViewTeam,
    facetContext,
    get createTask() {
      return props.onCreateTask;
    },
    state,
    projectsEnabled,
    showTaskProject,
    ganttEnabled,
    setState: setStateWithSearch,
    selectedTask,
    source,
    list,
    registerListActivationHandler,
    openTask,
    closeTask,
    setTab,
    setFacets,
    filterByTag,
    setPrimarySort,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
  };
});
