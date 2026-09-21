import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { usePdfDocument } from '@block-pdf/context/pdf-document-context';
import type { PdfRootLayout } from '@block-pdf/type/comments';
import {
  type CommentOperations,
  isDraftThreadId,
  isRoot,
  type ThreadId,
} from '@core/comments/commentType';
import { threadMeasureContainerId } from '@core/comments/Thread';
import type { Message } from '@service-storage/messages';
import { createCallback } from '@solid-primitives/rootless';
import { usePdfComments } from '../../context/pdf-comments-context';
import { usePdfViewer } from '../../context/pdf-viewer-context';
import {
  useAttachHighlightCommentResource,
  useCreateFreeCommentResource,
  useCreateHighlightCommentResource,
  useCreateThreadReplyResource,
  useDeleteThreadResource,
} from '../commentsResource';
import { useDeleteNewFreeComment, useNewThreadPlaceable } from './freeComments';
import { useDeleteNewHighlightComment } from './highlightComments';

/** A draft posts a root on its highlight or placeable; anything else replies to that root. */
export function useCreateComment(): CommentOperations['createComment'] {
  const analytics = useAnalytics();
  const annotations = usePdfDocument().annotations;
  const comments = usePdfComments();

  const deleteNewComments = useDeleteNewComments();
  const createFreeComment = useCreateFreeCommentResource();
  const createHighlightComment = useCreateHighlightCommentResource();
  const attachHighlightComment = useAttachHighlightCommentResource();
  const createThreadReply = useCreateThreadReplyResource();
  const newThreadPlaceable = useNewThreadPlaceable();

  return createCallback(async (input) => {
    analytics.track('comment_create', { blockType: 'pdf' });
    const { threadId, ...message } = input;

    if (!isDraftThreadId(threadId)) {
      return createThreadReply({ ...message, thread_id: threadId });
    }

    const draft = comments
      .all()
      .find(
        (comment): comment is PdfRootLayout => isRoot(comment) && comment.isNew
      );
    if (!draft) {
      console.error('Unable to comment');
      return null;
    }

    let created: Message | null = null;
    switch (draft.type) {
      case 'highlight': {
        const highlight = annotations.highlightsByUuid()[draft.anchorId];
        if (!highlight) {
          console.error('Unable to find highlight');
          return null;
        }
        created = highlight.existsOnServer
          ? await attachHighlightComment(message, highlight.uuid)
          : await createHighlightComment(message, highlight);
        break;
      }
      case 'free': {
        const placeable = newThreadPlaceable();
        if (!placeable || placeable.internalId !== draft.anchorId) {
          console.error('Unable to find new thread placeable');
          return null;
        }
        created = await createFreeComment(message, placeable);
        break;
      }
      default:
        console.error('invalid comment type', draft.type);
        return null;
    }

    if (created) {
      deleteNewComments();
      comments.activateThread(created.id);
    }
    return created;
  });
}

/** Removes a whole discussion; a draft is simply discarded. */
export function useDeleteCommentThread() {
  const analytics = useAnalytics();
  const deleteThread = useDeleteThreadResource();
  const deleteNewComments = useDeleteNewComments();

  return createCallback(async (threadId: ThreadId) => {
    if (isDraftThreadId(threadId)) {
      deleteNewComments();
      return false;
    }
    await deleteThread(threadId);
    analytics.track('comment_delete', { blockType: 'pdf' });
    return true;
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

  return async (threadId: ThreadId) => {
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
