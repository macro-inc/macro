import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  PANE_LEVEL,
  type PaneId,
  type SplitRouter,
} from '@app/lib/split-router';
import {
  appRoutes,
  createTestPolicy,
} from '@app/lib/split-router/tests/fixtures';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { NO_SPLITS_TAB_HOST } from '../DesktopTabsController';
import {
  createTabManager,
  MAX_PARKED_TABS,
  type TabLayoutHost,
} from '../tab-manager';

const fakeHost = (): TabLayoutHost => ({
  tabTitle: () => undefined,
  activeSplitId: () => undefined,
  getSplit: () => undefined,
  splits: () => [],
  activateSplit: () => {},
});

function setup(
  url: string,
  userId = `user-${Math.random()}`,
  host = fakeHost()
) {
  const history = createMemoryHistory(url);
  let created = 0;
  const { router, tabManager, dispose } = createRoot((dispose) => {
    const router = createSplitRouter({
      routes: appRoutes,
      history,
      paneStore: createMemoryPaneStore<Entry>(),
      policy: createTestPolicy().policy,
      createPaneId: () => `pane-${++created}` as PaneId,
    });
    const tabManager = createTabManager({
      router,
      manager: host,
      userId,
    });
    return { router, tabManager, dispose };
  });
  return {
    router,
    tabManager,
    history,
    userId,
    dispose: () => {
      router.dispose();
      dispose();
    },
  };
}

async function flush(router: SplitRouter) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await router.settled();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const routeIds = (router: SplitRouter) =>
  router.panes().map((pane) =>
    router
      .entry(pane)
      ?.location.route.matches.map((match) => match.id)
      .filter((id) => id !== 'app')
  );

let cleanup: (() => void) | undefined;
const track = <T extends { dispose: () => void }>(context: T) => {
  cleanup = context.dispose;
  return context;
};

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('desktop tab manager', () => {
  it('starts with one tab holding the default view', () => {
    const { tabManager } = track(setup('/mail/t1'));
    expect(tabManager.tabs()).toHaveLength(1);
    expect(tabManager.activeTabId()).toBe(tabManager.tabs()[0]!.id);
  });

  it('newTab opens the default view and switching back restores the layout and its history', async () => {
    const { router, tabManager } = track(setup('/mail/t1'));
    const [first] = tabManager.tabs();

    tabManager.newTab();
    await flush(router);
    expect(tabManager.tabs()).toHaveLength(2);
    const second = tabManager.tabs()[1]!;
    expect(tabManager.activeTabId()).toBe(second.id);
    expect(routeIds(router)).toEqual([['home']]);

    // Navigate within the second tab so it has pane history.
    await router.navigatePane(router.panes()[0]!, '/drive');
    expect(routeIds(router)).toEqual([['drive']]);

    tabManager.activateTab(first!.id);
    await flush(router);
    expect(tabManager.activeTabId()).toBe(first!.id);
    expect(routeIds(router)).toEqual([['mail', 'mail-thread']]);

    // The second tab kept its in-tab history across the switch away.
    tabManager.activateTab(second.id);
    await flush(router);
    expect(routeIds(router)).toEqual([['drive']]);
    expect(router.canGo(router.panes()[0]!, -1)).toBe(true);
  });

  it('scopes blocks to the tab they mount in, leaving the first unscoped', async () => {
    const { router, tabManager } = track(setup('/mail/t1'));
    const [first] = tabManager.tabs();
    expect(tabManager.blockScope()).toBeUndefined();

    tabManager.newTab();
    await flush(router);
    expect(tabManager.blockScope()).toBe(tabManager.activeTabId());

    tabManager.activateTab(first!.id);
    await flush(router);
    expect(tabManager.blockScope()).toBeUndefined();
  });

  it('numbers tabs by position, with 9 always the last', async () => {
    const { router, tabManager } = track(setup('/mail'));
    tabManager.newTab();
    await flush(router);
    tabManager.newTab();
    await flush(router);
    const [first, second, third] = tabManager.tabs();

    expect(tabManager.tabByNumber(1)).toBe(first);
    expect(tabManager.tabByNumber(2)).toBe(second);
    expect(tabManager.tabByNumber(3)).toBe(third);
    expect(tabManager.tabByNumber(4)).toBeUndefined();
    expect(tabManager.tabByNumber(9)).toBe(third);
  });

  it('closing the active tab activates its neighbor and restores it', async () => {
    const { router, tabManager } = track(setup('/mail/t1'));
    const [first] = tabManager.tabs();
    tabManager.newTab();
    await flush(router);

    tabManager.closeTab(tabManager.activeTabId());
    await flush(router);
    expect(tabManager.tabs()).toHaveLength(1);
    expect(tabManager.activeTabId()).toBe(first!.id);
    expect(routeIds(router)).toEqual([['mail', 'mail-thread']]);
  });

  it('never closes the last tab', () => {
    const { tabManager } = track(setup('/home'));
    tabManager.closeTab(tabManager.activeTabId());
    expect(tabManager.tabs()).toHaveLength(1);
  });

  it('openEntryInNewTab without activation leaves the layout alone', async () => {
    const { router, tabManager } = track(setup('/mail/t1'));
    const entry = router.entry(router.panes()[0]!)!;

    tabManager.openEntryInNewTab(entry, { activate: false });
    await flush(router);
    expect(tabManager.tabs()).toHaveLength(2);
    expect(tabManager.activeTabId()).toBe(tabManager.tabs()[0]!.id);
    expect(routeIds(router)).toEqual([['mail', 'mail-thread']]);

    // No stored English title; the strip renders its translated placeholder
    // until the tab is activated and gets a live title.
    const background = tabManager.tabs()[1]!;
    expect(background.title).toBeUndefined();
    expect(tabManager.tabTitle(background)).toBeUndefined();

    tabManager.activateTab(tabManager.tabs()[1]!.id);
    await flush(router);
    expect(routeIds(router)).toEqual([['mail', 'mail-thread']]);
  });

  it('persists tabs per user and restores them on the next start', async () => {
    const userId = 'user-persistence';
    const { router, tabManager, dispose } = setup('/mail/t1', userId);
    tabManager.newTab();
    await flush(router);
    await router.navigatePane(router.panes()[0]!, '/drive');
    await flush(router);
    dispose();

    const second = track(setup('/drive', userId));
    expect(second.tabManager.tabs()).toHaveLength(2);
    // The second tab was active when the first session ended.
    expect(second.tabManager.activeTabId()).toBe(
      second.tabManager.tabs()[1]!.id
    );
    const storedFirst = second.tabManager.tabs()[0]!;
    expect(storedFirst.stored).toMatchObject({
      kind: 'url',
      url: '/mail/t1',
    });
  });

  it('keeps the tabs on a page outside the app layout, such as a call', async () => {
    const { router, tabManager, userId } = track(setup('/mail/t1'));
    tabManager.newTab();
    await flush(router);

    // Entering a call swaps the app shell, and its tab owner, for the
    // meeting shell, which owns tabs over the same router without splits.
    const meeting = createRoot((dispose) => ({
      tabManager: createTabManager({
        router,
        manager: NO_SPLITS_TAB_HOST,
        userId,
      }),
      dispose,
    }));
    await router.navigate('/login');
    await flush(router);
    expect(meeting.tabManager.tabs()).toHaveLength(2);

    meeting.tabManager.activateTab(meeting.tabManager.tabs()[0]!.id);
    await flush(router);
    expect(routeIds(router)).toEqual([['mail', 'mail-thread']]);
    meeting.dispose();
  });

  it('parks the tab it leaves, so switching back shows the same panes without remounting', async () => {
    const { router, tabManager } = track(setup('/mail/t1'));
    const [first] = tabManager.tabs();
    const firstPanes = router.panes();
    const firstEntry = router.entry(firstPanes[0]!);

    tabManager.newTab();
    await flush(router);
    const second = tabManager.activeTabId();
    expect(tabManager.layerIds()).toEqual([first!.id, second]);
    expect(tabManager.isLive(second)).toBe(true);
    expect(tabManager.isLive(first!.id)).toBe(false);
    // The left tab's panes stay retained, with their entries, in its layer.
    expect(tabManager.layerSplits(first!.id)).toEqual(firstPanes);
    expect(router.entry(firstPanes[0]!)).toBe(firstEntry);

    tabManager.activateTab(first!.id);
    await flush(router);
    expect(router.panes()).toEqual(firstPanes);
    expect(router.entry(firstPanes[0]!)).toBe(firstEntry);
    expect(tabManager.isLive(first!.id)).toBe(true);
    expect(tabManager.layerSplits(second)).toHaveLength(1);
  });

  it('the first live tab takes the initial layer, so enabling tabs remounts nothing', () => {
    const { tabManager } = track(setup('/mail/t1'));
    expect(tabManager.layerIds()).toEqual(['initial']);
  });

  it(`unmounts the least recently used tabs past ${MAX_PARKED_TABS} parked`, async () => {
    const { router, tabManager } = track(setup('/mail/t1'));
    const [first] = tabManager.tabs();
    const firstPanes = router.panes();

    for (let i = 0; i <= MAX_PARKED_TABS; i += 1) {
      tabManager.newTab();
      await flush(router);
    }

    const evicted = tabManager.tabs().find((tab) => tab.id === first!.id)!;
    expect(evicted.stored.kind).toBe('snapshot');
    expect(router.retainedPanes()).not.toContain(firstPanes[0]);
    expect(tabManager.layerIds()).toHaveLength(MAX_PARKED_TABS + 1);

    tabManager.activateTab(first!.id);
    await flush(router);
    expect(routeIds(router)).toEqual([['mail', 'mail-thread']]);
  });

  it('closing a background tab forgets its parked panes', async () => {
    const { router, tabManager } = track(setup('/mail/t1'));
    const [first] = tabManager.tabs();
    const firstPanes = router.panes();
    tabManager.newTab();
    await flush(router);

    tabManager.closeTab(first!.id);
    expect(tabManager.tabs()).toHaveLength(1);
    expect(router.retainedPanes()).toEqual(router.panes());
    expect(router.entry(firstPanes[0]!)).toBeUndefined();
  });

  it('a leave guard in the active tab can refuse closing it', async () => {
    const { router, tabManager } = track(setup('/mail/t1'));
    tabManager.newTab();
    await flush(router);
    const closing = tabManager.activeTabId();
    const stop = router.registerGuard(
      router.panes()[0]!,
      PANE_LEVEL,
      () => false
    );

    tabManager.closeTab(closing);
    await flush(router);
    expect(tabManager.tabs()).toHaveLength(2);
    expect(tabManager.activeTabId()).toBe(closing);
    stop();
  });
});
