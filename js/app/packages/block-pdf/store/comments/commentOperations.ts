import { useGetRootViewer } from '@block-pdf/signal/pdfViewer';
import { commentsStore } from '@block-pdf/store/comments/commentStore';
import type { PdfRootLayout } from '@block-pdf/type/comments';
import { withAnalytics } from '@coparse/analytics';
import { useBlockId } from '@core/block';
import {
  type CreateCommentInfo,
  type DeleteCommentInfo,
  isRoot,
  type UpdateCommentInfo,
} from '@core/collab/comments/commentType';
import { threadMeasureContainerId } from '@core/collab/comments/Thread';
import { blockElementSignal } from '@core/signal/blockElement';
import type { CreateCommentResponse } from '@service-storage/generated/schemas/createCommentResponse';
import { createCallback } from '@solid-primitives/rootless';
import {
  useAttachHighlightCommentResource,
  useCreateFreeCommentResource,
  useCreateHighlightCommentResource,
  useCreateThreadReplyResource,
  useDeleteCommentResource,
  useEditCommentResource,
} from '../commentsResource';
import { highlightsUuidMap } from '../highlight';
import { newThreadPlaceable, useDeleteNewFreeComment } from './freeComments';
import { useDeleteNewHighlightComment } from './highlightComments';

const { track, TrackingEvents } = withAnalytics();

export function useCreateComment() {
  const deleteNewComments = useDeleteNewComments();
  const createFreeComment = useCreateFreeCommentResource();
  const createHighlightComment = useCreateHighlightCommentResource();
  const attachHighlightComment = useAttachHighlightCommentResource();
  const createThreadReply = useCreateThreadReplyResource();

  return createCallback(async (info: CreateCommentInfo) => {
    track(TrackingEvents.BLOCKPDF.COMMENT.CREATE);
    const { threadId, text } = info;

    // new thread + anchor
    if (threadId === -1) {
      const comment = commentsStore.get.find((c) => c.threadId === threadId);
      if (!comment) {
        console.error('Unable to comment');
        return null;
      }

      let response: CreateCommentResponse | null = null;
      switch (comment.type) {
        case 'highlight':
          const highlight = highlightsUuidMap()?.[comment.anchorId];
          if (!highlight) {
            console.error('Unable to find highlight');
            return response;
          }

          if (highlight.existsOnServer) {
            response = await attachHighlightComment(text, highlight.uuid);
          } else {
            response = await createHighlightComment(text, highlight);
          }
          break;
        case 'free':
          const newThreadPlaceable_ = newThreadPlaceable();
          if (
            !newThreadPlaceable_ ||
            newThreadPlaceable_.internalId !== comment.anchorId
          ) {
            console.error('Unable to find new thread placeable');
            return response;
          }

          response = await createFreeComment(text, newThreadPlaceable_);
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

    return await createThreadReply(text, threadId);
  });
}

export function useUpdateComment() {
  const editComment = useEditCommentResource();

  return createCallback((info: UpdateCommentInfo) => {
    track(TrackingEvents.BLOCKPDF.COMMENT.UPDATE);
    return editComment(info.commentId, {
      text: info.text,
    });
  });
}

export function useDeleteComment() {
  const deleteComment = useDeleteCommentResource();
  const deleteNewComments = useDeleteNewComments();

  return createCallback((info: DeleteCommentInfo) => {
    const commentId = info.commentId;

    if (commentId === -1) {
      deleteNewComments();
      return;
    }

    const success = deleteComment(commentId, {
      removeAnchorThreadOnly: info.removeAnchorThreadOnly,
    });

    track(TrackingEvents.BLOCKPDF.COMMENT.DELETE);
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
  const viewer = useGetRootViewer();
  const comments = commentsStore.get;
  const blockElement = blockElementSignal.get;
  const documentId = useBlockId();

  const scrollIntoView = (el: HTMLElement) => {
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'start',
    });
  };

  return async (threadId: number) => {
    const measureContainerId = threadMeasureContainerId(documentId, threadId);
    let measureContainer = document.getElementById(measureContainerId);
    const blockEl = blockElement();
    if (!blockEl) {
      console.error('Unable to find block element');
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

      // If the element is already in the DOM, start observing it immediately
      // otherwise, listen for it to be added to the DOM
      if (measureContainer) {
        intersectionObserver.observe(measureContainer);
        scrollIntoView(measureContainer);
      } else {
        mutationObserver.observe(blockEl, {
          childList: true,
          subtree: true,
        });

        // since page overlays are only rendered in viewport
        // we need to force a render by scrolling to the page
        setTimeout(() => {
          const viewer_ = viewer();
          if (!viewer_) return;

          const rootComment = comments
            .filter(isRoot)
            .find((c) => c.threadId === threadId) as PdfRootLayout | undefined;
          if (!rootComment) return;

          // if the comment is already in the viewport, we don't need to scroll
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
            mutationObserver.observe(blockEl, {
              childList: true,
              subtree: true,
            });
          }
        }, 250);
      }

      // automatically clean up after a timeout period
      setTimeout(() => {
        intersectionObserver.disconnect();
        mutationObserver.disconnect();
        resolve();
      }, 2000);
    });
  };
}
