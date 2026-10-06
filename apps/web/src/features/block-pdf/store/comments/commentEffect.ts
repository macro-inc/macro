import { usePdfCommentRealtimeBehavior } from '@block-pdf/store/commentsResource';
import { isPdfDraftThreadId } from '@block-pdf/type/comments';
import { createEffect, createMemo } from 'solid-js';
import { usePdfComments } from '../../context/pdf-comments-context';
import {
  useDeleteNewComments,
  useScrollToCommentThread,
} from './commentOperations';

const useDeleteNewCommentEffect = () => {
  const deleteNewComments = useDeleteNewComments();
  const activeCommentThreadId = usePdfComments().activeThreadId;

  createEffect(() => {
    const activeThreadId = activeCommentThreadId();
    if (!isPdfDraftThreadId(activeThreadId)) {
      deleteNewComments();
    }
  });
};

const useScrollToActiveThreadEffect = () => {
  const scrollToCommentThread = useScrollToCommentThread();
  const commentsContext = usePdfComments();
  const comments = commentsContext.all;
  const activeCommentThreadId = commentsContext.activeThreadId;
  const activeThreadScrollingSuppressed = commentsContext.scrollingSuppressed;
  const hasActiveThread = createMemo(() => {
    const activeThreadId = activeCommentThreadId();
    return (
      activeThreadId != null &&
      comments().some((comment) => comment.threadId === activeThreadId)
    );
  });

  createEffect(() => {
    if (activeThreadScrollingSuppressed()) return;

    const activeThreadId = activeCommentThreadId();
    if (activeThreadId == null) return;
    if (!hasActiveThread()) return;

    if (!isPdfDraftThreadId(activeThreadId))
      scrollToCommentThread(activeThreadId);
  });
};

export const usePdfCommentEffects = () => {
  usePdfCommentRealtimeBehavior();
  useDeleteNewCommentEffect();
  useScrollToActiveThreadEffect();
};
