import {
  activeCommentThreadSignal,
  noScrollToActiveCommentThreadSignal,
} from '@block-pdf/store/comments/commentStore';
import { createBlockSignal } from '@core/block';
import { createCallback } from '@solid-primitives/rootless';
import {
  createMemo,
  type JSX,
  onCleanup,
  onMount,
  type VoidProps,
} from 'solid-js';
import { Color, type IColor } from '../model/Color';
import type { IHighlight } from '../model/Highlight';
import {
  generalPopupLocationSignal,
  useSetLocationStore,
} from '../signal/location';
import { useIsPopup } from '../signal/pdfViewer';
import { usePopupContextUpdate } from '../store/definitionPopup';
import { selectionStore, useGetHighlightByUuid } from '../store/highlight';
import type { IHighlightObj } from './PageOverlay';

const hoverHighlightSignal = createBlockSignal<string | null>(null);
// uuid of the highlight that is currently active
export const activeHighlightSignal = createBlockSignal<string | null>(null);

// TODO: only check for highlight IDs within the block DOM subtree
export const highlightIdSelector = (highlightId: string) =>
  `[data-highlight-id="${highlightId}"]`;

export const useResetUserHighlights = () => {
  const setActiveThread = activeCommentThreadSignal.set;
  const setHoverHighlight = hoverHighlightSignal.set;
  const setActiveHighlight = activeHighlightSignal.set;

  return createCallback(() => {
    setActiveThread(null);
    setActiveHighlight(null);
    setHoverHighlight(null);
  });
};

const isHighlightComment = (highlight: IHighlight) =>
  highlight.thread != null || highlight.hasTempThread;

// export const useGoToHighlight = () => {
//   const getRootViewer = useGetRootViewer();
//   const selectHighlight = useHighlightSelection();
//   const getHighlightByUuid = useGetHighlightByUuid();
//
//   return async (highlightId: string) => {
//     const viewer = getRootViewer();
//     if (!viewer) return;
//
//     let highlightElement: HTMLElement | null = document.querySelector(
//       highlightIdSelector(highlightId)
//     );
//
//     if (!highlightElement) {
//       const highlight = getHighlightByUuid(highlightId);
//       if (!highlight) return;
//       const pageIndex = highlight.pageNum + 1;
//       viewer.scrollTo({
//         pageNumber: pageIndex,
//         yPos: highlight.rects[0].top,
//       });
//     }
//
//     // this lets us wait for the highlight to be added to the DOM before selecting it
//     return new Promise<void>((resolve) => {
//       const observer = new IntersectionObserver((_entries) => {
//         observer.disconnect();
//         // select highlight should jump to the highlight as long as the elemnent is in the DOM
//         selectHighlight(highlightId);
//         resolve();
//       });
//
//       const mutationObserver = new MutationObserver(() => {
//         highlightElement = document.querySelector(
//           highlightIdSelector(highlightId)
//         );
//         if (highlightElement) {
//           mutationObserver.disconnect();
//           observer.observe(highlightElement);
//         }
//       });
//
//       mutationObserver.observe(document.body, {
//         childList: true,
//         subtree: true,
//       });
//
//       // If the element is already in the DOM, start observing it immediately
//       if (highlightElement) {
//         observer.observe(highlightElement);
//       }
//     });
//   };
// };

// TODO: handle highlight selection in a different document
export const useHighlightSelection = () => {
  const setSelectionStore = selectionStore.set;
  const getHighlightByUuid = useGetHighlightByUuid();
  const setActiveThread = activeCommentThreadSignal.set;
  const setActiveHighlight = activeHighlightSignal.set;
  const setGeneralPopupLocation = generalPopupLocationSignal.set;
  const setLocationStore = useSetLocationStore();

  return (highlightId: string, element?: HTMLElement) => {
    const highlight = getHighlightByUuid(highlightId);
    if (!highlight) return;

    // handle comments and regular highlights differently
    if (isHighlightComment(highlight)) {
      setActiveThread(highlight.thread?.threadId ?? null);
    } else {
      setActiveHighlight(highlightId);
      setActiveThread(null);
    }

    // Find the highlight element in the DOM
    const highlightElement =
      element ??
      document.querySelector<HTMLElement>(highlightIdSelector(highlightId));
    if (!highlightElement) return;

    // Check if the highlight is in the viewport
    const rect = highlightElement.getBoundingClientRect();
    const isInViewport =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <=
        (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth);

    // show menu for regular highlight only
    if (!isHighlightComment(highlight)) {
      setSelectionStore('highlightsUnderSelection', [highlight]);
      setGeneralPopupLocation({
        pageIndex: highlight.pageNum,
        element: highlightElement,
      });
      setLocationStore('annotation', {
        pageIndex: highlight.pageNum,
        id: highlight.uuid,
      });
    }

    // If not in viewport, scroll to the highlight
    if (!isInViewport) {
      setTimeout(
        () =>
          highlightElement.scrollIntoView({
            behavior: 'instant',
            block: 'center',
          }),
        0
      );
    }
  };
};

/** User Highlight object which stores both regular highlights and comments.
 * Note that comments have a thread id associated with them. */
export function UserHighlight(props: VoidProps<IHighlightObj>) {
  let highlightRef!: HTMLDivElement;
  let textRef!: HTMLDivElement;

  const isPopup = useIsPopup();
  const popupDispatchCtx = usePopupContextUpdate(isPopup);
  const highlightSelection = useHighlightSelection();
  const setActiveThread = activeCommentThreadSignal.set;
  const [hoverHighlight, setHoverHighlight] = hoverHighlightSignal;
  const setActiveHighlight = activeHighlightSignal.set;

  onMount(() => {
    const handleSelectStart = (e: MouseEvent) => {
      e.stopPropagation();
    };
    highlightRef.addEventListener('mousedown', handleSelectStart);

    textRef.innerText = props.text ?? '';
    textRef.addEventListener('copy', handleCopy);

    onCleanup(() => {
      highlightRef.removeEventListener('mousedown', handleSelectStart);
      textRef.removeEventListener('copy', handleCopy);
    });
  });

  const handleCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const selection = window.getSelection();
    let copiedText = '';

    if (selection && selection.toString()) {
      copiedText = selection.toString();
    } else if (props.text) {
      copiedText = props.text;
    }

    if (copiedText) {
      navigator.clipboard.writeText(copiedText).catch((err) => {
        console.error('Failed to copy text: ', err);
      });
    }
  };

  const isHover = createMemo(
    () => hoverHighlight() === (props.threadId || props.highlightId)
  );

  const alphaColor = createMemo((): IColor => {
    const alpha =
      props.color.alpha === 1
        ? props.color.alpha
        : isHover() || props.isActive
          ? 0.7
          : 0.4;
    return {
      red: props.color.red,
      green: props.color.green,
      blue: props.color.blue,
      alpha,
    };
  });

  const setGeneralPopupLocation = generalPopupLocationSignal.set;
  const setNoScroll = noScrollToActiveCommentThreadSignal.set;
  const clickHandler: JSX.EventHandler<HTMLDivElement, MouseEvent> =
    createCallback((e) => {
      // prevents the page overlay from receiving the click event and resetting
      e.stopPropagation();
      e.stopImmediatePropagation();

      popupDispatchCtx({
        type: 'REMOVE_POPUPS',
      });
      setGeneralPopupLocation(null);

      if (props.threadId) {
        setNoScroll(true);
        setActiveThread(props.isActive ? null : props.threadId);
        setTimeout(() => setNoScroll(false), 10);
      } else {
        setActiveThread(null);
        highlightSelection(
          props.highlightId,
          e.target instanceof HTMLElement ? e.target : undefined
        );
      }
      setActiveHighlight(props.highlightId);
    });

  return (
    <div
      ref={highlightRef}
      class={`absolute ${props.threadId ? 'z-placeable' : 'z-user-highlight'}`}
      style={{
        left: `${props.left}px`,
        top: `${props.top}px`,
        width: `${props.width}px`,
        height: `${props.height}px`,
        'pointer-events': 'all',
      }}
      data-highlight-id={props.highlightId}
    >
      <div
        class="relative top-0 left-0 w-full h-full cursor-default"
        style={{
          'background-color': Color.toRgbaString(alphaColor()),
          outline:
            props.isActive && props.threadId ? '2px solid #FACC15' : undefined,
        }}
        on:click={clickHandler}
        onMouseOver={() => setHoverHighlight(props.highlightId)}
        onMouseOut={() => setHoverHighlight(null)}
      >
        <div
          ref={textRef}
          class={`absolute inset-0 overflow-hidden whitespace-pre-wrap opacity-0 pointer-events-none ${props.isActive ? 'select-text' : 'select-none'}`}
        />
      </div>
    </div>
  );
}
