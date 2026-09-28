import { createCallback } from '@solid-primitives/rootless';
import { cn } from '@ui';
import {
  batch,
  createMemo,
  type JSX,
  onCleanup,
  onMount,
  type VoidProps,
} from 'solid-js';
import { usePdfComments } from '../context/pdf-comments-context';
import { usePdfDocument } from '../context/pdf-document-context';
import { usePdfViewer } from '../context/pdf-viewer-context';
import { Color, type IColor } from '../model/Color';
import type { IHighlight } from '../model/Highlight';
import { usePopupContextUpdate } from '../signal/definitionPopup';
import { useIsPopup } from '../signal/pdfViewer';
import type { IHighlightObj } from './PageOverlay';

export const highlightIdSelector = (highlightId: string) =>
  `[data-highlight-id="${highlightId}"]`;

export const useResetUserHighlights = () => {
  const pdf = usePdfDocument();
  const comments = usePdfComments();

  return createCallback(() => {
    batch(() => {
      comments.clearActiveThread();
      pdf.clearActiveHighlight();
      pdf.clearHoveredHighlight();
    });
  });
};

const isHighlightComment = (highlight: IHighlight) =>
  highlight.thread != null || highlight.hasTempThread;

// TODO: handle highlight selection in a different document
export const useHighlightSelection = () => {
  const pdf = usePdfDocument();
  const comments = usePdfComments();
  const rootElement = usePdfViewer().rootElement;

  return (highlightId: string, element?: HTMLElement) => {
    const highlight = pdf.annotations.highlightsByUuid()[highlightId];
    if (!highlight) return;

    if (isHighlightComment(highlight)) {
      const threadId = highlight.thread?.threadId;
      if (threadId == null) {
        comments.clearActiveThread();
      } else {
        comments.activateThread(threadId);
      }
    } else {
      pdf.activateHighlight(highlightId);
      comments.clearActiveThread();
    }

    const highlightElement =
      element ??
      rootElement()?.querySelector<HTMLElement>(
        highlightIdSelector(highlightId)
      );
    if (!highlightElement) return;

    const rect = highlightElement.getBoundingClientRect();
    const isInViewport =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <=
        (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth);

    if (!isHighlightComment(highlight)) {
      pdf.replaceSelectedHighlights([highlight]);
      pdf.openSelectionMenu({
        pageIndex: highlight.pageNum,
        element: highlightElement,
      });
      pdf.setShareLocation({
        type: 'annotation',
        pageIndex: highlight.pageNum,
        id: highlight.uuid,
      });
    }

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

export function UserHighlight(props: VoidProps<IHighlightObj>) {
  let highlightRef!: HTMLDivElement;
  let textRef!: HTMLDivElement;

  const pdf = usePdfDocument();
  const comments = usePdfComments();
  const isPopup = useIsPopup();
  const popupDispatchCtx = usePopupContextUpdate(isPopup);
  const highlightSelection = useHighlightSelection();

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
    () => pdf.hoveredHighlightId() === (props.threadId || props.highlightId)
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

  const clickHandler: JSX.EventHandler<HTMLDivElement, MouseEvent> =
    createCallback((e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();

      popupDispatchCtx({
        type: 'REMOVE_POPUPS',
      });
      pdf.closeSelectionMenu();

      if (props.threadId) {
        comments.suppressScrolling();
        if (props.isActive) {
          comments.clearActiveThread();
        } else {
          comments.activateThread(props.threadId);
        }
        setTimeout(() => comments.restoreScrolling(), 10);
      } else {
        comments.clearActiveThread();
        highlightSelection(
          props.highlightId,
          e.target instanceof HTMLElement ? e.target : undefined
        );
      }
      pdf.activateHighlight(props.highlightId);
    });

  return (
    <div
      ref={highlightRef}
      class={cn(
        'absolute',
        props.threadId ? 'z-placeable' : 'z-user-highlight'
      )}
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
        class="relative top-0 left-0 size-full cursor-default"
        style={{
          'background-color': Color.toRgbaString(alphaColor()),
          outline:
            props.isActive && props.threadId ? '2px solid #FACC15' : undefined,
        }}
        on:click={clickHandler}
        onMouseOver={() => pdf.hoverHighlight(props.highlightId)}
        onMouseOut={() => pdf.clearHoveredHighlight()}
      >
        <div
          ref={textRef}
          class={cn(
            'absolute inset-0 overflow-hidden whitespace-pre-wrap opacity-0 pointer-events-none',
            props.isActive ? 'select-text' : 'select-none'
          )}
        />
      </div>
    </div>
  );
}
