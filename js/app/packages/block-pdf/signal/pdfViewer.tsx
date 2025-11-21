import {
  createBlockEffect,
  createBlockMemo,
  createBlockSignal,
  createBlockStore,
} from '@core/block';
import { setEquals } from '@core/util/compareUtils';
import {
  createContext,
  createMemo,
  type ParentComponent,
  useContext,
} from 'solid-js';
import { reconcile } from 'solid-js/store';
import { PDFViewer } from '../PdfViewer';
import type { IUpdateViewArea, TEvents } from '../PdfViewer/EventBus';
import { ZOOM_MAX, ZOOM_MIN } from '../PdfViewer/zoom';

type PageViewportWithScale = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  pageHeight: number;
  pageWidth: number;
  /** zoomed scale from PDF units to CSS units (ratio from view size pixels to PDF units) */
  viewScale: number;
  /** scale from zoom */
  relativeScale: number;
};
const PAGE_VIEWPORT_DEFAULT: PageViewportWithScale = {
  width: 0,
  height: 0,
  offsetX: 0,
  offsetY: 0,
  viewScale: 0,
  relativeScale: 0,
  pageHeight: 0,
  pageWidth: 0,
};

export const initializePdfViewer = (popupViewer?: PDFViewer) => {
  return new PDFViewer(popupViewer);
};

const popupPdfViewerSignal = createBlockSignal<PDFViewer | undefined>();
const rootPdfViewerSignal = createBlockSignal<PDFViewer | undefined>();

export const useSetRootViewer = () => {
  const set = rootPdfViewerSignal.set;
  return (viewer: PDFViewer | undefined) => set(viewer);
};

export const useSetPopupViewer = () => {
  const set = popupPdfViewerSignal.set;
  return (viewer: PDFViewer | undefined) => set(viewer);
};

export const useGetRootViewer = () => {
  const viewer = rootPdfViewerSignal.get;
  return () => viewer();
};

export const useGetPopupViewer = () => {
  const viewer = popupPdfViewerSignal.get;
  return () => viewer();
};

export const useGetPopupContextViewer = () => {
  const getRootViewer = useGetRootViewer();
  const getPopupViewer = useGetPopupViewer();
  const isPopup = useIsPopup();
  return () => (isPopup ? getPopupViewer() : getRootViewer());
};

// @ts-ignore
const _visiblePagesEqual = (prev?: IUpdateViewArea, next?: IUpdateViewArea) => {
  const isEqual =
    prev != null &&
    next != null &&
    !next.forceUpdate &&
    // checking for scale change allows change on zoom/resize
    (prev.location.viewportScale === next.location.viewportScale ||
      Math.abs(prev.location.viewportScale - next.location.viewportScale) <
        0.01) &&
    setEquals(prev.visiblePages.ids, next.visiblePages.ids);
  return isEqual;
};

const pagesLoadedSignal = createBlockSignal<TEvents['pagesloaded']>();
const scaleChangingSignal = createBlockSignal<TEvents['scalechanging']>();
const pageChangingSignal = createBlockSignal<TEvents['pagechanging']>();
const overlayViewsChangedSignal =
  createBlockSignal<TEvents['overlayViewsChanged']>();
const popupVisibilityChangedSignal =
  createBlockSignal<TEvents['popupvisibilitychanged']>();
export const visiblePagesChangedSignal = createBlockSignal<
  TEvents['updateviewarea'] | undefined
>();
export const updateFindControlStateSignal = createBlockSignal<
  TEvents['updatefindcontrolstate'] | undefined
>();
export const updateFindMatchesCountSignal = createBlockSignal<
  TEvents['updatefindmatchescount'] | undefined
>();

const scaleChangingPopupSignal = createBlockSignal<TEvents['scalechanging']>();
const pageChangingPopupSignal = createBlockSignal<TEvents['pagechanging']>();
const overlayViewsChangedPopupSignal =
  createBlockSignal<TEvents['overlayViewsChanged']>();
const visiblePagesChangedPopupSignal = createBlockSignal<
  TEvents['updateviewarea'] | undefined
>();

export const popupOpen = createBlockMemo(
  () => popupVisibilityChangedSignal()?.isOpen ?? false
);

export const currentPageNumber = createBlockMemo(
  () => pageChangingSignal()?.pageNumber ?? 1
);

// NOTE: this fires off on every change because the isEqual function is not working
export const useVisiblePages = () => {
  const isPopup = useIsPopup();
  const signal = isPopup
    ? visiblePagesChangedPopupSignal
    : visiblePagesChangedSignal;
  return () => signal()?.visiblePages;
};

const currentScale = createBlockMemo(() => scaleChangingSignal()?.scale);

export const canZoomIn = createBlockMemo(() => {
  const cs = currentScale();
  return !!(cs && cs < ZOOM_MAX);
});

export const canZoomOut = createBlockMemo(() => {
  const cs = currentScale();
  return !!(cs && cs > ZOOM_MIN);
});
export const pageCount = createBlockMemo(() => pagesLoadedSignal()?.pagesCount);

export const popupCurrentPageNumber = createBlockMemo(
  () => pageChangingPopupSignal()?.pageNumber ?? 1
);
export const popupCurrentScale = createBlockMemo(
  () => scaleChangingPopupSignal()?.scale
);

export const useAttachViewerSignals = () => {
  const setPagesLoaded = pagesLoadedSignal.set;
  const setScaleChanging = scaleChangingSignal.set;
  const setPageChanging = pageChangingSignal.set;
  const setOverlayViewsChanged = overlayViewsChangedSignal.set;
  const setPopupVisibilityChanged = popupVisibilityChangedSignal.set;
  const setVisiblePagesChanged = visiblePagesChangedSignal.set;
  const setUpdateFindControlState = updateFindControlStateSignal.set;
  const setUpdateFindMatchesCount = updateFindMatchesCountSignal.set;

  const setScaleChangingPopup = scaleChangingPopupSignal.set;
  const setPageChangingPopup = pageChangingPopupSignal.set;
  const setOverlayViewsChangedPopup = overlayViewsChangedPopupSignal.set;
  const setVisiblePagesChangedPopup = visiblePagesChangedPopupSignal.set;

  // For reasons unknown to me, using viewer.isPopup causes the signal to not update
  return (viewer: PDFViewer, isPopup: boolean) => {
    if (isPopup) {
      viewer.event.on('scalechanging', setScaleChangingPopup);
      viewer.event.on('pagechanging', setPageChangingPopup);
      viewer.event.on('overlayViewsChanged', setOverlayViewsChangedPopup);
      viewer.event.on('updateviewarea', setVisiblePagesChangedPopup);
      return;
    }

    viewer.event.on('pagesloaded', setPagesLoaded);
    viewer.event.on('scalechanging', setScaleChanging);
    viewer.event.on('pagechanging', setPageChanging);
    viewer.event.on('overlayViewsChanged', setOverlayViewsChanged);
    viewer.event.on('popupvisibilitychanged', setPopupVisibilityChanged);
    viewer.event.on('updateviewarea', setVisiblePagesChanged);
    viewer.event.on('updatefindcontrolstate', setUpdateFindControlState);
    viewer.event.on('updatefindmatchescount', setUpdateFindMatchesCount);
  };
};

export const useDetachViewerSignals = () => {
  const setPagesLoaded = pagesLoadedSignal.set;
  const setScaleChanging = scaleChangingSignal.set;
  const setPageChanging = pageChangingSignal.set;
  const setOverlayViewsChanged = overlayViewsChangedSignal.set;
  const setPopupVisibilityChanged = popupVisibilityChangedSignal.set;
  const setVisiblePagesChanged = visiblePagesChangedSignal.set;
  const setUpdateFindControlState = updateFindControlStateSignal.set;
  const setUpdateFindMatchesCount = updateFindMatchesCountSignal.set;

  const setScaleChangingPopup = scaleChangingPopupSignal.set;
  const setPageChangingPopup = pageChangingPopupSignal.set;
  const setOverlayViewsChangedPopup = overlayViewsChangedPopupSignal.set;
  const setVisiblePagesChangedPopup = visiblePagesChangedPopupSignal.set;

  return (viewer: PDFViewer, isPopup: boolean) => {
    if (isPopup) {
      viewer.event.off('scalechanging', setScaleChangingPopup);
      viewer.event.off('pagechanging', setPageChangingPopup);
      viewer.event.off('overlayViewsChanged', setOverlayViewsChangedPopup);
      viewer.event.off('updateviewarea', setVisiblePagesChangedPopup);
      setScaleChangingPopup(undefined);
      setPageChangingPopup(undefined);
      setOverlayViewsChangedPopup(undefined);
      setVisiblePagesChangedPopup(undefined);
      return;
    }

    viewer.event.off('pagesloaded', setPagesLoaded);
    viewer.event.off('scalechanging', setScaleChanging);
    viewer.event.off('pagechanging', setPageChanging);
    viewer.event.off('overlayViewsChanged', setOverlayViewsChanged);
    viewer.event.off('popupvisibilitychanged', setPopupVisibilityChanged);
    viewer.event.off('updateviewarea', setVisiblePagesChanged);
    viewer.event.off('updatefindcontrolstate', setUpdateFindControlState);
    viewer.event.off('updatefindmatchescount', setUpdateFindMatchesCount);

    setPagesLoaded(undefined);
    setScaleChanging(undefined);
    setPageChanging(undefined);
    setOverlayViewsChanged(undefined);
    setPopupVisibilityChanged(undefined);
    setVisiblePagesChanged(undefined);
    setUpdateFindControlState(undefined);
    setUpdateFindMatchesCount(undefined);
  };
};

const PopupContext = createContext<boolean>();
export const ViewerPopupProvider: ParentComponent<{ isPopup?: boolean }> = (
  props
) => (
  <PopupContext.Provider value={props.isPopup ?? false}>
    {props.children}
  </PopupContext.Provider>
);
export function useIsPopup() {
  const context = useContext(PopupContext);
  if (context === undefined) {
    throw new Error('useIsPopup: cannot find a ViewerPopupProvider');
  }

  return context;
}

export const useOverlayViewsChanged = () => {
  const isPopup = useIsPopup();
  const overlayViewsChangedPopupSignal_ = overlayViewsChangedPopupSignal.get;
  const overlayViewsChangedSignal_ = overlayViewsChangedSignal.get;
  return () =>
    isPopup ? overlayViewsChangedPopupSignal_() : overlayViewsChangedSignal_();
};

export const viewerHasVisiblePagesSignal = createBlockSignal<boolean>(false);

createBlockEffect(() => {
  const visiblePages = visiblePagesChangedSignal()?.visiblePages;
  const loadedIds = visiblePages?.ids;
  const hasVisiblePages = loadedIds ? loadedIds.size > 0 : false;
  viewerHasVisiblePagesSignal.set(hasVisiblePages);
});

// /** Indicates that all pages have been loaded */
export const viewerReadySignal = createBlockMemo(() => {
  const pagesLoaded = pagesLoadedSignal();
  if (!pagesLoaded) return false;
  return pagesLoaded.pagesCount > 0;
});

export const useCurrentPageNumber = () => {
  const getCurrentPageNumber = createMemo(currentPageNumber);
  return () => getCurrentPageNumber() ?? 1;
};

// /** reactive values based on current page dimensions */
export const useCurrentPageViewport = () => {
  const isPopup = useIsPopup();
  const getViewer = useGetPopupContextViewer();
  const getViewerReady = createMemo(viewerReadySignal);
  const getCurrentPageNumber = createMemo(currentPageNumber);
  const getPopupCurrentPageNumber = createMemo(popupCurrentPageNumber);

  return () => {
    const viewerReady = getViewerReady();
    const curPage = isPopup
      ? getPopupCurrentPageNumber()
      : getCurrentPageNumber();
    const viewer = getViewer();
    if (!viewerReady || !viewer || curPage == null || curPage < 1)
      return PAGE_VIEWPORT_DEFAULT;
    return viewer.pageViewport(curPage - 1) ?? PAGE_VIEWPORT_DEFAULT;
  };
};

export const useCurrentScale = () => {
  const isPopup = useIsPopup();
  const getCurrentScale = createMemo(currentScale);
  const getPopupCurrentScale = createMemo(popupCurrentScale);
  return () => {
    return (isPopup ? getPopupCurrentScale() : getCurrentScale()) ?? 1;
  };
};

type PageHeightStore = Partial<Record<number, number>>;
/** Maps page index to page height */
// TODO: in the future we can make this the entire viewport object but for now we only need the height
export const pageHeightStore = createBlockStore<PageHeightStore>({});

createBlockEffect(() => {
  const changeEvent = overlayViewsChangedSignal();
  if (!changeEvent) return;

  const updatedViewports: PageHeightStore = {};
  for (const pageView of Object.values(changeEvent.views)) {
    const pageIndex = pageView.id - 1;
    const viewport = pageView.viewport;
    updatedViewports[pageIndex] = viewport.height;
  }

  const setStore = pageHeightStore.set;
  setStore(reconcile(updatedViewports));
});

// export const useCurrentMaxPageWidth = () => {
//   const isPopup = useIsPopup();
//   const getViewer = useGetPopupContextViewer();
//   return () => {
//     const curPage = isPopup ? popupCurrentPageNumber() : currentPageNumber();
//     const viewer = getViewer();
//     if (!viewer || curPage == null) return 0;
//
//     const defaultViewport = {
//       width: 0,
//       height: 0,
//       offsetX: 0,
//       offsetY: 0,
//       viewScale: 0,
//       relativeScale: 0,
//       pageHeight: 0,
//       pageWidth: 0,
//     };
//
//     return [
//       viewer.pageViewport(curPage) ?? defaultViewport,
//       viewer.pageViewport(curPage - 1) ?? defaultViewport,
//       viewer.pageViewport(curPage + 1) ?? defaultViewport,
//     ]
//       .map((viewport) => viewport.width)
//       .sort((a, b) => b - a)[0];
//   };
// };
