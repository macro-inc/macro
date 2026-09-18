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
import { usePdfComments } from '../../context/pdf-comments-context';
import { usePdfDocument } from '../../context/pdf-document-context';
import { usePdfViewer } from '../../context/pdf-viewer-context';
import {
  Highlight,
  HighlightType,
  type IHighlight,
} from '../../model/Highlight';
import { sortComments } from '../commentsResource';
import { useDeleteNewComments } from './commentOperations';

const getHighlightPos = (highlight: IHighlight, viewportHeight: number) => {
  try {
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
  const pdf = usePdfDocument();
  const pdfViewer = usePdfViewer();
  const pageHeights = pdfViewer.root.pageHeights;
  const highlights = pdf.annotations.highlightsByPage;

  return createMemo(() => {
    if (!pdfViewer.root.isReady()) return [];

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

export const useDeleteNewHighlightComment = () => {
  const handleHighlightSelection = useHighlightSelection();
  const pdf = usePdfDocument();
  const annotations = pdf.annotations;
  const commentsById = usePdfComments().byId;

  return () => {
    const highlightUuid = commentsById().get(-1)?.anchorId;
    if (!highlightUuid) return;
    const highlight = annotations.highlightsByUuid()[highlightUuid];
    if (!highlight) return;

    if (!highlight.hasTempThread) {
      console.error('This method should only be used for temporary highlights');
      return;
    }

    const restoredExistingHighlight =
      annotations.commands.cancelTemporaryHighlightCommentDraft(highlight.uuid);
    if (restoredExistingHighlight) {
      setTimeout(() => handleHighlightSelection(highlight.uuid));
    }
  };
};

export function useCreateHighlightCommentAtSelection() {
  const pdf = usePdfDocument();
  const pdfViewer = usePdfViewer();
  const comments = usePdfComments();
  const annotationSelection = pdf.annotationSelection;
  const currentPageViewport = useCurrentPageViewport();
  const deleteNewComments = useDeleteNewComments();

  return createCallback((_e: MouseEvent) => {
    pdfViewer.runWithPageClicksDisabled(() => {
      deleteNewComments();
      pdf.closeSelectionMenu();

      const highlightUnderSelection =
        annotationSelection().selectedHighlights.at(0);
      if (highlightUnderSelection) {
        batch(() => {
          comments.activateThread(-1);
          pdf.annotations.commands.beginExistingHighlightCommentDraft(
            highlightUnderSelection
          );
        });

        return;
      }

      const selectedRange = annotationSelection().nativeSelection;
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

      const highlights: IHighlight[] = [];
      for (const highlight of [...selectionHighlights.values()].map(
        Highlight.toObject
      )) {
        highlights.push(highlight);
      }

      pdf.annotations.commands.beginNewHighlightCommentDrafts(highlights);
      comments.activateThread(-1);
    });
  });
}
