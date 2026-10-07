import { createOwnedSlots } from '@components/app/split-layout/utils/createOwnedSlots';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createRoot, createSignal, For, onCleanup, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TasksMobileTabs } from './components/TasksMobileTabs';
import { TaskListHeader } from './components/task-list/TaskListHeader';
import type { TasksDataSource } from './queries/use-tasks-query';
import {
  type TasksViewContext,
  TasksViewProvider,
  useTasksView,
} from './tasks-view-context';

const mocks = vi.hoisted(() => ({
  replace: undefined as (<T>(name: string, factory: () => T) => T) | undefined,
  routeTab: 'my-tasks',
  readSearch: (() => ({})) as () => Record<string, string | undefined>,
  updateSearch: (() => {}) as (
    next: Record<string, string | undefined>
  ) => void,
  writes: [] as {
    next: Record<string, string | undefined>;
    options?: { history?: string };
  }[],
  navigate: vi.fn(),
  captured: {} as Record<string, unknown>,
  captors: new Map<string, () => unknown>(),
  projectsEnabled: (() => true) as () => boolean,
  touch: false,
  dockOpen: (): boolean => false,
  dockText: (): string => '',
}));
vi.mock('@app/lib/split-router', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({}),
  createSearchParams: () => [
    new Proxy(
      {},
      {
        get(_target, key: string) {
          return key === 'tab'
            ? (mocks.readSearch().tab ?? mocks.routeTab)
            : mocks.readSearch()[key];
        },
      }
    ),
    (
      next: Record<string, string | undefined>,
      options?: { history?: string }
    ) => {
      mocks.writes.push({ next, options });
      mocks.updateSearch(next);
    },
  ],
}));
vi.mock('./tasks-tab-search', () => ({
  tasksTabSearch: { namespace: 'tasks' },
  tasksTabSearchCodec: {
    serialize: (state: Record<string, string | undefined>) =>
      Object.fromEntries(
        Object.entries(state)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, [value]])
      ),
  },
}));
vi.mock('@app/routes/routes', () => ({
  taskDetailRoute: {},
  tasksProjectsRoute: {},
  tasksSplitRoute: {},
  reviewsSplitRoute: {},
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.projectsEnabled() }),
}));
vi.mock('@components/app/mobile/PillTabs', () => ({
  PillTabs: (props: { items: { label: string }[] }) => (
    <nav aria-label="Task tabs">
      <For each={props.items}>{(item) => <span>{item.label}</span>}</For>
    </nav>
  ),
}));
vi.mock('./components/TasksFilterDrawer', () => ({
  TasksFilterDrawer: () => null,
}));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => {
  const panel = {
    handle: {
      isActive: () => true,
      currentEntryState: () => mocks.captured,
      registerEntryStateCaptor: (key: string, getter: () => unknown) => {
        mocks.captors.set(key, getter);
        return () => {
          if (mocks.captors.get(key) === getter) mocks.captors.delete(key);
        };
      },
      captureEntryState: () => {
        for (const [key, getter] of mocks.captors)
          mocks.captured[key] = getter();
      },
    },
  };
  return {
    useSplitPanel: () => panel,
    useSplitPanelOrThrow: () => panel,
    withSplitPanelOwner: (key: string, factory: () => unknown) =>
      mocks.replace!(key, factory),
  };
});
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () =>
    Object.assign(() => true, { canSelect: () => true }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@app/features/command/mobile/mobileSearchState', () => ({
  SearchState: {
    isOpen: () => mocks.dockOpen(),
    query: () => mocks.dockText(),
  },
}));
vi.mock('@app/components/view-shell', () => ({
  setSidebarSectionCollapsed: () => [],
  createCollapsedSidebarSectionsStorage: () => ({
    restore: () => undefined,
    write: () => {},
  }),
}));
vi.mock('@app/features/soup', () => ({
  normalizeFacetSelection: (value: unknown) => value,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@property/tags/tag-sets-context', () => ({
  useTagSets: () => () => [],
  useTagSetsReady: () => () => true,
}));
vi.mock('./constants', () => ({
  TASK_DEFAULT_GROUP_BY: {
    'team-tasks': 'status',
    'my-tasks': 'priority',
    projects: 'status',
  },
  TASK_TABS: [
    { id: 'my-tasks', label: 'My tasks' },
    { id: 'projects', label: 'Projects' },
  ],
}));
vi.mock('./filters/task-facets', () => ({ DEFAULT_TASK_FACET_SELECTION: {} }));
vi.mock('./queries/use-tasks-query', () => ({
  useTasksDataSource: () => {
    throw new Error('must use project source');
  },
}));

let disposeSlots: () => void;
beforeEach(() => {
  mocks.routeTab = 'my-tasks';
  mocks.writes = [];
  mocks.navigate.mockClear();
  mocks.touch = false;
  mocks.dockOpen = () => false;
  mocks.dockText = () => '';
  mocks.captured = {};
  mocks.captors.clear();
  mocks.projectsEnabled = () => true;
  createRoot((dispose) => {
    disposeSlots = dispose;
    mocks.replace = createOwnedSlots().replace;
    const [search, setSearch] = createSignal<
      Record<string, string | undefined>
    >({});
    mocks.readSearch = search;
    mocks.updateSearch = (next) =>
      setSearch((current) => ({ ...current, ...next }));
  });
});
afterEach(() => {
  cleanup();
  disposeSlots();
});

it('restores grouping and search after task breadcrumbs and section changes using the real split resource lifecycle', () => {
  const activated = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  let mounts = 0;
  const disposed = vi.fn();
  const sourceFactory = vi.fn((state: { search: string }): TasksDataSource => {
    onCleanup(disposed);
    return {
      items: () => [
        { kind: 'load-more', id: `row-${state.search}`, scopeId: 'scope' },
      ],
      isLoading: () => false,
      isFetching: () => false,
      error: () => undefined,
      hasMore: () => false,
      isLoadingMore: () => false,
      loadMore: async () => {},
      loadMoreGroup: async () => {},
      refresh: async () => {},
    };
  });
  let current!: TasksViewContext;
  const [projectId, setProjectId] = createSignal('one');
  const [showTasks, updateShowTasks] = createSignal(true);
  const setShowTasks = (show: boolean) => {
    if (!show)
      for (const [key, getter] of mocks.captors) mocks.captured[key] = getter();
    updateShowTasks(show);
  };
  const Probe = () => {
    current = useTasksView();
    current.registerListActivationHandler(activated[mounts++]);
    return null;
  };
  render(() => (
    <Show when={showTasks() ? projectId() : undefined} keyed>
      {(id) => (
        <TasksViewProvider
          scopeKey={`initiative:${id}:tasks`}
          initialState={{ tab: 'team-tasks', groupBy: 'status', facets: {} }}
          restoreEntryState
          sourceFactory={sourceFactory}
          onOpenTask={() => {
            setShowTasks(false);
            return true;
          }}
          onCloseTask={() => {}}
        >
          <Probe />
        </TasksViewProvider>
      )}
    </Show>
  ));

  current.setState('groupBy', 'priority');
  current.setState('search', 'launch');
  current.setState('collapsedGroupIds', ['not-set']);
  const originalSource = current.source;
  current.openTask({ id: 'task' });
  setShowTasks(true);

  expect(current.state.groupBy).toBe('priority');
  expect(current.state.search).toBe('launch');
  expect(current.state.collapsedGroupIds).toEqual(['not-set']);
  expect(current.source).not.toBe(originalSource);
  expect(sourceFactory).toHaveBeenCalledTimes(2);
  expect(disposed).toHaveBeenCalledOnce();
  current.setState('search', 'release');
  expect(current.source.items()[0].id).toBe('row-release');
  current.list.activate.key('row-release');
  expect(activated[1]).toHaveBeenCalledOnce();
  expect(activated[0]).not.toHaveBeenCalled();
  current.setFacets({ status: ['completed'] });
  expect(showTasks()).toBe(true);

  setShowTasks(false);
  setShowTasks(true);
  expect(current.state.groupBy).toBe('priority');
  expect(current.state.facets).toEqual({ status: ['completed'] });
  setProjectId('two');
  expect(current.state.groupBy).toBe('status');
  expect(current.state.search).toBe('');
});

it('hides project tabs and columns while disabled without overwriting a restored Projects selection', () => {
  const [enabled, setEnabled] = createSignal(false);
  mocks.projectsEnabled = enabled;
  mocks.routeTab = 'projects';
  mocks.captured['tasks.view'] = { version: 1, tab: 'projects' };
  let current!: TasksViewContext;
  let queryState!: { tab: string };
  const sourceFactory = (state: { tab: string }): TasksDataSource => {
    queryState = state;
    return {
      items: () => [],
      isLoading: () => false,
      isFetching: () => false,
      error: () => undefined,
      hasMore: () => false,
      isLoadingMore: () => false,
      loadMore: async () => {},
      loadMoreGroup: async () => {},
      refresh: async () => {},
    };
  };
  const Probe = () => {
    current = useTasksView();
    return (
      <>
        <TasksMobileTabs />
        <TaskListHeader />
      </>
    );
  };
  render(() => (
    <TasksViewProvider sourceFactory={sourceFactory}>
      <Probe />
    </TasksViewProvider>
  ));

  expect(current.state.tab).toBe('my-tasks');
  expect(queryState.tab).toBe('my-tasks');
  expect(screen.queryByText('Projects')).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Project' })).toBeNull();
  expect(mocks.captors.get('tasks.view')!()).toMatchObject({ tab: 'projects' });
  current.setTab('projects');
  expect(current.state.tab).toBe('my-tasks');

  setEnabled(true);
  expect(current.state.tab).toBe('projects');
  expect(queryState.tab).toBe('projects');
  expect(screen.getByText('Projects')).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'Project' })).toBeTruthy();

  setEnabled(false);
  expect(current.state.tab).toBe('my-tasks');
  expect(screen.queryByText('Projects')).toBeNull();
  // Explicitly choosing the visible fallback is a real navigation preference.
  current.setTab('my-tasks');
  setEnabled(true);
  expect(current.state.tab).toBe('my-tasks');
  expect(mocks.captors.get('tasks.view')!()).toMatchObject({ tab: 'my-tasks' });
});

it.each([undefined, 'initiative:one:tasks'])(
  'isolates dock search from saved and embedded task search (scope %s)',
  (scopeKey) => {
    mocks.touch = true;
    const [open, setOpen] = createSignal(true);
    mocks.dockOpen = open;
    mocks.dockText = () => 'dock query';
    let current!: TasksViewContext;
    const sourceFactory = (): TasksDataSource => ({
      items: () => [],
      isLoading: () => false,
      isFetching: () => false,
      error: () => undefined,
      hasMore: () => false,
      isLoadingMore: () => false,
      loadMore: async () => {},
      loadMoreGroup: async () => {},
      refresh: async () => {},
    });
    const Probe = () => {
      current = useTasksView();
      return null;
    };
    render(() => (
      <TasksViewProvider
        scopeKey={scopeKey}
        initialState={{ search: 'saved query' }}
        sourceFactory={sourceFactory}
      >
        <Probe />
      </TasksViewProvider>
    ));
    expect(current.state.search).toBe(scopeKey ? 'saved query' : 'dock query');
    current.setState('search', 'updated saved query');
    expect(current.state.search).toBe(
      scopeKey ? 'updated saved query' : 'dock query'
    );
    setOpen(false);
    expect(current.state.search).toBe('updated saved query');
  }
);

it('restores board grouping without legacy columns and switches layout without a second data source or losing list grouping', () => {
  mocks.captured['tasks.view'] = {
    version: 1,
    layout: 'board',
    boardGroupBy: 'assignee',
    groupBy: 'date',
    boardAssigneeColumnIds: ['alice'],
    boardProjectColumnIds: ['launch'],
  };

  let current!: TasksViewContext;
  let queryState!: { groupBy: string };
  let boardEnabled: (() => boolean) | undefined;
  const sourceFactory = vi.fn(
    (
      state: { groupBy: string },
      options: { board?: () => boolean }
    ): TasksDataSource => {
      queryState = state;
      boardEnabled = options.board;

      return {
        items: () => [],
        isLoading: () => false,
        isFetching: () => false,
        error: () => undefined,
        hasMore: () => false,
        isLoadingMore: () => false,
        loadMore: async () => {},
        loadMoreGroup: async () => {},
        refresh: async () => {},
      };
    }
  );

  const Probe = () => {
    current = useTasksView();

    return null;
  };

  render(() => (
    <TasksViewProvider sourceFactory={sourceFactory}>
      <Probe />
    </TasksViewProvider>
  ));

  expect(current.state.layout).toBe('board');
  expect(Object.keys(current.state)).not.toContain('boardAssigneeColumnIds');
  expect(Object.keys(current.state)).not.toContain('boardProjectColumnIds');
  expect(queryState.groupBy).toBe('assignee');
  expect(boardEnabled?.()).toBe(true);

  current.setState('layout', 'list');

  expect(queryState.groupBy).toBe('date');

  current.setState('boardGroupBy', 'priority');
  current.setState('layout', 'board');

  expect(queryState.groupBy).toBe('priority');
  expect(current.state.groupBy).toBe('date');
  expect(sourceFactory).toHaveBeenCalledOnce();
  expect(mocks.captors.get('tasks.view')!()).not.toHaveProperty(
    'boardAssigneeColumnIds'
  );
  expect(mocks.captors.get('tasks.view')!()).not.toHaveProperty(
    'boardProjectColumnIds'
  );
  expect(mocks.captors.get('tasks.view')!()).toMatchObject({
    layout: 'board',
    boardGroupBy: 'priority',
    groupBy: 'date',
  });
});

it('uses URL sort and group preferences over entry persistence and follows browser history', () => {
  mocks.captured['tasks.view'] = {
    version: 1,
    tab: 'my-tasks',
    sort: [{ id: 'viewed_at', reversed: true }],
    groupBy: 'date',
    boardGroupBy: 'assignee',
  };
  mocks.updateSearch({
    sort: 'created_at',
    sortReversed: 'true',
    groupBy: 'project',
    boardGroupBy: 'priority',
  });
  let current!: TasksViewContext;
  const Probe = () => {
    current = useTasksView();
    return null;
  };
  render(() => (
    <TasksViewProvider
      sourceFactory={() => ({
        items: () => [],
        isLoading: () => false,
        isFetching: () => false,
        error: () => undefined,
        hasMore: () => false,
        isLoadingMore: () => false,
        loadMore: async () => {},
        loadMoreGroup: async () => {},
        refresh: async () => {},
      })}
    >
      <Probe />
    </TasksViewProvider>
  ));
  expect(current.state.sort).toEqual([{ id: 'created_at', reversed: true }]);
  expect(current.state.groupBy).toBe('project');
  expect(current.state.boardGroupBy).toBe('priority');
  expect(mocks.writes).toEqual([]);

  current.setPrimarySort('created_at');
  expect(current.state.sort).toEqual([{ id: 'created_at', reversed: false }]);
  expect(mocks.writes.at(-1)?.next).toEqual({
    sort: 'created_at',
    sortReversed: 'false',
  });
  current.setState('groupBy', 'none');
  current.setState('boardGroupBy', 'project');
  expect(mocks.writes.slice(-2).map(({ next }) => next)).toEqual([
    { groupBy: 'none' },
    { boardGroupBy: 'project' },
  ]);

  mocks.updateSearch({
    sort: 'viewed_at',
    sortReversed: 'true',
    groupBy: 'status',
    boardGroupBy: 'assignee',
  });
  expect(current.state.sort).toEqual([{ id: 'viewed_at', reversed: true }]);
  expect(current.state.groupBy).toBe('status');
  expect(current.state.boardGroupBy).toBe('assignee');
  expect(mocks.writes).toHaveLength(3);

  mocks.updateSearch({
    sort: undefined,
    sortReversed: undefined,
    groupBy: undefined,
    boardGroupBy: undefined,
  });
  expect(current.state.sort).toEqual([{ id: 'viewed_at', reversed: true }]);
  expect(current.state.groupBy).toBe('date');
  expect(current.state.boardGroupBy).toBe('assignee');
  expect(mocks.writes).toHaveLength(3);

  mocks.updateSearch({
    sort: 'viewed_at',
    sortReversed: 'true',
    groupBy: 'status',
    boardGroupBy: 'assignee',
  });
  current.openTask({ id: 'task-1' });
  expect(mocks.navigate).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      search: {
        tasks: expect.objectContaining({
          sort: ['viewed_at'],
          sortReversed: ['true'],
          groupBy: ['status'],
          boardGroupBy: ['assignee'],
        }),
      },
    })
  );
});
