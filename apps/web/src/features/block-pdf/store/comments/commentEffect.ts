import { useBlockId } from '@core/block';
import { useUrlParams } from '@core/component/ParamsProvider';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useMessageLink } from '@queries/messages/document-messages';
import { createEffect, createMemo } from 'solid-js';
import { URL_PARAMS } from '../../constants';
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

/** Activate the thread named by a copied comment link once its anchor is loaded. */
const useCommentLinkEffect = () => {
  const id = useBlockId();
  const params = useUrlParams(URL_PARAMS);
  const target = useMessageLink(
    () => ({ type: 'document', id }),
    () => params.commentId()
  );
  let navigated: string | null = null;
  createEffect(() => {
    const requested = target.messageId();
    if (!requested) {
      navigated = null;
      return;
    }
    if (requested === navigated) return;
    const comment = commentsStore.get.find(
      (comment) => comment.id === requested || comment.id === target.rootId()
    );
    if (!comment) return;
    activeCommentThreadSignal.set(comment.threadId);
    navigated = requested;
  });
};

export const usePdfCommentEffects = () => {
  if (isFeatureEnabled(enableUnifiedDocumentDiscussions)) {
    useCommentLinkEffect();
  }
  useDeleteNewCommentEffect();
  useScrollToActiveThreadEffect();
};
