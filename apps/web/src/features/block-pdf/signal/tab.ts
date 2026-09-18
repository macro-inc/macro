import { ENABLE_PDF_TABS } from '@core/constant/featureFlags';
import { createCallback } from '@solid-primitives/rootless';
import { usePdfDocument } from '../context/pdf-document-context';

const TOP_PADDING = 0.2;

// TODO (seamus) : Max tabs is not an ideal solution. Revisit when making
export const MAX_TAB_COUNT = 8;

export type TabInfo = {
  label: string;
  locationHash?: string;
  id: number;
};

export function useGoToLocationHash() {
  const [rootViewer] = usePdfDocument().state.signals.rootViewer;
  const createTab = useCreateTab();
  const tabCount = useTabCount();

  return createCallback((hash: string, newTab = false) => {
    const viewer = rootViewer();
    if (!viewer) return;
    if (ENABLE_PDF_TABS && newTab && tabCount() < MAX_TAB_COUNT) {
      createTab();
    }
    viewer.goToLocationHash(hash);
    viewer.hidePopup();
  });
}

export function useGoToLocation() {
  const [rootViewer] = usePdfDocument().state.signals.rootViewer;
  const createTab = useCreateTab();
  const tabCount = useTabCount();
  return createCallback(
    (loc: {
      pageIndex: number;
      yPos: number;
      callout: number;
      newTab: boolean;
    }) => {
      const viewer = rootViewer();
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

function tabById(tabs: readonly TabInfo[], id: number): TabInfo | undefined {
  return tabs.find((tab) => tab.id === id);
}

/**
 * Create a block-scoped function to navigate to a tab by id. Also sets the
 * selected tab id, and pushes it to the tab history.
 */
export function useNavigateToTab() {
  const pdf = usePdfDocument();
  const updateCurrentTab = useUpdateCurrentTab();
  const [tabs] = pdf.state.stores.tabData;
  const [, setActiveTabId] = pdf.state.signals.activeTabId;
  const [, setTabHistory] = pdf.state.signals.tabHistory;
  const [rootViewer] = pdf.state.signals.rootViewer;

  return createCallback((id: number) => {
    const viewer = rootViewer();
    if (!viewer) return;

    // Store the current location in the current tab.
    updateCurrentTab();
    const tab = tabById(tabs, id);
    if (tab === undefined) {
      return;
    }
    tab.locationHash && viewer.goToLocationHash(tab.locationHash);
    setActiveTabId(id);
    setTabHistory((p) => [...p, id]);
  });
}

/**
 * Create a block-scoped function that stores the current location hash of the
 * pdf viewer in the currently active tab.
 */
export function useUpdateCurrentTab() {
  const pdf = usePdfDocument();
  const [rootViewer] = pdf.state.signals.rootViewer;
  const [activeTabId] = pdf.state.signals.activeTabId;
  const [tabs, setTabs] = pdf.state.stores.tabData;
  const currentPageNumber = pdf.state.derived.currentPageNumber;
  return createCallback(() => {
    const viewer = rootViewer();
    if (!viewer) return;

    const index = tabs.findIndex((tab) => tab.id === activeTabId());
    if (index === -1) return;
    setTabs(index, 'label', `Page ${currentPageNumber()}`);
    const locationHash = viewer.getLocationHash();
    if (locationHash) setTabs(index, 'locationHash', locationHash);
  });
}

/**
 * Create a block-scoped function that creates a new tab.
 */
export function useCreateTab() {
  const pdf = usePdfDocument();
  const navigateToTab = useNavigateToTab();
  const [tabId, setTabId] = pdf.state.signals.tabId;
  const [, setActiveTabId] = pdf.state.signals.activeTabId;
  const [, setShowTabBar] = pdf.state.signals.showTabBar;
  const [tabs, setTabs] = pdf.state.stores.tabData;
  const [rootViewer] = pdf.state.signals.rootViewer;
  const currentPageNumber = pdf.state.derived.currentPageNumber;

  return createCallback((info?: { label: string; locationHash: string }) => {
    if (pdf.isNested()) return;

    const viewer = rootViewer();
    if (!viewer) return;

    setTabId((previous) => previous + 1);
    const newId = tabId();
    setTabs([
      ...tabs,
      {
        locationHash: info?.locationHash ?? viewer.getLocationHash() ?? '',
        label: info?.label ?? `Page ${currentPageNumber()}`,
        id: newId,
      },
    ]);
    setShowTabBar(true);
    navigateToTab(newId);
    setActiveTabId(newId);
  });
}

/**
 * Create a block-scoped function that resets tab state.
 */
export function useClearTabs() {
  const pdf = usePdfDocument();
  const [, setActiveTabId] = pdf.state.signals.activeTabId;
  const [, setTabHistory] = pdf.state.signals.tabHistory;
  const [, setTabId] = pdf.state.signals.tabId;
  const [, setTabData] = pdf.state.stores.tabData;
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
  const pdf = usePdfDocument();
  const [tabs, setTabs] = pdf.state.stores.tabData;
  const [tabHistory, setTabHistory] = pdf.state.signals.tabHistory;
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
  const [tabs] = usePdfDocument().state.stores.tabData;
  return createCallback(() => tabs.length);
}
