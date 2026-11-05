import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import type {
  Entry,
  LayoutSnapshot,
  PaneId,
  ShowLayoutOptions,
  SplitRouter,
} from '@app/lib/split-router';
import {
  INITIAL_LAYER_ID,
  type SplitLayers,
  sameIds,
} from '@components/app/split-layout/layers';
import type {
  SplitId,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';
import { disarmOpenInNewTabIntent } from './open-in-tab-intent';
import { readPersistedTabs, writePersistedTabs } from './tab-persistence';

export type DesktopTabId = string & { readonly DesktopTabId: unique symbol };

/**
 * How an inactive tab comes back: its panes still mounted (parked), a kept
 * capture of a layout that is not mounted, or a saved URL.
 */
type StoredLayout =
  | {
      kind: 'parked';
      panes: readonly PaneId[];
      activeSplit: SplitId | undefined;
    }
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

/**
 * Background tabs kept mounted (parked) for instant switching. Past this, the
 * least recently used ones unmount and come back from a capture.
 */
export const MAX_PARKED_TABS = 5;

const newTabId = () => crypto.randomUUID() as DesktopTabId;

const SURFACE = 'desktop-tabs';

function newUrlTab(url: string, id: DesktopTabId = newTabId()): DesktopTab {
  return {
    id,
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
 * Browser-style tabs over the split layout. The active tab's panes are the
 * router's open panes. Switching away parks them: the router keeps them out of
 * the URL, and the split layout keeps their views mounted but hidden and not
 * rendered, so switching back is instant. Tabs not yet opened, or evicted past
 * `MAX_PARKED_TABS`, hold a capture (or a saved URL) and mount on activation.
 */
export function createTabManager(options: TabManagerOptions) {
  const { router, manager, userId } = options;

  const persisted = readPersistedTabs(userId);
  const initialActiveIndex = persisted
    ? Math.min(persisted.active, persisted.tabs.length - 1)
    : 0;
  // The live tab takes the split layout's initial layer, so the panes that
  // are already mounted stay mounted when tabs turn on.
  const initialTabs: readonly DesktopTab[] = persisted
    ? persisted.tabs.map((tab, index) => ({
        id:
          index === initialActiveIndex
            ? (INITIAL_LAYER_ID as DesktopTabId)
            : newTabId(),
        title: tab.title,
        paneCount: tab.paneCount,
        stored: { kind: 'url', url: tab.url },
      }))
    : [newUrlTab(DEFAULT_ROUTE, INITIAL_LAYER_ID as DesktopTabId)];
  const initialActive = initialTabs[initialActiveIndex]!;

  const [tabs, setTabs] = createSignal<readonly DesktopTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = createSignal(initialActive.id);
  // Which tab each pane belongs to, recorded when a tab parks or opens.
  // Panes opened inside the live tab are unrecorded until it parks.
  const [owners, setOwners] = createSignal<ReadonlyMap<PaneId, DesktopTabId>>(
    new Map()
  );
  const lastUsed = new Map<DesktopTabId, number>();
  let useCount = 0;
  const touch = (id: DesktopTabId) => lastUsed.set(id, ++useCount);
  touch(initialActive.id);
  // Tab operations swap the whole layout; one at a time keeps them coherent.
  let switching = false;

  const findTab = (id: DesktopTabId) => tabs().find((tab) => tab.id === id);
  const activeIndex = () => tabs().findIndex((tab) => tab.id === activeTabId());

  /**
   * The tab the router's open panes belong to. It moves with the router's
   * commit, before the strip highlights the tab, so a layer never shows
   * another tab's panes.
   */
  const liveTabId = createMemo(() => {
    const owned = owners();
    for (const pane of router.panes()) {
      const owner = owned.get(pane);
      if (owner) return owner;
    }

    return activeTabId();
  });

  const assignOwners = (panes: readonly PaneId[], id: DesktopTabId) => {
    setOwners((current) => {
      const next = new Map(current);
      for (const pane of panes) next.set(pane, id);
      return next;
    });
  };

  const dropOwners = (panes: readonly PaneId[]) => {
    setOwners((current) => {
      const next = new Map(current);
      for (const pane of panes) next.delete(pane);
      return next;
    });
  };

  const setTab = (next: DesktopTab) =>
    setTabs((list) => list.map((tab) => (tab.id === next.id ? next : tab)));

  /** Records the active tab's open panes as parked, before they are swapped out. */
  const parkActiveTab = () => {
    const current = findTab(activeTabId());
    const panes = router.panes();
    if (!current || panes.length === 0) return;

    batch(() => {
      assignOwners(panes, current.id);
      setTab({
        ...current,
        title: manager.tabTitle() ?? current.title,
        paneCount: panes.length,
        stored: {
          kind: 'parked',
          panes,
          activeSplit: manager.activeSplitId(),
        },
      });
    });
  };

  const parkedPanes = (tab: DesktopTab): readonly PaneId[] =>
    tab.stored.kind === 'parked' ? tab.stored.panes : [];

  const storedHref = (tab: DesktopTab): string =>
    match(tab.stored)
      .with({ kind: 'url' }, (stored) => stored.url)
      .with({ kind: 'snapshot' }, (stored) => stored.href)
      .with({ kind: 'parked' }, (stored) =>
        router.layoutHref(router.layoutSnapshot(stored.panes))
      )
      .exhaustive();

  /** Mounts a captured layout as `tab`'s panes. */
  const openLayout = (
    tab: DesktopTab,
    layout: LayoutSnapshot,
    showOptions: ShowLayoutOptions
  ) => {
    assignOwners(
      layout.panes.map((pane) => pane.pane),
      tab.id
    );
    return router.openLayout(layout, showOptions);
  };

  /**
   * Brings a stored tab's layout up: parked panes come back as they were;
   * anything else mounts. False when a leave guard or middleware refused.
   */
  const show = async (
    tab: DesktopTab,
    showOptions: ShowLayoutOptions = {}
  ): Promise<boolean> => {
    disarmOpenInNewTabIntent();
    const result = await match(tab.stored)
      .with({ kind: 'parked' }, (stored) =>
        router.showLayout(stored.panes, showOptions)
      )
      .with({ kind: 'snapshot' }, (stored) =>
        openLayout(tab, stored.layout, showOptions)
      )
      .with({ kind: 'url' }, (stored) =>
        openLayout(tab, router.layoutFromHref(stored.url), showOptions)
      )
      .exhaustive();

    return result.status !== 'cancelled';
  };

  const focusStoredSplit = (tab: DesktopTab) => {
    const stored = tab.stored.kind === 'url' ? undefined : tab.stored;
    const target =
      stored?.activeSplit !== undefined && manager.getSplit(stored.activeSplit)
        ? stored.activeSplit
        : untrack(manager.splits)[0]?.id;
    if (target) manager.activateSplit(target);
  };

  /** Unmounts the least recently used parked tabs past `MAX_PARKED_TABS`. */
  const evictParkedTabs = () => {
    const parked = untrack(tabs).filter(
      (tab) => tab.stored.kind === 'parked' && tab.id !== untrack(liveTabId)
    );
    const excess = parked.length - MAX_PARKED_TABS;
    if (excess <= 0) return;

    const oldest = [...parked]
      .sort((a, b) => (lastUsed.get(a.id) ?? 0) - (lastUsed.get(b.id) ?? 0))
      .slice(0, excess);
    batch(() => {
      for (const tab of oldest) {
        const panes = parkedPanes(tab);
        const layout = router.layoutSnapshot(panes);
        setTab({
          ...tab,
          stored: {
            kind: 'snapshot',
            layout,
            activeSplit:
              tab.stored.kind === 'parked' ? tab.stored.activeSplit : undefined,
            href: router.layoutHref(layout),
          },
        });
        router.discardPanes(panes);
        dropOwners(panes);
      }
    });
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
      span.setAttr('tabs.target_kept', target.stored.kind === 'parked');
      untrack(parkActiveTab);
      const shown = await show(target);
      span.setAttr('tabs.outcome', shown ? 'committed' : 'cancelled');
      if (!shown) return;

      setActiveTabId(id);
      touch(id);
      focusStoredSplit(target);
      evictParkedTabs();
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
      // Showing the neighbor removes this tab's panes, so its leave guards
      // (unsaved changes) decide whether the close happens.
      const closing = untrack(router.panes);
      const shown = await show(target, { closeOpen: true });
      if (!shown) return;

      batch(() => {
        setTabs((list) => list.filter((tab) => tab.id !== id));
        setActiveTabId(neighbor);
        dropOwners(closing);
      });
      lastUsed.delete(id);
      touch(neighbor);
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

  // Layers keep the order tabs first got one, so opening or closing a tab
  // never moves another tab's mounted panes in the document.
  let layerOrder: readonly DesktopTabId[] = [];
  const layerIds = createMemo(
    () => {
      const live = liveTabId();
      const mounted = new Set(
        tabs()
          .filter((tab) => tab.id === live || tab.stored.kind === 'parked')
          .map((tab) => tab.id)
      );
      mounted.add(live);
      const kept = layerOrder.filter((id) => mounted.has(id));
      const added = [...mounted].filter((id) => !kept.includes(id));
      layerOrder = [...kept, ...added];
      return layerOrder;
    },
    [],
    { equals: sameIds }
  );

  const layers: SplitLayers = {
    layerIds,
    layerSplits(layer) {
      const tab = findTab(layer as DesktopTabId);
      const panes =
        layer === liveTabId() ? router.panes() : tab ? parkedPanes(tab) : [];
      return panes as readonly string[] as readonly SplitId[];
    },
    isLive: (layer) => layer === liveTabId(),
  };

  // Parked panes outlive nothing: when tabs turn off or the account changes,
  // forget them so only the open layout remains.
  onCleanup(() => {
    const open = untrack(router.panes);
    router.discardPanes(
      untrack(router.retainedPanes).filter((pane) => !open.includes(pane))
    );
  });

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
    ...layers,

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

    /**
     * Brings up the background tab holding a parked split, focused on that
     * split. False when no background tab holds it, so the split is live.
     */
    revealSplit(id: SplitId): boolean {
      const holder = untrack(tabs).find(
        (tab) =>
          tab.id !== untrack(activeTabId) &&
          parkedPanes(tab).some((pane) => (pane as string) === id)
      );
      if (holder?.stored.kind !== 'parked') return false;

      setTab({ ...holder, stored: { ...holder.stored, activeSplit: id } });
      fireAndForget(activateTab(holder.id), SURFACE);
      return true;
    },

    closeTab(id: DesktopTabId): void {
      const list = untrack(tabs);
      if (list.length <= 1) return;
      const index = list.findIndex((tab) => tab.id === id);
      if (index < 0) return;

      if (id !== untrack(activeTabId)) {
        const panes = parkedPanes(list[index]!);
        batch(() => {
          setTabs((current) => current.filter((tab) => tab.id !== id));
          router.discardPanes(panes);
          dropOwners(panes);
        });
        lastUsed.delete(id);
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

    /** The tab Cmd+`number` opens: the Nth, except 9, which is always the last. */
    tabByNumber(number: number): DesktopTab | undefined {
      const list = tabs();
      return number === 9 ? list.at(-1) : list[number - 1];
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
