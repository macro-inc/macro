import { usePdfDocument } from '@block-pdf/context/pdf-document-context';
import { usePdfCommentRealtimeBehavior } from '@block-pdf/store/commentsResource';
import { createEffect, createMemo } from 'solid-js';
import { useCommentLayoutBehavior } from './commentLayout';
import {
  useDeleteNewComments,
  useScrollToCommentThread,
} from './commentOperations';
import { useCommentStoreBehavior } from './commentStore';

// remove the new temporary comment when it is no longer active
const useDeleteNewCommentEffect = () => {
  const deleteNewComments = useDeleteNewComments();
  const [activeCommentThread] =
    usePdfDocument().state.signals.activeCommentThread;

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
  const { signals, stores } = usePdfDocument().state;
  const [comments] = stores.comments;
  const [activeCommentThread] = signals.activeCommentThread;
  const [noScrollToActiveCommentThread] = signals.noScrollToActiveCommentThread;
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

    if (typeof activeThreadId === 'number')
      scrollToCommentThread(activeThreadId);
  });
};

export const usePdfCommentEffects = () => {
  useCommentStoreBehavior();
  useCommentLayoutBehavior();
  usePdfCommentRealtimeBehavior();
  useDeleteNewCommentEffect();
  useScrollToActiveThreadEffect();
};
