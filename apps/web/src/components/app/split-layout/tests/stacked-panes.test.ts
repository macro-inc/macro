import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  driveSplitRoute,
  homeSplitRoute,
  notFoundRoute,
  settingsRoute,
} from '@app/routes/routes';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SplitContent } from '../layoutManager';
import { createMobilePaneStack } from '../mobile/createMobilePaneStack';
import { createAppSplitLayout } from '../split-router/app-content';
import { createAppPanePolicy } from '../split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '../split-router/legacy-route';

vi.mock('../componentRegistry', () => ({
  resolveComponent: vi.fn((id: string, params: Record<string, string>) => ({
    type: 'mock-component',
    id,
    params,
  })),
}));

vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: vi.fn(() => false),
  resolveBlockAlias: vi.fn((type: string) => type),
}));

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

const home: SplitContent = { type: 'component', id: 'home' };
const settings: SplitContent = { type: 'component', id: 'settings' };
const documents: SplitContent = { type: 'component', id: 'documents' };

const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [homeSplitRoute, settingsRoute, driveSplitRoute, notFoundRoute],
    },
  ],
  defaultRoute: () => paneRoute({ id: 'view-home', params: {} }),
};

function createMockOrchestrator(): BlockOrchestrator {
  return {
    isBlockMounted: vi.fn(() => false),
    createBlockInstance: vi.fn((_type, id) => ({
      node: { type: 'mock-node', id },
      detach: vi.fn(),
      dispose: vi.fn(),
    })),
  } as unknown as BlockOrchestrator;
}

let dispose: (() => void) | undefined;

function setup(url: string) {
  const history = createMemoryHistory(url);

  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    let manager: ReturnType<typeof createAppSplitLayout> | undefined;
    const router = createSplitRouter({
      routes,
      history,
      paneStore: createMemoryPaneStore<Entry>(),
      policy: createAppPanePolicy({
        manager: () => manager,
        toContent: splitContentFromLocation,
        defaultLocation: () => ({
          route: paneRoute({ id: 'view-home', params: {} }),
        }),
        stacked: () => true,
      }),
    });
    manager = createAppSplitLayout(createMockOrchestrator(), {
      router,
      toLocation: (content) => resolveContentLocation(router.routes, content),
      toContent: splitContentFromLocation,
      stacked: () => true,
    });
    const stack = createMobilePaneStack(manager);
    const shown = () =>
      manager!.splits().map((split) => split.content.id as string);
    const active = () => manager!.activeSplit()?.content().id;

    return { history, router, manager, stack, shown, active };
  });
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('stacked panes', () => {
  it('opens content in a new pane in front, and going back closes it', () => {
    const { manager, stack, shown, active } = setup('/home');
    const forward = vi.fn();
    stack.setForwardTrigger(forward);

    manager.openWithSplit(settings);
    expect(shown()).toEqual(['home', 'settings']);
    expect(active()).toBe('settings');
    expect(manager.getVisibleSplits().map((split) => split.content.id)).toEqual(
      ['settings']
    );
    expect(forward).toHaveBeenCalledOnce();

    expect(stack.canGoBack()).toBe(true);
    stack.completeGoBack();
    expect(shown()).toEqual(['home']);
    expect(active()).toBe('home');
    expect(stack.canGoBack()).toBe(false);
    expect(forward).toHaveBeenCalledOnce();
  });

  it('replaces the front pane in place when the open merges history', () => {
    const { manager, shown } = setup('/home');
    manager.openWithSplit(settings, { mergeHistory: true });
    expect(shown()).toEqual(['settings']);
  });

  it('moves a pane behind that already shows the content to the front, in one history entry', () => {
    const { history, manager, stack, shown, active } = setup('/home');
    manager.openWithSplit(settings);
    manager.openWithSplit(documents);
    expect(shown()).toEqual(['home', 'settings', 'documents']);
    const entries = history.entries().length;
    const forward = vi.fn();
    stack.setForwardTrigger(forward);

    manager.openWithSplit(home);
    expect(shown()).toEqual(['settings', 'documents', 'home']);
    expect(active()).toBe('home');
    expect(history.entries()).toHaveLength(entries + 1);
    expect(forward).toHaveBeenCalledOnce();

    stack.completeGoBack();
    expect(shown()).toEqual(['settings', 'documents']);
    expect(active()).toBe('documents');
  });

  it('resets the stack to one view in one history entry, keeping a pane that already shows it', () => {
    const { history, manager, shown, active } = setup('/home');
    manager.openWithSplit(settings);
    const entries = history.entries().length;

    manager.replaceAllSplits(documents);
    expect(shown()).toEqual(['documents']);
    expect(active()).toBe('documents');
    expect(history.entries()).toHaveLength(entries + 1);

    manager.openWithSplit(home);
    manager.openWithSplit(settings);
    expect(shown()).toEqual(['documents', 'home', 'settings']);
    const homePane = manager.splits()[1]!.id;

    manager.replaceAllSplits(home);
    expect(shown()).toEqual(['home']);
    expect(manager.splits()[0]!.id).toBe(homePane);
    expect(active()).toBe('home');
  });

  it('moves the pane holding a claim to the front when a router open lands on it', () => {
    const { router, manager, shown, active } = setup('/home');
    manager.openWithSplit(settings);
    manager.openWithSplit(documents);

    router.open('/settings', { newPane: true });
    expect(shown()).toEqual(['home', 'documents', 'settings']);
    expect(active()).toBe('settings');
  });
});
