import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { mdStore } from '@block-md/signal/markdownBlockData';
import { useBlockId } from '@core/block';
import type { DeleteCommentInfo } from '@core/comments/commentType';
import { threadMeasureContainerId } from '@core/comments/Thread';
import {
  COMMIT_COMMENT_MARK_COMMAND,
  DELETE_COMMENT_COMMAND,
  DISCARD_DRAFT_COMMENT_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { isMobile } from '@core/mobile/isMobile';
import { blockElementSignal } from '@core/signal/blockElement';
import type { EditMessage } from '@service-storage/generated/schemas/editMessage';
import type { Message, PostMessage } from '@service-storage/messages';
import { until } from '@solid-primitives/promise';
import { createCallback } from '@solid-primitives/rootless';
import { onCleanup } from 'solid-js';
import {
  activeCommentThreadSignal,
  commentsStore,
  markStore,
  threadStore,
} from './commentStore';
import {
  useCreateHighlightCommentResource,
  useCreateThreadReplyResource,
  useDeleteCommentResource,
  useEditCommentResource,
} from './commentsResource';

export function useCreateComment() {
  const analytics = useAnalytics();

  const deleteNewComments = useDeleteNewComments();
  const createHighlightComment = useCreateHighlightCommentResource();
  const createThreadReply = useCreateThreadReplyResource();
  const threads = threadStore.get;
  const [marks, setMarks] = markStore;
  const setActiveThread = activeCommentThreadSignal.set;

  return createCallback(async (info: PostMessage & { thread_id: string }) => {
    const editor = mdStore.get.editor;
    analytics.track('comment_create', { blockType: 'md' });
    const { thread_id: threadId, content: text, mentions, attachments } = info;

    if (threadId === 'draft') {
      setActiveThread(threadId);

      const comment = threads[threadId];
      if (!comment) {
        console.error('Unable to comment');
        return null;
      }

      let response: Message | null = null;

      response = await createHighlightComment(
        text,
        comment.anchorId,
        mentions,
        attachments
      );

      if (response) {
        if (marks[comment.anchorId]) {
          setMarks(comment.anchorId, 'existsOnServer', true);
          setMarks(comment.anchorId, 'isDraft', false);
        }
        setActiveThread(response.id);
        editor?.dispatchCommand(COMMIT_COMMENT_MARK_COMMAND, {
          markId: comment.anchorId,
        });
        deleteNewComments();
      }
      return response;
    }

    return await createThreadReply(info);
  });
}

export function useUpdateComment() {
  const analytics = useAnalytics();

  const editComment = useEditCommentResource();

  return createCallback((commentId: string, info: EditMessage) => {
    analytics.track('comment_update', { blockType: 'md' });

    return editComment(commentId, info);
  });
}

export function useCreatePendingComment() {
  return createCallback(async (_info: {}) => {});
}

export function useDeleteComment() {
  const analytics = useAnalytics();

  const deleteComment = useDeleteCommentResource();
  const deleteNewComments = useDeleteNewComments();
  const editor = mdStore.get.editor;
  const comments = commentsStore.get;

  return createCallback(async (info: DeleteCommentInfo) => {
    analytics.track('comment_delete', { blockType: 'md' });
    editor?.dispatchCommand(DISCARD_DRAFT_COMMENT_COMMAND, undefined);
    const commentId = info.commentId;

    if (commentId === 'draft') {
      deleteNewComments();
      return true;
    }

    const comment = comments[commentId];
    // this can happen when deleting the thread ->
    // comment mark deleted -> comment server delete re-attempted
    if (!comment) return true;

    return await deleteComment(commentId);
  });
}

export function useDeleteNewComments() {
  const [marks, setMarks] = markStore;
  const editor = mdStore.get.editor;

  return createCallback((discardPending = true) => {
    // console.trace('delete new comments');
    for (const [markId, mark] of Object.entries(marks)) {
      if (!mark || !mark.existsOnServer) {
        setMarks(markId, undefined);
        editor?.dispatchCommand(DELETE_COMMENT_COMMAND, [markId, false]);
      }
      if (discardPending) {
        editor?.dispatchCommand(DISCARD_DRAFT_COMMENT_COMMAND, undefined);
      }
    }
  });
}

export function useScrollToCommentThread() {
  const blockElement = blockElementSignal.get;
  const documentId = useBlockId();
  // Captured at setup: block stores resolve their block context at access
  // time, which the returned callback no longer has.
  const threads = threadStore.get;
  const [marks] = markStore;
  // At most one mobile wait-for-mark may be outstanding — a newer deep
  // link supersedes an older still-pending one, so a slow-syncing thread
  // can't later yank the scroll and the active thread away from the one
  // the user navigated to last. Registered here at setup (under the
  // component's owner) so an unresolved wait also dies with the block.
  let disposePendingWait: (() => void) | undefined;
  onCleanup(() => disposePendingWait?.());

  const scrollIntoView = (el: HTMLElement) => {
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'start',
    });
  };

  return async (threadId: string) => {
    // On phones the margin is display:none (the drawer is the only comment
    // surface), so its measure containers can't be scrolled to. Scroll to
    // the thread's mark in the editor itself. On a cold-load deep link the
    // comment stores populate after this runs — `until` awaits exactly
    // that: it re-evaluates the condition as the stores change and
    // resolves once the thread's mark has a rendered element. Disposing
    // the wait (a newer link superseding it, or the block unmounting via
    // the onCleanup above) rejects it, which the catch turns into a no-op.
    if (isMobile()) {
      disposePendingWait?.();
      const wait = until(() => {
        const anchorId = threads[threadId]?.anchorId;
        return anchorId != null
          ? Object.values(marks[anchorId]?.markNodes ?? {})[0]
          : undefined;
      });
      disposePendingWait = wait.dispose;
      const markElement = await wait.catch(() => undefined);
      // A cancelled wait resolves undefined — report it so the caller
      // skips activating the superseded/unmounted link's thread.
      if (!markElement) return false;
      markElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }

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
