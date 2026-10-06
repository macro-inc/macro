import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { usePdfDocument } from '@block-pdf/context/pdf-document-context';
import {
  isPdfDraftThreadId,
  type PdfRootLayout,
} from '@block-pdf/type/comments';
import {
  isDraftThreadId,
  isRoot,
  type MessageCommentOperations,
  type ThreadId,
} from '@core/comments/commentType';
import { threadMeasureContainerId } from '@core/comments/Thread';
import { toast } from '@core/component/Toast/Toast';
import type { Message } from '@service-storage/messages';
import { createCallback } from '@solid-primitives/rootless';
import { usePdfComments } from '../../context/pdf-comments-context';
import { usePdfViewer } from '../../context/pdf-viewer-context';
import {
  useAttachHighlightMessageComment,
  useCreateFreeMessageComment,
  useCreateHighlightMessageComment,
  useCreateMessageThreadReply,
  useDeleteMessageThread,
} from '../messageCommentsResource';
import { useDeleteNewFreeComment, useNewThreadPlaceable } from './freeComments';
import { useDeleteNewHighlightComment } from './highlightComments';

/**
 * Message-path comment writes: a draft posts a root carrying its highlight or
 * placeable anchor; anything else replies to that root.
 */
export function useCreateMessageComment(): MessageCommentOperations['createComment'] {
  const analytics = useAnalytics();
  const annotations = usePdfDocument().annotations;
  const comments = usePdfComments();

  const deleteNewComments = useDeleteNewComments();
  const createFreeComment = useCreateFreeMessageComment();
  const createHighlightComment = useCreateHighlightMessageComment();
  const attachHighlightComment = useAttachHighlightMessageComment();
  const createThreadReply = useCreateMessageThreadReply();
  const newThreadPlaceable = useNewThreadPlaceable();

  return createCallback(async (input) => {
    analytics.track('comment_create', { blockType: 'pdf' });
    const { threadId, ...message } = input;

    if (!isDraftThreadId(threadId) && !isPdfDraftThreadId(threadId)) {
      return createThreadReply({ ...message, thread_id: String(threadId) });
    }

    // The shared composer posts with the generic draft id; the active thread
    // names the PDF draft being composed.
    const activeThreadId = comments.activeThreadId();
    const drafts = comments
      .all()
      .filter(
        (comment): comment is PdfRootLayout => isRoot(comment) && comment.isNew
      );
    const draft =
      drafts.find((comment) => comment.threadId === activeThreadId) ??
      drafts.at(0);
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

/** Removes a whole message discussion; a draft is simply discarded. */
export function useDeleteMessageCommentThread() {
  const analytics = useAnalytics();
  const deleteThread = useDeleteMessageThread();
  const deleteNewComments = useDeleteNewComments();

  return createCallback(async (threadId: ThreadId) => {
    if (isDraftThreadId(threadId) || isPdfDraftThreadId(threadId)) {
      deleteNewComments();
      return false;
    }
    try {
      await deleteThread(String(threadId));
    } catch (error) {
      console.error('Unable to delete comment thread', error);
      toast.failure('Unable to delete comment');
      return false;
    }
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
