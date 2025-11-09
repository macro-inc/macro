import { freeComments } from '@block-pdf/store/comments/freeComments';
import { highlightComments } from '@block-pdf/store/comments/highlightComments';
import type { CommentStore, PdfComment } from '@block-pdf/type/comments';
import {
  createBlockEffect,
  createBlockMemo,
  createBlockSignal,
  createBlockStore,
} from '@core/block';
import type { ThreadId } from '@core/collab/comments/commentType';
import { createMemo, createSelector } from 'solid-js';
import { reconcile } from 'solid-js/store';

export const activeCommentThreadSignal = createBlockSignal<ThreadId | null>(
  null
);

export const noScrollToActiveCommentThreadSignal = createBlockSignal(false);

export const useIsActiveThreadSelector = () => {
  const isSelected = createSelector(
    activeCommentThreadSignal,
    (id: ThreadId | null, activeId) => {
      if (id == null) return false;
      return id === activeId;
    }
  );
  return isSelected;
};

export const commentsStore = createBlockStore<CommentStore>([]);

type CommentMap = Map<number, PdfComment>;
export const commentMap = createBlockMemo(() => {
  const commentMap: CommentMap = new Map();
  for (const comment of commentsStore.get ?? []) {
    commentMap.set(comment.id, comment);
  }
  return commentMap;
});

export const useGetCommentById = () => {
  return (id: number) => commentMap()?.get(id);
};

const combinedComments = createBlockMemo(() => {
  const highlights = highlightComments() ?? [];
  const free = freeComments() ?? [];
  const combined = [...highlights, ...free];
  return combined;
});

// NOTE: this lets us block on the comments store being loaded in
// but it does not distinguish between unloaded and non-existent comments states
export const useHasComments = () => {
  return createMemo(() => {
    const combinedComments_ = combinedComments();
    return combinedComments_ && combinedComments_.length > 0;
  });
};

createBlockEffect(() => {
  const setComments = commentsStore.set;
  const combinedComments_ = combinedComments();
  setComments(reconcile(combinedComments_ ?? []));
});
