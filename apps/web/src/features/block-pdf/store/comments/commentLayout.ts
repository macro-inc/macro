import { MIN_THREAD_GAP } from '@block-pdf/signal/viewerThreeColumnLayout';
import type {
  CommentLayout,
  CommentStore,
  CommentViewerInitialLayout,
  Overflow,
  PdfRootLayout,
} from '@block-pdf/type/comments';
import type { ThreadId } from '@core/comments/commentType';
import { isRoot, type Root } from '@core/comments/commentType';
import { type Accessor, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import { usePdfComments } from '../../context/pdf-comments-context';
import { usePdfViewer } from '../../context/pdf-viewer-context';

// how much to pad the container for the "show more" buttons
const CONTAINER_PADDING = 80;

type ThreadHeights = Record<ThreadId, number>;

const isPdfRootLayout = (
  comment: CommentStore[number]
): comment is PdfRootLayout => isRoot(comment) && 'layout' in comment;

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

export function computePageCommentLayout({
  comments,
  activeThreadId,
  pageHeight,
  threadHeights,
}: {
  comments: readonly PdfRootLayout[];
  activeThreadId: ThreadId | null;
  pageHeight: number | undefined;
  threadHeights: Partial<ThreadHeights>;
}): CommentLayout<Root>[] {
  if (!pageHeight || comments.length === 0) return [];

  const sortedThreadsByOriginalPosition = [...comments]
    .sort((a, b) => a.layout.originalYPosition - b.layout.originalYPosition)
    .map((thread) => ({
      ...thread,
      height: threadHeights[thread.threadId] ?? 0,
    }));

  const activeThreadIndex = sortedThreadsByOriginalPosition.findIndex(
    (thread) => thread.threadId === activeThreadId
  );
  const anchorIndex = activeThreadIndex === -1 ? 0 : activeThreadIndex;
  const anchorElement = sortedThreadsByOriginalPosition[anchorIndex];
  const anchorHeight = threadHeights[anchorElement.threadId] ?? 0;
  const sliceAboveAnchor = sortedThreadsByOriginalPosition.slice(
    0,
    anchorIndex
  );
  const sliceBelowAnchor = sortedThreadsByOriginalPosition.slice(
    anchorIndex + 1
  );

  const paddedHeight = pageHeight - CONTAINER_PADDING;
  let anchorTop = anchorElement.layout.originalYPosition;
  const anchorOverflow = anchorTop + anchorHeight - paddedHeight;
  if (anchorOverflow > 0) {
    anchorTop -= anchorOverflow;
  }
  if (anchorTop < 0) {
    anchorTop = 0;
  }
  const anchorEnd = anchorTop + anchorHeight;

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

  return [
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
}

export function usePageCommentLayout(pageIndex: Accessor<number>) {
  const pdfViewer = usePdfViewer();
  const commentsContext = usePdfComments();
  const activeCommentThreadId = commentsContext.activeThreadId;
  const comments = commentsContext.all;
  const pageHeights = pdfViewer.root.pageHeights;
  const [threadHeights, setThreadHeights] = createStore<Partial<ThreadHeights>>(
    {}
  );

  const threads = createMemo(() => {
    const currentPageIndex = pageIndex();
    return computePageCommentLayout({
      comments: comments().filter(
        (comment): comment is PdfRootLayout =>
          isPdfRootLayout(comment) &&
          comment.layout.pageIndex === currentPageIndex
      ),
      activeThreadId: activeCommentThreadId(),
      pageHeight: pageHeights[currentPageIndex],
      threadHeights,
    });
  });

  return {
    threads,
    setThreadHeight: (threadId: ThreadId, height: number) => {
      if (threadHeights[threadId] === height) return;
      setThreadHeights(threadId, height);
    },
  };
}
