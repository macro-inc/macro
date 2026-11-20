import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type PaneId,
  type SplitRouter,
  type SplitRoutes,
} from '@app/lib/split-router';
import { SplitRouterProvider } from '@app/lib/split-router/solid/context';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  channelDetailRoute,
  channelsSplitRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { setGlobalTabManager } from '@app/signal/tabLayout';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import {
  SplitLayoutContext,
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import {
  createSplitLayout,
  type SplitManager,
  splitOf,
} from '@components/app/split-layout/layoutManager';
import { SplitLayout } from '@components/app/split-layout/SplitLayout';
import { createAppPanePolicy } from '@components/app/split-layout/split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '@components/app/split-layout/split-router/legacy-route';
import { toast } from '@core/component/Toast/Toast';
import type { BlockOrchestrator } from '@core/orchestrator';
import { cleanup, render } from '@solidjs/testing-library';
import { onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTabManager,
  MAX_PARKED_TABS,
  type TabManager,
} from '../tab-manager';

const panels = vi.hoisted(() => ({ mounted: 0, unmounted: 0 }));

// A stand-in that counts mounts: the layers decide what stays mounted, not
// the panel.
vi.mock('@components/app/split-layout/components/SplitPanel', () => ({
  SplitPanel: (props: { split: { id: string } }) => {
    panels.mounted += 1;
    onCleanup(() => {
      panels.unmounted += 1;
    });
    return <div data-panel={props.split.id} />;
  },
}));

const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [
        homeSplitRoute,
        { ...channelsSplitRoute, children: [channelDetailRoute] },
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => paneRoute({ id: 'view-home', params: {} }),
};

function setup(url: string) {
  let router!: SplitRouter;
  let manager!: SplitManager;
  let tabManager: TabManager | undefined;
  /** The tab each block instance was created for. */
  const blockScopes: (string | undefined)[] = [];
  render(() => {
    router = createSplitRouter({
      routes,
      history: createMemoryHistory(url),
      paneStore: createMemoryPaneStore<Entry>(),
      policy: createAppPanePolicy({
        manager: () => manager,
        toContent: splitContentFromLocation,
        defaultLocation: () => ({ route: routes.defaultRoute() }),
        stacked: () => false,
      }),
    });
    const orchestrator = {
      isBlockMounted: () => false,
      createBlockInstance: () => {
        blockScopes.push(tabManager?.blockScope());
        return { element: () => null };
      },
    } as unknown as BlockOrchestrator;
    manager = createSplitLayout(orchestrator, {
      router,
      toLocation: (content) => resolveContentLocation(router.routes, content),
      toContent: splitContentFromLocation,
      stacked: () => false,
    });
    tabManager = createTabManager({
      router,
      manager,
      userId: `user-${Math.random()}`,
    });
    setGlobalTabManager(tabManager);
    return (
      <SplitRouterProvider router={router}>
        <SplitLayoutContext.Provider value={{ manager }}>
          <SplitLayout />
        </SplitLayoutContext.Provider>
      </SplitRouterProvider>
    );
  });
  return { router, tabManager: tabManager!, manager, blockScopes };
}

/** A view's preview guard, as a host mounted in the router's first open pane creates it. */
function guardInFirstPane(router: SplitRouter, manager: SplitManager) {
  const handle = manager.getSplit(splitOf(router.panes()[0]!));
  let guard!: ReturnType<typeof createPreviewSelectionGuard>;
  function Host() {
    guard = createPreviewSelectionGuard();
    return null;
  }
  render(() => (
    <SplitLayoutContext.Provider value={{ manager }}>
      <SplitPanelContext.Provider
        value={{ handle } as unknown as SplitPanelContextType}
      >
        <Host />
      </SplitPanelContext.Provider>
    </SplitLayoutContext.Provider>
  ));
  return guard;
}

async function flush(router: SplitRouter) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await router.settled();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const layer = (id: string) =>
  document.querySelector<HTMLElement>(`[data-split-layer="${id}"]`);

// jsdom has no layout; the tiled layout only needs to observe something.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  // Unmount first: clearing the tab manager while a later tab is live would
  // mount the tabless layer without the stubs.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setGlobalTabManager(undefined);
  panels.mounted = 0;
  panels.unmounted = 0;
});

describe('desktop tab layers', () => {
  it('switching tabs hides the left tab and shows it again without remounting', async () => {
    const { router, tabManager } = setup('/channels/channel-one');
    await flush(router);
    const first = tabManager.activeTabId();
    const firstPanel = document.querySelector('[data-panel]');
    expect(firstPanel).not.toBeNull();
    expect(panels.mounted).toBe(1);

    tabManager.newTab();
    await flush(router);
    const second = tabManager.activeTabId();
    expect(panels.mounted).toBe(2);
    expect(panels.unmounted).toBe(0);
    expect(layer(first)?.inert).toBe(true);
    expect(layer(first)?.classList.contains('invisible')).toBe(true);
    expect(layer(second)?.inert).toBe(false);

    tabManager.activateTab(first);
    await flush(router);
    tabManager.activateTab(second);
    await flush(router);
    tabManager.activateTab(first);
    await flush(router);

    expect(panels.mounted).toBe(2);
    expect(panels.unmounted).toBe(0);
    expect(document.querySelector('[data-panel]')).toBe(firstPanel);
    expect(layer(first)?.inert).toBe(false);
    expect(layer(second)?.inert).toBe(true);
  });

  it('selecting a preview held by a background tab opens it in this tab', async () => {
    const alert = vi.spyOn(toast, 'alert').mockReturnValue(0);
    const { router, tabManager, manager } = setup('/channels');
    await flush(router);
    const channel = { type: 'channel', id: 'channel-two' } as const;
    expect(guardInFirstPane(router, manager)(channel, 'navigate')).toBe(true);

    tabManager.newTab();
    await flush(router);
    const second = tabManager.activeTabId();
    expect(manager.findOpenView(channel)).toBeUndefined();

    expect(guardInFirstPane(router, manager)(channel, 'navigate')).toBe(true);
    await flush(router);

    expect(tabManager.activeTabId()).toBe(second);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a preview held in the same tab still blocks a second one', async () => {
    const alert = vi.spyOn(toast, 'alert').mockReturnValue(0);
    const { router, manager } = setup('/channels');
    await flush(router);
    const channel = { type: 'channel', id: 'channel-two' } as const;
    expect(guardInFirstPane(router, manager)(channel, 'navigate')).toBe(true);

    expect(guardInFirstPane(router, manager)(channel, 'navigate')).toBe(false);
    expect(alert).toHaveBeenCalledOnce();
  });

  it('a document open in a background tab mounts again in this tab', async () => {
    const { router, tabManager, manager, blockScopes } = setup('/md/doc-one');
    await flush(router);
    expect(blockScopes).toEqual([undefined]);

    tabManager.newTab();
    await flush(router);
    const second = tabManager.activeTabId();

    const result = manager.openWithSplit({ type: 'md', id: 'doc-one' });
    await flush(router);

    expect(result.status).not.toBe('reused');
    expect(blockScopes).toEqual([undefined, second]);
    expect(tabManager.activeTabId()).toBe(second);
  });

  it('a tab mounting onto a document another tab holds gets its own instance', async () => {
    const { router, tabManager, blockScopes } = setup('/md/doc-one');
    await flush(router);
    const entry = router.entry(router.panes()[0]!)!;

    tabManager.openEntryInNewTab(entry, { activate: true });
    await flush(router);

    expect(blockScopes).toEqual([undefined, tabManager.activeTabId()]);
  });

  it('a stacked tab parks and comes back stacked without remounting', async () => {
    const { router, tabManager } = setup(
      '/channels/channel-one/~/home?layout=c2pp'
    );
    await flush(router);
    const first = tabManager.activeTabId();
    const stacked = router.layout();
    expect(stacked).toMatchObject({ axis: 'column' });

    tabManager.newTab();
    await flush(router);
    tabManager.activateTab(first);
    await flush(router);

    expect(router.layout()).toEqual(stacked);
    expect(panels.mounted).toBe(3);
    expect(panels.unmounted).toBe(0);
  });

  it(`keeps split state for at most ${MAX_PARKED_TABS} parked tabs as tabs are evicted`, async () => {
    const { router, tabManager, manager } = setup('/channels/channel-one');
    await flush(router);
    const seen = new Set<PaneId>();
    const retainedSplits = () =>
      [...seen].filter((pane) => manager.splitState(splitOf(pane))).length;

    const counts: number[] = [];
    for (let i = 0; i < MAX_PARKED_TABS * 3; i += 1) {
      tabManager.newTab();
      await flush(router);
      for (const pane of router.retainedPanes()) seen.add(pane);
      counts.push(retainedSplits());
    }

    // One live tab and up to MAX_PARKED_TABS parked ones, each one pane:
    // the count grows until tabs start being evicted, then stays put.
    expect(counts).toEqual(
      counts.map((_, i) => Math.min(i + 2, MAX_PARKED_TABS + 1))
    );
    // Tabs still parked keep their splits.
    for (const pane of router.retainedPanes()) {
      expect(manager.splitState(splitOf(pane))).toBeDefined();
    }
  });

  it('closing a background tab forgets its splits', async () => {
    const { router, tabManager, manager } = setup('/channels/channel-one');
    await flush(router);
    const first = tabManager.activeTabId();
    const [firstPane] = router.panes();
    tabManager.newTab();
    await flush(router);
    expect(manager.splitState(splitOf(firstPane!))).toBeDefined();

    tabManager.closeTab(first);
    await flush(router);
    expect(manager.splitState(splitOf(firstPane!))).toBeUndefined();
  });

  it('closing a tab unmounts only its panes', async () => {
    const { router, tabManager } = setup('/channels/channel-one');
    await flush(router);
    tabManager.newTab();
    await flush(router);

    tabManager.closeTab(tabManager.activeTabId());
    await flush(router);
    expect(panels.mounted).toBe(2);
    expect(panels.unmounted).toBe(1);
    expect(document.querySelectorAll('[data-split-layer]')).toHaveLength(1);
  });
});
