import { useHighlightSelection } from '@block-pdf/component/UserHighlight';
import { useCurrentPageViewport } from '@block-pdf/signal/pdfViewer';
import type {
  PdfComment,
  PdfReply,
  PdfRoot,
  ViewerCommentType,
} from '@block-pdf/type/comments';
import { getHighlightsFromSelection } from '@block-pdf/util/pdfjsUtils';
import { useUserId } from '@core/context/user';
import { createCallback } from '@solid-primitives/rootless';
import { batch, createMemo } from 'solid-js';
import { produce } from 'solid-js/store';
import { usePdfDocument } from '../../context/pdf-document-context';
import {
  Highlight,
  HighlightType,
  type IHighlight,
} from '../../model/Highlight';
import { sortComments } from '../commentsResource';
import { useDeleteNewComments } from './commentOperations';
import { useGetCommentById } from './commentStore';

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

export const useHighlightComments = () => {
  const userId = useUserId();
  const { stores, derived } = usePdfDocument().state;
  const [pageHeights] = stores.pageHeight;
  const [highlights] = stores.highlights;

  return createMemo(() => {
    if (!derived.viewerReady()) return [];

    const out: PdfComment[] = [];
    for (const [pageIndexStr, pageHighlights] of Object.entries(highlights)) {
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
          const currentUserId = userId();
          if (!currentUserId) {
            console.error('User ID not found');
            continue;
          }
          const rootComment: PdfRoot = {
            id: -1,
            rootId: -1,
            type: 'highlight',
            text: '',
            owner: currentUserId,
            author: currentUserId,
            createdAt: new Date(),
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
};

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
  const { signals, stores, derived } = usePdfDocument().state;
  const [convertedHighlightThreadId, setConvertedHighlightThreadId] =
    signals.convertedHighlightThreadId;
  const [, setHighlights] = stores.highlights;
  const getHighlightIdFromCommentId = useGetHighlightIdFromCommentId();

  return () => {
    const commentId = -1;
    const highlightUuid = getHighlightIdFromCommentId(commentId);
    if (!highlightUuid) return;
    const highlight = derived.highlightsUuidMap()?.[highlightUuid];
    if (!highlight) return;
    const pageIndex = highlight.pageNum;

    setHighlights(
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
  const { signals, stores } = usePdfDocument().state;
  const [selection] = stores.selection;
  const [, setHighlights] = stores.highlights;
  const currentPageViewport = useCurrentPageViewport();
  const deleteNewComments = useDeleteNewComments();

  return createCallback((_e: MouseEvent) => {
    signals.disablePageViewClick[1](true);
    try {
      deleteNewComments();

      // TODO: make the general popup location reactive to the active highlight/term state instead of requiring a manual reset
      signals.generalPopupLocation[1](null);

      // create comment from existing highlight
      const highlightUnderSelection = selection.highlightsUnderSelection.at(0);
      if (highlightUnderSelection) {
        batch(() => {
          signals.convertedHighlightThreadId[1](highlightUnderSelection.uuid);
          signals.activeCommentThread[1](-1);

          // NOTE: the new comment is reactively determined in the highlight comments memo
          setHighlights(
            highlightUnderSelection.pageNum,
            highlightUnderSelection.uuid,
            (prev) => ({ ...prev, hasTempThread: true })
          );
        });

        return;
      }

      const selectedRange = selection.selection;
      if (!selectedRange) return;

      const selectionHighlights = getHighlightsFromSelection(
        selectedRange,
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

      setHighlights(
        produce((state) => {
          for (const highlight of highlights) {
            const pageNum = highlight.pageNum;
            const uuid = highlight.uuid;
            if (state[pageNum]) {
              state[pageNum][uuid] = highlight;
            } else {
              state[pageNum] = { [uuid]: highlight };
            }
          }
        })
      );
      signals.activeCommentThread[1](-1);
    } finally {
      signals.disablePageViewClick[1](false);
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
