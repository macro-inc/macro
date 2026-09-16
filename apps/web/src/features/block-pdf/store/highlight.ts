import { getHighlightsFromSelection } from '@block-pdf/util/pdfjsUtils';
import { createCallback } from '@solid-primitives/rootless';
import { batch, createEffect } from 'solid-js';
import { produce, reconcile } from 'solid-js/store';
import { usePdfDocument } from '../context/pdf-document-context';
import { Highlight, type IHighlight } from '../model/Highlight';
import {
  useCreateUnthreadedHighlightResource,
  useDeleteUnthreadedHighlightResource,
} from './commentsResource';

/** Map of highlight uuid to highlights */
export type HighlightUuidMap = Partial<Record<string, IHighlight>>;
/** Map of highlight page index to highlights uuid map on that page. */
export type HighlightPageMap = Partial<Record<number, HighlightUuidMap>>;

/**
 * Keeps the document-scoped highlight store synchronized with annotation
 * resources. Invoke once inside the PDF document provider.
 */
export function useSyncHighlightStore() {
  const pdf = usePdfDocument();
  const [, setHighlightStore] = pdf.state.stores.highlights;
  const [anchorsData] = pdf.state.resources.anchors;
  const [commentThreadsData] = pdf.state.resources.commentThreads;

  createEffect(() => {
    setHighlightStore(reconcile({}));

    const anchors = anchorsData();
    if (!anchors || anchors.length === 0) return;

    const commentThreads = commentThreadsData() ?? [];
    const highlightAnchors = anchors.filter(
      (anchor) => anchor.anchorType === 'highlight'
    );

    const mappedAnchors = highlightAnchors.flatMap((anchor) => {
      const commentThread = commentThreads.find(
        (thread) => thread.thread.threadId === anchor.threadId
      );
      // This is an error but may resolve once both resources have loaded.
      if (!commentThread && anchor.threadId) return [];

      // TODO: deprecate unneeded fields
      const highlight: IHighlight = {
        owner: anchor.owner,
        existsOnServer: true,
        pageNum: anchor.page,
        rects: anchor.highlightRects,
        color: {
          red: anchor.red,
          green: anchor.green,
          blue: anchor.blue,
          alpha: anchor.alpha,
        },
        hasTempThread: false,
        uuid: anchor.uuid,
        text: anchor.text,
        type: anchor.highlightType,
        pageViewport: {
          width: anchor.pageViewportWidth,
          height: anchor.pageViewportHeight,
        },
        thread: commentThread
          ? {
              threadId: commentThread.thread.threadId,
              rootId: commentThread.comments[0].commentId,
              anchorId: anchor.uuid,
              page: anchor.page,
              comments: commentThread.comments,
              isResolved: commentThread.thread.resolved,
            }
          : null,
      };

      return highlight;
    });

    batch(() => {
      for (const highlight of mappedAnchors) {
        setHighlightStore(highlight.pageNum, (previous) => ({
          ...previous,
          [highlight.uuid]: highlight,
        }));
      }
    });
  });
}

export const useClearHighlightStore = () => {
  const [, setHighlightStore] = usePdfDocument().state.stores.highlights;
  return () => {
    setHighlightStore(reconcile({}));
  };
};

export const useClearSelectionHighlights = () => {
  const [, setSelectionStore] = usePdfDocument().state.stores.selection;
  return () => {
    setSelectionStore(
      reconcile({
        highlightsUnderSelection: [],
        selection: null,
        selectionString: '',
      })
    );
  };
};

export const useSetSelectionHighlights = () => {
  const { highlights, selection } = usePdfDocument().state.stores;
  const [highlightStore] = highlights;
  const [, setSelectionStore] = selection;

  return (selection: Selection) => {
    if (selection.isCollapsed) return;

    setSelectionStore({
      highlightsUnderSelection: [],
      selection,
      selectionString: selection.toString(),
    });

    batch(() => {
      const selectionHighlights = getHighlightsFromSelection(selection);
      for (let [
        pageIndex,
        selectionHighlight,
      ] of selectionHighlights.entries()) {
        const existingHighlights = highlightStore[pageIndex];
        if (!existingHighlights) continue;

        const overlappingHighlights = Object.values(existingHighlights).filter(
          (existingHighlight): existingHighlight is IHighlight =>
            !!existingHighlight &&
            Highlight.overlaps(selectionHighlight, existingHighlight)
        );

        setSelectionStore(
          produce((state) => {
            if (!state.highlightsUnderSelection)
              state.highlightsUnderSelection = [];

            state.highlightsUnderSelection.push(...overlappingHighlights);
          })
        );
      }
    });
  };
};

export const useAddNewHighlightComments = () => {
  const [, setHighlightStore] = usePdfDocument().state.stores.highlights;
  return (highlights: IHighlight[]) =>
    setHighlightStore(
      produce((state) => {
        for (const highlight of highlights) {
          const pageNum = highlight.pageNum;
          const uuid = highlight.uuid;

          if (state[pageNum]) {
            // Update the existing page highlights
            state[pageNum][uuid] = highlight;
          } else {
            // Create a new entry for the page if it doesn't exist
            state[pageNum] = { [uuid]: highlight };
          }
        }
      })
    );
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
  const [, setGeneralPopupLocation] =
    usePdfDocument().state.signals.generalPopupLocation;

  return (uuid: string) => {
    setGeneralPopupLocation(null);
    deleteHighlight(uuid);
  };
}

export const useGetHighlightByUuid = () => {
  const highlightsUuidMap = usePdfDocument().state.derived.highlightsUuidMap;
  return createCallback((uuid: string) => {
    return highlightsUuidMap()?.[uuid];
  });
};

export const useHasHighlights = () => {
  const [highlightStore] = usePdfDocument().state.stores.highlights;
  return () =>
    Object.values(highlightStore).some(
      (page) => Object.values(page ?? {}).length > 0
    );
};
