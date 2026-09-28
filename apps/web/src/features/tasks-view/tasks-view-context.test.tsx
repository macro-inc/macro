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
  captured: {} as Record<string, unknown>,
  captors: new Map<string, () => unknown>(),
  projectsEnabled: (() => true) as () => boolean,
}));
vi.mock('@app/lib/split-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  createSearchParams: () => [
    {
      get tab() {
        return mocks.routeTab;
      },
    },
  ],
}));
vi.mock('./tasks-tab-search', () => ({
  tasksTabSearch: {},
  tasksTabSearchCodec: { serialize: () => ({}) },
}));
vi.mock('./route', () => ({
  taskDetailRoute: {},
  tasksProjectsRoute: {},
  tasksSplitRoute: {},
}));
vi.mock('@app/features/reviews-view/route', () => ({ reviewsSplitRoute: {} }));
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
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
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
  mocks.captured = {};
  mocks.captors.clear();
  mocks.projectsEnabled = () => true;
  createRoot((dispose) => {
    disposeSlots = dispose;
    mocks.replace = createOwnedSlots().replace;
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
