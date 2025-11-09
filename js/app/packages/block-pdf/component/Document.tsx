import '../PdfViewer/pdf_viewer.css';

import type { PDFViewer } from '@block-pdf/PdfViewer';
import { ZOOM_MAX, ZOOM_MIN } from '@block-pdf/PdfViewer/zoom';
import {
  disableOverlayClickSignal,
  isSelectingViewerTextSignal,
} from '@block-pdf/signal/click';
import { useCanEditModificationData } from '@block-pdf/signal/permissions';
import { useGoToLocationHash } from '@block-pdf/signal/tab';
import { usePdfCommentEffects } from '@block-pdf/store/comments/commentEffect';
import { getPdfPageRect } from '@block-pdf/util/pdfjsUtils';
import {
  extractSelectionText,
  isMultiPageSelection,
  useResetSelection,
} from '@block-pdf/util/selectionUtils';
import { useBlockId, useIsNestedBlock } from '@core/block';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import {
  ENABLE_FORM_EDITING,
  ENABLE_PDF_LOCATION_AUTOSAVE,
  ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE,
} from '@core/constant/featureFlags';
import { IS_MAC } from '@core/constant/isMac';
import { observedSize } from '@core/directive/observedSize';
import { blockElementSignal } from '@core/signal/blockElement';
import { blockMetadataSignal } from '@core/signal/load';
import { tempRedirectLocation } from '@core/signal/location';
import { useReadOnly } from '@core/signal/permissions';
import { isInDOMRect } from '@core/util/rect';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import { useSearchParams } from '@solidjs/router';
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
import { PageModel } from '../model/Page';
import {
  pdfDocumentProxy,
  pdfModificationDataStore,
  pdfOverlays,
} from '../signal/document';
import {
  generalPopupLocationSignal,
  goToLinkLocation,
  type LocationSearchParams,
  locationChangedSignal,
  URL_PARAMS,
  useGoToTempRedirect,
  useSetLocationStore,
} from '../signal/location';
import {
  canZoomIn,
  canZoomOut,
  currentPageNumber,
  initializePdfViewer,
  popupOpen,
  useAttachViewerSignals,
  useDetachViewerSignals,
  useGetPopupContextViewer,
  useGetPopupViewer,
  useGetRootViewer,
  useIsPopup,
  useOverlayViewsChanged,
  useSetPopupViewer,
  useSetRootViewer,
  ViewerPopupProvider,
  viewerHasVisiblePagesSignal,
  viewerReadySignal,
  visiblePagesChangedSignal,
} from '../signal/pdfViewer';
import {
  isSaving as isSavingSignal,
  modificationDataSaveRequired,
  numOperations,
  serverModificationDataSignal,
  usePdfSaveLocation,
  useSaveModificationData,
} from '../signal/save';
import { useLoadAnnotations } from '../store/annotations';
import { useSetSelectionHighlights } from '../store/highlight';
import { type IPageOverlayProps, PageOverlay } from './PageOverlay';
import { SimpleSearch } from './SimpleSearch';

false && observedSize;

const CSS = 96.0;
const PDF = 72.0;
const PDF_TO_CSS_UNITS = CSS / PDF;

function InnerDocument() {
  const readOnly = useReadOnly();
  const getViewer = useGetPopupContextViewer();

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
    const overlays = pdfOverlays();
    if (!overlays || overlays.length === 0) return;
    getViewer()?.setOverlays(overlays);
  });

  // For PDF autosave we've disabled the annotation layer completely
  if (ENABLE_FORM_EDITING) {
    createEffect(() => {
      const viewer_ = getViewer();
      if (!viewer_ || !viewerReadySignal()) return;

      const isReadOnly = readOnly();

      const annotationSections = viewer_
        .container()
        .querySelectorAll('[data-annotation-id]');

      annotationSections.forEach((section) => {
        const inputs = section.querySelectorAll(
          'input, textarea, select, button'
        );

        inputs.forEach((input) => {
          if (
            input instanceof HTMLInputElement ||
            input instanceof HTMLTextAreaElement ||
            input instanceof HTMLSelectElement ||
            input instanceof HTMLButtonElement
          ) {
            input.disabled = isReadOnly;
            input.style.pointerEvents = isReadOnly ? 'none' : 'auto';
          }
        });
      });
    });
  }

  const isPopup = useIsPopup();
  if (!isPopup) {
    usePdfCommentEffects();
  }
  const showOverlays = createMemo(
    () => (isPopup ? popupOpen() : true) && viewerReadySignal()
  );
  const overlayViewsChanged = useOverlayViewsChanged();

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
  return (
    <Show when={!viewerHasVisiblePagesSignal()}>
      <div class="flex absolute w-full h-full z-viewer-document-loading-spinner">
        <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <LoadingSpinner />
        </div>
      </div>
    </Show>
  );
}

const [destroying, setDestroying] = createSignal(false);

export function Document() {
  const isNestedBlock = useIsNestedBlock();
  const [documentSize, setDocumentSize] = createSignal<DOMRect>();
  const [documentContainerRef, setDocumentContainerRef] =
    createSignal<HTMLDivElement>();
  const setRootViewer = useSetRootViewer();
  const setPopupViewer = useSetPopupViewer();
  const getRootViewer = useGetRootViewer();
  const getPopupViewer = useGetPopupViewer();
  const attachViewerSignals = useAttachViewerSignals();
  const detachViewerSignals = useDetachViewerSignals();
  const disableClick = disableOverlayClickSignal.get;
  const setIsSelecting = isSelectingViewerTextSignal.set;
  const blockElement = blockElementSignal.get;

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
    if (!documentSize()) return;
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
  const canSaveModificationData = useCanEditModificationData();

  const loadAnnotations = useLoadAnnotations();
  const serverModificationData = serverModificationDataSignal.get;
  const hasServerModificationData = () => !!serverModificationData();
  const updateModificationDataOnLoad = () =>
    canSaveModificationData() && !hasServerModificationData();

  createEffect((prevDocumentId) => {
    const rootPdfViewer = getRootViewer();
    const popupPdfViewer = getPopupViewer();
    if (!rootPdfViewer || !popupPdfViewer) return;

    const documentProxy = pdfDocumentProxy();
    const documentMetadata = blockMetadataSignal();
    const modificationData = pdfModificationDataStore.get;

    if (documentProxy && documentMetadata) {
      const annotationsPromise = loadAnnotations(
        documentProxy,
        modificationData
      );

      if (updateModificationDataOnLoad()) {
        annotationsPromise.then(saveModificationData);
      }

      const { documentId } = documentMetadata;
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

  const isPopupOpen = createMemo(() => popupOpen());
  const setGeneralPopupLocation = generalPopupLocationSignal.set;
  const setLocationStore = useSetLocationStore();

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
      setLocationStore('precise', undefined);
      return;
    }
    // let shouldHandleDefinition = isValidTerm(selectionString);

    setLocationStore('precise', {
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

  const zoomHandler: JSX.EventHandler<Document, KeyboardEvent> = createCallback(
    (e) => {
      if (IS_MAC ? !e.metaKey : !e.ctrlKey) return;
      const viewer = getRootViewer();
      if (!viewer) return;

      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          if (canZoomIn()) viewer.zoomIn();
          break;
        case '_':
        case '-':
          e.preventDefault();
          if (canZoomOut()) viewer.zoomOut();
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
    }
  );

  onMount(() => {
    if (isNestedBlock) return;

    blockElement()?.addEventListener('selectionchange', selectionChangeHandler);
    onCleanup(() => {
      blockElement()?.removeEventListener(
        'selectionchange',
        selectionChangeHandler
      );
    });
  });

  createEffect(() => {
    const goToTempRedirect = useGoToTempRedirect();
    const documentId = useBlockId();
    const recentState = tempRedirectLocation();
    if (!documentId || !recentState) return;

    setTimeout(() => {
      goToTempRedirect(documentId, recentState);
    }, 0);
  });

  createEffect(() => {
    if (isNestedBlock) return;

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
    if (isNestedBlock) return;

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

  const [searchParams] = useSearchParams();
  const locationSearchParams = () => {
    return {
      annotationId: searchParams[URL_PARAMS.annotationId],
      searchPage: searchParams[URL_PARAMS.searchPage],
      searchMatchNumOnPage: searchParams[URL_PARAMS.searchMatchNumOnPage],
      searchTerm: searchParams[URL_PARAMS.searchTerm],
      pageNumber: searchParams[URL_PARAMS.pageNumber],
      yPos: searchParams[URL_PARAMS.yPos],
      x: searchParams[URL_PARAMS.x],
      width: searchParams[URL_PARAMS.width],
      height: searchParams[URL_PARAMS.height],
    } as LocationSearchParams;
  };

  createEffect(() => {
    if (locationChangedSignal() || !viewerReadySignal()) return;
    let params = locationSearchParams();
    goToLinkLocation(params);
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

        const currentPage = currentPageNumber() ?? 1;
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
      pageIndex: currentPageNumber() ?? 1,
      y: 0,
    });
  });

  if (ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE && !isNestedBlock) {
    const isSaving = createDeferred(isSavingSignal);
    const currentOperations = createDeferred(numOperations);
    const [savedOperations, setSavedOperations] = createSignal(0);
    const setSaveRequired = modificationDataSaveRequired.set;
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
  if (ENABLE_PDF_LOCATION_AUTOSAVE && !isNestedBlock) {
    const isSaving = createDeferred(isSavingSignal);
    const viewChanged = createDeferred(visiblePagesChangedSignal);
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
      <Show when={!isNestedBlock}>
        <div class="absolute top-4 left-4 z-simple-search">
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
          class={`${disableClick() ? 'noClickParse' : ''} w-full h-full relative outline-none`}
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
        <Show when={!isNestedBlock}>
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
