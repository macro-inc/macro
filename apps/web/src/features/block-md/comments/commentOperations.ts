import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  type CommentOperations,
  isDraftThreadId,
  type ThreadId,
} from '@core/comments/commentType';
import { threadMeasureContainerId } from '@core/comments/Thread';
import {
  COMMIT_COMMENT_MARK_COMMAND,
  DELETE_COMMENT_COMMAND,
  DISCARD_DRAFT_COMMENT_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { isMobile } from '@core/mobile/isMobile';
import { until } from '@solid-primitives/promise';
import { createCallback } from '@solid-primitives/rootless';
import { onCleanup } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import {
  useCreateMarkedMessageResource,
  useCreateMessageReplyResource,
} from './commentsResource';

/** A draft posts a root anchored to its mark; anything else replies to that root. */
export function useCreateComment(): CommentOperations['createComment'] {
  const analytics = useAnalytics();
  const deleteNewComments = useDeleteNewComments();
  const createMarkedMessage = useCreateMarkedMessageResource();
  const createReply = useCreateMessageReplyResource();
  const { state } = useMarkdownDocument();
  const { comments: commentState, setCommentState } = state;
  const threads = commentState.threads;
  const marks = commentState.marks;
  const setMarks = (...args: unknown[]) =>
    (setCommentState as (...a: unknown[]) => void)('marks', ...args);
  const setActiveThread = (v: ThreadId | null) =>
    setCommentState('activeCommentThread', v);

  return createCallback(async (info) => {
    const editor = state.editor.md.editor;
    analytics.track('comment_create', { blockType: 'md' });
    const { threadId, ...message } = info;

    if (!isDraftThreadId(threadId)) {
      return createReply({ ...message, thread_id: threadId });
    }

    setActiveThread(threadId);
    const draft = threads[threadId];
    if (!draft) {
      console.error('Unable to comment');
      return null;
    }

    const response = await createMarkedMessage(
      message.content,
      draft.anchorId,
      message.mentions,
      message.attachments
    );
    if (!response) return null;

    if (marks[draft.anchorId]) {
      setMarks(draft.anchorId, 'existsOnServer', true);
      setMarks(draft.anchorId, 'isDraft', false);
    }
    setActiveThread(response.id);
    editor?.dispatchCommand(COMMIT_COMMENT_MARK_COMMAND, {
      markId: draft.anchorId,
    });
    deleteNewComments();
    return response;
  });
}

export function useDeleteNewComments() {
  const { state } = useMarkdownDocument();
  const { comments: commentState, setCommentState } = state;
  const editor = state.editor.md.editor;

  return createCallback((discardPending = true) => {
    // console.trace('delete new comments');
    for (const [markId, mark] of Object.entries(commentState.marks)) {
      if (!mark || !mark.existsOnServer) {
        setCommentState('marks', markId, undefined);
        editor?.dispatchCommand(DELETE_COMMENT_COMMAND, [markId, false]);
      }
      if (discardPending) {
        editor?.dispatchCommand(DISCARD_DRAFT_COMMENT_COMMAND, undefined);
      }
    }
  });
}

export function useScrollToCommentThread() {
  const {
    documentId: getDocumentId,
    element: blockElement,
    state,
  } = useMarkdownDocument();
  const commentState = state.comments;
  const documentId = getDocumentId();
  // Captured at setup: block stores resolve their block context at access
  // time, which the returned callback no longer has.
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

  return async (threadId: ThreadId) => {
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
        const anchorId = commentState.threads[threadId]?.anchorId;
        return anchorId != null
          ? Object.values(commentState.marks[anchorId]?.markNodes ?? {})[0]
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
