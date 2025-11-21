import {
  ENABLE_FORM_EDITING,
  ENABLE_SCRIPTING,
  ENABLE_THUMBNAIL_VIEWER,
} from '@core/constant/featureFlags';
import * as stackingContext from '@core/constant/stackingContext';
import { showMessageBoxSync } from '@core/util/dialog';
import debounce from 'lodash/debounce';
import { AnnotationMode, type PageViewport } from 'pdfjs-dist';
import scriptingSandbox from 'pdfjs-dist/build/pdf.sandbox.js?url';
import {
  PDFViewer as BaseViewer,
  NullL10n,
  type PDFPageView,
  PDFRenderingQueue,
  PDFScriptingManager,
  PDFThumbnailViewer,
  TextLayerBuilder,
} from 'pdfjs-dist/web/pdf_viewer';
import { PageModel } from '../model/Page';
import { PDF_TO_CSS_UNITS } from '../util/pixelsPerInch';
import { destHrefToDest } from './DestArray';
import {
  createEventBus,
  type IAnnotationLayerRenderedEvent,
  type IEventBus,
  type IPageChangingEvent,
  type IPageRenderedEvent,
  type IPageResetEvent,
  type IUpdateViewArea,
  type TEventListener,
  type TEvents,
} from './EventBus';
import { FindController } from './FindController';
import { LinkService } from './LinkService';
import { MdOpenInNewIcon } from './MdOpenInNew';
import {
  accumulateTouchTicks,
  getTouches,
  setTouches,
  touchEndHandler,
  touchStartHandler,
} from './touchUtils';
import {
  accumulateWheelTicks,
  normalizeWheelEventDirection,
} from './wheelUtils';
import {
  correctScrollAfterWheelZoom,
  isSameScale,
  scaleByScrollTicks,
} from './zoom';

interface Match {
  page_number: number;
  match_index: number;
  rects: Rect[];
  text: string;
}

const SCROLLBAR_OFFSET = -5;
const CALLOUT_TIMEOUT_SECONDS = 1.5;
export const DEFAULT_THUMBNAIL_WIDTH = 250;

type TBoundEvents = {
  [TEvent in keyof TEvents]?: TEventListener<TEvent>;
};

export type TCallout = {
  pageNumber: number;
  yPos: number;
  height?: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// This is the internal API that our PDFViewer builds off of
export class InternalPDFViewer {
  protected _viewer: BaseViewer;
  protected _eventBus: IEventBus;
  protected _linkService: LinkService;
  protected _findController: FindController;
  protected _scriptingManager: PDFScriptingManager | null;
  protected _renderingQueue: PDFRenderingQueue;

  protected _interceptLinks: boolean = false;
  protected _boundEvents: TBoundEvents = Object.create(null);

  protected _overlays: string[] = [];
  protected _processedOverlaysByPage: HTMLDivElement[] = [];
  protected _processedOverlayContainersByPage: HTMLDivElement[] = [];

  protected _pageOverlayContainersByPage: HTMLDivElement[] = [];

  protected _mountpoint: HTMLElement | null = null;
  protected _eventListenerElement: HTMLElement | null = null;
  protected _container: HTMLDivElement;

  protected _popupViewer: InternalPDFViewer | undefined;
  protected _floatingPopupContainer: HTMLDivElement | undefined;
  protected _popupTargetID: string | undefined;
  protected _popupTargetHref: string | undefined;

  protected _thumbnailViewer: PDFThumbnailViewer | undefined;
  protected _thumbnailViewerContainer: HTMLElement | undefined;
  protected _thumbnailViewerMountpoint: HTMLElement | undefined;

  protected _callout: Required<TCallout> | undefined;
  protected _calloutTimeout: number | undefined;
  #calloutDiv: HTMLDivElement | undefined;

  protected _fullRenderTimeout: number | undefined;
  protected _timeoutThreshold = 150;
  /** Overlay for a given window selection */
  protected _selectionOverlay: HTMLElement | null = null;
  /** Callback when clicking on a term/definition overlay */
  protected _onDefinitionClick: (
    ref: HTMLDivElement,
    pageIndex: number,
    term: string
  ) => void = () => {};
  protected _onScaleChange: (selectionElement?: HTMLElement) => void = () => {};
  protected _openInNewTabButton: HTMLDivElement | null = null;

  #textLayerMouseHandlerMap: WeakMap<
    HTMLDivElement,
    {
      mouseDown: (e: MouseEvent) => void;
      mouseUp: (e: MouseEvent) => void;
    }
  > = new WeakMap();

  private _pageViewsMarkedForOverlay = new Set<PDFPageView>();

  constructor(popupViewer?: InternalPDFViewer) {
    this._interceptLinks = popupViewer != null;
    this._popupViewer = popupViewer;
    const container = document.createElement('div');
    container.className = 'pdfViewerContainer bg-panel';
    container.tabIndex = 0;
    const viewerDiv = document.createElement('div');
    viewerDiv.className = 'pdfViewer';
    container.appendChild(viewerDiv);

    if (popupViewer != null) {
      const popupContainer = this.#buildPopupContainer();
      container.appendChild(popupContainer.outer);
      this._floatingPopupContainer = popupContainer.inner;
    }

    this._container = container;

    const eventBus = createEventBus();
    const renderingQueue = new PDFRenderingQueue();
    this._renderingQueue = renderingQueue;

    const linkService = new LinkService({
      eventBus,
    });
    const findController = new FindController({
      eventBus,
      linkService,
    });
    const scriptingManager =
      popupViewer == null
        ? null
        : ENABLE_SCRIPTING
          ? new PDFScriptingManager({
              eventBus,
              sandboxBundleSrc: scriptingSandbox,
            })
          : null;

    this._linkService = linkService;
    this._eventBus = eventBus;
    this._findController = findController;
    this._scriptingManager = scriptingManager;

    this._viewer = new BaseViewer({
      container,
      viewer: viewerDiv,
      l10n: NullL10n,
      eventBus,
      linkService,
      findController,
      scriptingManager,
      renderingQueue,
      /**
       *   @property {number} [annotationMode] Controls which annotations are rendered
       *   onto the canvas, for annotations with appearance-data; the values from
       *   {@link AnnotationMode} should be used. The following values are supported:
       *    - `AnnotationMode.DISABLE`, which disables all annotations.
       *    - `AnnotationMode.ENABLE`, which includes all possible annotations (thus
       *      it also depends on the `intent`-option, see above).
       *    - `AnnotationMode.ENABLE_FORMS`, which excludes annotations that contain
       *      interactive form elements (those will be rendered in the display layer).
       *    - `AnnotationMode.ENABLE_STORAGE`, which includes all possible annotations
       *      (as above) but where interactive form elements are updated with data
       *      from the {@link AnnotationStorage}-instance; useful e.g. for printing.
       *   The default value is `AnnotationMode.ENABLE`.
       */
      annotationMode: ENABLE_FORM_EDITING
        ? AnnotationMode.ENABLE_FORMS
        : AnnotationMode.ENABLE, // lets us view but not edit forms
    });

    if (
      ENABLE_THUMBNAIL_VIEWER &&
      popupViewer != null &&
      this._renderingQueue != null
    ) {
      const thumbnailContainer = this.#buildThumbnailViewerContainer();
      this._thumbnailViewerContainer = thumbnailContainer;

      const thumbnailViewer = new PDFThumbnailViewer({
        container: thumbnailContainer,
        eventBus: this._eventBus,
        renderingQueue: this._renderingQueue,
        linkService: this._linkService,
        l10n: this._viewer.l10n,
        thumbnailWidth: DEFAULT_THUMBNAIL_WIDTH,
      });
      this._thumbnailViewer = thumbnailViewer;

      this._renderingQueue.setThumbnailViewer(thumbnailViewer);
    }

    renderingQueue.setViewer(this._viewer);
    linkService.setViewer(this._viewer);
    scriptingManager?.setViewer(this._viewer);

    // override the text layer builder to use smooth selections
    this._viewer.createTextLayerBuilder = this._createTextLayerBuilder;
    this.#bindEvents();
  }

  protected _createTextLayerBuilder({
    textLayerDiv,
    pageIndex,
    viewport,
    eventBus,
    highlighter,
  }: Parameters<BaseViewer['createTextLayerBuilder']>[0]): TextLayerBuilder {
    return new TextLayerBuilder({
      textLayerDiv,
      eventBus,
      pageIndex,
      viewport,
      enhanceTextSelection: true,
      highlighter: highlighter as any,
    });
  }

  // should not be called on unmount, but should be called if the document is replaced
  // if called on unmount, it will cause a drastic drop in performance and significant lag
  unload() {
    this._pageViewsMarkedForOverlay.clear();
    // only clear this on the root
    if (this._popupViewer != null) {
      this._viewer.setDocument(null);
      this._thumbnailViewer?.setDocument(null as any);
    }
    // TODO (seamus) : is there a better way to force these updates through the
    // signal? The signals are derived from the internal pdf event bus events.
    this._eventBus.dispatch('pagechanging', {
      pageNumber: 1,
      pageLabel: '',
      previous: 1,
      source: {},
    });
    this._eventBus.dispatch('pagesloaded', {
      pagesCount: 0,
      source: {},
    });
  }

  mount(mountpoint: HTMLElement, eventListenerElement: HTMLElement) {
    this._mountpoint = mountpoint;
    this._eventListenerElement = eventListenerElement;
    mountpoint.replaceChildren(this._container);

    if (this._popupViewer != null) {
      if (this._floatingPopupContainer != null) {
        this._popupViewer.mount(
          this._floatingPopupContainer,
          eventListenerElement
        );
      }

      eventListenerElement.addEventListener('wheel', this._handleViewerWheel, {
        passive: false,
      });

      eventListenerElement.addEventListener('touchstart', touchStartHandler, {
        passive: false,
      });
      eventListenerElement.addEventListener(
        'touchmove',
        this._handleViewerTouchMove,
        {
          passive: false,
        }
      );
      eventListenerElement.addEventListener('touchend', touchEndHandler, {
        passive: false,
      });
    }

    // popup viewer needs the open button
    if (this._popupViewer == null) {
      mountpoint.appendChild(this.#buildPopupOpenInNewTabButton());
    }

    this._viewer._firstPageCapability.promise.then(() => {
      // if the page views aren't ready, then the zoom/scale value won't be calculated
      if (this._popupViewer != null) {
        this._viewer._setScale('auto', true);
        this.#scalePopupToRootScale();
      }
    });
  }

  unmount() {
    this._mountpoint?.removeChild(this._container);
    this._mountpoint = null;

    this._eventListenerElement?.removeEventListener(
      'wheel',
      this._handleViewerWheel
    );

    this._eventListenerElement?.removeEventListener(
      'touchstart',
      touchStartHandler
    );
    this._eventListenerElement?.removeEventListener(
      'touchmove',
      this._handleViewerTouchMove
    );
    this._eventListenerElement?.removeEventListener(
      'touchend',
      touchEndHandler
    );
  }

  mountThumbnails(mountpoint: HTMLElement) {
    if (this._thumbnailViewerContainer == null) {
      return this.#warnRootViewerOnly();
    }

    this._thumbnailViewerMountpoint = mountpoint;
    mountpoint.replaceChildren(this._thumbnailViewerContainer);
    this._thumbnailViewer?.scrollThumbnailIntoView(
      this._viewer.currentPageNumber
    );
    if (this._renderingQueue != null) {
      this._renderingQueue.isThumbnailViewEnabled = true;
      this._thumbnailViewer?.forceRendering();
    }
  }

  unmountThumbnails() {
    if (this._thumbnailViewerContainer == null) {
      return this.#warnRootViewerOnly();
    }

    this._thumbnailViewerContainer?.remove();
    this._thumbnailViewerMountpoint = undefined;
    if (this._renderingQueue != null) {
      this._renderingQueue.isThumbnailViewEnabled = false;
    }
  }

  scaleThumbnails(scale: number) {
    if (!this._thumbnailViewerContainer) {
      return;
    }

    // If scale is 1, we just want to render things as normal, so ensure we
    // don't have any transforms or w/h adjustments
    // If the scale is not, thumbnails needs to squeeze into a smaller than
    // default space. We can just scale transform it to be smaller. We get the
    // scale as a percent of the base size, and apply that as the scale()
    // function. This keeps the actual thumbnails sized down. But to make sure
    // we continue to fill the correct container amount, we then use the inverse
    // of the scale to fill out the width/height to fill it (otherwise if we
    // zoomed out to 75%, the thumbnail container would only go down 75% of the
    // page; this way the thumbnails render at 75% size but the vertical height
    // is upped to 125% so it fills out again.
    if (scale === 1) {
      this._thumbnailViewerContainer.style.transformOrigin = '';
      this._thumbnailViewerContainer.style.transform = '';
      this._thumbnailViewerContainer.style.height = '100dvh';
      this._thumbnailViewerContainer.style.width = '';
    } else {
      const rounded = Math.round(scale * 100);
      const invertedPct = 100 + (100 - rounded);
      this._thumbnailViewerContainer.style.transformOrigin = 'left top';
      this._thumbnailViewerContainer.style.transform = `scale(0.${rounded})`;
      this._thumbnailViewerContainer.style.height = `${invertedPct}vh`;
      this._thumbnailViewerContainer.style.width = `${invertedPct}%`;
    }
  }

  #buildThumbnailViewerContainer(): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'pdfThumbnailViewerContainer';

    return div;
  }

  #buildPopupContainer() {
    const outer = document.createElement('div');
    outer.className = 'pdfPopupOuter';

    const inner = document.createElement('div');
    inner.className = 'pdfPopupInner';
    inner.style.zIndex = `${stackingContext.zPopupViewer}`;
    inner.style.visibility = 'visible';

    outer.appendChild(inner);

    return { outer, inner };
  }

  #buildPopupOpenInNewTabButton(): HTMLDivElement {
    const button = document.createElement('div');
    button.className = 'openInNewTab';

    const icon = MdOpenInNewIcon('1.5em', {
      class: 'icon',
    });
    button.onclick = () => {
      const locationHash = this._viewer._location?.pdfOpenParams;

      if (locationHash == null) return;

      this._eventBus.dispatch('openNewTab', {
        source: this,
        locationHash,
      });
    };

    button.appendChild(icon);

    this._openInNewTabButton = button;

    return button;
  }

  private renderOverlays() {
    const overlays = this._overlays;
    const pagesCount = overlays.length;
    if (pagesCount !== this._processedOverlayContainersByPage.length) {
      return;
    }

    // free old overlays
    this._processedOverlaysByPage.length = 0;
    const overlayElements = overlaysToElements(overlays);
    this._processedOverlaysByPage = overlayElements;

    this._eventBus.dispatch('processedOverlaysReady', {
      source: this,
      processedOverlaysByPage: overlayElements,
    });

    for (let pageIndex = 0; pageIndex < pagesCount; ++pageIndex) {
      this._processedOverlayContainersByPage[pageIndex]?.replaceChildren(
        overlayElements[pageIndex]
      );
    }

    this._eventBus.dispatch('processedOverlaysRendered', {
      source: this,
      processedOverlaysByPage: overlayElements,
      processedOverlayContainersByPage: this._processedOverlayContainersByPage,
    });
  }

  protected setOverlays(overlays: string[]) {
    this._overlays = overlays;
    this.renderOverlays();
  }

  #warnRootViewerOnly() {
    console.error('This should only be called on the root viewer');
  }

  #hidePopup() {
    if (this._floatingPopupContainer == null) {
      return this.#warnRootViewerOnly();
    }

    // NOTE: temp workaround because changing visibility to hidden will crash ios safari
    this._floatingPopupContainer.style.zIndex = '-1';
    this._floatingPopupContainer.style.pointerEvents = 'none';

    // the floating popup messes with this, PDF.js sets this as a
    // :root CSS var which causes conflicts with the root/popup resetting it
    this._viewer.updateContainerHeightCss();
    this._viewer?.eventBus.dispatch('popupvisibilitychanged', {
      source: this,
      isOpen: false,
      target: this._floatingPopupContainer,
    });
  }

  hidePopup() {
    this.#hidePopup();
    this._popupTargetID = undefined;
  }

  #scalePopupToRootScale() {
    if (this._popupViewer == null) {
      return this.#warnRootViewerOnly();
    }
    let scale = this._viewer._currentScale;
    // NOTE: don't allow negative scale values
    if (scale < 0) {
      scale = null;
    }
    const popupViewer = this._popupViewer;
    popupViewer._viewer._pagesCapability.promise.then(() => {
      popupViewer._viewer._setScale(scale || 'auto', false);
    });
  }

  #showPopup(_target?: HTMLElement) {
    if (this._floatingPopupContainer == null) return;

    if (_target == null && this._popupTargetID == null) return;
    const target = (_target ??
      document.getElementById(this._popupTargetID!) ??
      document.querySelector(
        `.annotationLayer .linkAnnotation[data-annotation-id="${this._popupTargetID}"]`
      ))!;

    const pageNode = PageModel.getPageNode(target);
    if (pageNode == null) return;

    const pageRect = pageNode.getBoundingClientRect();
    const top =
      target.getBoundingClientRect().bottom - pageRect.top + pageNode.offsetTop;
    const width = pageNode.offsetWidth;

    this._floatingPopupContainer.style.width = `${width + SCROLLBAR_OFFSET}px`;
    this._floatingPopupContainer.style.top = `${Math.ceil(top)}px`;

    this._floatingPopupContainer.style.zIndex = `${stackingContext.zPopupViewer}`;
    this._floatingPopupContainer.style.pointerEvents = 'all';
    this._viewer?.eventBus.dispatch('popupvisibilitychanged', {
      source: this,
      isOpen: true,
      target: this._floatingPopupContainer,
    });
  }

  showPopupAt(target: HTMLElement) {
    if (this._floatingPopupContainer == null || this._popupViewer == null) {
      return this.#warnRootViewerOnly();
    }
    this.#scalePopupToRootScale();

    this._popupTargetID =
      target.getAttribute('id') ??
      target.parentElement?.dataset['annotationId'];

    this.#showPopup(target);
  }

  private overrideInternalLinks(annotationLayerDiv: HTMLDivElement) {
    annotationLayerDiv.style.zIndex = `${stackingContext.zAnnotationLayer + (!this._popupViewer ? stackingContext.zPopupViewer : 0)}`;
    annotationLayerDiv
      .querySelectorAll<HTMLAnchorElement>('a.internalLink')
      .forEach((el) => {
        const destination = destHrefToDest(el.href);
        el.draggable = false;

        // There are "internal links" that are actions, not links, without valid destinations
        if (destination == null) return;

        el.onclick = (evt) => {
          evt.preventDefault();

          // prevents immediately closing the popup
          evt.stopImmediatePropagation();

          const popupViewer = this._popupViewer;
          popupViewer?._viewer._pagesCapability.promise.then(() => {
            popupViewer._linkService.goToDestination(destination);
            this.showPopupAt(el);
          });
        };
      });
  }

  #preventOverlaysFromStoppingTextSelection(source: PDFPageView) {
    const textLayerDiv: HTMLDivElement | undefined =
      source.textLayer?.textLayerDiv.textLayerDiv;
    if (textLayerDiv == null) return;
    const existingHandlers = this.#textLayerMouseHandlerMap.get(textLayerDiv);
    if (existingHandlers != null) {
      textLayerDiv.removeEventListener('mouseup', existingHandlers.mouseUp);
      textLayerDiv.removeEventListener('mousedown', existingHandlers.mouseDown);
    }

    const handlers = {
      mouseUp: () => {
        this._container.classList.remove('noOverlayEvents');
      },
      mouseDown: () => {
        this._container.classList.add('noOverlayEvents');
      },
    };
    this.#textLayerMouseHandlerMap.set(textLayerDiv, handlers);

    textLayerDiv.addEventListener('mouseup', handlers.mouseUp);
    textLayerDiv.addEventListener('mousedown', handlers.mouseDown);
  }

  #destroyCallout() {
    if (this._calloutTimeout) clearTimeout(this._calloutTimeout);
    this.#calloutDiv?.remove();
    this.#calloutDiv = undefined;
    this._callout = undefined;
  }

  #lastCallout: TCallout | undefined;
  #displayCallout(source: PDFPageView) {
    if (
      this._callout?.pageNumber !== source.id ||
      this._callout === this.#lastCallout
    )
      return;
    // Only display the same callout once, to prevent moving after scrolling
    this.#lastCallout = this._callout;

    if (this._calloutTimeout) clearTimeout(this._calloutTimeout);
    this.#calloutDiv?.remove();

    const callout = document.createElement('div');
    callout.className = 'calloutIndicator';

    const height =
      ((this._callout.height * source.viewport.scale) /
        source.viewport.height) *
      100;
    const top =
      ((this._callout.yPos * source.viewport.scale) / source.viewport.height) *
      100;
    callout.style.height = `${height}%`;
    callout.style.top = `${top}%`;

    source.div.appendChild(callout);

    this.#calloutDiv = callout;

    this._calloutTimeout = setTimeout(() => {
      this.#destroyCallout();
    }, CALLOUT_TIMEOUT_SECONDS * 1000) as any;
  }

  // use debounced event to prevent multiple calls
  protected _markPageViewsChanged() {
    this._eventBus.dispatch('overlayViewsChanged', {
      views: [...this._pageViewsMarkedForOverlay],
    });
  }

  protected _debouncedMarkPageViewsChanged = debounce(
    () => {
      this._markPageViewsChanged();
    },
    100,
    {
      leading: true,
      trailing: true,
    }
  );

  protected _handleAnnotationLayerRendered({
    source,
    pageNumber,
  }: IAnnotationLayerRenderedEvent) {
    this.#preventOverlaysFromStoppingTextSelection(source);

    const pageIndex = pageNumber - 1;

    const pageOverlayContainer = this._pageOverlayContainersByPage[pageIndex];
    if (
      pageOverlayContainer != null &&
      !elementHasChild(source.div, pageOverlayContainer)
    ) {
      source.div.appendChild(pageOverlayContainer);
    }

    const processedOverlayContainer =
      this._processedOverlayContainersByPage[pageIndex];
    if (
      processedOverlayContainer != null &&
      !elementHasChild(source.div, processedOverlayContainer)
    ) {
      source.div.appendChild(processedOverlayContainer);
    }

    this._pageViewsMarkedForOverlay.add(source);
    this._debouncedMarkPageViewsChanged();

    if (this._fullRenderTimeout == null) this.#showPopup();

    if (!this._interceptLinks) return;
    const annotationLayerDiv = source.annotationLayer?.div;
    if (annotationLayerDiv == null) return;
    this.overrideInternalLinks(annotationLayerDiv);
  }

  protected _handlePagesInit() {
    // immediate free of old containers
    if (this._pageOverlayContainersByPage.length !== 0) {
      for (const el of this._pageOverlayContainersByPage) {
        try {
          el.remove();
        } catch {}
      }
    }
    this._pageOverlayContainersByPage.length = 0;
    if (this._processedOverlayContainersByPage.length !== 0) {
      for (const el of this._processedOverlayContainersByPage) {
        try {
          el.remove();
        } catch {}
      }
    }
    this._processedOverlayContainersByPage.length = 0;
    const pageCount = this._viewer.pagesCount;

    for (let pageIndex = 0; pageIndex < pageCount; ++pageIndex) {
      const pageOverlayContainer = document.createElement('div');
      pageOverlayContainer.className = 'pageOverlayContainer';
      this._pageOverlayContainersByPage.push(pageOverlayContainer);

      const processedOverlayContainer = document.createElement('div');
      processedOverlayContainer.className = 'processedOverlayContainer';
      this._processedOverlayContainersByPage.push(processedOverlayContainer);
    }

    this._viewer.update();
    this.renderOverlays();
  }

  private resizeOverlayContainer({
    container,
    width,
    height,
  }: {
    container: HTMLDivElement;
    height: number;
    width: number;
  }) {
    container.style.width = `${Math.floor(width)}px`;
    container.style.height = `${Math.floor(height)}px`;
  }

  protected _handlePageRendered(event: IPageRenderedEvent) {
    // containers need to be resized on render, just like the text layer,
    // otherwise the contents get clipped or render incorrectly
    const pageIndex = event.pageNumber - 1;
    const { height, width } = event.source.viewport;

    const pageOverlayContainer = this._pageOverlayContainersByPage[pageIndex];
    if (pageOverlayContainer != null) {
      this.resizeOverlayContainer({
        container: pageOverlayContainer,
        width,
        height,
      });
    }

    const processedOverlayContainer =
      this._processedOverlayContainersByPage[pageIndex];
    if (processedOverlayContainer != null) {
      this.resizeOverlayContainer({
        container: processedOverlayContainer,
        width,
        height,
      });
    }

    if (this._thumbnailViewerMountpoint != null) {
      const pageView = this._viewer.getPageView(pageIndex);
      const thumbnailView = this._thumbnailViewer?.getThumbnail(pageIndex);
      if (pageView != null && thumbnailView != null) {
        thumbnailView.setImage(pageView);
      }
    }
  }

  protected _handleContainerClick(event: MouseEvent) {
    if (event.target == null || this._floatingPopupContainer == null) {
      return;
    }

    if (!this._floatingPopupContainer.contains(event.target as Node)) {
      this.hidePopup();
    }
  }

  protected _handleViewAreaChanged(event: IUpdateViewArea) {
    if (
      this._callout == null ||
      !event.visiblePages.ids.has(this._callout.pageNumber)
    )
      return;

    const { pageNumber } = this._callout;

    const visiblePage = event.visiblePages.views.find(
      (view) => view.id === pageNumber
    )!;
    this.#displayCallout(visiblePage.view);
  }

  protected _handlePageChanging(event: IPageChangingEvent) {
    if (this._thumbnailViewerMountpoint != null) {
      this._thumbnailViewer?.scrollThumbnailIntoView(event.pageNumber);
    }
  }

  private fastResizeLayers(pageView: PDFPageView) {
    const { div, viewport } = pageView;
    if (pageView.canvas == null) {
      div.style.width = Math.floor(viewport.width) + 'px';
      div.style.height = Math.floor(viewport.height) + 'px';
    } else {
      pageView.cssTransform({
        target: pageView.canvas,
      });
    }

    const { width, height } = pageView.viewport;
    const processedOverlay =
      this._processedOverlayContainersByPage[pageView.id - 1];
    if (processedOverlay) {
      this.resizeOverlayContainer({
        container: processedOverlay,
        width,
        height,
      });
    }

    const pageOverlay = this._pageOverlayContainersByPage[pageView.id - 1];
    const innerDiv = pageOverlay.firstElementChild as
      | HTMLDivElement
      | undefined;

    if (innerDiv && pageView.textLayer) {
      const textViewport: PageViewport = pageView.textLayer.viewport;
      innerDiv.style.transform = `scale(${width / textViewport.width})`;
      innerDiv.style.transformOrigin = '0 0';
      innerDiv.style.width = `${Math.floor(textViewport.width)}px`;
      innerDiv.style.height = `${Math.floor(textViewport.height)}px`;
    } else if (pageOverlay) {
      pageOverlay.style.pointerEvents = 'none';
    }
  }

  protected fastScale(scale: number) {
    const pages = this._viewer._pages;
    if (!pages) return;

    for (const pageView of pages) {
      // a new page can be rendered while zooming out, ensure that it doesn't do a full render
      pageView.useOnlyCssZoom = true;

      pageView.scale = scale;
      pageView.viewport = pageView.viewport.clone({
        scale: scale * PDF_TO_CSS_UNITS,
      });

      // instead of destroying the annotation layers, just hide them until the full render
      pageView.annotationLayer?.hide();
      pageView.xfaLayer?.hide();

      disableTextLayer(pageView);
      this.fastResizeLayers(pageView);
    }
    this._viewer.updateContainerHeightCss();
  }

  protected resetFastScale(newScale: number) {
    const pages = this._viewer?._pages;
    if (!pages) return;

    this.setScaleWithoutUpdate(newScale);

    this._eventBus.dispatch('scalechanging', {
      source: this._viewer,
      scale: this._viewer._currentScale,
      presetValue: this._viewer._currentScaleValue,
    });

    for (const pageView of pages) {
      pageView.useOnlyCssZoom = false;
      const pageOverlay = this._pageOverlayContainersByPage[pageView.id - 1];
      enableTextLayer(pageView);
      pageView.update({ scale: newScale });
      const innerDiv = pageOverlay.firstElementChild as
        | HTMLDivElement
        | undefined;
      if (innerDiv) {
        innerDiv.style.transformOrigin = '';
        innerDiv.style.transform = '';
        innerDiv.style.width = '';
        innerDiv.style.height = '';
      } else if (pageOverlay) {
        pageOverlay.style.pointerEvents = 'none';
      }
    }

    // this gets invoked later on in the flow, so skip this pass
    // (this is pretty slow on long PDFs so dodging 1 invoke saves 50-100ms)
    // this._eventBus.dispatch("overlayViewsChanged", {
    //   views: [...this._pageViewsMarkedForOverlay],
    // });

    this._viewer.update();
    this._viewer.updateContainerHeightCss();
  }

  protected setScaleWithoutUpdate(newScale: number) {
    this._viewer._currentScale = newScale;
    this._viewer._currentScaleValue = newScale.toString();
    if (this._viewer._location) {
      this._viewer._location.scale = Math.round(newScale * 10000) / 100;
      this._viewer._location.viewportScale = newScale * PDF_TO_CSS_UNITS;
    }
  }

  currentScaleValue() {
    return this._viewer._currentScaleValue;
  }

  // Modify version of _handleViewerWheel for pinch zoom with touches
  protected _handleViewerTouchMove = (evt: TouchEvent) => {
    const touches = getTouches();
    if (evt.touches.length !== 2 || !touches) {
      return;
    }

    let [touch0, touch1] = evt.touches;
    if (touch0.identifier > touch1.identifier) {
      [touch0, touch1] = [touch1, touch0];
    }
    const { pageX: page0X, pageY: page0Y } = touch0;
    const { pageX: page1X, pageY: page1Y } = touch1;

    const [
      { pageX: pTouch0X, pageY: pTouch0Y },
      { pageX: pTouch1X, pageY: pTouch1Y },
    ] = touches;

    if (
      Math.abs(pTouch0X - page0X) <= 1 &&
      Math.abs(pTouch0Y - page0Y) <= 1 &&
      Math.abs(pTouch1X - page1X) <= 1 &&
      Math.abs(pTouch1Y - page1Y) <= 1
    ) {
      // Touches are really too close and it's hard do some basic
      // geometry in order to guess something.
      return;
    }

    setTouches([
      {
        identifier: touch0.identifier,
        pageX: page0X,
        pageY: page0Y,
      },
      {
        identifier: touch1.identifier,
        pageX: page1X,
        pageY: page1Y,
      },
    ]);

    if (pTouch0X === page0X && pTouch0Y === page0Y) {
      // First touch is fixed, if the vectors are collinear then we've a pinch.
      const v1X = pTouch1X - page0X;
      const v1Y = pTouch1Y - page0Y;
      const v2X = page1X - page0X;
      const v2Y = page1Y - page0Y;
      const det = v1X * v2Y - v1Y * v2X;
      // 0.02 is approximatively sin(0.15deg).
      if (Math.abs(det) > 0.02 * Math.hypot(v1X, v1Y) * Math.hypot(v2X, v2Y)) {
        return;
      }
    } else if (pTouch1X === page1X && pTouch1Y === page1Y) {
      // Second touch is fixed, if the vectors are collinear then we've a pinch.
      const v1X = pTouch0X - page1X;
      const v1Y = pTouch0Y - page1Y;
      const v2X = page0X - page1X;
      const v2Y = page0Y - page1Y;
      const det = v1X * v2Y - v1Y * v2X;
      if (Math.abs(det) > 0.02 * Math.hypot(v1X, v1Y) * Math.hypot(v2X, v2Y)) {
        return;
      }
    } else {
      const diff0X = page0X - pTouch0X;
      const diff1X = page1X - pTouch1X;
      const diff0Y = page0Y - pTouch0Y;
      const diff1Y = page1Y - pTouch1Y;
      const dotProduct = diff0X * diff1X + diff0Y * diff1Y;
      if (dotProduct >= 0) {
        // The two touches go in almost the same direction.
        return;
      }
    }

    // Only zoom the pages, not the entire viewer.
    evt.preventDefault();
    evt.stopImmediatePropagation();
    // NOTE: this check must be placed *after* preventDefault.
    if (document.visibilityState === 'hidden') {
      return;
    }

    const took = performance.now();

    const distance = Math.hypot(page0X - page1X, page0Y - page1Y) || 1;
    const pDistance = Math.hypot(pTouch0X - pTouch1X, pTouch0Y - pTouch1Y) || 1;
    const delta = distance - pDistance;
    const previousScale = this._viewer.currentScale;

    const PIXELS_PER_LINE_SCALE = 30; // 30 seems smoother than 36
    const ticks = accumulateTouchTicks(delta / PIXELS_PER_LINE_SCALE);

    const newScale = scaleByScrollTicks(previousScale, ticks);

    if (isSameScale(previousScale, newScale)) return;

    this.setScaleWithoutUpdate(newScale);

    const clientX = (page0X + page1X) / 2;
    const clientY = (page0Y + page1Y) / 2;
    this._eventBus.withoutEvents(() => {
      this.#hidePopup();
      this.fastScale(newScale);
      correctScrollAfterWheelZoom({
        previousScale,
        currentScale: newScale,
        container: this._viewer.container,
        evt: {
          clientX,
          clientY,
        },
      });
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
  };

  protected _handleViewerWheel = (evt: WheelEvent) => {
    if (!evt.ctrlKey) {
      return;
    }

    // Only zoom the pages, not the entire viewer.
    evt.preventDefault();
    evt.stopImmediatePropagation();
    // NOTE: this check must be placed *after* preventDefault.
    if (document.visibilityState === 'hidden') {
      return;
    }

    const took = performance.now();

    const delta = normalizeWheelEventDirection(evt);
    const previousScale = this._viewer.currentScale;

    const PIXELS_PER_LINE_SCALE = 36; // this just seems like a good number base on trial and error, basically
    const ticks = accumulateWheelTicks(delta / PIXELS_PER_LINE_SCALE);

    const newScale = scaleByScrollTicks(previousScale, ticks);

    if (isSameScale(previousScale, newScale)) return;

    this.setScaleWithoutUpdate(newScale);

    this._eventBus.withoutEvents(() => {
      this.#hidePopup();
      this.fastScale(newScale);
      correctScrollAfterWheelZoom({
        previousScale,
        currentScale: newScale,
        container: this._viewer.container,
        evt,
      });
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
  };

  protected _handlePageReset = ({
    keepAnnotationLayer,
    source,
  }: IPageResetEvent) => {
    // when a page is reset and the annotation layer is not kept, then it should not be re-rendered
    if (!keepAnnotationLayer) this._pageViewsMarkedForOverlay.delete(source);
  };

  #bindEvents() {
    this._handleContainerClick = this._handleContainerClick.bind(this);
    this._container.addEventListener('click', this._handleContainerClick);

    this._boundEvents.annotationlayerrendered =
      this._handleAnnotationLayerRendered.bind(this);

    this._boundEvents.pagesinit = this._handlePagesInit.bind(this);

    this._boundEvents.scalechanging = () => {
      if (this._popupViewer == null) return;
      this.#hidePopup();
      this.#scalePopupToRootScale();
      this._viewer.update();
    };
    this._boundEvents.pagerendered = this._handlePageRendered.bind(this);

    this._boundEvents.updateviewarea = this._handleViewAreaChanged.bind(this);

    this._boundEvents.pagechanging = this._handlePageChanging.bind(this);

    this._boundEvents.pagereset = this._handlePageReset;

    this._boundEvents.sandboxcreated = this._handleSandboxCreated;

    this._boundEvents.scriptingready = this._handleScriptingReady;

    for (const key in this._boundEvents) {
      const event = key as keyof TEvents;
      if (!this._boundEvents[event]) continue;
      this._eventBus.on(event, this._boundEvents[event]);
    }
  }

  #unbindEvents() {
    if (this._openInNewTabButton) {
      this._openInNewTabButton.onclick = null;
      this._openInNewTabButton = null;
    }

    const annotationStorage = this._viewer.pdfDocument?.annotationStorage;
    if (annotationStorage != null) {
      annotationStorage.onSetModified = () => {};
    }

    this._container.removeEventListener('click', this._handleContainerClick);

    for (const key in this._boundEvents) {
      const event = key as keyof TEvents;
      if (!this._boundEvents[event]) continue;
      this._eventBus.off(event, this._boundEvents[event]);
      this._boundEvents[event] = undefined;
    }
    this._eventBus._listeners = [];
    this._boundEvents = Object.create(null);

    this._container.removeEventListener(
      'scroll',
      this._viewer.scroll._eventHandler,
      true
    );
  }

  protected boundedPageNumber(pageNumber: number) {
    return Math.max(Math.min(pageNumber, this._viewer.pagesCount), 1);
  }

  /**
   * This will allow the viewer to be fully destroyed and garbage collected
   * However it may persist if there are other references to it so it also minimizes the memory footprint
   */
  protected async destroy() {
    await this._popupViewer?.destroy();
    this._popupViewer = undefined;

    this.unmount();

    this.#unbindEvents();

    this._overlays = [];
    this._processedOverlaysByPage = [];
    this._processedOverlayContainersByPage = [];
    this._pageOverlayContainersByPage = [];
    this._pageViewsMarkedForOverlay = new Set();

    for (const page of this._viewer._pages ?? []) {
      page.pdfPage = null;
      page.annotationLayerFactory = null as any;
      page.textLayerFactory = null;
      page.structTreeLayerFactory = null as any;
      page.destroy();
    }
    await this._viewer.pdfDocument?.cleanup();
    await this._viewer.pdfDocument?.destroy();
    this._viewer.setDocument(null);
    this._viewer.l10n = null as any;
    this._createTextLayerBuilder = (() => {}) as any;
    this._viewer._pagesCapability.promise = null as any;
    this._viewer = null as any;

    this._eventBus = null as any;
    this._findController = null as any;

    await this._scriptingManager?.setDocument(null);
    this._scriptingManager?.setViewer(null);
    this._scriptingManager = null as any;

    this._linkService?.setDocument(null);
    this._linkService?.setViewer(null);
    this._linkService = null as any;

    this._renderingQueue.setThumbnailViewer(null as any);
    this._renderingQueue.setViewer(null as any);
    this._renderingQueue = null as any;

    this._thumbnailViewer?.cleanup();
    this._thumbnailViewer?.setDocument(null as any);
    this._thumbnailViewer = undefined;
    this._thumbnailViewerContainer = undefined;
    this._thumbnailViewerMountpoint = undefined;

    this._mountpoint = null;
    this._container.remove;
    this._container = null as any;
    this._floatingPopupContainer = null as any;
    this._popupTargetID = undefined;
    this._popupTargetHref = undefined;
    this._callout = undefined;
    this._calloutTimeout = undefined;
    this.#calloutDiv = undefined;

    this._selectionOverlay = null;
    this._onDefinitionClick = () => {};
    this._onScaleChange = () => {};
    this._handleContainerClick = () => {};
    this._handleFormUpdate = () => {};
    this._handlePageReset = () => {};
    this._handleScriptingReady = () => {};
    this._handleSandboxCreated = (() => {}) as any;
    this._handleViewerWheel = () => {};
    this._handleViewerTouchMove = () => {};
    this._debouncedMarkPageViewsChanged = (() => {}) as any;
  }

  protected resetOverlays() {
    this._processedOverlaysByPage.length = 0;
  }

  /**
   * Displays the callout banner at a given page number at a certain yPos and height
   */
  callout(callout: TCallout) {
    if (!callout.height) {
      return;
    }

    this._callout = callout as Required<TCallout>;
    const pageView = this._viewer._pages?.[this._viewer.currentPageNumber - 1];
    if (pageView) {
      this.#displayCallout(pageView);
    }
  }

  handleViewerEvent<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (event: HTMLElementEventMap[K]) => any
  ) {
    const viewer = this._viewer.viewer as HTMLElement | null;
    viewer?.addEventListener(type, listener);
    return () => {
      viewer?.removeEventListener(type, listener);
    };
  }

  handlePDFEvent<TEvent extends keyof TEvents>(
    eventName: TEvent,
    listener: TEventListener<TEvent>
  ) {
    this._eventBus.on(eventName, listener);
    return () => {
      this._eventBus.off(eventName, listener);
    };
  }

  // TODO: the proper way is to extend the generic scripting module
  // and override the external method calls, but this works for now
  // Another approach would be to change the form API logic entirely to
  // call our own external functions that we hook up, which would give us finer control
  private _handleSandboxCreated = async () => {
    if (this._scriptingManager?._scripting == null) {
      console.error('expected scripting to be available');
      return;
    }
    const sandbox = await this._scriptingManager._scripting._ready;
    if (sandbox == null) {
      console.error('expected sandbox to be available');
      return;
    }

    const externalCallHandler = sandbox._module.externalCall;
    sandbox._module.externalCall = function replacementCallHandler(
      name: string,
      args: any
    ) {
      switch (name) {
        case 'alert': {
          return showMessageBoxSync({
            type: 'warning',
            title: 'Macro',
            message: args[0],
            buttons: ['OK'],
            defaultId: 0,
          });
        }
        case 'confirm': {
          return (
            showMessageBoxSync({
              type: 'question',
              title: 'Macro',
              message: args[0],
              buttons: ['OK', 'Cancel'],
              defaultId: 0,
              cancelId: 1,
            }) === 0
          );
        }
        // TODO: Nothing we can do about prompt, but hopefully that's not going to get used?
        default: {
          return externalCallHandler(name, args);
        }
      }
    };
  };

  private _handleFormUpdate = () => {
    const storage = this._viewer.pdfDocument?.annotationStorage;
    if (!storage) return;

    this._eventBus.dispatch('updateFormState', {
      source: storage,
      modified: storage._modified,
    });

    // Reset the modified state after the event is dispatched so subsequent changes are detected
    // NOTE: this does not undo the changes, just resets the flag
    storage.resetModified();
  };

  private _handleScriptingReady = () => {
    // After scripting is ready in PDF.js, there is a queued timeout of 0 for the 'Open' scripting event which may incorrectly flag the annotations as modified
    setTimeout(() => {
      const annotationStorage = this._viewer.pdfDocument?.annotationStorage;
      if (annotationStorage != null) {
        annotationStorage._modified = false;
        annotationStorage.onSetModified = this._handleFormUpdate;
      }
    }, 0);
  };

  setOnDefinitionClick(
    onDefinitionClick: (
      ref: HTMLDivElement,
      pageIndex: number,
      term: string
    ) => void
  ) {
    this._onDefinitionClick = onDefinitionClick;
  }

  /** Converts a window viewport [DOMRect] to page rect [Rect]} in percentages
   * dealing with percentages helps us scale the overlays when the page is zoomed */
  windowToPagePercentCoords(pageIndex: number, windowCoords: DOMRect): Rect {
    // Why not just use the pageView rect?
    // Because the bounding rect of the overlay container is slightly larger than the actual page rect
    const pageOverlayContainer = this._pageOverlayContainersByPage[pageIndex];
    const pageRect = pageOverlayContainer.getBoundingClientRect();

    const pageX = windowCoords.x - pageRect.x;
    const pageY = windowCoords.y - pageRect.y;

    return {
      x: (pageX / pageRect.width) * 100,
      y: (pageY / pageRect.height) * 100,
      width: (windowCoords.width / pageRect.width) * 100,
      height: (windowCoords.height / pageRect.height) * 100,
    };
  }

  pdfToPagePercentCoords(pageIndex: number, pdfCoords: Rect): Rect {
    const pageView = this._viewer.getPageView(pageIndex);
    const boundingRect = [
      pageView.viewport.convertToViewportPoint(pdfCoords.x, pdfCoords.y),
      pageView.viewport.convertToViewportPoint(
        pdfCoords.x + pdfCoords.width,
        pdfCoords.y + pdfCoords.height
      ),
    ] as Array<Array<number>>;
    // Why not just use the pageView rect?
    // Because the bounding rect of the overlay container is slightly larger than the actual page rect
    const pageOverlayContainer = this._pageOverlayContainersByPage[pageIndex];
    const pageOverlayContainerRect =
      pageOverlayContainer.getBoundingClientRect();
    const pageX = boundingRect[0][0];
    const pageY = boundingRect[0][1];

    return {
      x: (pageX / pageOverlayContainerRect.width) * 100,
      y: (pageY / pageOverlayContainerRect.height) * 100,
      width:
        ((boundingRect[1][0] - boundingRect[0][0]) /
          pageOverlayContainerRect.width) *
        100,
      height:
        ((boundingRect[0][1] - boundingRect[1][1]) /
          pageOverlayContainerRect.height) *
        100,
    };
  }

  private buildTermOverlay(pageIndex: number, pdfCoords: Rect): HTMLDivElement {
    const rect = this.pdfToPagePercentCoords(pageIndex, pdfCoords);
    const overlayElement = document.createElement('div');

    overlayElement.style.position = 'absolute';
    overlayElement.style.left = `${rect.x}%`;
    overlayElement.style.top = `${rect.y}%`;
    // Oversize slightly to make sure the whole char is covered
    overlayElement.style.width = `${rect.width * 1.05}%`;
    overlayElement.style.height = `${rect.height * 1.1}%`;
    overlayElement.style.mixBlendMode = 'lighten';
    overlayElement.style.cursor = 'var(--cursor-pointer)';
    overlayElement.style.transition = 'all 0.3s ease-in-out';
    overlayElement.style.pointerEvents = 'auto';
    overlayElement.addEventListener('mouseenter', () => {
      overlayElement.style.backgroundColor = '#3B82F6';
    });
    overlayElement.addEventListener('mouseleave', () => {
      overlayElement.style.backgroundColor = 'transparent';
    });

    return overlayElement;
  }

  initializeStoredDefinitionOverlays(
    definitions: Array<{ term: string; results: Match[] }>
  ): void {
    for (let definition of definitions) {
      this.generateOverlaysForTerm(definition.term, definition.results);
    }
  }

  generateOverlaysForTerm(term: string, results: Match[]) {
    for (let result of results) {
      for (let rect of result.rects) {
        const overlayElement = this.buildTermOverlay(result.page_number, rect);
        overlayElement.addEventListener('click', () =>
          this._onDefinitionClick(overlayElement, result.page_number, term)
        );
        const pageOverlayContainer =
          this._processedOverlayContainersByPage[result.page_number];
        pageOverlayContainer.appendChild(overlayElement);
      }
    }
    this._debouncedMarkPageViewsChanged();
  }

  /** Generates an overlay element given a window based text selection */
  generateOverlayForSelection(
    pageIndex: number,
    selection: Selection
  ): {
    element: HTMLElement;
    location: Rect;
  } | null {
    const range = selection.getRangeAt(0);
    // focus node will be the end span
    let lastTextNode = selection.focusNode?.parentElement;
    if (lastTextNode?.tagName !== 'SPAN') {
      // fixes triple click line selection
      lastTextNode = range.startContainer.parentElement;
    }
    const rect = lastTextNode
      ? lastTextNode.getBoundingClientRect()
      : range.getBoundingClientRect();
    const pdfCoords = this.windowToPagePercentCoords(pageIndex, rect);
    return this.setSelectionOverlay(pageIndex, pdfCoords, false);
  }

  generateOverlayForSelectionRect(pageIndex: number, selection: Rect) {
    return this.setSelectionOverlay(
      pageIndex,
      new DOMRect(selection.x, selection.y, selection.width, selection.height),
      true
    );
  }

  clearAllOverlays() {
    if (this._selectionOverlay) {
      this._selectionOverlay.remove();
    }
  }

  private setSelectionOverlay(
    pageNumber: number,
    rect: Rect,
    visible?: boolean
  ): {
    element: HTMLElement;
    location: Rect;
  } | null {
    if (this._selectionOverlay) {
      this._selectionOverlay.remove();
    }
    const overlayElement = document.createElement('div');
    overlayElement.className = 'selectionOverlay';
    overlayElement.style.position = 'absolute';
    overlayElement.style.left = `${rect.x}%`;
    overlayElement.style.top = `${rect.y}%`;
    overlayElement.style.width = `${rect.width}%`;
    overlayElement.style.height = `${rect.height}%`;
    if (visible) {
      overlayElement.style.backgroundColor = '#3B82F6';
      overlayElement.style.opacity = '0.25';
    }

    const pageOverlayContainer = this._pageOverlayContainersByPage[pageNumber];
    if (!pageOverlayContainer) return null;
    pageOverlayContainer.appendChild(overlayElement);
    this._debouncedMarkPageViewsChanged();
    this._selectionOverlay = overlayElement;

    return {
      element: overlayElement,
      location: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  }
}

export function overlaysToElements(overlays: string[]) {
  return overlays.map((overlay) => {
    const el = document.createElement('div');
    el.innerHTML = overlay;
    el.className = 'overouter mouseup';
    el.addEventListener('mousedown', overlayMouseDown);
    el.addEventListener('mouseup', overlayMouseUp);
    return el;
  });
}

function overlayMouseDown(evt: MouseEvent) {
  evt.stopPropagation();
  (evt.currentTarget as HTMLDivElement).classList.remove('mouseup');
}

function overlayMouseUp(evt: MouseEvent) {
  (evt.currentTarget as HTMLDivElement).classList.add('mouseup');
}

function elementHasChild(el: HTMLElement, targetChild: HTMLElement): boolean {
  for (let child of el.childNodes) {
    if (targetChild === child) return true;
  }

  return false;
}

function disableTextLayer(pageView: PDFPageView) {
  if (pageView.textLayer?.textLayerDiv == null) return;
  pageView.textLayer.textLayerDiv.style.userSelect = 'none';
}

function enableTextLayer(pageView: PDFPageView) {
  if (pageView.textLayer?.textLayerDiv == null) return;
  pageView.textLayer.textLayerDiv.style.userSelect = '';
}
