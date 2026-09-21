import { ENABLE_PDF_TABS } from '@core/constant/featureFlags';
import { createCallback } from '@solid-primitives/rootless';
import { usePdfDocument } from '../context/pdf-document-context';
import { usePdfViewer } from '../context/pdf-viewer-context';

const TOP_PADDING = 0.2;

export const MAX_TAB_COUNT = 8;

export function useGoToLocationHash() {
  const rootViewer = usePdfViewer().root.instance;
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
  const rootViewer = usePdfViewer().root.instance;
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

export function useNavigateToTab() {
  const pdf = usePdfDocument();
  const pdfViewer = usePdfViewer();
  const updateCurrentTab = useUpdateCurrentTab();
  const rootViewer = pdfViewer.root.instance;

  return createCallback((id: number) => {
    const viewer = rootViewer();
    if (!viewer) return;

    updateCurrentTab();
    const tab = pdf.tabs.items.find((tab) => tab.id === id);
    if (tab === undefined) {
      return;
    }
    tab.locationHash && viewer.goToLocationHash(tab.locationHash);
    pdf.tabs.commands.activate(id);
  });
}

export function useUpdateCurrentTab() {
  const pdf = usePdfDocument();
  const pdfViewer = usePdfViewer();
  const rootViewer = pdfViewer.root.instance;
  const currentPageNumber = pdfViewer.root.currentPageNumber;
  return createCallback(() => {
    const viewer = rootViewer();
    if (!viewer) return;

    pdf.tabs.commands.updateCurrent({
      label: `Page ${currentPageNumber()}`,
      locationHash: viewer.getLocationHash() ?? undefined,
    });
  });
}

export function useCreateTab() {
  const pdf = usePdfDocument();
  const pdfViewer = usePdfViewer();
  const navigateToTab = useNavigateToTab();
  const rootViewer = pdfViewer.root.instance;
  const currentPageNumber = pdfViewer.root.currentPageNumber;

  return createCallback((info?: { label: string; locationHash: string }) => {
    if (pdf.isNested()) return;

    const viewer = rootViewer();
    if (!viewer) return;

    const newId = pdf.tabs.commands.create({
      locationHash: info?.locationHash ?? viewer.getLocationHash() ?? '',
      label: info?.label ?? `Page ${currentPageNumber()}`,
    });
    navigateToTab(newId);
  });
}

export function useDeleteTab() {
  const pdf = usePdfDocument();
  const navigateToTab = useNavigateToTab();

  return createCallback((id: number) => {
    const nextId = pdf.tabs.commands.remove(id);
    navigateToTab(nextId);
  });
}

export function useTabCount() {
  return usePdfDocument().tabs.count;
}
