import { getHighlightsFromSelection } from '@block-pdf/util/pdfjsUtils';
import { batch } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { Highlight, type IHighlight } from '../model/Highlight';
import {
  useCreateUnthreadedHighlightResource,
  useDeleteUnthreadedHighlightResource,
} from './commentsResource';

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
  const pdf = usePdfDocument();

  return (uuid: string) => {
    pdf.closeSelectionMenu();
    deleteHighlight(uuid);
  };
}
