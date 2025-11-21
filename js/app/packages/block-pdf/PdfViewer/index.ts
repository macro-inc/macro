import type { WithRequired } from '@core/util/withRequired';
import { debounce } from '@solid-primitives/scheduled';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PDFPageView } from 'pdfjs-dist/web/pdf_viewer';
import type { TDestArray } from './DestArray';
import type { IFindEvent, IPublicEventBus } from './EventBus';
import { InternalPDFViewer } from './InternalPDFViewer';
import {
  correctScrollAfterWheelZoom,
  decrementScale,
  incrementScale,
  isSameScale,
} from './zoom';

export class PDFViewer extends InternalPDFViewer {
  #savedPosition: string | undefined;
  #savedScale: number | undefined;

  setOverlays(overlays: string[]) {
    super.setOverlays(overlays);
  }

  get processedOverlaysByPage(): ReadonlyArray<HTMLDivElement> {
    return this._processedOverlaysByPage;
  }

  get pageOverlayContainersByPage(): ReadonlyArray<HTMLDivElement> {
    return this._pageOverlayContainersByPage;
  }

  /**
   * Event bus for the PDF viewer. Listeners are attached using the `on`
   * and `off` methods. To raise an event, the `dispatch` method shall be used.
   */
  get event(): IPublicEventBus {
    return this._eventBus;
  }

  get pdfDocument() {
    return this._viewer.pdfDocument;
  }

  async destroy() {
    super.destroy();
  }

  load(pdfDocument: PDFDocumentProxy) {
    if (this._viewer.pdfDocument === pdfDocument) return;
    if (this._viewer.pdfDocument != null) {
      this.unload();
    }

    this.resetOverlays();
    this._linkService.setDocument(pdfDocument);
    this._viewer.setDocument(pdfDocument);
    this.#restorePositionAndScale();
    this._thumbnailViewer?.setDocument(pdfDocument);
  }

  getScale({
    pageNumber,
    topPadding = 0,
  }: {
    pageNumber: number;
    topPadding?: number;
  }) {
    const boundedPageNumber = this.boundedPageNumber(pageNumber);
    const pageView: PDFPageView | undefined =
      this._viewer._pages?.[boundedPageNumber - 1];
    if (pageView == null) {
      console.error(
        `The PageView for Page ${pageNumber} (bound to ${boundedPageNumber}) is not available`
      );
      return;
    }

    const offset = pageView.viewport.height * -topPadding;
    const scale = pageView.viewport.scale;
    return { pageView, scale, offset };
  }

  getPageHeight(pageNumber: number) {
    const res = this.getScale({ pageNumber });
    if (!res) return 0;
    const { pageView } = res;
    return pageView.viewport.height;
  }

  scrollToPosition(position: number) {
    this._viewer.container.scrollTo(0, position);
  }

  scrollTo({
    yPos = 0,
    ...args
  }: {
    pageNumber: number;
    yPos?: number;
    topPadding?: number;
  }) {
    const res = this.getScale(args);
    if (!res) return Promise.resolve();
    const { pageView, scale, offset } = res;
    const top = yPos * scale + offset;
    // create the one-off listener to resolve promise
    const output = new Promise<void>((resolve) => {
      this._viewer.eventBus.on('updateviewarea', () => resolve(), {
        once: true,
      });
    });
    this._viewer.scrollIntoView(pageView, { top } as any);
    return output;
  }

  noScaleScrollTo(pageNumber: number, top: number) {
    const res = this.getScale({ pageNumber });
    if (!res) return Promise.resolve();
    const { pageView } = res;
    this._viewer.scrollIntoView(pageView, { top } as any);
  }

  firstPage() {
    this._container.scrollTop = 0;
  }

  lastPage() {
    this._viewer.currentPageNumber = this._viewer.pagesCount;
  }

  nextPage() {
    this._viewer.nextPage();
  }

  previousPage() {
    this._viewer.previousPage();
  }

  get isMounted(): boolean {
    return this._mountpoint != null;
  }

  get isPopup(): boolean {
    return this._popupViewer != null;
  }

  _hackySetScale(previousScale: number, newScale: number) {
    const took = performance.now();
    this.setScaleWithoutUpdate(newScale);
    this.fastScale(newScale);
    correctScrollAfterWheelZoom({
      previousScale,
      currentScale: newScale,
      container: this._viewer.container,
      evt: {
        clientX: 0,
        clientY: 0,
      },
    });

    if (this._fullRenderTimeout != null) clearTimeout(this._fullRenderTimeout);
    this._fullRenderTimeout = setTimeout(() => {
      this.resetFastScale(newScale);
      this._timeoutThreshold = Math.max(
        Math.min(performance.now() - took, 80),
        100
      );
      this._fullRenderTimeout = undefined;
    }, this._timeoutThreshold) as any;
  }

  container() {
    return this._container;
  }

  viewerElement() {
    return this._viewer.viewer;
  }

  /**
   * Increase the current zoom level one, or more, times.
   * @param [steps] - Defaults to zooming once.
   */
  zoomIn(steps: number = 1) {
    const previousScale = this._viewer.currentScale;
    const newScale = incrementScale(previousScale, steps);
    if (newScale > previousScale && !isSameScale(previousScale, newScale))
      this._hackySetScale(previousScale, newScale);
  }

  /**
   * Decrease the current zoom level one, or more, times.
   * @param [steps] - Defaults to zooming out once.
   */
  zoomOut(steps: number = 1) {
    const previousScale = this._viewer._currentScale;
    const newScale = decrementScale(previousScale, steps);
    if (newScale < previousScale && !isSameScale(previousScale, newScale))
      this._hackySetScale(previousScale, newScale);
  }

  private _zoomReset(scale?: number, noScroll = true) {
    // only reset if you have to
    if (
      !isSameScale(this._viewer._currentScaleValue, scale ?? 0) ||
      this._viewer._currentScaleValue !== 'auto'
    ) {
      this._viewer._setScale('auto', noScroll);
    }
  }

  /**
   * Resets the zoom level to default
   */
  zoomReset = debounce(
    (scale?: number, noScroll: boolean = true) =>
      this._zoomReset(scale, noScroll),
    100
  );

  /**
   * Search for text in the PDF document and highlight matches.
   *
   * @param query - The search text/term to find in the PDF
   * @param again - If true, repeat the previous search immediately without timeout (default: false)
   * @param phraseSearch - If true, search for exact phrase; if false, match partial words (default: true)
   * @param caseSensitive - If true, match case exactly; if false, ignore case differences (default: false)
   * @param entireWord - If true, only match complete words; if false, match partial words (default: false)
   * @param highlightAll - If true, highlight all matches in document; if false, only highlight current match (default: true)
   * @param findPrevious - If true, search backwards (previous match); if false, search forwards (next match) (default: false)
   */
  search({
    query,
    again = false,
    phraseSearch = true,
    caseSensitive = false,
    entireWord = false,
    highlightAll = true,
    findPrevious = false,
  }: WithRequired<Partial<Omit<IFindEvent, 'source' | 'type'>>, 'query'> & {
    again?: boolean;
  }) {
    this._eventBus.dispatch('find', {
      source: this,
      query,
      type: again ? 'again' : '',
      phraseSearch,
      caseSensitive,
      entireWord,
      highlightAll,
      findPrevious,
    });
  }

  resetSearch() {
    this._findController._reset();
    this._findController._updateAllPages();
    this._eventBus.dispatch('findbarclose', { source: this });
  }

  /** Stores the current scroll position */
  saveScrollPosition() {
    this.#savedPosition = this._viewer._location?.pdfOpenParams.split('#')[1];
  }

  // Should only be called imediately after _viewer.setDocument due to _viewer's _resetView
  #restorePositionAndScale() {
    let scale = this.#savedScale || 'auto';
    // NOTE: we shouldn't allow a negative value for scale
    if (typeof scale === 'number' && scale < 0) {
      scale = 'auto';
    }

    this._viewer._setScale(scale, true);

    const hash = this.#savedPosition;
    this._viewer._pagesCapability.promise.then(() => {
      if (hash) {
        const hashNoNull = hash.includes('zoom=null')
          ? hash.replace('zoom=null', 'zoom=auto')
          : hash;
        this._linkService.setHash(hashNoNull);
      }
      this.#savedScale = undefined;
      this.#savedPosition = undefined;
    });
  }

  // The page width/height is used for a lot of calculations, for things like placeables,
  // it's mostly unnecessary since the coordinates are defined by the inside of the page container and should
  // be reworked
  /** Gets the scaled (CSS) or unscaled (PDF) dimensions of a page */
  pageDimensions(
    pageIndex: number,
    scaled: boolean
  ): {
    width: number;
    height: number;
  } | null {
    const pageView = this._viewer._pages?.[pageIndex];
    if (pageView == null) return null;

    const { width, height, viewBox } = pageView.viewport;

    return {
      width: scaled ? width : viewBox[2] - viewBox[0],
      height: scaled ? height : viewBox[3] - viewBox[1],
    };
  }

  pageViewport(pageIndex: number): {
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
  } | null {
    const pageView = this._viewer._pages?.[pageIndex];
    if (pageView == null) return null;

    const {
      width,
      height,
      offsetX,
      offsetY,
      scale: viewScale,
      viewBox,
    } = pageView.viewport;
    const { scale: relativeScale } = pageView;

    return {
      width,
      height,
      offsetY,
      offsetX,
      pageWidth: viewBox[2] - viewBox[0],
      pageHeight: viewBox[3] - viewBox[1],
      viewScale,
      relativeScale,
    };
  }

  getLocation() {
    return this._viewer._location;
  }

  getLocationHash(): string | undefined {
    return this._viewer._location?.pdfOpenParams;
  }

  goToLocationHash(hash: string) {
    const query = hash.split('#');
    if (query.length !== 2) {
      console.error('Invalid hash: ', hash);
    }
    this._linkService.setHash(query[1]);
  }

  goToDestination(dest: TDestArray) {
    this._linkService.goToDestination(dest);
  }
}
