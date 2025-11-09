import { useHighlightSelection } from '@block-pdf/component/UserHighlight';
import { disablePageViewClickSignal } from '@block-pdf/signal/click';
import { generalPopupLocationSignal } from '@block-pdf/signal/location';
import {
  pageHeightStore,
  useCurrentPageViewport,
  viewerReadySignal,
} from '@block-pdf/signal/pdfViewer';
import type {
  PdfComment,
  PdfReply,
  PdfRoot,
  ViewerCommentType,
} from '@block-pdf/type/comments';
import { getHighlightsFromSelection } from '@block-pdf/util/pdfjsUtils';
import { createBlockMemo, createBlockSignal } from '@core/block';
import { useUserId } from '@service-gql/client';
import { createCallback } from '@solid-primitives/rootless';
import { batch } from 'solid-js';
import { produce } from 'solid-js/store';
import {
  Highlight,
  HighlightType,
  type IHighlight,
} from '../../model/Highlight';
import {
  highlightStore,
  highlightsUuidMap,
  selectionStore,
  useAddNewHighlightComments,
} from '../../store/highlight';
import { sortComments } from '../commentsResource';
import { useDeleteNewComments } from './commentOperations';
import { activeCommentThreadSignal, useGetCommentById } from './commentStore';

// highlight uuid that is converted to a comment. This allows us to revert to a regular highlight if the user cancels the comment operation
export const convertedHighlightThreadIdSignal = createBlockSignal<
  string | null
>(null);

const getHighlightPos = (highlight: IHighlight, viewportHeight: number) => {
  try {
    // NOTE: got a weird bug where the rects were undefined for some reason
    // going to add this try/catch for now since unable to reproduce
    const top = highlight.rects.at(0)?.top;
    if (top === undefined) return null;
    return top * viewportHeight;
  } catch (e) {
    console.error('Error getting highlight pos', e, highlight);
    return null;
  }
};

const getHighlightThread = (
  highlight: IHighlight
): { root: PdfRoot; replies: PdfReply[] } | null => {
  const commentType: ViewerCommentType = 'highlight';

  const thread = highlight.thread;
  if (!thread) return null;

  const comments = [...thread.comments].sort(sortComments);

  const rootComment = comments[0];

  const commentBase = {
    type: commentType,
    isNew: false,
    threadId: rootComment.threadId,
    rootId: rootComment.commentId,
    anchorId: highlight.uuid,
  };

  const replies: PdfReply[] = [];
  for (let i = 1; i < comments.length; i++) {
    const comment = comments[i];
    replies.push({
      ...commentBase,
      id: comment.commentId,
      createdAt: comment.createdAt,
      owner: comment.owner,
      author: comment.sender || comment.owner,
      text: comment.text,
    });
  }

  const root: PdfRoot = {
    ...commentBase,
    id: rootComment.commentId,
    createdAt: rootComment.createdAt,
    owner: rootComment.owner,
    author: rootComment.sender || rootComment.owner,
    text: rootComment.text,
    children: replies.map((r) => r.id),
  };

  return { root, replies };
};

export const highlightComments = createBlockMemo(() => {
  const userId = useUserId()();
  const pageHeights = pageHeightStore.get;
  if (!viewerReadySignal()) return [];

  const out: PdfComment[] = [];
  for (const [pageIndexStr, pageHighlights] of Object.entries(
    highlightStore.get
  )) {
    if (!pageHighlights) continue;
    const pageIndex = parseInt(pageIndexStr);
    const height = pageHeights[pageIndex] ?? 0;

    for (const highlight of Object.values(pageHighlights)) {
      if (!highlight) continue;

      const originalYPosition = getHighlightPos(highlight, height);
      if (originalYPosition === null) continue;

      const layout = {
        pageIndex,
        originalYPosition,
      };

      // new highlight thread
      if (highlight.hasTempThread) {
        if (!userId) {
          console.error('User ID not found');
          continue;
        }
        const rootComment: PdfRoot = {
          id: -1,
          rootId: -1,
          type: 'highlight',
          text: '',
          owner: userId,
          author: userId,
          createdAt: Date.now(),
          isNew: true,
          children: [],
          threadId: -1,
          anchorId: highlight.uuid,
        };
        out.push({ ...rootComment, layout });
        continue;
      }

      const highlightThread = getHighlightThread(highlight);
      if (!highlightThread) continue;

      const { root, replies } = highlightThread;
      out.push({ ...root, layout });
      replies.forEach((reply) => out.push(reply));
    }
  }
  return out;
});

const useGetHighlightIdFromCommentId = () => {
  const getCommentById = useGetCommentById();
  return (commentId: number) => {
    const comment = getCommentById(commentId);
    if (!comment) {
      return;
    }

    return comment.anchorId;
  };
};

export const useDeleteNewHighlightComment = () => {
  const handleHighlightSelection = useHighlightSelection();
  const [convertedHighlightThreadId, setConvertedHighlightThreadId] =
    convertedHighlightThreadIdSignal;
  const setHighlightStore = highlightStore.set;
  const getHighlightIdFromCommentId = useGetHighlightIdFromCommentId();

  return () => {
    const commentId = -1;
    const highlightUuid = getHighlightIdFromCommentId(commentId);
    if (!highlightUuid) return;
    const highlight = highlightsUuidMap()?.[highlightUuid];
    if (!highlight) return;
    const pageIndex = highlight.pageNum;

    setHighlightStore(
      pageIndex,
      produce((draft) => {
        if (!draft) return;

        const highlight = draft[highlightUuid];
        if (!highlight) return;

        const isTemporaryHighlight = highlight.hasTempThread;
        if (!isTemporaryHighlight) {
          console.error(
            'This method should only be used for temporary highlights'
          );
          return;
        }

        // Revert back to a regular highlight if the user cancels the comment operation
        if (highlight.uuid === convertedHighlightThreadId()) {
          highlight.thread = null;
          highlight.hasTempThread = false;
          setConvertedHighlightThreadId(null);
          setTimeout(() => handleHighlightSelection(highlight.uuid));
          return;
        }

        // Delete the whole highlight
        delete draft[highlightUuid];
      })
    );
  };
};

export function useCreateHighlightCommentAtSelection() {
  const selectionStoreValue = selectionStore.get;
  const setHighlightStore = highlightStore.set;
  const setConvertedHighlightThreadId = convertedHighlightThreadIdSignal.set;
  const setGeneralPopupLocation = generalPopupLocationSignal.set;
  const addHighlights = useAddNewHighlightComments();
  const currentPageViewport = useCurrentPageViewport();
  const deleteNewComments = useDeleteNewComments();
  const setActiveCommentThread = activeCommentThreadSignal.set;
  const setDisablePageViewClick = disablePageViewClickSignal.set;

  return createCallback((_e: MouseEvent) => {
    setDisablePageViewClick(true);
    try {
      deleteNewComments();

      // TODO: make the general popup location reactive to the active highlight/term state instead of requiring a manual reset
      setGeneralPopupLocation(null);

      // create comment from existing highlight
      const highlightUnderSelection =
        selectionStoreValue.highlightsUnderSelection.at(0);
      if (highlightUnderSelection) {
        batch(() => {
          setConvertedHighlightThreadId(highlightUnderSelection.uuid);
          setActiveCommentThread(-1);

          // NOTE: the new comment is reactively determined in the highlight comments memo
          setHighlightStore(
            highlightUnderSelection.pageNum,
            highlightUnderSelection.uuid,
            (prev) => ({ ...prev, hasTempThread: true })
          );
        });

        return;
      }

      const selection = selectionStoreValue.selection;
      if (!selection) return;

      const selectionHighlights = getHighlightsFromSelection(
        selection,
        Highlight.defaultYellow,
        HighlightType.HIGHLIGHT,
        null,
        false,
        {
          width: currentPageViewport().pageWidth,
          height: currentPageViewport().pageHeight,
        }
      );

      // create ID to make highlight accessible later
      let highlights: IHighlight[] = [];
      for (const highlight of [...selectionHighlights.values()].map(
        Highlight.toObject
      )) {
        highlights.push({ ...highlight, hasTempThread: true });
      }

      addHighlights(highlights);
      setActiveCommentThread(-1);
    } finally {
      setDisablePageViewClick(false);
    }
  });
}

// // NOTE: also works for regular highlights
// export const useGoToHighlightComment = () => {
//   const goToHighlight = useGoToHighlight();
//   const getHighlightIdFromCommentId = useGetHighlightIdFromCommentId();
//   const getHighlightByUuid = useGetHighlightByUuid();
//
//   return async (id: string) => {
//     let highlightUuid: string | undefined = id;
//     if (getHighlightByUuid(id) == null) {
//       highlightUuid = getHighlightIdFromCommentId(id);
//     }
//
//     if (!highlightUuid) return;
//     return goToHighlight(highlightUuid);
//   };
// };
