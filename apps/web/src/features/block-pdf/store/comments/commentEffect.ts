import { createEffect, createMemo } from 'solid-js';
import {
  useDeleteNewComments,
  useScrollToCommentThread,
} from './commentOperations';
import {
  activeCommentThreadSignal,
  commentsStore,
  noScrollToActiveCommentThreadSignal,
} from './commentStore';

// remove the new temporary comment when it is no longer active
const useDeleteNewCommentEffect = () => {
  const deleteNewComments = useDeleteNewComments();
  const activeCommentThread = activeCommentThreadSignal.get;

  createEffect(() => {
    const activeThreadId = activeCommentThread();
    if (!activeThreadId || activeThreadId !== -1) {
      deleteNewComments();
    }
  });
};

// scroll to the active comment thread
const useScrollToActiveThreadEffect = () => {
  const scrollToCommentThread = useScrollToCommentThread();
  const comments = commentsStore.get;
  const activeCommentThread = activeCommentThreadSignal.get;

  const noScrollToActiveCommentThread = noScrollToActiveCommentThreadSignal.get;
  const noScroll = createMemo(() => {
    return noScrollToActiveCommentThread();
  });
  const hasMatch = createMemo(() => {
    return comments.find((c) => c.threadId === activeCommentThread()) != null;
  });

  createEffect(() => {
    if (noScroll()) return;

    const activeThreadId = activeCommentThread();
    if (activeThreadId == null) return;

    if (!hasMatch()) return;

    scrollToCommentThread(activeThreadId);
  });
};

export const usePdfCommentEffects = () => {
  useDeleteNewCommentEffect();
  useScrollToActiveThreadEffect();
};
