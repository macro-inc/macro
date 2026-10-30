import { createMobileSearchEntry } from '@app/features/command/mobile/create-mobile-search-entry';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  SplitRouter,
  type SplitRoutes,
} from '@app/lib/split-router';
import { firstChangedDepth } from '@app/lib/split-router/routes/queries';
import {
  clearDocumentLifecycle,
  startDocumentLifecycle,
} from '@app/observability/document-lifecycle';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  driveSplitRoute,
  driveTabRoute,
  homeSplitRoute,
  notFoundRoute,
  reviewsSplitRoute,
  searchRoute,
  settingsRoute,
} from '@app/routes/routes';
import type { BlockOrchestrator } from '@core/orchestrator';
import { cleanup, render } from '@solidjs/testing-library';
import { createComponent, createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SplitPanelContext, type SplitPanelContextType } from '../context';
import {
  createSplitLayout,
  type SplitContent,
  type SplitHandle,
} from '../layoutManager';
import { createMobilePaneStack } from '../mobile/createMobilePaneStack';
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
      children: [
        homeSplitRoute,
        settingsRoute,
        { ...driveSplitRoute, children: [driveTabRoute] },
        reviewsSplitRoute,
        searchRoute,
        notFoundRoute,
      ],
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

function mountSearchEntry(
  router: ReturnType<typeof createSplitRouter>,
  handle: SplitHandle
) {
  return render(() =>
    createComponent(SplitRouter.Root, {
      router,
      get children() {
        return createComponent(SplitPanelContext.Provider, {
          value: { handle } as SplitPanelContextType,
          get children() {
            createMobileSearchEntry();
            return null;
          },
        });
      },
    })
  );
}

function setup(url: string, stacked = true) {
  const history = createMemoryHistory(url);

  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    let manager: ReturnType<typeof createSplitLayout> | undefined;
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
        stacked: () => stacked,
      }),
    });
    manager = createSplitLayout(createMockOrchestrator(), {
      router,
      toLocation: (content) => resolveContentLocation(router.routes, content),
      toContent: splitContentFromLocation,
      stacked: () => stacked,
    });
    const stack = createMobilePaneStack(manager);
    const shown = () =>
      manager!.splits().map((split) => split.content.id as string);
    const active = () => manager!.activeSplit()?.content().id;

    return { history, router, manager, stack, shown, active };
  });
}

afterEach(() => {
  clearDocumentLifecycle();
  cleanup();
  SearchState.close();
  dispose?.();
  dispose = undefined;
});

describe('stacked panes', () => {
  it('releases saved state when entries are replaced and panes are removed', async () => {
    startDocumentLifecycle();
    const { manager, router } = setup('/search');
    const pane = router.panes()[0]!;
    for (let index = 0; index < 100; index++) {
      const handle = manager.activeSplit()!;
      const stop = handle.registerEntryStateCaptor('rows', () => [index]);
      handle.captureEntryState();
      await router.navigatePane(
        pane,
        index % 2 === 0 ? '/settings' : '/search',
        { replace: true }
      );
      stop();
    }
    await Promise.resolve();
    expect(
      JSON.parse(sessionStorage.getItem('macro-document-lifecycle')!).navigation
    ).toMatchObject({
      paneCount: 1,
      historyEntryCount: 1,
      savedEntryStateCount: 0,
    });
    const handle = manager.activeSplit()!;
    handle.registerEntryStateCaptor('rows', () => ['retained until close']);
    handle.captureEntryState();
    manager.openWithSplit(documents);
    await router.remove(pane);
    await Promise.resolve();

    expect(
      JSON.parse(sessionStorage.getItem('macro-document-lifecycle')!).navigation
    ).toMatchObject({
      paneCount: 1,
      historyEntryCount: 1,
      savedEntryStateCount: 0,
    });
  });

  it('keeps reachable snapshots and releases a discarded forward branch', async () => {
    startDocumentLifecycle();
    const { manager, router } = setup('/search');
    const pane = router.panes()[0]!;
    const handle = manager.activeSplit()!;
    const stopSearch = handle.registerEntryStateCaptor('rows', () => [
      'search',
    ]);
    await router.navigatePane(pane, '/settings');
    stopSearch();
    const stopSettings = handle.registerEntryStateCaptor('rows', () => [
      'settings',
    ]);
    handle.goBack();
    stopSettings();
    expect(handle.currentEntryState()?.rows).toEqual(['search']);
    handle.goForward();
    expect(handle.currentEntryState()?.rows).toEqual(['settings']);
    handle.goBack();
    await router.navigatePane(pane, '/drive');
    await Promise.resolve();
    expect(handle.canGoForward()).toBe(false);
    expect(
      JSON.parse(sessionStorage.getItem('macro-document-lifecycle')!).navigation
    ).toMatchObject({ historyEntryCount: 2, savedEntryStateCount: 1 });
    handle.goBack();
    expect(handle.currentEntryState()?.rows).toEqual(['search']);
  });

  it('restores search after a second entity evicts its mounted pane', () => {
    const { manager, stack, router } = setup('/search');
    const handle = manager.activeSplit()!;
    const mountSearch = () => mountSearchEntry(router, handle);
    SearchState.open();
    const view = mountSearch();
    SearchState.setQuery('original search');
    SearchState.setCategory('email');
    SearchState.searchFullText();
    manager.openWithSplit(settings);
    manager.openWithSplit(documents);
    view.unmount();
    stack.completeGoBack();
    // Search is the behind pane again, before the next Back reveals it.
    mountSearch();
    expect(SearchState.isOpen()).toBe(false);
    stack.completeGoBack();
    expect(SearchState.isOpen()).toBe(true);
    expect(SearchState.query()).toBe('original search');
    expect(SearchState.category()).toBe('email');
    expect(SearchState.mode()).toBe('full-text');
  });

  it('starts a fresh search entry when dock navigation reuses a covered native pane', () => {
    const { manager, router, history } = setup('/search');
    const handle = manager.activeSplit()!;
    const mountSearch = () => mountSearchEntry(router, handle);
    SearchState.open();
    const view = mountSearch();
    SearchState.setQuery('old query');
    SearchState.setCategory('email');
    SearchState.searchFullText();
    const pane = router.panes()[0]!;
    const previous = router.entry(pane)!;
    manager.openWithSplit(settings);
    SearchState.open();
    const pending = SearchState.session();
    manager.replaceAllSplits(
      { type: 'component', id: 'search' },
      { routeState: { sessionId: 'new-search' } }
    );
    expect(manager.activeSplit()?.id).toBe(handle.id);
    expect(router.entry(pane)?.id).not.toBe(previous.id);
    expect(router.entry(pane)?.state).toEqual({ sessionId: 'new-search' });
    expect(SearchState.session()).toBe(pending);
    // The outlet must recreate Search for the new entry in this same pane.
    expect(firstChangedDepth(router.routes, previous, router.entry(pane))).toBe(
      1
    );
    view.unmount();
    const fresh = mountSearch();
    expect(SearchState.isOpen()).toBe(true);
    expect(SearchState.query()).toBe('');
    expect(SearchState.category()).toBe('all');
    expect(SearchState.mode()).toBe('name');
    history.back();
    fresh.unmount();
    // The previous URL still owns its original Search entry and query.
    expect(router.entry(pane)?.id).toBe(previous.id);
    const restored = mountSearch();
    manager.getSplit(manager.splits().at(-1)!.id)?.close();
    expect(SearchState.query()).toBe('old query');
    expect(SearchState.category()).toBe('email');
    expect(SearchState.mode()).toBe('full-text');
    restored.unmount();
  });

  it('reuses a Search visit only when its route session is unchanged', () => {
    const { manager, router } = setup('/search');
    const content: SplitContent = { type: 'component', id: 'search' };
    manager.replaceAllSplits(content, {
      routeState: { sessionId: 'first-search' },
    });
    const pane = router.panes()[0]!;
    const first = router.entry(pane)!;
    expect(first.state).toEqual({ sessionId: 'first-search' });

    manager.replaceAllSplits(content, {
      routeState: { sessionId: 'first-search' },
    });
    expect(router.entry(pane)?.id).toBe(first.id);

    manager.replaceAllSplits(content, {
      routeState: { sessionId: 'second-search' },
    });
    expect(router.entry(pane)?.id).not.toBe(first.id);
    expect(router.entry(pane)?.state).toEqual({ sessionId: 'second-search' });
  });

  it.each([true, false])(
    'preserves the search session in real pane history (stacked: %s)',
    (stacked) => {
      const { manager, stack, shown, router } = setup('/search', stacked);
      const handle = manager.activeSplit()!;
      const mountSearch = () => mountSearchEntry(router, handle);
      SearchState.open();
      const view = mountSearch();
      SearchState.setQuery('teo update');
      SearchState.setCategory('email');
      SearchState.searchFullText();
      manager.openWithSplit(settings);
      if (stacked) {
        expect(SearchState.isOpen()).toBe(false);
        expect(shown()).toEqual(['search', 'settings']);
        stack.completeGoBack();
      } else {
        expect(shown()).toEqual(['settings']);
        view.unmount();
        expect(SearchState.isOpen()).toBe(false);
        // A newer dock search must not become this entry's saved state.
        SearchState.open();
        SearchState.setQuery('other search');
        SearchState.close();
        handle.goBack();
        mountSearch();
      }
      expect(shown()).toEqual(['search']);
      expect(SearchState.isOpen()).toBe(true);
      expect(SearchState.query()).toBe('teo update');
      expect(SearchState.category()).toBe('email');
      expect(SearchState.mode()).toBe('full-text');
    }
  );

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

  it('applies the Recent destination when reusing an existing Files pane', () => {
    const { manager, shown } = setup('/drive');
    const recent: SplitContent = {
      ...documents,
      entryMetadata: {
        route: paneRoute(
          { id: 'drive', params: {} },
          { id: 'drive-tab', params: { tab: 'recent' } }
        ),
      },
    };
    const expectRecent = () => {
      expect(manager.activeSplit()?.content().entryMetadata).toMatchObject({
        route: {
          matches: [
            { id: 'app' },
            { id: 'drive' },
            { id: 'drive-tab', params: { tab: 'recent' } },
          ],
        },
      });
      expect(shown()).toEqual(['documents']);
    };

    manager.replaceAllSplits(recent);
    expectRecent();
    manager.replaceAllSplits(documents);
    manager.openWithSplit(recent, { mergeHistory: true, search: {} });
    expectRecent();
  });

  it('applies the All scope when reusing an existing Reviews pane', () => {
    const { manager, shown } = setup('/reviews');
    const all: SplitContent = {
      type: 'component',
      id: 'reviews',
      entryMetadata: { search: { reviews: { tab: ['all'] } } },
    };
    const expectAll = () => {
      expect(manager.activeSplit()?.content().entryMetadata).toMatchObject({
        search: { reviews: { tab: ['all'] } },
      });
      expect(shown()).toEqual(['reviews']);
    };

    manager.replaceAllSplits(all);
    expectAll();
    manager.replaceAllSplits({ type: 'component', id: 'reviews' });
    manager.openWithSplit(all, { mergeHistory: true, search: {} });
    expectAll();
  });

  it('moves the pane holding a claim to the front when a router open lands on it', async () => {
    const { router, manager, shown, active } = setup('/home');
    manager.openWithSplit(settings);
    manager.openWithSplit(documents);

    await router.open('/settings', { newPane: true });
    expect(shown()).toEqual(['home', 'documents', 'settings']);
    expect(active()).toBe('settings');
  });
});
