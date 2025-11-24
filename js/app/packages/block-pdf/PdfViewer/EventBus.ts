import type { AnnotationStorage } from 'pdfjs-dist/types/src/display/annotation_storage';
import {
  FindState as _FindState,
  EventBus,
  type PDFPageView,
  type PDFScriptingManager,
} from 'pdfjs-dist/web/pdf_viewer';
import type { FindController } from './FindController';

export interface ISourcedEvent {
  source: any;
}

export interface IPageRenderEvent extends ISourcedEvent {
  pageNumber: number;
}

export interface IPageRenderedEvent extends IPageRenderEvent {
  source: PDFPageView;
  cssTransform: boolean;
  timestamp: number;
  error: Error | null;
}

export interface IMatchesCount {
  current: number;
  total: number;
}

export interface IAnnotationLayerRenderedEvent extends IPageRenderEvent {
  source: PDFPageView;
  error: Error | null;
}

export interface IUpdateFindMatchesCountEvent extends ISourcedEvent {
  source: FindController;
  /** the total matches, can be 0/0 even when FOUND, need to wait on updatefindmatchescount */
  matchesCount: IMatchesCount;
}

export enum FindState {
  FOUND = _FindState.FOUND, // 0
  WRAPPED = _FindState.WRAPPED, // 1
  PENDING = _FindState.PENDING, // 2
  NOT_FOUND = _FindState.NOT_FOUND, // 3
}

export interface IUpdateFindControlStateEvent
  extends IUpdateFindMatchesCountEvent {
  /** FindState.{FOUND,WRAPPED,NOT_FOUND,PENDING} */
  state: FindState;
  /** true if searching backward, false otherwise */
  previous: boolean;
  /** the original search string */
  rawQuery: string;
}

export interface IPagesLoadedEvent extends ISourcedEvent {
  pagesCount: number;
}

export interface IScrollMatchEvent extends ISourcedEvent {
  element: HTMLElement | null;
  selectedLeft: number;
  pageIndex: number;
  matchIndex: number;
  yPos?: number;
}

export interface IFindEvent {
  /** The object that initiated the find operation */
  source: any;
  /** Search type: '' for new search (with timeout), 'again' for repeat search (immediate) */
  type: '' | 'again';
  /** The search text/term to find in the PDF */
  query: string;
  /** If true, search for exact phrase; if false, match partial words */
  phraseSearch: boolean;
  /** If true, match case exactly; if false, ignore case differences */
  caseSensitive: boolean;
  /** If true, only match complete words; if false, match partial words.
   * e.g. credit will match creditors if entireWord is false */
  entireWord: boolean;
  /** If true, highlight all matches in document; if false, only highlight current match */
  highlightAll: boolean;
  /** If true, search backwards (previous match); if false, search forwards (next match) */
  findPrevious: boolean;
}

export interface IUpdateFormState extends ISourcedEvent {
  source: AnnotationStorage;
  modified: boolean;
}

export interface IOpenNewTabEvent extends ISourcedEvent {
  locationHash: string;
}

export interface IVisiblePage {
  /** Page number */
  id: number;
  x: number;
  y: number;
  view: PDFPageView;
  percent: number;
  widthPercent: number;
}

export interface IVisiblePages {
  first: IVisiblePage;
  last: IVisiblePage;
  views: IVisiblePage[];
  /** The set of page numbers (ids) of visible pages */
  ids: Set<number>;
}

export interface IUpdateViewArea extends ISourcedEvent {
  location: {
    pageNumber: number;
    scale: number | string;
    top: number;
    left: number;
    rotation: number;
    pdfOpenParams: string;
    unscaledYPos: number;
    viewportScale: number;
  };
  visiblePages: IVisiblePages;
  forceUpdate?: true;
}

export interface IProcessedOverlaysReadyEvent extends ISourcedEvent {
  processedOverlaysByPage: ReadonlyArray<HTMLDivElement>;
}

export interface IProcessedOverlaysRenderedEvent extends ISourcedEvent {
  processedOverlaysByPage: ReadonlyArray<HTMLDivElement>;
  processedOverlayContainersByPage: ReadonlyArray<HTMLDivElement>;
}

export interface IScaleChangingEvent extends ISourcedEvent {
  scale: number;
  presetValue: number | string | undefined;
}

export interface IPageChangingEvent extends ISourcedEvent {
  pageNumber: number;
  previous: number;
  pageLabel: string | null;
}

export interface IPageResetEvent extends ISourcedEvent {
  source: PDFPageView;
  keepAnnotationLayer: boolean;
}

export interface IOverlayViewsChangedEvent {
  views: PDFPageView[];
}

export interface IScriptingManagerEvent {
  source: PDFScriptingManager;
}

export interface IPopupVisibilityChangedEvent extends ISourcedEvent {
  isOpen: boolean;
  target: HTMLElement;
}

export type TEvents = {
  pagesinit: ISourcedEvent;
  pagesdestroy: ISourcedEvent;
  pagesloaded: IPagesLoadedEvent;
  scrollmatch: IScrollMatchEvent;
  updateviewarea: IUpdateViewArea;
  // PDFPageView
  pagereset: IPageResetEvent;
  pagerender: IPageRenderEvent;
  annotationlayerrendered: IAnnotationLayerRenderedEvent;
  pagerendered: IPageRenderedEvent;
  scalechanging: IScaleChangingEvent;
  pagechanging: IPageChangingEvent;
  // FindController
  find: IFindEvent;
  findbarclose: ISourcedEvent;
  updatefindmatchescount: IUpdateFindMatchesCountEvent;
  updatefindcontrolstate: IUpdateFindControlStateEvent;
  // PDFScriptingManager
  sandboxcreated: IScriptingManagerEvent;
  scriptingready: IScriptingManagerEvent;
  updatefromsandbox: ISourcedEvent;
  // Custom events
  processedOverlaysReady: IProcessedOverlaysReadyEvent;
  processedOverlaysRendered: IProcessedOverlaysRenderedEvent;
  openNewTab: IOpenNewTabEvent;
  overlayViewsChanged: IOverlayViewsChangedEvent;
  updateFormState: IUpdateFormState;
  popupvisibilitychanged: IPopupVisibilityChangedEvent;
};

export type TEventListener<TEvent extends keyof TEvents> = (
  event: TEvents[TEvent]
) => void;

export interface IEventBus extends EventBus {
  /** Attach a listener for an event defined in TEvent. */
  on<TEvent extends keyof TEvents>(
    eventName: TEvent,
    listener: TEventListener<TEvent>
  ): void;
  /** Detach a listener for an event defined in TEvent. */
  off<TEvent extends keyof TEvents>(
    eventName: TEvent,
    listener: TEventListener<TEvent>
  ): void;
  /** Raise an event defined in TEvent. */
  dispatch<TEvent extends keyof TEvents>(
    eventName: TEvent,
    data: TEvents[TEvent]
  ): void;
  /** Runs a callback with all events disabled. */
  withoutEvents(callback: () => void): void;
}

export type IPublicEventBus = Omit<IEventBus, '_on' | '_off' | '_listeners'>;

class _EventBus extends EventBus implements IEventBus {
  withoutEvents(callback: () => void): void {
    const dispatch = super.dispatch;
    const _listeners = this._listeners;
    this.dispatch = nopDispatch;
    this._listeners = Object.create(null);
    callback();
    this._listeners = _listeners;
    this.dispatch = dispatch;
  }
}

function nopDispatch(_eventName: any, _data: any) {}

export function createEventBus(): IEventBus {
  return new _EventBus() as IEventBus;
}
