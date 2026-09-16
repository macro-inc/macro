import '../PdfViewer/pdf_viewer.css';

import type { PDFViewer } from '@block-pdf/PdfViewer';
import { ZOOM_MAX, ZOOM_MIN } from '@block-pdf/PdfViewer/zoom';
import { useGoToLocationHash } from '@block-pdf/signal/tab';
import { usePdfCommentEffects } from '@block-pdf/store/comments/commentEffect';
import { getPdfPageRect } from '@block-pdf/util/pdfjsUtils';
import {
  extractSelectionText,
  isMultiPageSelection,
  useResetSelection,
} from '@block-pdf/util/selectionUtils';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import {
  ENABLE_PDF_LOCATION_AUTOSAVE,
  ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE,
} from '@core/constant/featureFlags';
import { IS_MAC } from '@core/constant/isMac';
import { observedSize } from '@core/directive/observedSize';
import { isInDOMRect } from '@core/util/rect';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import { cn } from '@ui';
import {
  createDeferred,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { usePdfDocument } from '../context/pdf-document-context';
import { PageModel } from '../model/Page';
import { useGoToLinkLocation } from '../signal/location';
import {
  initializePdfViewer,
  useIsPopup,
  ViewerPopupProvider,
} from '../signal/pdfViewer';
import { usePdfSaveLocation, useSaveModificationData } from '../signal/save';
import { useLoadAnnotations } from '../store/annotations';
import { useSetSelectionHighlights } from '../store/highlight';
import { type IPageOverlayProps, PageOverlay } from './PageOverlay';
import { SimpleSearch } from './SimpleSearch';

false && observedSize;

const CSS = 96.0;
const PDF = 72.0;
const PDF_TO_CSS_UNITS = CSS / PDF;

function InnerDocument() {
  const { state } = usePdfDocument();
  const isPopup = useIsPopup();
  const getViewer = () =>
    isPopup ? state.signals.popupViewer[0]() : state.signals.rootViewer[0]();

  // attach new tab listeners
  const goToLocationHash = useGoToLocationHash();

  // TODO (seamus) : Chatted with Rithy. Manual cleanup should not be
  // needed here, but currently a new 'openInNewTab' subscriber is created
  // everytime we nevigate from pdf block -> pdf block without old ones being
  // removed.
  let cleanupNewTabHandler: () => void = () => {};
  createEffect(() => {
    const viewer = getViewer();
    if (!viewer) return;
    cleanupNewTabHandler = viewer.handlePDFEvent('openNewTab', (event) => {
      goToLocationHash(event.locationHash, true);
    });
  });

  onCleanup(() => {
    cleanupNewTabHandler();
    cleanupNewTabHandler = () => {};
  });

  // watch the overlays and send the contents to be rendered by PDFViewer
  createEffect(() => {
    const overlays = state.signals.overlays[0]();
    if (!overlays || overlays.length === 0) return;
    getViewer()?.setOverlays(overlays);
  });

  if (!isPopup) {
    usePdfCommentEffects();
  }
  const showOverlays = createMemo(
    () =>
      (isPopup ? state.derived.popupOpen() : true) &&
      state.derived.viewerReady()
  );
  const overlayViewsChanged = isPopup
    ? state.signals.overlayViewsChangedPopup[0]
    : state.signals.overlayViewsChanged[0];

  const pageOverlays = () => {
    const pageViews = createMemo<IPageOverlayProps[]>(
      (prev) => {
        const event = overlayViewsChanged();
        if (!event) return [];

        const newPageViews: IPageOverlayProps[] = [];
        event.views.forEach((view) => {
          const pageIndex = view.id - 1;
          const cachedPageView = prev[pageIndex];
          const pageViewDiv = view.div;
          const viewport = view.textLayer?.viewport ?? view.viewport;

          // Use the cached page view if it exists and nothing changed
          if (
            cachedPageView &&
            cachedPageView.pageViewDiv === pageViewDiv &&
            cachedPageView.viewport === viewport
          ) {
            newPageViews[pageIndex] = cachedPageView;
            return;
          }

          newPageViews[pageIndex] = {
            pageIndex,
            pageViewDiv,
            viewport,
          };
        });

        return newPageViews;
      },
      [],
      { equals: false }
    );

    return (
      <For each={pageViews()}>
        {(pageView) => {
          if (!pageView) return '';
          const { pageIndex, pageViewDiv, viewport } = pageView;
          const container = getViewer()?.pageOverlayContainersByPage[pageIndex];
          if (!container) return '';

          return (
            <Portal mount={container}>
              <PageOverlay
                pageIndex={pageIndex}
                viewport={viewport}
                pageViewDiv={pageViewDiv}
              />
            </Portal>
          );
        }}
      </For>
    );
  };

  return <Show when={showOverlays()}>{pageOverlays()}</Show>;
}

/** Shows the document loading spinner without unloading the PDF Viewer */
function LoadingDocumentSpinnerEffect() {
  const viewerHasVisiblePages =
    usePdfDocument().state.signals.viewerHasVisiblePages[0];
  return (
    <Show when={!viewerHasVisiblePages()}>
      <div class="flex absolute size-full z-viewer-document-loading-spinner">
        <div class="absolute top-1/2 left-1/2 transform -translate-1/2">
          <LoadingSpinner />
        </div>
      </div>
    </Show>
  );
}

export function Document() {
  const pdf = usePdfDocument();
  const { signals, stores, derived } = pdf.state;
  const [documentSize, setDocumentSize] = createSignal<DOMRect>();
  const [documentContainerRef, setDocumentContainerRef] =
    createSignal<HTMLDivElement>();
  const [destroying, setDestroying] = signals.destroying;
  const [getRootViewer, setRootViewer] = signals.rootViewer;
  const [getPopupViewer, setPopupViewer] = signals.popupViewer;
  const disableClick = signals.disableOverlayClick[0];
  const setIsSelecting = signals.isSelectingViewerText[1];
  const blockElement = pdf.rootElement;

  const attachViewerSignals = (viewer: PDFViewer, isPopup: boolean) => {
    if (isPopup) {
      viewer.event.on('scalechanging', signals.scaleChangingPopup[1]);
      viewer.event.on('pagechanging', signals.pageChangingPopup[1]);
      viewer.event.on(
        'overlayViewsChanged',
        signals.overlayViewsChangedPopup[1]
      );
      viewer.event.on('updateviewarea', signals.visiblePagesChangedPopup[1]);
      return;
    }

    viewer.event.on('pagesloaded', signals.pagesLoaded[1]);
    viewer.event.on('scalechanging', signals.scaleChanging[1]);
    viewer.event.on('pagechanging', signals.pageChanging[1]);
    viewer.event.on('overlayViewsChanged', signals.overlayViewsChanged[1]);
    viewer.event.on(
      'popupvisibilitychanged',
      signals.popupVisibilityChanged[1]
    );
    viewer.event.on('updateviewarea', signals.visiblePagesChanged[1]);
    viewer.event.on(
      'updatefindcontrolstate',
      signals.updateFindControlState[1]
    );
    viewer.event.on(
      'updatefindmatchescount',
      signals.updateFindMatchesCount[1]
    );
  };

  const detachViewerSignals = (viewer: PDFViewer, isPopup: boolean) => {
    if (isPopup) {
      viewer.event.off('scalechanging', signals.scaleChangingPopup[1]);
      viewer.event.off('pagechanging', signals.pageChangingPopup[1]);
      viewer.event.off(
        'overlayViewsChanged',
        signals.overlayViewsChangedPopup[1]
      );
      viewer.event.off('updateviewarea', signals.visiblePagesChangedPopup[1]);
      signals.scaleChangingPopup[1](undefined);
      signals.pageChangingPopup[1](undefined);
      signals.overlayViewsChangedPopup[1](undefined);
      signals.visiblePagesChangedPopup[1](undefined);
      return;
    }

    viewer.event.off('pagesloaded', signals.pagesLoaded[1]);
    viewer.event.off('scalechanging', signals.scaleChanging[1]);
    viewer.event.off('pagechanging', signals.pageChanging[1]);
    viewer.event.off('overlayViewsChanged', signals.overlayViewsChanged[1]);
    viewer.event.off(
      'popupvisibilitychanged',
      signals.popupVisibilityChanged[1]
    );
    viewer.event.off('updateviewarea', signals.visiblePagesChanged[1]);
    viewer.event.off(
      'updatefindcontrolstate',
      signals.updateFindControlState[1]
    );
    viewer.event.off(
      'updatefindmatchescount',
      signals.updateFindMatchesCount[1]
    );
    signals.pagesLoaded[1](undefined);
    signals.scaleChanging[1](undefined);
    signals.pageChanging[1](undefined);
    signals.overlayViewsChanged[1](undefined);
    signals.popupVisibilityChanged[1](undefined);
    signals.visiblePagesChanged[1](undefined);
    signals.updateFindControlState[1](undefined);
    signals.updateFindMatchesCount[1](undefined);
  };

  let rootViewer: PDFViewer | undefined;
  let popupViewer: PDFViewer | undefined;

  createRenderEffect(() => {
    if (destroying()) return;

    if (getRootViewer() || getPopupViewer()) return;

    popupViewer = initializePdfViewer();
    rootViewer = initializePdfViewer(popupViewer);
    attachViewerSignals(rootViewer, false);
    attachViewerSignals(popupViewer, true);

    setPopupViewer(popupViewer);
    setRootViewer(rootViewer);
  });

  let mountRef: HTMLDivElement | undefined;
  createEffect(() => {
    const blockEl = blockElement();
    if (!blockEl) return;
    const viewer = getRootViewer();
    const size = documentSize();
    if (!size) return;
    // wait for valid dimensions
    if (size.width === 0 || size.height === 0) {
      return;
    }
    if (!mountRef || !viewer || viewer.isMounted) return;
    viewer.mount(mountRef, blockEl);
  });

  onCleanup(() => {
    setDestroying(true);

    popupViewer && detachViewerSignals(popupViewer, true);

    if (!rootViewer) {
      console.warn('unable to detach signals');
      return;
    }

    detachViewerSignals(rootViewer, false);

    rootViewer
      .destroy()
      .then(() => {})
      .finally(() => {
        popupViewer = undefined;
        rootViewer = undefined;
        setRootViewer(undefined);
        setPopupViewer(undefined);
        setDestroying(false);
      });
  });

  const saveModificationData = useSaveModificationData();
  const canSaveModificationData = pdf.permissions.canEdit;

  const loadAnnotations = useLoadAnnotations();
  const serverModificationData = signals.serverModificationData[0];
  const hasServerModificationData = () => !!serverModificationData();
  const updateModificationDataOnLoad = () =>
    canSaveModificationData() && !hasServerModificationData();

  createEffect((prevDocumentId) => {
    const rootPdfViewer = getRootViewer();
    const popupPdfViewer = getPopupViewer();
    if (!rootPdfViewer || !popupPdfViewer) return;

    const documentProxy = signals.documentProxy[0]();
    const modificationData = stores.modificationData[0];

    if (documentProxy) {
      const annotationsPromise = loadAnnotations(
        documentProxy,
        modificationData
      );

      if (updateModificationDataOnLoad()) {
        annotationsPromise.then(saveModificationData);
      }

      const documentId = pdf.documentId();
      if (documentId === prevDocumentId) return documentId;

      rootPdfViewer.load(documentProxy);
      popupPdfViewer.load(documentProxy);

      return documentId;
    }

    return prevDocumentId;
  });

  const resetSelection = useResetSelection();
  const setSelectionHighlights = useSetSelectionHighlights();

  const invalidSelection = (selection: Selection) =>
    selection.type !== 'Range' ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.getRangeAt(0) ||
    selection.getRangeAt(0).collapsed;

  const isPopupOpen = createMemo(derived.popupOpen);
  const setGeneralPopupLocation = signals.generalPopupLocation[1];
  const setLocationStore = stores.location[1];

  const handleSelection = async (selection: Selection, pageIndex: number) => {
    const viewer = getRootViewer();
    if (!viewer) return;

    if (isPopupOpen() || invalidSelection(selection)) {
      resetSelection(selection);
      return;
    }

    const overlay = viewer.generateOverlayForSelection(pageIndex, selection);
    if (!overlay) {
      resetSelection(selection);
      return;
    }

    const { element, location } = overlay;

    const pageNum = pageIndex + 1;
    const pdfPageRect = getPdfPageRect({ pageNum, viewer });
    const selectionRect = element.getBoundingClientRect();
    if (
      !pdfPageRect ||
      !isInDOMRect(
        pdfPageRect,
        selectionRect.x + selectionRect.width / 2,
        selectionRect.y + selectionRect.height / 2
      )
    ) {
      resetSelection(selection);
      return;
    }

    const selectionString = selection.toString();
    if (selectionString.trim().length === 0) {
      setLocationStore('annotation', undefined);
      setLocationStore('precise', undefined);
      return;
    }
    // let shouldHandleDefinition = isValidTerm(selectionString);

    setLocationStore('annotation', undefined);
    setLocationStore('precise', {
      type: 'precise',
      pageIndex: pageIndex + 1,
      ...location,
    });

    setSelectionHighlights(selection);

    // set anchor element for the definition popup
    setGeneralPopupLocation({ pageIndex, element });
  };

  const selectionHandler: JSX.EventHandler<
    HTMLDivElement,
    MouseEvent | TouchEvent
  > = createCallback((e) => {
    setIsSelecting(false);

    if (!(e.target instanceof HTMLElement)) return;

    const sel = document.getSelection();
    if (!sel) return;

    const pageIndex = PageModel.getPageIndex(e.target);
    if (typeof pageIndex !== 'number') return;

    // Selection operations need to be delayed to avoid race conditions
    setTimeout(() => handleSelection(sel, pageIndex));
  });

  const onCopy = async (e: ClipboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const selection = window.getSelection();

    if (selection) {
      let text: string = isMultiPageSelection(selection)
        ? extractSelectionText(selection)
        : selection.toString();
      await navigator.clipboard.writeText(text);
    }
  };

  const selectionChangeHandler = () => {
    const sel = document.getSelection();
    if (!sel || invalidSelection(sel)) {
      resetSelection();
    }
  };

  const zoomHandler = createCallback((e: KeyboardEvent) => {
    if (IS_MAC ? !e.metaKey : !e.ctrlKey) return;
    const viewer = getRootViewer();
    if (!viewer) return;

    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        if (derived.canZoomIn()) viewer.zoomIn();
        break;
      case '_':
      case '-':
        e.preventDefault();
        if (derived.canZoomOut()) viewer.zoomOut();
        break;
      case 'PageUp':
      case 'ArrowLeft':
        e.preventDefault();
        viewer.previousPage();
        break;
      case 'PageDown':
      case 'ArrowRight':
        e.preventDefault();
        viewer.nextPage();
        break;
    }
  });

  onMount(() => {
    if (pdf.isNested()) return;

    blockElement()?.addEventListener('selectionchange', selectionChangeHandler);
    onCleanup(() => {
      blockElement()?.removeEventListener(
        'selectionchange',
        selectionChangeHandler
      );
    });
  });

  createEffect(() => {
    if (pdf.isNested()) return;

    const element = blockElement();
    if (!element) return;

    element.addEventListener('copy', onCopy);
    element.addEventListener('keydown', zoomHandler);

    onCleanup(() => {
      element.removeEventListener('copy', onCopy);
      element.removeEventListener('keydown', zoomHandler);
    });
  });

  const [mouseDown, setMouseDown] = createSignal(false);
  createEffect(() => {
    if (pdf.isNested()) return;

    const element = documentContainerRef();
    if (!element) return;

    const mouseDownHandler = () => {
      setMouseDown(true);
    };

    const setMouseUp = () => {
      setIsSelecting(false);
      setMouseDown(false);
    };

    const selectStartHandler = () => {
      if (!mouseDown()) return;
      setIsSelecting(true);
    };

    element.addEventListener('mousedown', mouseDownHandler);
    element.addEventListener('mousemove', selectStartHandler);
    blockElement()?.addEventListener('mouseup', setMouseUp);

    onCleanup(() => {
      element.removeEventListener('mousedown', mouseDownHandler);
      element.removeEventListener('mousemove', selectStartHandler);
      blockElement()?.removeEventListener('mouseup', setMouseUp);
    });
  });

  const goToLinkLocation = useGoToLinkLocation();
  createEffect(() => {
    if (signals.locationChanged[0]() || !derived.viewerReady()) return;
    goToLinkLocation(pdf.locationParams());
  });

  const [initialized, setInitialized] = createSignal(false);
  createEffect(
    on(
      documentSize,
      (currentSize, prevSize) => {
        const viewer = getRootViewer();
        if (
          !viewer ||
          !initialized() ||
          !currentSize ||
          !prevSize ||
          currentSize.width === 0 ||
          prevSize.width === 0
        )
          return;

        const currentPage = derived.currentPageNumber();
        const pdfDimensions = viewer.pageViewport(currentPage);
        if (!pdfDimensions) return;

        const ratio = pdfDimensions.width / prevSize.width;
        const { pageWidth, width } = pdfDimensions;
        let zoomScale =
          (currentSize.width / (pageWidth * PDF_TO_CSS_UNITS)) * ratio;
        if (
          currentSize.width > width + 30 &&
          currentSize.width < prevSize.width
        ) {
          return;
        } else if (currentSize.width < prevSize.width) {
          zoomScale = (currentSize.width - 30) / (pageWidth * PDF_TO_CSS_UNITS);
        }

        if (prevSize.width > 1000 && currentSize.width > prevSize.width) return;

        let fitWidthScale = Math.max(Math.min(zoomScale, ZOOM_MAX), ZOOM_MIN);

        // Huh? (seamus) – reduce the precision of this ratio to prevent it from
        // being treated as a to string somewhere in pdf.js internals. Without
        // this, viewer.location.scale is a string after this call is directed
        // to _viewer._setScale() as a number.
        fitWidthScale = Math.floor(fitWidthScale * 10e5) / 10e5;
        viewer.zoomReset(fitWidthScale, false);
      },
      { defer: true }
    )
  );

  createEffect(() => {
    setLocationStore('general', {
      type: 'general',
      pageIndex: derived.currentPageNumber(),
      y: 0,
    });
  });

  if (ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE && !pdf.isNested()) {
    const isSaving = createDeferred(signals.isSaving[0]);
    const currentOperations = createDeferred(signals.numOperations[0]);
    const [savedOperations, setSavedOperations] = createSignal(0);
    const setSaveRequired = signals.modificationDataSaveRequired[1];
    createEffect(() => {
      if (isSaving()) return;

      const currOps = currentOperations();
      const savedOps = savedOperations();
      if (currOps > savedOps) {
        setSaveRequired(true);
      } else {
        setSaveRequired(false);
        return;
      }

      saveModificationData().then(() => setSavedOperations(currOps));
    });
  }

  // TODO: hacky location autosave that works on page refresh
  // without requiring a confirm dialog
  if (ENABLE_PDF_LOCATION_AUTOSAVE && !pdf.isNested()) {
    const isSaving = createDeferred(signals.isSaving[0]);
    const viewChanged = createDeferred(signals.visiblePagesChanged[0]);
    const saveLocation = usePdfSaveLocation();
    const debouncedSaveLocation = debounce(saveLocation, 1000);

    createEffect(() => {
      // listen to root viewer changed view area
      // e.g. scroll, zoom, go to, etc.
      viewChanged();

      if (untrack(isSaving)) return;

      debouncedSaveLocation();
    });
  }

  return (
    <>
      <Show when={!pdf.isNested()}>
        <div class="absolute top-4 right-4 z-simple-search">
          <SimpleSearch />
        </div>
      </Show>
      <LoadingDocumentSpinnerEffect />
      <ViewerPopupProvider>
        <div
          use:observedSize={{
            setSize: setDocumentSize,
            setInitialized: setInitialized,
          }}
          class={cn(
            'size-full relative outline-none',
            disableClick() && 'noClickParse'
          )}
          ref={(ref) => {
            mountRef = ref;
            setDocumentContainerRef(ref);
          }}
          onMouseUp={selectionHandler}
          onTouchEnd={selectionHandler}
        >
          This is where the document should go!
        </div>
        <InnerDocument />
        <Show when={!pdf.isNested()}>
          <ViewerPopupProvider isPopup>
            <InnerDocument />
          </ViewerPopupProvider>
        </Show>
      </ViewerPopupProvider>
    </>
  );
}

export default Document;

if (import.meta.hot) {
  import('./PageOverlay');
}
