import { usePdfDocument } from '@block-pdf/context/pdf-document-context';
import type { ThreadId } from '@core/comments/commentType';
import { createEffect, createMemo, createSelector } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { useFreeComments } from './freeComments';
import { useHighlightComments } from './highlightComments';

export const useIsActiveThreadSelector = () => {
  const [activeCommentThread] =
    usePdfDocument().state.signals.activeCommentThread;
  const isSelected = createSelector(
    activeCommentThread,
    (id: ThreadId | null, activeId) => {
      if (id == null) return false;
      return id === activeId;
    }
  );
  return isSelected;
};

export const useGetCommentById = () => {
  const { commentMap } = usePdfDocument().state.derived;
  return (id: number) => commentMap().get(id);
};

// NOTE: this lets us block on the comments store being loaded in
// but it does not distinguish between unloaded and non-existent comments states
export const useHasComments = () => {
  const highlightComments = useHighlightComments();
  const freeComments = useFreeComments();
  return createMemo(() => {
    return [...highlightComments(), ...freeComments()].length > 0;
  });
};

export function useCommentStoreBehavior() {
  const highlightComments = useHighlightComments();
  const freeComments = useFreeComments();
  const [, setComments] = usePdfDocument().state.stores.comments;

  createEffect(() => {
    setComments(reconcile([...highlightComments(), ...freeComments()]));
  });
}
