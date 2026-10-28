import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import type { Entry, LayoutSnapshot, SplitRouter } from '@app/lib/split-router';
import type {
  SplitId,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { batch, createEffect, createSignal, untrack } from 'solid-js';
import { disarmOpenInNewTabIntent } from './open-in-tab-intent';
import { readPersistedTabs, writePersistedTabs } from './tab-persistence';

export type DesktopTabId = string & { readonly DesktopTabId: unique symbol };

/** How an inactive tab comes back: a kept capture, or a saved URL. */
type StoredLayout =
  | {
      kind: 'snapshot';
      layout: LayoutSnapshot;
      activeSplit: SplitId | undefined;
      href: string;
    }
  | { kind: 'url'; url: string };

export type DesktopTab = {
  readonly id: DesktopTabId;
  /** Frozen at deactivation; the active tab renders live values instead. */
  readonly title: string | undefined;
  readonly paneCount: number;
  readonly stored: StoredLayout;
};

const newTabId = () => crypto.randomUUID() as DesktopTabId;

const SURFACE = 'desktop-tabs';

function newUrlTab(url: string): DesktopTab {
  return {
    id: newTabId(),
    title: undefined,
    paneCount: 1,
    stored: { kind: 'url', url },
  };
}

/** What the tab layer needs from the split layout manager. */
export type TabLayoutHost = Pick<
  SplitManager,
  'tabTitle' | 'activeSplitId' | 'getSplit' | 'splits' | 'activateSplit'
>;

export type TabManagerOptions = {
  router: SplitRouter;
  manager: TabLayoutHost;
  userId: string;
};

export type TabManager = ReturnType<typeof createTabManager>;

/**
 * Browser-style tabs over the split layout. Only the active tab is live; the
 * others hold a layout capture (or a saved URL) and restore through the
 * router, so switching runs leave guards and keeps pane histories.
 */
export function createTabManager(options: TabManagerOptions) {
  const { router, manager, userId } = options;

  const persisted = readPersistedTabs(userId);
  const initialTabs: readonly DesktopTab[] = persisted
    ? persisted.tabs.map((tab) => ({
        id: newTabId(),
        title: tab.title,
        paneCount: tab.paneCount,
        stored: { kind: 'url', url: tab.url },
      }))
    : [newUrlTab(DEFAULT_ROUTE)];
  const initialActive =
    initialTabs[Math.min(persisted?.active ?? 0, initialTabs.length - 1)]!;

  const [tabs, setTabs] = createSignal<readonly DesktopTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = createSignal(initialActive.id);
  // Tab operations swap the whole layout; one at a time keeps them coherent.
  let switching = false;

  const findTab = (id: DesktopTabId) => tabs().find((tab) => tab.id === id);
  const activeIndex = () => tabs().findIndex((tab) => tab.id === activeTabId());

  /** The active tab with the live layout frozen in, ready to be stored. */
  const captureActiveTab = (): DesktopTab | undefined => {
    const current = findTab(activeTabId());
    if (!current) return;

    const layout = router.layoutSnapshot();
    if (layout.panes.length === 0) return current;

    return {
      ...current,
      title: manager.tabTitle() ?? current.title,
      paneCount: layout.panes.length,
      stored: {
        kind: 'snapshot',
        layout,
        activeSplit: manager.activeSplitId(),
        href: router.layoutHref(layout),
      },
    };
  };

  const storedHref = (tab: DesktopTab): string =>
    tab.stored.kind === 'url' ? tab.stored.url : tab.stored.href;

  /** Brings a stored tab's layout up; false when a leave guard refused. */
  const show = async (tab: DesktopTab): Promise<boolean> => {
    disarmOpenInNewTabIntent();
    const result =
      tab.stored.kind === 'snapshot'
        ? await router.restoreLayout(tab.stored.layout)
        : await router.navigate(tab.stored.url);

    return result.status !== 'cancelled';
  };

  const focusStoredSplit = (tab: DesktopTab) => {
    const stored = tab.stored.kind === 'snapshot' ? tab.stored : undefined;
    const target =
      stored?.activeSplit !== undefined && manager.getSplit(stored.activeSplit)
        ? stored.activeSplit
        : untrack(manager.splits)[0]?.id;
    if (target) manager.activateSplit(target);
  };

  async function activateTab(id: DesktopTabId): Promise<void> {
    if (switching || id === untrack(activeTabId)) return;
    const target = untrack(() => findTab(id));
    if (!target) return;

    switching = true;
    const span = Telemetry.span('tabs.switch');
    try {
      span.setAttr('tabs.count', untrack(tabs).length);
      span.setAttr('tabs.target_pane_count', target.paneCount);
      const previous = untrack(captureActiveTab);
      const shown = await show(target);
      span.setAttr('tabs.outcome', shown ? 'committed' : 'cancelled');
      if (!shown) return;

      batch(() => {
        if (previous) {
          setTabs((list) =>
            list.map((tab) => (tab.id === previous.id ? previous : tab))
          );
        }
        setActiveTabId(id);
      });
      focusStoredSplit(target);
    } finally {
      switching = false;
      span.end();
    }
  }

  async function closeActiveTab(
    id: DesktopTabId,
    neighbor: DesktopTabId
  ): Promise<void> {
    if (switching) return;
    const target = untrack(() => findTab(neighbor));
    if (!target) return;

    switching = true;
    try {
      // Restoring the neighbor removes this tab's panes, so its leave
      // guards (unsaved changes) decide whether the close happens.
      const shown = await show(target);
      if (!shown) return;

      batch(() => {
        setTabs((list) => list.filter((tab) => tab.id !== id));
        setActiveTabId(neighbor);
      });
      focusStoredSplit(target);
    } finally {
      switching = false;
    }
  }

  const insertTab = (tab: DesktopTab, index: number) => {
    setTabs((list) => {
      const next = [...list];
      next.splice(Math.max(0, Math.min(index, next.length)), 0, tab);
      return next;
    });
  };

  // Keep the saved tabs current: the active tab persists its live layout URL.
  createEffect(() => {
    const list = tabs();
    const active = activeTabId();
    // Track the live layout so in-tab navigation refreshes the saved URL.
    router.panes().forEach((pane) => router.entry(pane));
    const activeTitle = manager.tabTitle();
    const livePaneCount = router.panes().length;
    const liveUrl = untrack(() => router.layoutHref(router.layoutSnapshot()));

    writePersistedTabs(userId, {
      version: 1,
      active: Math.max(
        0,
        list.findIndex((tab) => tab.id === active)
      ),
      tabs: list.map((tab) => {
        const isActive = tab.id === active;
        return {
          title: isActive ? (activeTitle ?? tab.title) : tab.title,
          paneCount:
            isActive && livePaneCount > 0 ? livePaneCount : tab.paneCount,
          url: isActive && livePaneCount > 0 ? liveUrl : storedHref(tab),
        };
      }),
    });
  });

  return {
    tabs,
    activeTabId,

    /** Live title for the strip: the active tab reads the layout manager.
     * Undefined when the tab has no title yet; the strip renders the
     * translated placeholder. */
    tabTitle(tab: DesktopTab): string | undefined {
      const live = tab.id === activeTabId() ? manager.tabTitle() : undefined;
      return live ?? tab.title;
    },

    /** Live pane count for the strip's split indicator. */
    tabPaneCount(tab: DesktopTab): number {
      if (tab.id !== activeTabId()) return tab.paneCount;
      const live = router.panes().length;
      return live > 0 ? live : tab.paneCount;
    },

    activateTab(id: DesktopTabId): void {
      fireAndForget(activateTab(id), SURFACE);
    },

    closeTab(id: DesktopTabId): void {
      const list = untrack(tabs);
      if (list.length <= 1) return;
      const index = list.findIndex((tab) => tab.id === id);
      if (index < 0) return;

      if (id !== untrack(activeTabId)) {
        setTabs((current) => current.filter((tab) => tab.id !== id));
        return;
      }

      const neighbor = list[index + 1] ?? list[index - 1];
      if (!neighbor) return;
      fireAndForget(closeActiveTab(id, neighbor.id), SURFACE);
    },

    /** The + button and cmd+T: a fresh tab on the default view. */
    newTab(options: { activate?: boolean } = {}): void {
      const tab = newUrlTab(DEFAULT_ROUTE);
      insertTab(tab, untrack(tabs).length);
      if (options.activate !== false) {
        fireAndForget(activateTab(tab.id), SURFACE);
      }
    },

    /** Cmd+click: the destination opens as a tab beside the active one. */
    openEntryInNewTab(entry: Entry, options: { activate: boolean }): void {
      const layout: LayoutSnapshot = {
        panes: [{ pane: router.createPaneId(), entries: [entry], index: 0 }],
      };
      const tab: DesktopTab = {
        id: newTabId(),
        // No stored title until the tab is activated and gets a live one;
        // the strip renders its translated placeholder meanwhile (i18n.md
        // bans deriving display text from English route ids).
        title: undefined,
        paneCount: 1,
        stored: {
          kind: 'snapshot',
          layout,
          activeSplit: undefined,
          href: router.layoutHref(layout),
        },
      };
      const span = Telemetry.span('tabs.open');
      span.setAttr('tabs.activate', options.activate);
      span.setAttr('tabs.count', untrack(tabs).length + 1);
      span.end();

      insertTab(tab, untrack(activeIndex) + 1);
      if (options.activate) {
        // The intercepted navigation is still settling; activate after it.
        queueMicrotask(() => fireAndForget(activateTab(tab.id), SURFACE));
      }
    },

    activateNextTab(step: 1 | -1): void {
      const list = untrack(tabs);
      if (list.length <= 1) return;
      const index = untrack(activeIndex);
      const next = list[(index + step + list.length) % list.length];
      if (next) fireAndForget(activateTab(next.id), SURFACE);
    },
  };
}
