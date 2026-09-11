import type {
  CommentLayout,
  CommentViewerInitialLayout,
  MarkId,
  Overflow,
  ThreadHeights,
  ThreadPositions,
} from '@block-md/comments/commentType';
import {
  autoRegister,
  registerEditorWidthObserver,
  registerInternalLayoutShiftListener,
} from '@core/component/LexicalMarkdown/plugins';
import { getScrollParentElement } from '@core/util/scrollParent';
import { createElementSize } from '@solid-primitives/resize-observer';
import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { useMarkdownDocument } from '../context/markdown-document-context';

// how much to pad the container for the "show more" buttons
const CONTAINER_PADDING = 0;

// minimum distance between adjacent threads
export const MIN_THREAD_GAP = 10;

// the throttle time for layout updates.
const LAYOUT_THROTTLE = 60;

export function createCommentLayout() {
  const markdownDocument = useMarkdownDocument();
  const { md } = markdownDocument.state.editor;
  const commentState = markdownDocument.state.comments;

  const notebookSize = createElementSize(() => md.notebook);
  const notebookHeight = createMemo(() => notebookSize.height);

  const [threadHeights, setThreadHeights] = createStore<ThreadHeights>({});
  const [threadPositions, setThreadPositions] = createStore<ThreadPositions>(
    {}
  );
  const [markLocationTops, setMarkLocationTops] = createStore<
    Partial<Record<MarkId, number>>
  >({});

  const [marginTop, setMarginTop] = createSignal(0);
  const [scrollY, setScrollY] = createSignal(0);

  createEffect(() => {
    const commentMargin = md.commentMargin;

    if (!commentMargin) {
      return;
    }

    // Track the top of the bounding NON-scrolling element.
    const blockContent = commentMargin.closest('[data-block-content]');
    if (blockContent) {
      const resizeObserver = new ResizeObserver(() => {
        const top = blockContent?.getBoundingClientRect().top ?? 0;
        setMarginTop(top);
      });
      resizeObserver.observe(blockContent);
      onCleanup(() => {
        resizeObserver.disconnect();
      });
    }

    // Track the scroll top of the bounding scrolling element.
    const scrollParent = getScrollParentElement(commentMargin);
    if (scrollParent) {
      const updateScrollY = () => {
        const scrollTop = scrollParent.scrollTop;
        setScrollY(scrollTop);
      };
      scrollParent.addEventListener('scroll', updateScrollY, { passive: true });
      onCleanup(() => {
        scrollParent.removeEventListener('scroll', updateScrollY);
      });
    }
  });

  // Sort comments by their marks' positions.
  function markElementSort(a: HTMLElement, b: HTMLElement) {
    const { left: aLeft, top: aTop } = a.getBoundingClientRect();
    const { left: bLeft, top: bTop } = b.getBoundingClientRect();
    if (aTop === bTop) {
      return aLeft - bLeft;
    }
    return aTop - bTop;
  }

  createEffect(() => {
    const updateMarkPositions = () => {
      for (const markId in commentState.marks) {
        const mark = commentState.marks[markId];
        if (!mark) continue;

        const markEls = Object.values(mark.markNodes).filter((el) => !!el);
        if (markEls.length === 0) continue;

        // attach the comment layout to the top element of the mark
        const topEl = markEls.sort(markElementSort)[0];
        const top = topEl.getBoundingClientRect().top + scrollY();
        setMarkLocationTops(markId, top);
      }
    };

    updateMarkPositions();

    const throttledUpdate = leadingAndTrailing(
      throttle,
      updateMarkPositions,
      LAYOUT_THROTTLE
    );

    // Throttle updates on comment positions. Update on (1) editor updates, (2)
    // internal layout shifts causes by non-updating element height changed to
    // embeds and media and (3) editor width changes.
    if (md.editor) {
      autoRegister(
        md.editor.registerUpdateListener(() => {
          throttledUpdate();
        }),
        registerInternalLayoutShiftListener(md.editor, throttledUpdate),
        registerEditorWidthObserver(md.editor, throttledUpdate)
      );
    }
  });

  type MarkLayout = {
    id: MarkId;
    layout?: {
      top: number;
    };
  };

  const [markLayouts, setMarkLayouts] = createSignal<MarkLayout[]>([]);

  createEffect(() => {
    const layouts = Object.values(commentState.marks)
      .filter((m) => m !== undefined)
      .map((m) => {
        const top = markLocationTops[m.id];
        if (top != null) {
          return {
            id: m.id,
            layout: {
              top: top - marginTop(),
            },
          };
        }

        return {
          id: m.id,
        };
      });

    setMarkLayouts(layouts);
  });

  function computeLayout<T>({
    initialAnchor,
    input,
    direction,
    containerHeight,
    containerPadding = 0,
  }: {
    initialAnchor: number;
    input: (CommentViewerInitialLayout<T> & { height: number })[];
    direction: 'up' | 'down';
    containerHeight: number;
    containerPadding?: number;
  }): Array<CommentLayout<T>> {
    let anchor = initialAnchor;
    if (direction === 'up') {
      input.reverse();
    }
    const out = input.map((i): CommentLayout<T> => {
      let calculatedYPos = 0;
      if (direction === 'up') {
        calculatedYPos = Math.min(
          anchor - i.height - MIN_THREAD_GAP,
          i.layout.originalYPosition
        );
        anchor = calculatedYPos;
      } else {
        calculatedYPos = Math.max(
          anchor + MIN_THREAD_GAP,
          i.layout.originalYPosition
        );
        anchor = calculatedYPos + i.height;
      }

      let overflow: Overflow = null;
      if (calculatedYPos <= 0 + containerPadding) overflow = 'top';
      if (anchor >= containerHeight - containerPadding) overflow = 'bottom';
      return {
        ...i,
        layout: {
          height: i.height,
          calculatedYPos,
          overflow,
        },
      };
    });
    if (direction === 'up') {
      out.reverse();
    }
    return out;
  }

  createEffect(() => {
    const pageHeight = notebookHeight();

    // there are no bounds for the container, cant compute position
    if (!pageHeight) {
      console.error('no page height');
      return;
    }

    const sortedThreadsByOriginalPosition = markLayouts()
      .flatMap((layout) => {
        if (!layout.layout) return [];
        let threadHeight = 0;
        const mark = commentState.marks[layout.id];
        const threadId = mark?.thread?.threadId;
        if (threadId) {
          threadHeight = threadHeights[threadId] ?? 0;
        }

        return [
          {
            id: layout.id,
            height: threadHeight,
            layout: { originalYPosition: layout.layout.top },
          },
        ];
      })
      .sort((a, b) => a.layout.originalYPosition - b.layout.originalYPosition);

    // there are no comment threads on this page, cant position nothing
    if (sortedThreadsByOriginalPosition.length === 0) {
      return;
    }

    // if no threads is active by default
    // position threads as if the first one is active
    const activeMarkIdsValue = untrack(() => commentState.activeMarkIds);
    const middleMarkId =
      activeMarkIdsValue[Math.floor(activeMarkIdsValue.length / 2)];
    const anchorPositionId =
      middleMarkId ?? sortedThreadsByOriginalPosition[0].id;
    if (!anchorPositionId) return;

    let sliceTo = sortedThreadsByOriginalPosition.findIndex(
      (thread) => thread.id === anchorPositionId
    );
    if (sliceTo === -1) {
      sliceTo = 0;
    }
    const sliceFrom = sliceTo + 1;

    // all threads on page above the anchor with height
    const sliceAboveAnchor = sortedThreadsByOriginalPosition.slice(0, sliceTo);
    // all threads on page below the anchor with height
    const sliceBelowAnchor = sortedThreadsByOriginalPosition.slice(sliceFrom);

    // calculate closest fit for anchor within bounds of container
    const anchorElement = sortedThreadsByOriginalPosition[sliceTo];
    const anchorHeight = anchorElement.height;

    // check if original y plus height fits inside bounds for anchor
    const paddedHeight = pageHeight - CONTAINER_PADDING;
    let anchorTop = anchorElement.layout.originalYPosition;
    let anchorEnd = anchorTop + anchorHeight;
    if (anchorEnd > paddedHeight) {
      const anchorOverflow = anchorEnd - paddedHeight;
      anchorTop -= anchorOverflow;
    }

    // handle edge case where anchor element is larger than container
    if (anchorTop < 0) {
      anchorTop = 0;
    }
    anchorEnd = anchorTop + anchorHeight;

    const layoutAboveAnchor = computeLayout({
      initialAnchor: anchorTop,
      direction: 'up',
      input: sliceAboveAnchor,
      containerHeight: pageHeight,
      containerPadding: CONTAINER_PADDING,
    });

    const layoutBelowAnchor = computeLayout({
      initialAnchor: anchorEnd,
      direction: 'down',
      input: sliceBelowAnchor,
      containerHeight: pageHeight,
      containerPadding: CONTAINER_PADDING,
    });

    // the positioning of all threads on the page
    const out: CommentLayout<{ id: MarkId }>[] = [
      ...layoutAboveAnchor,
      {
        ...anchorElement,
        layout: {
          height: anchorHeight,
          calculatedYPos: anchorTop,
          overflow: null,
        },
      },
      ...layoutBelowAnchor,
    ];

    for (const layout of out) {
      setThreadPositions(layout.id, layout);
    }
  });

  return {
    notebookHeight,
    setThreadHeights,
    threadPositions,
  };
}
