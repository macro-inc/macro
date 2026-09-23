import { getHighlightsFromSelection } from '@block-pdf/util/pdfjsUtils';
import { toast } from '@core/component/Toast/Toast';
import { batch } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { Highlight, type IHighlight } from '../model/Highlight';
import {
  useCreateUnthreadedHighlightResource,
  useDeleteUnthreadedHighlightResource,
} from './commentsResource';
import { useDeleteMessageThread } from './messageCommentsResource';

export const useSetSelectionHighlights = () => {
  const pdf = usePdfDocument();
  const highlightsByPage = pdf.annotations.highlightsByPage;

  return (selection: Selection) => {
    if (selection.isCollapsed) return;

    pdf.setNativeSelection(selection);

    batch(() => {
      const selectedHighlights: IHighlight[] = [];
      const selectionHighlights = getHighlightsFromSelection(selection);
      for (let [
        pageIndex,
        selectionHighlight,
      ] of selectionHighlights.entries()) {
        const existingHighlights = highlightsByPage[pageIndex];
        if (!existingHighlights) continue;

        const overlappingHighlights = Object.values(existingHighlights).filter(
          (existingHighlight): existingHighlight is IHighlight =>
            !!existingHighlight &&
            Highlight.overlaps(selectionHighlight, existingHighlight)
        );
        selectedHighlights.push(...overlappingHighlights);
      }
      pdf.replaceSelectedHighlights(selectedHighlights);
    });
  };
};

export const useAddNewHighlights = () => {
  const addHighlight = useCreateUnthreadedHighlightResource();

  return (highlights: IHighlight[]) => {
    batch(() => {
      highlights.forEach(addHighlight);
    });
  };
};

export function useRemoveHighlight() {
  const deleteHighlight = useDeleteUnthreadedHighlightResource();
  const deleteMessageThread = useDeleteMessageThread();
  const pdf = usePdfDocument();

  return async (uuid: string) => {
    pdf.closeSelectionMenu();
    // The annotation endpoint deletes only a legacy thread with its highlight,
    // so a message discussion goes first; the server then detaches the highlight.
    const rootId = pdf.annotations.unified
      ? pdf.annotations.anchors()?.find((anchor) => anchor.uuid === uuid)
          ?.rootId
      : null;
    try {
      if (rootId) await deleteMessageThread(rootId);
      await deleteHighlight(uuid);
    } catch (error) {
      console.error('Unable to remove highlight', error);
      toast.failure('Unable to remove highlight');
    }
    // Supersede the reload the discussion delete started, which can
    // otherwise land after the highlight is gone and restore it.
    if (rootId) void pdf.annotations.commands.refetchAnchors();
  };
}
