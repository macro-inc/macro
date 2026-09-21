import { batch, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { PDFViewer } from '../PdfViewer';
import type { TEvents } from '../PdfViewer/EventBus';
import { ZOOM_MAX, ZOOM_MIN } from '../PdfViewer/zoom';

type ViewerPair = {
  root: PDFViewer;
  popup: PDFViewer;
};

export function createPdfViewerRuntime() {
  const [pair, setPair] = createSignal<ViewerPair>();
  const [overlays, setOverlays] = createSignal<string[]>();
  const [rootCurrentPageNumber, setRootCurrentPageNumber] = createSignal(1);
  const [rootCurrentScale, setRootCurrentScale] = createSignal<number>();
  const [rootPageCount, setRootPageCount] = createSignal<number>();
  const [rootOverlayViews, setRootOverlayViews] =
    createSignal<TEvents['overlayViewsChanged']>();
  const [rootViewArea, setRootViewArea] =
    createSignal<TEvents['updateviewarea']>();
  const [rootFindControlState, setRootFindControlState] =
    createSignal<TEvents['updatefindcontrolstate']>();
  const [rootFindMatchesCount, setRootFindMatchesCount] =
    createSignal<TEvents['updatefindmatchescount']>();
  const [rootPageHeights, setRootPageHeights] = createStore<
    Partial<Record<number, number>>
  >({});
  const [popupCurrentPageNumber, setPopupCurrentPageNumber] = createSignal(1);
  const [popupCurrentScale, setPopupCurrentScale] = createSignal<number>();
  const [popupOverlayViews, setPopupOverlayViews] =
    createSignal<TEvents['overlayViewsChanged']>();
  const [popupViewArea, setPopupViewArea] =
    createSignal<TEvents['updateviewarea']>();
  const [isPopupOpen, setIsPopupOpen] = createSignal(false);

  const onRootPagesLoaded = (event: TEvents['pagesloaded']) => {
    setRootPageCount(event.pagesCount);
  };
  const onRootScaleChanging = (event: TEvents['scalechanging']) => {
    setRootCurrentScale(event.scale);
  };
  const onRootPageChanging = (event: TEvents['pagechanging']) => {
    setRootCurrentPageNumber(event.pageNumber);
  };
  const onRootOverlayViewsChanged = (event: TEvents['overlayViewsChanged']) => {
    const updated: Partial<Record<number, number>> = {};
    for (const pageView of event.views) {
      updated[pageView.id - 1] = pageView.viewport.height;
    }
    batch(() => {
      setRootOverlayViews(event);
      setRootPageHeights(reconcile(updated));
    });
  };
  const onPopupVisibilityChanged = (
    event: TEvents['popupvisibilitychanged']
  ) => {
    setIsPopupOpen(event.isOpen);
  };
  const onRootViewArea = (event: TEvents['updateviewarea']) => {
    setRootViewArea(event);
  };
  const onRootFindControlState = (event: TEvents['updatefindcontrolstate']) => {
    setRootFindControlState(event);
  };
  const onRootFindMatchesCount = (event: TEvents['updatefindmatchescount']) => {
    setRootFindMatchesCount(event);
  };
  const onPopupScaleChanging = (event: TEvents['scalechanging']) => {
    setPopupCurrentScale(event.scale);
  };
  const onPopupPageChanging = (event: TEvents['pagechanging']) => {
    setPopupCurrentPageNumber(event.pageNumber);
  };
  const onPopupOverlayViewsChanged = (
    event: TEvents['overlayViewsChanged']
  ) => {
    setPopupOverlayViews(event);
  };
  const onPopupViewArea = (event: TEvents['updateviewarea']) => {
    setPopupViewArea(event);
  };

  const attachRootListeners = (viewer: PDFViewer) => {
    viewer.event.on('pagesloaded', onRootPagesLoaded);
    viewer.event.on('scalechanging', onRootScaleChanging);
    viewer.event.on('pagechanging', onRootPageChanging);
    viewer.event.on('overlayViewsChanged', onRootOverlayViewsChanged);
    viewer.event.on('popupvisibilitychanged', onPopupVisibilityChanged);
    viewer.event.on('updateviewarea', onRootViewArea);
    viewer.event.on('updatefindcontrolstate', onRootFindControlState);
    viewer.event.on('updatefindmatchescount', onRootFindMatchesCount);
  };

  const attachPopupListeners = (viewer: PDFViewer) => {
    viewer.event.on('scalechanging', onPopupScaleChanging);
    viewer.event.on('pagechanging', onPopupPageChanging);
    viewer.event.on('overlayViewsChanged', onPopupOverlayViewsChanged);
    viewer.event.on('updateviewarea', onPopupViewArea);
  };

  const detachPopupListeners = (viewer: PDFViewer) => {
    viewer.event.off('scalechanging', onPopupScaleChanging);
    viewer.event.off('pagechanging', onPopupPageChanging);
    viewer.event.off('overlayViewsChanged', onPopupOverlayViewsChanged);
    viewer.event.off('updateviewarea', onPopupViewArea);
    setPopupCurrentScale(undefined);
    setPopupCurrentPageNumber(1);
    setPopupOverlayViews(undefined);
    setPopupViewArea(undefined);
  };

  const detachRootListeners = (viewer: PDFViewer) => {
    viewer.event.off('pagesloaded', onRootPagesLoaded);
    viewer.event.off('scalechanging', onRootScaleChanging);
    viewer.event.off('pagechanging', onRootPageChanging);
    viewer.event.off('overlayViewsChanged', onRootOverlayViewsChanged);
    viewer.event.off('popupvisibilitychanged', onPopupVisibilityChanged);
    viewer.event.off('updateviewarea', onRootViewArea);
    viewer.event.off('updatefindcontrolstate', onRootFindControlState);
    viewer.event.off('updatefindmatchescount', onRootFindMatchesCount);
    setRootPageCount(undefined);
    setRootCurrentScale(undefined);
    setRootCurrentPageNumber(1);
    setRootOverlayViews(undefined);
    setIsPopupOpen(false);
    setRootViewArea(undefined);
    setRootFindControlState(undefined);
    setRootFindMatchesCount(undefined);
  };

  const commands = {
    installPair(viewers: ViewerPair) {
      attachRootListeners(viewers.root);
      attachPopupListeners(viewers.popup);
      setPair(viewers);
    },
    detachListeners() {
      const viewers = pair();
      if (!viewers) return;
      detachPopupListeners(viewers.popup);
      detachRootListeners(viewers.root);
    },
    clearPair() {
      setPair(undefined);
    },
    replaceOverlays(value: string[]) {
      setOverlays(value);
    },
  };

  return {
    root: {
      instance: () => pair()?.root,
      currentPageNumber: rootCurrentPageNumber,
      currentScale: rootCurrentScale,
      pageCount: rootPageCount,
      isReady: () => {
        const count = rootPageCount();
        return count != null && count > 0;
      },
      hasVisiblePages: () => {
        const ids = rootViewArea()?.visiblePages.ids;
        return ids != null && ids.size > 0;
      },
      canZoomIn: () => {
        const scale = rootCurrentScale();
        return !!(scale && scale < ZOOM_MAX);
      },
      canZoomOut: () => {
        const scale = rootCurrentScale();
        return !!(scale && scale > ZOOM_MIN);
      },
      overlayViews: rootOverlayViews,
      viewArea: rootViewArea,
      findControlState: rootFindControlState,
      findMatchesCount: rootFindMatchesCount,
      pageHeights: rootPageHeights,
    },
    popup: {
      instance: () => pair()?.popup,
      currentPageNumber: popupCurrentPageNumber,
      currentScale: popupCurrentScale,
      overlayViews: popupOverlayViews,
      viewArea: popupViewArea,
    },
    isPopupOpen,
    overlays,
    ...commands,
  };
}

export type PdfViewerRuntime = ReturnType<typeof createPdfViewerRuntime>;
