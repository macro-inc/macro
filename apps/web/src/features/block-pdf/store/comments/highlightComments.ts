import { useHighlightSelection } from '@block-pdf/component/UserHighlight';
import { useCurrentPageViewport } from '@block-pdf/signal/pdfViewer';
import {
  createPdfDraftThreadId,
  type PdfComment,
  type PdfRoot,
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
import { anchoredThread } from './anchoredThread';
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
          const draftThreadId = createPdfDraftThreadId(
            'highlight',
            highlight.uuid
          );
          const rootComment: PdfRoot = {
            id: draftThreadId,
            rootId: draftThreadId,
            type: 'highlight',
            text: '',
            owner: currentUserId,
            author: currentUserId,
            createdAt: new Date(),
            isNew: true,
            children: [],
            threadId: draftThreadId,
            anchorId: highlight.uuid,
          };
          out.push({ ...rootComment, layout });
          continue;
        }

        if (!highlight.thread) continue;
        const highlightThread = anchoredThread('highlight', highlight.thread);
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

  return () => {
    for (const highlight of Object.values(annotations.highlightsByUuid())) {
      if (!highlight?.hasTempThread) continue;

      const restoredExistingHighlight =
        annotations.commands.cancelTemporaryHighlightCommentDraft(
          highlight.uuid
        );
      if (restoredExistingHighlight) {
        setTimeout(() => handleHighlightSelection(highlight.uuid));
      }
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
        const draftThreadId = createPdfDraftThreadId(
          'highlight',
          highlightUnderSelection.uuid
        );
        batch(() => {
          comments.activateThread(draftThreadId);
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

      const activeHighlight = highlights.at(0);
      if (!activeHighlight) return;

      batch(() => {
        pdf.annotations.commands.beginNewHighlightCommentDrafts(highlights);
        comments.activateThread(
          createPdfDraftThreadId('highlight', activeHighlight.uuid)
        );
      });
    });
  });
}
