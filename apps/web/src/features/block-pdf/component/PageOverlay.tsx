import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { PDFPopup } from '@block-pdf/component/PDFPopup';
import {
  useOwnedCommentPlaceableSelector,
  useOwnedHighlightSelector,
} from '@block-pdf/signal/permissions';
import { useDoEdit } from '@block-pdf/signal/save';
import { useCommentPlaceables } from '@block-pdf/store/comments/freeComments';
import { useCreateHighlightCommentAtSelection } from '@block-pdf/store/comments/highlightComments';
import { useCreatePlaceable } from '@block-pdf/store/placeables';
import { PayloadMode, type PayloadType } from '@block-pdf/type/placeables';
import { getHighlightsFromSelection } from '@block-pdf/util/pdfjsUtils';
import { useIsAuthenticated } from '@core/auth';
import { openLoginModal } from '@core/component/TopBar/LoginButton';
import { cn } from '@ui';
import { detect } from 'detect-browser';
import type { PageViewport } from 'pdfjs-dist';
import type { PDFPageView } from 'pdfjs-dist/web/pdf_viewer';
import {
  batch,
  createEffect,
  createMemo,
  createSelector,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import type { IColor } from '../model/Color';
import { Highlight, HighlightType } from '../model/Highlight';
import { PageModel } from '../model/Page';
import type Term from '../model/Term';
import { LocationType, useCreateShareUrl } from '../signal/location';
import { useIsPopup } from '../signal/pdfViewer';
import { usePopupContextUpdate, usePopupStore } from '../store/definitionPopup';
import { useAddNewHighlights, useRemoveHighlight } from '../store/highlight';
import { useGetIdToSectionMap } from '../store/tableOfContents';
import TocUtils from '../util/TocUtils';
import { AbsoluteDefinitionLookups } from './AbsoluteDefinitionLookups';
import { Placeable } from './Placeable';
import { RightMarginLayout } from './RightMarginLayout';
import { UserHighlight, useResetUserHighlights } from './UserHighlight';

export interface IPageOverlayProps {
  pageIndex: number;
  viewport: PageViewport;
  pageViewDiv: PDFPageView['div'];
}

export interface IHighlightObj {
  left: number;
  top: number;
  width: number;
  height: number;
  color: IColor;
  threadId: number | null;
  highlightId: string; // uuid of the highlight that contains this rect
  rectId: string; // unique identifier of this rect
  text?: string;
  isActive: boolean;
}

// This is where all the page-specifc overlays should reside, like placeables, etc.
export function PageOverlay(props: IPageOverlayProps) {
  const analytics = useAnalytics();

  const pdf = usePdfDocument();
  const { signals, stores, derived } = pdf.state;
  let pageOverlayRef!: HTMLDivElement;
  const pageViewDivProp = () => props.pageViewDiv;

  const modificationPlaceablesAccess = pdf.permissions.canEdit;
  const commentAccess = pdf.permissions.canComment;
  const isDocumentOwner = pdf.permissions.isOwner;

  const [mode, setMode] = signals.placeableMode;
  const getPopupViewer = signals.popupViewer[0];
  const getRootViewer = signals.rootViewer[0];
  const getIdToSectionMap = useGetIdToSectionMap();
  const isPopup = useIsPopup();
  const popupDispatchCtx = usePopupContextUpdate(isPopup);
  const popupTerms = usePopupStore(isPopup).terms;
  const resetUserHighlights = useResetUserHighlights();
  const isAuth = useIsAuthenticated();
  const createPlaceable = useCreatePlaceable();
  const commentPlaceables = useCommentPlaceables();
  const disableOverlayClick = signals.disableOverlayClick[0];
  const setActiveThreadId = signals.activeCommentThread[1];
  const disablePageViewClick = signals.disablePageViewClick[0];
  const termDataStore = pdf.state.termDataStore;

  const onClick = (e: MouseEvent) => {
    if (disablePageViewClick()) return;

    if (mode() !== PayloadMode.NoMode) {
      return;
    }

    resetUserHighlights();

    const tgt = e.target as Element;
    const parent = tgt.parentElement;
    const secID = parent?.getAttribute('secid');
    const defID = parent?.getAttribute('defid');

    if (defID) {
      // display definition for term
      const tokenID = tgt.getAttribute('id');

      if (!tokenID) {
        console.error('Missing token ID on click');
        return;
      }

      const targetNode = tgt;

      if (!targetNode) {
        console.error('Could not find node with ID');
        return;
      }

      const term = termDataStore?.get(defID);

      if (!term) {
        console.error('Term not found on click');
        return;
      }

      term.id = tokenID;
      const pageIndex = PageModel.getPageIndex(targetNode as HTMLElement)!;
      term.index = pageIndex;
      popupDispatchCtx({
        type: 'REMOVE_POPUPS',
      });
      popupDispatchCtx({
        type: 'SET_TERM_FROM_ELEMENT',
        term,
        element: targetNode,
        pageWidth: getRootViewer()?.pageDimensions(pageIndex, true)?.width ?? 0,
      });
      analytics.track('block_pdf_definition_open');
    } else if (secID) {
      // display section popup
      e.stopPropagation();

      const secIDNumber = parseInt(secID);
      const idToSectionMap = getIdToSectionMap();
      const { page, y } = TocUtils.getSection({
        id: secIDNumber,
        idToSectionMap,
      });

      analytics.track('block_pdf_section_open');

      getPopupViewer()?.scrollTo({ pageNumber: page + 1, yPos: y });
      if (!isPopup) getRootViewer()?.showPopupAt(tgt as HTMLElement);
    } else {
      if (!pageOverlayRef.contains(e.target as Node)) {
        popupDispatchCtx({ type: 'REMOVE_POPUPS' });
      }
    }
  };

  const pageTerm = createMemo(
    (): {
      terms: Term[];
      rootTermID: string | null;
    } => {
      const allTerms = popupTerms();
      if (allTerms[0]?.index !== props.pageIndex) {
        return { terms: [], rootTermID: null };
      }
      return { terms: allTerms, rootTermID: allTerms[0]?.id ?? null };
    }
  );

  const terms = () => pageTerm().terms;
  const rootTermID = () => pageTerm().rootTermID;

  createEffect(() => {
    if (rootTermID() == null) return;

    popupDispatchCtx({
      type: 'SET_RECTS',
      pageWidth: props.viewport.width,
    });
  });

  const onKeyDown = (e: KeyboardEvent) => {
    // Ignore custom handling if editing inside a text placeable
    if (
      document.activeElement &&
      (document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'INPUT')
    ) {
      return;
    }
    const browser = detect();
    // Handle copy/cut here since clipboard event listeners are blocked with some placeable types
    if (
      e.key === 'c' &&
      ((browser?.os !== 'Mac OS' && e.ctrlKey) ||
        (browser?.os === 'Mac OS' && e.metaKey))
    ) {
      return;
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    // TODO: Handle images copied externally
    if (
      document.activeElement &&
      (document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'INPUT')
    ) {
      return;
    }
    if (e.clipboardData && e.clipboardData.getData('text/plain').length > 0) {
    }
  };

  createEffect(() => {
    const pageViewDiv = pageViewDivProp();
    if (!pageViewDiv) return;

    pageViewDiv.addEventListener('click', onClick);
    // -1 tabIndex denotes elements that should not be navigated to using Tab but need keyboard focus
    // keyboard focus is necessary to capture "keydown" events
    pageViewDiv.tabIndex = -1;
    onCleanup(() => {
      pageViewDiv.removeEventListener('click', onClick);
    });

    if (pdf.isNested()) return;
    pageViewDiv.addEventListener('paste', onPaste);
    pageViewDiv.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      pageViewDiv.removeEventListener('paste', onPaste);
      pageViewDiv.removeEventListener('keydown', onKeyDown);
    });
  });

  const disableSelect = signals.disableViewerTextSelection[0];
  createEffect(() => {
    const pageViewDiv = pageViewDivProp();
    if (!pageViewDiv) return;
    if (disableSelect()) {
      pageViewDiv.classList.add('noSelect');
    } else {
      pageViewDiv.classList.remove('noSelect');
    }
  });

  onMount(() => {
    const resetMode = (_e: MouseEvent) => {
      setActiveThreadId(null);
      setMode(PayloadMode.NoMode);
    };
    const el = pdf.rootElement();
    if (!el) return;
    el.addEventListener('click', resetMode);
    onCleanup(() => el.removeEventListener('click', resetMode));
  });

  const getCursorForMode = (mode: PayloadType) => {
    const textModes: PayloadType[] = [
      PayloadMode.TextBox,
      PayloadMode.FreeComment,
      PayloadMode.PageNumber,
      PayloadMode.Thread,
      PayloadMode.HeaderFooter,
      PayloadMode.FreeTextAnnotation,
      PayloadMode.Signature,
    ];
    return textModes.includes(mode) ? 'pointer' : 'text';
  };

  const [selectionStoreValue, setSelectionStore] = stores.selection;

  const addNewHighlights = useAddNewHighlights();
  const doEdit = useDoEdit();
  const setActiveHighlightId = signals.activeHighlight[1];
  const currentPageViewport = () => {
    const pageNumber = isPopup
      ? derived.popupCurrentPageNumber()
      : derived.currentPageNumber();
    const viewer = isPopup ? getPopupViewer() : getRootViewer();
    return (
      viewer?.pageViewport(pageNumber - 1) ?? {
        pageWidth: 0,
        pageHeight: 0,
      }
    );
  };

  const addHighlight = () => {
    if (!selectionStoreValue.selection) return;

    const highlights = getHighlightsFromSelection(
      selectionStoreValue.selection,
      null,
      undefined,
      null,
      undefined,
      {
        width: currentPageViewport().pageWidth,
        height: currentPageViewport().pageHeight,
      }
    );

    const highlightsUnderSelection = [...highlights.values()].map(
      Highlight.toObject
    );

    batch(() => {
      setTimeout(doEdit);
      addNewHighlights(highlightsUnderSelection);
      setSelectionStore('highlightsUnderSelection', highlightsUnderSelection);

      const selection = highlightsUnderSelection.at(0);
      if (!selection) return;

      setActiveHighlightId(selection.uuid);
    });
  };

  const removeHighlight = useRemoveHighlight();

  const removeCurrentHighlight = () => {
    if (selectionStoreValue.highlightsUnderSelection.length < 1) return;

    batch(() => {
      setTimeout(doEdit);
      selectionStoreValue.highlightsUnderSelection.forEach((h) =>
        removeHighlight(h.uuid)
      );
      setSelectionStore('highlightsUnderSelection', []);
    });
  };

  const ownedHighlightSelector = useOwnedHighlightSelector();
  const createHighlightCommentAtSelection =
    useCreateHighlightCommentAtSelection();

  const commentProps = createMemo(() => {
    const currentHighlight = selectionStoreValue.highlightsUnderSelection.at(0);
    const uuid = currentHighlight?.uuid;
    // Although the user can technically take ownership of a highlight
    // when making a comment, deleting the highlight-comment will remove the highlight
    // We dont want to allow this insofar as the original highlight was not created by the user
    // so we need to support this in the backend correctly first
    const canEdit =
      isDocumentOwner() || (!!uuid && ownedHighlightSelector(uuid));
    const canCreate = commentAccess();

    let placeComment: (e: MouseEvent) => void;
    if (isAuth()) {
      placeComment = createHighlightCommentAtSelection;
    } else {
      placeComment = () => openLoginModal();
    }
    return { placeComment, canCreate, canEdit };
  });

  const highlightProps = createMemo(() => {
    const currentHighlight = selectionStoreValue.highlightsUnderSelection.at(0);
    const uuid = currentHighlight?.uuid;
    const canEdit =
      isDocumentOwner() || (!!uuid && ownedHighlightSelector(uuid));
    const canCreate = commentAccess();

    let highlight: () => void;
    if (isAuth()) {
      highlight = addHighlight;
    } else {
      highlight = openLoginModal;
    }
    return {
      highlight,
      removeHighlight: removeCurrentHighlight,
      currentHighlight,
      canEdit,
      canCreate,
    };
  });

  const createShareUrl = useCreateShareUrl();
  const shareLinkProps = () => ({
    share: () => {
      createShareUrl(LocationType.Annotation);
    },
  });

  const aiProps = {
    attachmentId: pdf.documentId(),
  };

  const newPlaceable = signals.newPlaceable[0];
  const newPlaceableId = () => newPlaceable()?.internalId;
  const isNewPlaceableSelector = createSelector(newPlaceableId);
  const activePlaceableId = signals.activePlaceableId[0];
  const isActivePlaceableSelector = createSelector(activePlaceableId);
  const ownedCommentSelector = useOwnedCommentPlaceableSelector();

  const showPopup = createMemo(() => {
    const shouldshow =
      !isPopup && !derived.popupOpen() && !!signals.generalPopupLocation[0]();
    if (!shouldshow) {
      signals.popupSelectedText[1](undefined);
      signals.popupCompletion[1](undefined);
    }
    return shouldshow;
  });

  return (
    <div
      ref={pageOverlayRef}
      class={cn('pageOverlayInner', disableOverlayClick() && 'noClickOverlay')}
      on:click={(e) => {
        if (mode() !== PayloadMode.NoMode) {
          createPlaceable(e);
        }
      }}
    >
      <div
        style={{
          cursor: getCursorForMode(mode()),
          'pointer-events': mode() === PayloadMode.NoMode ? 'none' : 'auto',
          width: '100%',
          height: '100%',
        }}
        class="bg-transparent top-0 left-0 absolute"
      >
        <Show when={showPopup() && signals.generalPopupLocation[0]()}>
          {(generalPopupLocation) => (
            <Show when={generalPopupLocation().pageIndex === props.pageIndex}>
              <PDFPopup
                commentProps={commentProps()}
                highlightProps={highlightProps()}
                shareLinkProps={shareLinkProps()}
                anchorRef={/*@once*/ generalPopupLocation().element}
                aiProps={aiProps}
              />
            </Show>
          )}
        </Show>
      </div>
      <div
        style={{
          cursor: getCursorForMode(mode()),
          'pointer-events': mode() === PayloadMode.NoMode ? 'none' : 'auto',
          width: '100%',
          height: '100%',
        }}
        class="bg-transparent top-0 left-0 absolute"
      >
        {terms().length > 0 && <AbsoluteDefinitionLookups terms={terms()} />}
      </div>
      <div
        style={{
          cursor: getCursorForMode(mode()),
          'pointer-events': mode() === PayloadMode.NoMode ? 'none' : 'auto',
          width: '100%',
          height: '100%',
        }}
        class="bg-transparent top-0 left-0 absolute"
      >
        <UserHighlightNodes
          pageIndex={props.pageIndex}
          viewport={props.viewport}
        />
        <div
          style={{
            height: props.viewport.height.toString(),
            width: props.viewport.width.toString(),
            'transform-origin': '0% 0%',
          }}
          class="top-0 left-0 absolute bg-transparent"
          inert={pdf.isNested()}
        >
          <For each={stores.modificationData[0].placeables}>
            {(placeable) => {
              return (
                <Show
                  when={
                    placeable.pageRange.has(props.pageIndex) &&
                    !placeable.wasDeleted
                  }
                >
                  <Placeable
                    id={placeable.internalId}
                    placeable={placeable}
                    pageNum={props.pageIndex}
                    isNew={isNewPlaceableSelector(placeable.internalId)}
                    isActive={isActivePlaceableSelector(placeable.internalId)}
                    canEdit={modificationPlaceablesAccess()}
                  />
                </Show>
              );
            }}
          </For>
          <For each={commentPlaceables() ?? []}>
            {(placeable) => {
              return (
                <Show
                  when={
                    placeable.pageRange.has(props.pageIndex) &&
                    !placeable.wasDeleted
                  }
                >
                  <Placeable
                    id={placeable.internalId}
                    placeable={placeable}
                    pageNum={props.pageIndex}
                    isNew={isNewPlaceableSelector(placeable.internalId)}
                    isActive={isActivePlaceableSelector(placeable.internalId)}
                    canEdit={ownedCommentSelector(placeable.internalId)}
                  />
                </Show>
              );
            }}
          </For>
        </div>
      </div>
      <Show when={!isPopup}>
        <RightMarginLayout pageNumber={props.pageIndex} />
      </Show>
    </div>
  );
}

function UserHighlightNodes(props: {
  pageIndex: number;
  viewport: PageViewport;
}) {
  const { signals, stores } = usePdfDocument().state;
  const thisPageHighlights = createMemo(() =>
    Object.values(stores.highlights[0][props.pageIndex] ?? {}).filter(
      (h) => !!h
    )
  );

  const viewportHeight = createMemo(() => props.viewport.height);
  const viewportWidth = createMemo(() => props.viewport.width);
  const isActiveHighlightSelector = createSelector(signals.activeHighlight[0]);
  const isActiveThreadSelector = createSelector(signals.activeCommentThread[0]);

  return (
    <For each={thisPageHighlights()}>
      {(h) => (
        <For each={h.rects}>
          {(rect) => {
            const threadId = () => h.thread?.threadId ?? null;
            const isActive = () => {
              if (threadId() == null) return isActiveHighlightSelector(h.uuid);
              return isActiveThreadSelector(threadId());
            };
            return (
              <UserHighlight
                left={viewportWidth() * rect.left}
                top={
                  h.type === HighlightType.UNDERLINE
                    ? viewportHeight() * rect.top +
                      viewportHeight() * rect.height
                    : h.type === HighlightType.STRIKEOUT
                      ? viewportHeight() * rect.top +
                        (viewportHeight() * rect.height) / 2
                      : viewportHeight() * rect.top
                }
                width={viewportWidth() * rect.width}
                height={
                  h.type === HighlightType.UNDERLINE ||
                  h.type === HighlightType.STRIKEOUT
                    ? 2
                    : viewportHeight() * rect.height
                }
                color={h.color}
                threadId={threadId()}
                highlightId={h.uuid}
                rectId={`${h.pageNum}:${rect.toString()}`}
                text={h.text}
                isActive={isActive()}
              />
            );
          }}
        </For>
      )}
    </For>
  );
}
