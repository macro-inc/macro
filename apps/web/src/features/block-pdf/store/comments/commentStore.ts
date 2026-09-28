import type { ThreadId } from '@core/comments/commentType';
import { createMemo, createSelector } from 'solid-js';
import { usePdfComments } from '../../context/pdf-comments-context';
import { useFreeComments } from './freeComments';
import { useHighlightComments } from './highlightComments';

export const useIsActiveThreadSelector = () => {
  const isSelected = createSelector(
    usePdfComments().activeThreadId,
    (id: ThreadId | null, activeId) => {
      if (id == null) return false;
      return id === activeId;
    }
  );
  return isSelected;
};

export function usePdfCommentProjection() {
  const highlightComments = useHighlightComments();
  const freeComments = useFreeComments();
  return createMemo(() => [...highlightComments(), ...freeComments()]);
}

export const useHasComments = () => {
  const comments = usePdfComments().all;
  return () => comments().length > 0;
};
