import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { usePdfDocument } from '@block-pdf/context/pdf-document-context';
import type { PdfRootLayout } from '@block-pdf/type/comments';
import { type DeleteCommentInfo, isRoot } from '@core/comments/commentType';
import { threadMeasureContainerId } from '@core/comments/Thread';
import type {
  CreateCommentRequest,
  EditCommentRequest,
} from '@service-storage/generated/schemas';
import type { CreateCommentResponse } from '@service-storage/generated/schemas/createCommentResponse';
import { createCallback } from '@solid-primitives/rootless';
import { usePdfComments } from '../../context/pdf-comments-context';
import { usePdfViewer } from '../../context/pdf-viewer-context';
import {
  useAttachHighlightCommentResource,
  useCreateFreeCommentResource,
  useCreateHighlightCommentResource,
  useCreateThreadReplyResource,
  useDeleteCommentResource,
  useEditCommentResource,
} from '../commentsResource';
import { useDeleteNewFreeComment, useNewThreadPlaceable } from './freeComments';
import { useDeleteNewHighlightComment } from './highlightComments';

export function useCreateComment() {
  const analytics = useAnalytics();
  const annotations = usePdfDocument().annotations;
  const comments = usePdfComments().all;

  const deleteNewComments = useDeleteNewComments();
  const createFreeComment = useCreateFreeCommentResource();
  const createHighlightComment = useCreateHighlightCommentResource();
  const attachHighlightComment = useAttachHighlightCommentResource();
  const createThreadReply = useCreateThreadReplyResource();
  const newThreadPlaceable = useNewThreadPlaceable();

  return createCallback(
    async (info: CreateCommentRequest & { threadId: number }) => {
      analytics.track('comment_create', { blockType: 'pdf' });
      const { threadId, text, mentions } = info;

      if (threadId === -1) {
        const comment = comments().find((c) => c.threadId === threadId);
        if (!comment) {
          console.error('Unable to comment');
          return null;
        }

        let response: CreateCommentResponse | null = null;
        switch (comment.type) {
          case 'highlight':
            const highlight = annotations.highlightsByUuid()[comment.anchorId];
            if (!highlight) {
              console.error('Unable to find highlight');
              return response;
            }

            if (highlight.existsOnServer) {
              response = await attachHighlightComment(
                text,
                highlight.uuid,
                mentions
              );
            } else {
              response = await createHighlightComment(
                text,
                highlight,
                mentions
              );
            }
            break;
          case 'free':
            const newThreadPlaceableValue = newThreadPlaceable();
            if (
              !newThreadPlaceableValue ||
              newThreadPlaceableValue.internalId !== comment.anchorId
            ) {
              console.error('Unable to find new thread placeable');
              return response;
            }

            response = await createFreeComment(
              text,
              newThreadPlaceableValue,
              mentions
            );
            break;
          default:
            console.error('invalid comment type', comment.type);
            return response;
        }

        if (response) {
          deleteNewComments();
        }

        return response;
      }

      return await createThreadReply(info);
    }
  );
}

export function useUpdateComment() {
  const analytics = useAnalytics();

  const editComment = useEditCommentResource();

  return createCallback((commentId: number, info: EditCommentRequest) => {
    analytics.track('comment_update', { blockType: 'pdf' });
    return editComment(commentId, info);
  });
}

export function useDeleteComment() {
  const analytics = useAnalytics();

  const deleteComment = useDeleteCommentResource();
  const deleteNewComments = useDeleteNewComments();

  return createCallback(async (info: DeleteCommentInfo) => {
    const commentId = info.commentId;

    if (commentId === -1) {
      deleteNewComments();
      return false;
    }

    const success = await deleteComment(commentId, {
      removeAnchorThreadOnly: info.removeAnchorThreadOnly,
    });

    if (success) {
      analytics.track('comment_delete', { blockType: 'pdf' });
    }
    return success;
  });
}

export function useDeleteNewComments() {
  const deleteHighlightComment = useDeleteNewHighlightComment();
  const deleteFreeComment = useDeleteNewFreeComment();

  return createCallback(() => {
    deleteHighlightComment();
    deleteFreeComment();
  });
}

export function useScrollToCommentThread() {
  const pdf = usePdfDocument();
  const pdfViewer = usePdfViewer();
  const { documentId } = pdf;
  const rootElement = pdfViewer.rootElement;
  const viewer = pdfViewer.root.instance;
  const comments = usePdfComments().all;

  const scrollIntoView = (el: HTMLElement) => {
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'start',
    });
  };

  return async (threadId: number) => {
    const measureContainerId = threadMeasureContainerId(documentId(), threadId);
    let measureContainer = document.getElementById(measureContainerId);
    const pdfRoot = rootElement();
    if (!pdfRoot) {
      console.error('Unable to find PDF document root element');
      return;
    }

    return new Promise<void>((resolve) => {
      const intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting || entry.intersectionRatio < 1) {
            setTimeout(() => {
              if (!measureContainer) return;
              scrollIntoView(measureContainer);
            }, 0);
          }
          intersectionObserver.disconnect();
          mutationObserver.disconnect();
          resolve();
        },
        {
          threshold: 1.0, // Ensures the element is fully in view before resolving
        }
      );

      const mutationObserver = new MutationObserver(() => {
        measureContainer = document.getElementById(measureContainerId);
        if (measureContainer) {
          mutationObserver.disconnect();
          intersectionObserver.observe(measureContainer);
        }
      });

      if (measureContainer) {
        intersectionObserver.observe(measureContainer);
        scrollIntoView(measureContainer);
      } else {
        mutationObserver.observe(pdfRoot, {
          childList: true,
          subtree: true,
        });

        // since page overlays are only rendered in viewport
        // we need to force a render by scrolling to the page
        setTimeout(() => {
          const viewer_ = viewer();
          if (!viewer_) return;

          const rootComment = comments()
            .filter(isRoot)
            .find((c) => c.threadId === threadId) as PdfRootLayout | undefined;
          if (!rootComment) return;

          if (measureContainer) return;

          mutationObserver.disconnect();
          intersectionObserver.disconnect();

          viewer_.scrollTo({
            pageNumber: rootComment.layout.pageIndex + 1,
          });

          measureContainer = document.getElementById(measureContainerId);
          if (measureContainer) {
            scrollIntoView(measureContainer);
            intersectionObserver.observe(measureContainer);
          } else {
            mutationObserver.observe(pdfRoot, {
              childList: true,
              subtree: true,
            });
          }
        }, 250);
      }

      setTimeout(() => {
        intersectionObserver.disconnect();
        mutationObserver.disconnect();
        resolve();
      }, 2000);
    });
  };
}
