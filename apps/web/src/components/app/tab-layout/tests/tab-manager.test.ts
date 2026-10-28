import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type PaneId,
  type SplitRouter,
} from '@app/lib/split-router';
import {
  appRoutes,
  createTestPolicy,
} from '@app/lib/split-router/tests/fixtures';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createTabManager, type TabLayoutHost } from '../tab-manager';

const fakeHost = (): TabLayoutHost => ({
  tabTitle: () => undefined,
  activeSplitId: () => undefined,
  getSplit: () => undefined,
  splits: () => [],
  activateSplit: () => {},
});

function setup(url: string, userId = `user-${Math.random()}`) {
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
      manager: fakeHost(),
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
});
