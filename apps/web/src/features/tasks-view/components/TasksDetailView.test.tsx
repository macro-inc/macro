import type { ListDetailNavigationTarget } from '@app/components/list';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { TasksDataSource } from '../queries/use-tasks-query';
import { TasksDetailView } from './TasksDetailView';

const calls = vi.hoisted(() => ({
  navigation: undefined as
    | { enabled(): boolean; navigation: ListDetailNavigationTarget }
    | undefined,
  context: undefined as unknown,
}));
vi.mock('@app/components/entity-detail/use-list-navigation-hotkeys', () => ({
  useListNavigationHotkeys: (options: typeof calls.navigation) => {
    calls.navigation = options;
  },
}));
vi.mock(
  '@app/components/list',
  async () => await import('@app/components/list/use-list-detail-navigation')
);
vi.mock('@app/components/view-shell', () => ({
  ViewShell: { TopBar: (props: ParentProps) => props.children },
  ViewBreadcrumbs: { Outlet: () => null },
}));
vi.mock('@app/components/entity-detail/EntityDetailBreadcrumbSkeleton', () => ({
  EntityDetailBreadcrumbSkeleton: () => null,
}));
vi.mock('@app/lib/split-router', () => ({ useRouteParams: () => ({}) }));
vi.mock('../route', () => ({ taskDetailRoute: {} }));
vi.mock('@block-md/component/MarkdownDetailBreadcrumbItem', () => ({
  MarkdownDetailBreadcrumbItem: () => null,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Root: (props: ParentProps) => props.children,
    Toggle: () => null,
  },
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    splitHotkeyScope: 'tasks',
    isPanelActive: () => true,
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareTrigger: () => null,
}));
vi.mock('@core/component/TopBar/shareModal', () => ({
  useDocumentShareModal: () => vi.fn(),
}));
vi.mock('../tasks-view-context', () => ({ useTasksView: () => calls.context }));
vi.mock('./TaskDetail', () => ({ TaskDetail: () => null }));
afterEach(cleanup);

it('steps within the provider task source without switching to tasks outside the project', async () => {
  const [selected, setSelected] = createSignal({ id: 'first-task' });
  const source: TasksDataSource = {
    items: () =>
      ['first-task', 'second-task'].map((id) => ({
        kind: 'entity',
        id,
        entity: {
          id,
          name: id,
          ownerId: 'owner',
          type: 'document',
          fileType: 'md',
          subType: { type: 'task' },
          properties: [],
        },
      })),
    isLoading: () => false,
    isFetching: () => false,
    error: () => undefined,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
    loadMoreGroup: async () => {},
    refresh: async () => {},
  };
  const openTask = vi.fn((task: { id: string }) => {
    setSelected(task);
    return true;
  });
  calls.context = {
    source,
    selectedTask: selected,
    openTask,
    closeTask: vi.fn(),
  };
  render(() => <TasksDetailView task={selected()} breadcrumbOrder={2} />);
  expect(calls.navigation?.enabled()).toBe(true);
  expect(calls.navigation?.navigation.canNext()).toBe(true);
  await calls.navigation?.navigation.next();
  await waitFor(() => expect(selected().id).toBe('second-task'));
  expect(calls.navigation?.navigation.canPrevious()).toBe(true);
  await calls.navigation?.navigation.previous();
  await waitFor(() => expect(selected().id).toBe('first-task'));
});
