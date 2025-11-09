import { pageHeightStore } from '@block-pdf/signal/pdfViewer';
import { MIN_THREAD_GAP } from '@block-pdf/signal/viewerThreeColumnLayout';
import type {
  CommentLayout,
  CommentViewerInitialLayout,
  Overflow,
  PdfRootLayout,
} from '@block-pdf/type/comments';
import {
  createBlockMemo,
  createBlockRenderEffect,
  createBlockStore,
} from '@core/block';
import { isRoot, type Root } from '@core/collab/comments/commentType';
import { reconcile } from 'solid-js/store';
import { activeCommentThreadSignal, commentsStore } from './commentStore';

// how much to pad the container for the "show more" buttons
const CONTAINER_PADDING = 80;

/** Maps thread id to height of its measure container */
type ThreadHeights = Record<number, number>;
export const threadHeightStore = createBlockStore<Partial<ThreadHeights>>({});

/** Maps page index to comment layout on that page */
type ThreadPositionsOnPage = Partial<Record<number, CommentLayout<Root>[]>>;
export const threadsOnPagePositionStore =
  createBlockStore<ThreadPositionsOnPage>({});

const rootCommentsGroupedByPage = createBlockMemo(() => {
  const comments = commentsStore.get;

  const out: Record<number, PdfRootLayout[]> = {};
  comments.filter(isRoot).forEach((comment: PdfRootLayout) => {
    const pageIndex = comment.layout.pageIndex;
    if (!out[pageIndex]) out[pageIndex] = [];
    out[pageIndex].push(comment);
  });
  return out;
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
// todo: scroll to highlight or comment
// todo: optistic update (esp. for placeable drag)
// TODO: make this dependent on current page only
// i.e. move this logic into a page specific component so it only runs on for the selected page
createBlockRenderEffect(() => {
  const activeThread = activeCommentThreadSignal.get;
  const setStore = threadsOnPagePositionStore.set;
  const pageHeights = pageHeightStore.get;
  const threadHeights = threadHeightStore.get;
  const rootComments = rootCommentsGroupedByPage() ?? {};

  const groupedThreadLayoutsByPage: ThreadPositionsOnPage = {};
  for (const [pageIndexStr, comments] of Object.entries(rootComments)) {
    const pageIndex = parseInt(pageIndexStr);

    // TODO compute actual position based on container bounds, height and active atom
    const pageHeight = pageHeights[pageIndex];

    // there are no bounds for the container, cant compute position
    if (!pageHeight) {
      groupedThreadLayoutsByPage[pageIndex] = [];
      continue;
    }

    const sortedThreadsByOriginalPosition = comments
      .sort((a, b) => a.layout.originalYPosition - b.layout.originalYPosition)
      .map((t) => {
        return {
          ...t,
          height: threadHeights[t.threadId] ?? 0,
        };
      });

    // there are no comment threads on this page, cant position nothing
    if (sortedThreadsByOriginalPosition.length === 0) {
      groupedThreadLayoutsByPage[pageIndex] = [];
      continue;
    }

    // if no threads is active by default
    // position threads as if the first one is active
    const anchorPositionId =
      activeThread() ?? sortedThreadsByOriginalPosition[0].threadId;

    let sliceTo = sortedThreadsByOriginalPosition.findIndex(
      (t) => t.threadId === anchorPositionId
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
    const anchorId = anchorElement.threadId;
    const anchorHeight = threadHeights[anchorId] ?? 0;

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
    const out: CommentLayout<Root>[] = [
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

    groupedThreadLayoutsByPage[pageIndex] = out;
  }

  setStore(reconcile(groupedThreadLayoutsByPage));
});
