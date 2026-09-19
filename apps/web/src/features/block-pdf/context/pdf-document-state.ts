import type { Completion } from '@core/client/completion';
import type { CommentId, ThreadId } from '@core/comments/commentType';
import type { ThreeColumnLayout } from '@core/util/threeColumnLayout';
import type { GetDocumentResponseDataViewLocation } from '@service-storage/generated/schemas/getDocumentResponseDataViewLocation';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { Accessor } from 'solid-js';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { IHighlight } from '../model/Highlight';
import type { PDFViewer } from '../PdfViewer';
import type { TEvents } from '../PdfViewer/EventBus';
import { TermDataStore } from '../PdfViewer/TermDataStore';
import { ZOOM_MAX, ZOOM_MIN } from '../PdfViewer/zoom';
import { getPdfAnchors, getPdfComments } from '../queries/annotations';
import type {
  AnnotationLocation,
  GeneralLocation,
  LocationBlockParams,
  PreciseLocation,
  SearchLocation,
} from '../signal/location';
import type { TabInfo } from '../signal/tab';
import type {
  ThreadHeights,
  ThreadPositionsOnPage,
} from '../store/comments/commentLayout';
import type { ISectionPopupContext } from '../store/definitionPopup';
import type { HighlightPageMap, HighlightUuidMap } from '../store/highlight';
import type { ITableOfContentsContext } from '../store/tableOfContents';
import type { CommentStore } from '../type/comments';
import type {
  IModificationData,
  IModificationDataOnServer,
} from '../type/coParse';
import {
  type IPlaceable,
  PayloadMode,
  type PayloadType,
} from '../type/placeables';

const defaultTabData = (id: number): TabInfo => ({
  label: 'Page 1',
  locationHash: '#page=1',
  id,
});

const createDefinitionPopupState = (): ISectionPopupContext => ({
  terms: [],
  termIDs: [],
  termIDToSizingMap: {},
  pageWidth: null,
  element: null,
});

const createTableOfContentsState = (): ITableOfContentsContext => ({
  original: {
    aiToc: null,
    pdfBookmarks: null,
  },
  currentMode: 'bookmarks',
  width:
    typeof window === 'undefined'
      ? 150
      : Math.max(150, Math.round(window.innerWidth * 0.15)),
  sectionToRenameID: null,
  renameFormValue: '',
  sectionToDeleteID: null,
  unsavedBookmarks: false,
  coparse: null,
  items: [],
  openItems: {},
  isLoaded: false,
  pageToSectionMap: [],
  idToSectionMap: {},
  idToPathMap: {},
  idToNearestTitleMap: {},
  aiTocIdToSectionMap: {},
});

export function createPdfDocumentState(documentId: Accessor<string>) {
  const documentProxy = createSignal<PDFDocumentProxy>();
  const viewLocation = createSignal<GetDocumentResponseDataViewLocation>();
  const modificationData = createStore<IModificationData>({
    bookmarks: [],
    placeables: [],
    pinnedTermsNames: [],
  });
  const overlays = createSignal<string[]>();

  const locationChanged = createSignal(false);
  const pendingLocationParams = createSignal<LocationBlockParams>();
  const searchLocationPending = createSignal(false);
  const location = createStore<{
    general: GeneralLocation | undefined;
    precise: PreciseLocation | undefined;
    annotation: AnnotationLocation | undefined;
    search: SearchLocation | undefined;
  }>({
    general: undefined,
    precise: undefined,
    annotation: undefined,
    search: undefined,
  });
  const generalPopupLocation = createSignal<{
    pageIndex: number;
    element: HTMLElement;
    hasHighlight?: boolean;
    hasComment?: boolean;
  } | null>(null);

  const disableOverlayClick = createSignal(false);
  const disableViewerTextSelection = createSignal(false);
  const disablePageViewClick = createSignal(false);
  const isSelectingViewerText = createSignal(false);
  const selectingCommentThread = createSignal<ThreadId | null>(null);

  const search = createSignal('');
  const isSearchOpen = createSignal(false);

  const placeableMode = createSignal<PayloadType>(PayloadMode.NoMode);
  const showTabBar = createSignal(false);
  const activePlaceableId = createSignal<string>();
  const newPlaceable = createSignal<IPlaceable>();
  const fontPreference = createSignal<
    'Times New Roman' | 'Courier' | 'Helvetica'
  >('Times New Roman');

  const numOperations = createSignal(0);
  const savingCount = createSignal(0);
  const isSaving = createSignal(false);
  const modificationDataSaveRequired = createSignal(false);
  const serverModificationData = createSignal<IModificationDataOnServer>();

  const tabId = createSignal(0);
  const tabData = createStore<TabInfo[]>([defaultTabData(0)]);
  const activeTabId = createSignal(0);
  const tabHistory = createSignal<number[]>([0]);

  const rootViewer = createSignal<PDFViewer>();
  const popupViewer = createSignal<PDFViewer>();
  const pagesLoaded = createSignal<TEvents['pagesloaded']>();
  const scaleChanging = createSignal<TEvents['scalechanging']>();
  const pageChanging = createSignal<TEvents['pagechanging']>();
  const overlayViewsChanged = createSignal<TEvents['overlayViewsChanged']>();
  const popupVisibilityChanged =
    createSignal<TEvents['popupvisibilitychanged']>();
  const visiblePagesChanged = createSignal<TEvents['updateviewarea']>();
  const updateFindControlState =
    createSignal<TEvents['updatefindcontrolstate']>();
  const updateFindMatchesCount =
    createSignal<TEvents['updatefindmatchescount']>();
  const scaleChangingPopup = createSignal<TEvents['scalechanging']>();
  const pageChangingPopup = createSignal<TEvents['pagechanging']>();
  const overlayViewsChangedPopup =
    createSignal<TEvents['overlayViewsChanged']>();
  const visiblePagesChangedPopup = createSignal<TEvents['updateviewarea']>();
  const viewerHasVisiblePages = createSignal(false);
  const pageHeight = createStore<Partial<Record<number, number>>>({});
  const destroying = createSignal(false);

  const viewerThreeColumnLayout = createSignal<ThreeColumnLayout>({
    isInitialized: false,
    leftWidth: 352,
    rightWidth: 293,
    rightMargin: 6,
    centerWidth: -1,
    windowWidth: -1,
    marginWidth: -1,
  });

  const highlights = createStore<HighlightPageMap>({});
  const selection = createStore<{
    highlightsUnderSelection: IHighlight[];
    selection: Selection | null;
    selectionString: string;
  }>({
    highlightsUnderSelection: [],
    selection: null,
    selectionString: '',
  });
  const activeHighlight = createSignal<string | null>(null);
  const hoverHighlight = createSignal<string | null>(null);
  const popupSelectedText = createSignal<string>();
  const popupCompletion = createSignal<Completion>();
  const isPopupDrag = createSignal(false);

  const convertedHighlightThreadId = createSignal<string | null>(null);
  const activeCommentThread = createSignal<ThreadId | null>(null);
  const noScrollToActiveCommentThread = createSignal(false);
  const comments = createStore<CommentStore>([]);
  const threadHeight = createStore<Partial<ThreadHeights>>({});
  const threadsOnPagePosition = createStore<ThreadPositionsOnPage>({});

  const rootDefinition = createStore<ISectionPopupContext>(
    createDefinitionPopupState()
  );
  const popupDefinition = createStore<ISectionPopupContext>(
    createDefinitionPopupState()
  );
  const tableOfContents = createStore<ITableOfContentsContext>(
    createTableOfContentsState()
  );

  const commentThreads = createResource(documentId, getPdfComments);
  const anchors = createResource(documentId, getPdfAnchors);

  const popupOpen = createMemo(
    () => popupVisibilityChanged[0]()?.isOpen ?? false
  );
  const currentPageNumber = createMemo(
    () => pageChanging[0]()?.pageNumber ?? 1
  );
  const currentScale = createMemo(() => scaleChanging[0]()?.scale);
  const canZoomIn = createMemo(() => {
    const scale = currentScale();
    return !!(scale && scale < ZOOM_MAX);
  });
  const canZoomOut = createMemo(() => {
    const scale = currentScale();
    return !!(scale && scale > ZOOM_MIN);
  });
  const pageCount = createMemo(() => pagesLoaded[0]()?.pagesCount);
  const popupCurrentPageNumber = createMemo(
    () => pageChangingPopup[0]()?.pageNumber ?? 1
  );
  const popupCurrentScale = createMemo(() => scaleChangingPopup[0]()?.scale);
  const viewerReady = createMemo(() => {
    const loaded = pagesLoaded[0]();
    return !!loaded && loaded.pagesCount > 0;
  });
  const highlightList = createMemo(() => {
    const result: IHighlight[] = [];
    for (const pageHighlights of Object.values(highlights[0] ?? {})) {
      if (!pageHighlights) continue;
      for (const highlight of Object.values(pageHighlights)) {
        if (highlight) result.push(highlight);
      }
    }
    return result;
  });
  const highlightsUuidMap = createMemo(() => {
    const result: HighlightUuidMap = {};
    for (const pageHighlights of Object.values(highlights[0] ?? {})) {
      if (!pageHighlights) continue;
      for (const [uuid, highlight] of Object.entries(pageHighlights)) {
        result[uuid] = highlight;
      }
    }
    return result;
  });
  const commentMap = createMemo(() => {
    const result = new Map<CommentId, CommentStore[number]>();
    for (const comment of comments[0]) result.set(comment.id, comment);
    return result;
  });

  createEffect(() => {
    const disabled =
      placeableMode[0]() !== PayloadMode.NoMode || isSelectingViewerText[0]();
    disableOverlayClick[1](disabled);
  });
  createEffect(() => {
    if (isSelectingViewerText[0]()) selectingCommentThread[1](null);
  });
  createEffect(() => {
    disableViewerTextSelection[1](selectingCommentThread[0]() != null);
  });
  createEffect(() => {
    const ids = visiblePagesChanged[0]()?.visiblePages.ids;
    viewerHasVisiblePages[1](!!ids && ids.size > 0);
  });
  createEffect(() => {
    const event = overlayViewsChanged[0]();
    if (!event) return;
    const updated: Partial<Record<number, number>> = {};
    for (const pageView of Object.values(event.views)) {
      updated[pageView.id - 1] = pageView.viewport.height;
    }
    pageHeight[1](reconcile(updated));
  });

  return {
    signals: {
      documentProxy,
      viewLocation,
      overlays,
      locationChanged,
      pendingLocationParams,
      searchLocationPending,
      generalPopupLocation,
      disableOverlayClick,
      disableViewerTextSelection,
      disablePageViewClick,
      isSelectingViewerText,
      selectingCommentThread,
      search,
      isSearchOpen,
      placeableMode,
      showTabBar,
      activePlaceableId,
      newPlaceable,
      fontPreference,
      numOperations,
      savingCount,
      isSaving,
      modificationDataSaveRequired,
      serverModificationData,
      tabId,
      activeTabId,
      tabHistory,
      rootViewer,
      popupViewer,
      pagesLoaded,
      scaleChanging,
      pageChanging,
      overlayViewsChanged,
      popupVisibilityChanged,
      visiblePagesChanged,
      updateFindControlState,
      updateFindMatchesCount,
      scaleChangingPopup,
      pageChangingPopup,
      overlayViewsChangedPopup,
      visiblePagesChangedPopup,
      viewerHasVisiblePages,
      destroying,
      viewerThreeColumnLayout,
      activeHighlight,
      hoverHighlight,
      popupSelectedText,
      popupCompletion,
      isPopupDrag,
      convertedHighlightThreadId,
      activeCommentThread,
      noScrollToActiveCommentThread,
    },
    stores: {
      modificationData,
      location,
      tabData,
      pageHeight,
      highlights,
      selection,
      comments,
      threadHeight,
      threadsOnPagePosition,
      rootDefinition,
      popupDefinition,
      tableOfContents,
    },
    resources: {
      commentThreads,
      anchors,
    },
    derived: {
      popupOpen,
      currentPageNumber,
      currentScale,
      canZoomIn,
      canZoomOut,
      pageCount,
      popupCurrentPageNumber,
      popupCurrentScale,
      viewerReady,
      highlightList,
      highlightsUuidMap,
      commentMap,
    },
    termDataStore: new TermDataStore(),
  };
}

export type PdfDocumentState = ReturnType<typeof createPdfDocumentState>;
