import {
  createBlockSignal,
  createBlockStore,
  useIsNestedBlock,
} from '@core/block';
import { ENABLE_PDF_TABS } from '@core/constant/featureFlags';
import { createCallback } from '@solid-primitives/rootless';
import { useCurrentPageNumber, useGetRootViewer } from './pdfViewer';
import { showTabBarSignal } from './placeables';

const TOP_PADDING = 0.2;

// TODO (seamus) : Max tabs is not an ideal solution. Revisit when making
export const MAX_TAB_COUNT = 8;

export type TabInfo = {
  label: string;
  locationHash?: string;
  id: number;
};

export function useGoToLocationHash() {
  const getRootViewer = useGetRootViewer();
  const createTab = useCreateTab();
  const tabCount = useTabCount();

  return createCallback((hash: string, newTab = false) => {
    const viewer = getRootViewer();
    if (!viewer) return;
    if (ENABLE_PDF_TABS && newTab && tabCount() < MAX_TAB_COUNT) {
      createTab();
    }
    viewer.goToLocationHash(hash);
    viewer.hidePopup();
  });
}

export function useGoToLocation() {
  const getRootViewer = useGetRootViewer();
  const createTab = useCreateTab();
  const tabCount = useTabCount();
  return createCallback(
    (loc: {
      pageIndex: number;
      yPos: number;
      callout: number;
      newTab: boolean;
    }) => {
      const viewer = getRootViewer();
      if (!viewer) return;

      if (ENABLE_PDF_TABS && loc.newTab && tabCount() < MAX_TAB_COUNT) {
        createTab();
      }
      viewer.hidePopup();
      const pageNumber = loc.pageIndex + 1;

      // perform the scroll
      viewer.scrollTo({
        pageNumber,
        yPos: Math.floor(loc.yPos),
        topPadding: TOP_PADDING,
      });

      viewer.callout({
        pageNumber,
        yPos: loc.yPos,
        height: loc.callout,
      });
    }
  );
}

// The default tab info for a newly opened pdf.
const defaultTabData = (id: number) => ({
  label: 'Page 1',
  locationHash: '#page=1',
  id,
});

// Store a simple signal that goes up when we make a new tab
const tabIdSignal = createBlockSignal<number>(0);

export const tabDataStore = createBlockStore<TabInfo[]>([defaultTabData(0)]);
export const activeTabIdSignal = createBlockSignal<number>(0);
export const tabHistorySignal = createBlockSignal<number[]>([0]);

function tabById(id: number): TabInfo | undefined {
  return tabDataStore.get.find((t) => t.id === id);
}

function tabIndexById(id: number): number {
  return tabDataStore.get.findIndex((t) => t.id === id);
}

function updateTabById(
  id: number,
  info?: { label?: string; locationHash?: string }
): void {
  const index = tabIndexById(id);
  if (index === -1) return;
  if (info?.label) {
    tabDataStore.set(index, 'label', info.label);
  }
  if (info?.locationHash) {
    tabDataStore.set(index, 'locationHash', info.locationHash);
  }
}

function createTab(info: { label: string; locationHash: string }): number {
  tabIdSignal.set((p) => p + 1);
  const id = tabIdSignal.get();
  tabDataStore.set([
    ...tabDataStore.get,
    {
      ...info,
      id,
    },
  ]);
  return id;
}

/**
 * Create a block-scoped function to navigate to a tab by id. Also sets the
 * selected tab id, and pushes it to the tab history.
 */
export function useNavigateToTab() {
  const updateCurrentTab = useUpdateCurrentTab();
  const setTabHistory = tabHistorySignal.set;
  const getRootViewer = useGetRootViewer();

  return createCallback((id: number) => {
    const viewer = getRootViewer();
    if (!viewer) return;

    // Store the current location in the current tab.
    updateCurrentTab();
    const tab = tabById(id);
    if (tab === undefined) {
      return;
    }
    tab.locationHash && viewer.goToLocationHash(tab.locationHash);
    activeTabIdSignal.set(id);
    setTabHistory((p) => [...p, id]);
  });
}

/**
 * Create a block-scoped function that stores the current location hash of the
 * pdf viewer in the currently active tab.
 */
export function useUpdateCurrentTab() {
  const getRootViewer = useGetRootViewer();
  const currentPageNumber = useCurrentPageNumber();
  return createCallback(() => {
    const viewer = getRootViewer();
    if (!viewer) return;

    updateTabById(activeTabIdSignal.get(), {
      label: `Page ${currentPageNumber()}`,
      locationHash: viewer.getLocationHash(),
    });
  });
}

/**
 * Create a block-scoped function that creates a new tab.
 */
export function useCreateTab() {
  const navigateToTab = useNavigateToTab();
  const [_, setActiveTabId] = activeTabIdSignal;
  const getRootViewer = useGetRootViewer();
  const currentPageNumber = useCurrentPageNumber();
  const setShowTabBar = showTabBarSignal.set;
  const isNestedBlock = useIsNestedBlock();

  return createCallback((info?: { label: string; locationHash: string }) => {
    if (isNestedBlock) return;

    const viewer = getRootViewer();
    if (!viewer) return;

    const newId = createTab({
      locationHash: info?.locationHash ?? viewer.getLocationHash() ?? '',
      label: info?.label ?? `Page ${currentPageNumber()}`,
    });
    setShowTabBar(true);
    navigateToTab(newId);
    setActiveTabId(newId);
  });
}

/**
 * Create a block-scoped function that resets tab state.
 */
export function useClearTabs() {
  const setActiveTabId = activeTabIdSignal.set;
  const setTabHistory = tabHistorySignal.set;
  const setTabId = tabIdSignal.set;
  const setTabData = tabDataStore.set;
  return () => {
    setTabId(0);
    setActiveTabId(0);
    setTabHistory([0]);
    setTabData([defaultTabData(0)]);
  };
}

/**
 * Create a block-scoped function deletes a tab by id.
 */
export function useDeleteTab() {
  const [tabs, setTabs] = tabDataStore;
  const [tabHistory, setTabHistory] = tabHistorySignal;
  const navigateToTab = useNavigateToTab();

  return createCallback((id: number) => {
    setTabs([...tabs.filter((tab) => tab.id !== id)]);
    let history = tabHistory().filter((tabId) => tabId !== id);

    // If history is empty after filtering, use the first available tab
    if (history.length === 0 && tabs.length > 0) {
      history = [tabs[0].id];
    }

    setTabHistory(history);
    const nextId = history.at(-1) ?? tabs[0].id ?? 0;
    navigateToTab(nextId);
  });
}

export function useTabCount() {
  const [tabs] = tabDataStore;
  return createCallback(() => tabs.length);
}
