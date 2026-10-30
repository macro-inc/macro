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

type StackInput<T> = CommentViewerInitialLayout<T> & { height: number };

/**
 * Stacks margin threads (sorted by their marks' positions) so no two cards
 * overlap and none starts above the top of the margin, where it could never
 * be scrolled to. The anchor (the active thread) sits beside its mark, moved
 * up only as far as it takes to end inside the page; threads above it are
 * pushed up and threads below it are pushed down. When the threads above do
 * not fit between the top of the page and the anchor, the whole stack is
 * pushed down instead. Threads below may run past the page's bottom; the
 * document scrolls to them.
 */
export function stackMarginThreads<T>(
  threads: readonly StackInput<T>[],
  anchorIndex: number,
  pageHeight: number
): Array<CommentLayout<T>> {
  const anchor = threads[anchorIndex];
  if (!anchor) return [];
  const tops = threads.map((thread) => thread.layout.originalYPosition);

  tops[anchorIndex] = Math.max(
    0,
    Math.min(tops[anchorIndex], pageHeight - anchor.height)
  );
  for (let i = anchorIndex + 1; i < threads.length; i++) {
    const previousEnd = tops[i - 1] + threads[i - 1].height;
    tops[i] = Math.max(tops[i], previousEnd + MIN_THREAD_GAP);
  }
  for (let i = anchorIndex - 1; i >= 0; i--) {
    tops[i] = Math.min(
      tops[i],
      tops[i + 1] - threads[i].height - MIN_THREAD_GAP
    );
  }

  // Threads pushed above the top come back down, and push the rest down.
  let floor = 0;
  for (let i = 0; i < threads.length; i++) {
    tops[i] = Math.max(tops[i], floor);
    floor = tops[i] + threads[i].height + MIN_THREAD_GAP;
  }

  return threads.map((thread, i): CommentLayout<T> => {
    const end = tops[i] + thread.height;
    const overflow: Overflow =
      end >= pageHeight ? 'bottom' : tops[i] <= 0 ? 'top' : null;
    return {
      ...thread,
      layout: { height: thread.height, calculatedYPos: tops[i], overflow },
    };
  });
}

export function createCommentLayout() {
  const { state } = useMarkdownDocument();
  const commentState = state.comments;
  const md = state.editor.md;

  const notebookSize = createElementSize(() => md.notebook);
  const notebookHeight = createMemo(() => notebookSize.height);

  const [threadHeights, setThreadHeights] = createStore<ThreadHeights>({});
  const [threadPositions, setThreadPositions] = createStore<ThreadPositions>(
    {}
  );
  const [markLocationTops, setMarkLocationTops] = createStore<
    Partial<Record<MarkId, number>>
  >({});

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
    const commentMargin = md.commentMargin;
    if (!commentMargin) return;

    // Measure marks against the margin itself: it scrolls with the document,
    // so the offsets hold at any scroll position without tracking scrollTop.
    const updateMarkPositions = () => {
      const marginTop = commentMargin.getBoundingClientRect().top;
      for (const markId in commentState.marks) {
        const mark = commentState.marks[markId];
        if (!mark) continue;

        const markEls = Object.values(mark.markNodes).filter((el) => !!el);
        if (markEls.length === 0) continue;

        // attach the comment layout to the top element of the mark
        const topEl = markEls.sort(markElementSort)[0];
        const top = topEl.getBoundingClientRect().top - marginTop;
        setMarkLocationTops(markId, top);
      }
    };

    updateMarkPositions();

    const throttledUpdate = leadingAndTrailing(
      throttle,
      updateMarkPositions,
      LAYOUT_THROTTLE
    );

    // The margin is display:none until the document has a comment; re-measure
    // once it is laid out.
    // ResizeObserver runs before paint. Keep geometry changes synchronous:
    // scroll anchoring can hold the text still while a resizing embed moves
    // the margin, so throttling here paints cards at stale document offsets.
    const marginResizeObserver = new ResizeObserver(updateMarkPositions);
    marginResizeObserver.observe(commentMargin);
    onCleanup(() => marginResizeObserver.disconnect());

    // Coalesce editor updates, but measure layout shifts and editor resizes
    // immediately so the margin and its text anchors move in the same frame.
    if (md.editor) {
      autoRegister(
        md.editor.registerUpdateListener(() => {
          throttledUpdate();
        }),
        registerInternalLayoutShiftListener(md.editor, updateMarkPositions),
        registerEditorWidthObserver(md.editor, updateMarkPositions)
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
              top,
            },
          };
        }

        return {
          id: m.id,
        };
      });

    setMarkLayouts(layouts);
  });

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

    const anchorIndex = Math.max(
      0,
      sortedThreadsByOriginalPosition.findIndex(
        (thread) => thread.id === anchorPositionId
      )
    );
    const out = stackMarginThreads(
      sortedThreadsByOriginalPosition,
      anchorIndex,
      pageHeight - CONTAINER_PADDING
    );

    for (const layout of out) {
      setThreadPositions(layout.id, layout);
    }
  });

  return {
    setThreadHeights,
    threadPositions,
  };
}
