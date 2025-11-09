import { mdStore } from '@block-md/signal/markdownBlockData';
import { withAnalytics } from '@coparse/analytics';
import { useBlockId } from '@core/block';
import type {
  CreateCommentInfo,
  DeleteCommentInfo,
  UpdateCommentInfo,
} from '@core/collab/comments/commentType';
import { threadMeasureContainerId } from '@core/collab/comments/Thread';
import {
  CREATE_COMMENT_COMMAND,
  DELETE_COMMENT_COMMAND,
  DISCARD_DRAFT_COMMENT_COMMAND,
  SET_COMMENT_THREAD_ID_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { blockElementSignal } from '@core/signal/blockElement';
import type { CreateCommentResponse } from '@service-storage/generated/schemas/createCommentResponse';
import { createCallback } from '@solid-primitives/rootless';
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

const { track, TrackingEvents } = withAnalytics();

export function useCreateComment() {
  const deleteNewComments = useDeleteNewComments();
  const createHighlightComment = useCreateHighlightCommentResource();
  const createThreadReply = useCreateThreadReplyResource();
  const threads = threadStore.get;
  const updateNodeThreadId = useSetNodeCommentThreadId();
  const setActiveThread = activeCommentThreadSignal.set;
  const editor = mdStore.get.editor;

  return createCallback(
    async (info: CreateCommentInfo & { markId: string }) => {
      track(TrackingEvents.BLOCKMARKDOWN.COMMENT.CREATE);
      const { threadId, text } = info;

      if (threadId === -1) {
        setActiveThread(threadId);

        const comment = threads[threadId];
        if (!comment) {
          console.error('Unable to comment');
          return null;
        }

        let response: CreateCommentResponse | null = null;

        response = await createHighlightComment(text, comment.anchorId);

        if (response) {
          editor?.dispatchCommand(CREATE_COMMENT_COMMAND, {
            threadId: response.thread.threadId,
          });
          updateNodeThreadId({
            markId: comment.anchorId,
            threadId: response.thread.threadId,
          });
          deleteNewComments();
        }
        return response;
      }

      return await createThreadReply(text, threadId);
    }
  );
}

export function useUpdateComment() {
  const editComment = useEditCommentResource();

  return createCallback((info: UpdateCommentInfo) => {
    track(TrackingEvents.BLOCKMARKDOWN.COMMENT.UPDATE);

    return editComment(info.commentId, {
      text: info.text,
    });
  });
}

export function useCreatePendingComment() {
  return createCallback(async (_info: {}) => {});
}

export function useDeleteComment() {
  const deleteComment = useDeleteCommentResource();
  const deleteNewComments = useDeleteNewComments();
  const editor = mdStore.get.editor;
  const comments = commentsStore.get;

  return createCallback(async (info: DeleteCommentInfo) => {
    track(TrackingEvents.BLOCKMARKDOWN.COMMENT.DELETE);
    editor?.dispatchCommand(DISCARD_DRAFT_COMMENT_COMMAND, undefined);
    const commentId = info.commentId;

    if (commentId === -1) {
      deleteNewComments();
      return true;
    }

    const comment = comments[commentId];
    // this can happen when deleting the thread ->
    // comment mark deleted -> comment server delete re-attempted
    if (!comment) return true;

    const deleteInfo = await deleteComment(commentId, {
      removeAnchorThreadOnly: info.removeAnchorThreadOnly,
    });

    if (deleteInfo?.threadDeleted) {
      editor?.dispatchCommand(DELETE_COMMENT_COMMAND, [comment.anchorId, true]);
    }

    return !!deleteInfo;
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

export const useSetNodeCommentThreadId = () => {
  const editor = mdStore.get.editor;

  return createCallback(
    ({ markId, threadId }: { markId: string; threadId: number }) => {
      editor?.dispatchCommand(SET_COMMENT_THREAD_ID_COMMAND, {
        markId,
        threadId,
      });
    }
  );
};

export function useScrollToCommentThread() {
  const blockElement = blockElementSignal.get;
  const documentId = useBlockId();

  const scrollIntoView = (el: HTMLElement) => {
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
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
