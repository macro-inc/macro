import {
  SplitRouter,
  type SplitRouterEntry,
  type SplitRouterLayout,
  type SplitRouterSettledChange,
  useSplitRouter,
} from '@app/lib/split-router';
import { createMemorySplitRouterLocation } from '@app/lib/split-router/integrations/memory';
import { appSplitRoutes } from '@components/app/split-layout/split-router/app-routes';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TasksViewProvider, useTasksView } from './tasks-view-context';

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@property/tags/tag-sets-context', () => ({
  useTagSets: () => () => [],
  useTagSetsReady: () => () => true,
}));
vi.mock('./queries/use-tasks-query', () => ({
  useTasksDataSource: () => ({ items: () => [] }),
}));
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () =>
    Object.assign(() => true, { canSelect: () => true }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      currentEntryState: () => ({}),
      registerEntryStateCaptor: () => () => {},
    },
  }),
  withSplitPanelOwner: (_name: string, factory: () => unknown) => factory(),
}));

function createLayout(): SplitRouterLayout<string> {
  let current: (SplitRouterEntry & { splitId: string }) | undefined;
  const listeners = new Set<(change: SplitRouterSettledChange) => void>();
  const notify = () => {
    for (const listener of listeners) listener({ history: 'push' });
  };
  return {
    snapshot: () => ({ entries: current ? [current] : [] }),
    updateCurrentEntry(_splitId, update) {
      if (!current) return;
      current = { splitId: current.splitId, ...update(current) };
      notify();
    },
    open: () => {},
    reconcile(entries) {
      const next = entries[0];
      current = next ? { splitId: 'split', ...next } : undefined;
      notify();
    },
    activate: () => {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function mountProvider(path = '/tasks') {
  let context!: ReturnType<typeof useTasksView>;
  let router!: ReturnType<typeof useSplitRouter<string>>;
  const location = createMemorySplitRouterLocation(path);
  function ReadContext() {
    context = useTasksView();
    router = useSplitRouter<string>();
    return null;
  }
  const view = render(() => (
    <SplitRouter.Root
      layout={createLayout()}
      routes={appSplitRoutes}
      location={location}
    >
      <SplitRouter.Scope splitId="split">
        <TasksViewProvider>
          <ReadContext />
        </TasksViewProvider>
      </SplitRouter.Scope>
    </SplitRouter.Root>
  ));
  return { ...view, context, location, router };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('TasksViewProvider URL tabs', () => {
  it('loads the pane-local URL tab and preserves it through inline detail', async () => {
    const { context, location, router } = mountProvider(
      '/tasks?s0.tasks.tab=team-tasks'
    );
    expect(context.state.tab).toBe('team-tasks');
    expect(context.openTask({ id: 'task-1' })).toBe(true);
    await router.settled();
    expect(location.read().pathname).toBe('/tasks/task-1');
    expect(location.read().search).toContain('s0.tasks.tab=team-tasks');
    context.closeTask();
    await router.settled();
    expect(location.read().pathname).toBe('/tasks');
    expect(location.read().search).toBe('?s0.tasks.tab=team-tasks');

    context.openTask({ id: 'task-2' });
    await router.settled();
    context.setTab('created-by-me');
    await router.settled();
    expect(location.read().pathname).toBe('/tasks');
    expect(location.read().search).toBe('?s0.tasks.tab=created-by-me');
  });

  it('updates the URL on tab change and follows browser Back/Forward', async () => {
    const { context, location, router } = mountProvider();
    context.setTab('created-by-me');
    await router.settled();
    expect(location.read().search).toBe('?s0.tasks.tab=created-by-me');
    expect(location.back()).toBe(true);
    await router.settled();
    expect(context.state.tab).toBe('my-tasks');
    expect(location.forward()).toBe(true);
    await router.settled();
    expect(context.state.tab).toBe('created-by-me');
  });
});
