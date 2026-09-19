import { createContext, type ParentComponent, useContext } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { PDFViewer } from '../PdfViewer';

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

export const useGetRootViewer = () => {
  const [viewer] = usePdfDocument().state.signals.rootViewer;
  return () => viewer();
};

export const useGetPopupViewer = () => {
  const [viewer] = usePdfDocument().state.signals.popupViewer;
  return () => viewer();
};

export const useGetPopupContextViewer = () => {
  const getRootViewer = useGetRootViewer();
  const getPopupViewer = useGetPopupViewer();
  const isPopup = useIsPopup();
  return () => (isPopup ? getPopupViewer() : getRootViewer());
};

// NOTE: this fires off on every change because the isEqual function is not working
export const useVisiblePages = () => {
  const { visiblePagesChanged, visiblePagesChangedPopup } =
    usePdfDocument().state.signals;
  const isPopup = useIsPopup();
  const [visiblePages] = isPopup
    ? visiblePagesChangedPopup
    : visiblePagesChanged;
  return () => visiblePages()?.visiblePages;
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
  const { overlayViewsChanged, overlayViewsChangedPopup } =
    usePdfDocument().state.signals;
  const isPopup = useIsPopup();
  return () =>
    isPopup ? overlayViewsChangedPopup[0]() : overlayViewsChanged[0]();
};

export const useCurrentPageNumber = () => {
  const currentPageNumber = usePdfDocument().state.derived.currentPageNumber;
  return () => currentPageNumber() ?? 1;
};

// /** reactive values based on current page dimensions */
export const useCurrentPageViewport = () => {
  const pdf = usePdfDocument();
  const isPopup = useIsPopup();
  const getViewer = useGetPopupContextViewer();
  const { currentPageNumber, popupCurrentPageNumber, viewerReady } =
    pdf.state.derived;

  return () => {
    const curPage = isPopup ? popupCurrentPageNumber() : currentPageNumber();
    const viewer = getViewer();
    if (!viewerReady() || !viewer || curPage == null || curPage < 1)
      return PAGE_VIEWPORT_DEFAULT;
    return viewer.pageViewport(curPage - 1) ?? PAGE_VIEWPORT_DEFAULT;
  };
};

export const useCurrentScale = () => {
  const { currentScale, popupCurrentScale } = usePdfDocument().state.derived;
  const isPopup = useIsPopup();
  return () => {
    return (isPopup ? popupCurrentScale() : currentScale()) ?? 1;
  };
};
