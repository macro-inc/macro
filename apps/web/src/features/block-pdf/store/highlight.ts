import { generalPopupLocationSignal } from '@block-pdf/signal/location';
import { getHighlightsFromSelection } from '@block-pdf/util/pdfjsUtils';
import {
  createBlockEffect,
  createBlockMemo,
  createBlockStore,
} from '@core/block';
import { createCallback } from '@solid-primitives/rootless';
import { batch } from 'solid-js';
import { produce, reconcile } from 'solid-js/store';
import { Highlight, type IHighlight } from '../model/Highlight';
import {
  anchorsResource,
  commentThreadsResource,
  useCreateUnthreadedHighlightResource,
  useDeleteUnthreadedHighlightResource,
} from './commentsResource';

/** Map of highlight uuid to highlights */
export type HighlightUuidMap = Partial<Record<string, IHighlight>>;
/** Map of highlight page index to highlights uuid map on that page. */
export type HighlightPageMap = Partial<Record<number, HighlightUuidMap>>;

/**
 * Map of highlight page index to highlights on that page.
 * Highlights are stored as an object mapping UUID to highlight object. See {@link Highlight}.
 * NOTE: page number is 0-indexed, and is converted to a string as a Record is a JS object under the hood
 */
export const highlightStore = createBlockStore<HighlightPageMap>({});

createBlockEffect(() => {
  const clearHighlightStore = useClearHighlightStore();
  clearHighlightStore();

  const [anchorsData] = anchorsResource;
  const anchors = anchorsData();
  if (!anchors || anchors.length === 0) return;

  const [commentThreadsData] = commentThreadsResource;
  const commentThreads = commentThreadsData() ?? [];

  const highlightAnchors = anchors.filter((a) => a.anchorType === 'highlight');

  const mappedAnchors = highlightAnchors.flatMap((a) => {
    const commentThread = commentThreads.find(
      (ct) => ct.thread.threadId === a.threadId
    );
    // this is an error but probably resolves eventually as the data is fetched asynchronously
    if (!commentThread && a.threadId) {
      return [];
    }

    // TODO: deprecate unneeded fields
    const highlight: IHighlight = {
      owner: a.owner,
      existsOnServer: true,
      pageNum: a.page,
      rects: a.highlightRects,
      color: {
        red: a.red,
        green: a.green,
        blue: a.blue,
        alpha: a.alpha,
      },
      hasTempThread: false,
      uuid: a.uuid,
      text: a.text,
      type: a.highlightType,
      pageViewport: {
        width: a.pageViewportWidth,
        height: a.pageViewportHeight,
      },
      thread: commentThread
        ? {
            threadId: commentThread.thread.threadId,
            rootId: commentThread.comments[0].commentId,
            anchorId: a.uuid,
            page: a.page,
            comments: commentThread.comments,
            isResolved: commentThread.thread.resolved,
          }
        : null,
    };

    return highlight;
  });

  batch(() => {
    for (const highlight of mappedAnchors) {
      highlightStore.set(highlight.pageNum, (prev) => ({
        ...prev,
        [highlight.uuid]: highlight,
      }));
    }
  });
});

export const highlights = createBlockMemo(() => {
  const out: IHighlight[] = [];
  for (const pageHighlights of Object.values(highlightStore.get ?? {})) {
    if (!pageHighlights) continue;
    for (const highlight of Object.values(pageHighlights)) {
      if (!highlight) continue;
      out.push(highlight);
    }
  }
  return out;
});

export const highlightsUuidMap = createBlockMemo(() => {
  const out: HighlightUuidMap = {};
  for (const pageHighlights of Object.values(highlightStore.get ?? {})) {
    if (!pageHighlights) continue;
    for (const [highlightUuid, highlight] of Object.entries(pageHighlights)) {
      out[highlightUuid] = highlight;
    }
  }
  return out;
});

export const selectionStore = createBlockStore<{
  highlightsUnderSelection: IHighlight[];
  selection: Selection | null;
  selectionString: string;
}>({
  highlightsUnderSelection: [],
  selection: null,
  selectionString: '',
});

export const useClearHighlightStore = () => {
  const setHighlightStore = highlightStore.set;
  return () => {
    setHighlightStore(reconcile({}));
  };
};

export const useClearSelectionHighlights = () => {
  const setSelectionStore = selectionStore.set;
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
  const setSelectionStore = selectionStore.set;
  const highlightStoreValue = highlightStore.get;

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
        const existingHighlights = highlightStoreValue[pageIndex];
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
  const setHighlightStore = highlightStore.set;
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
  const setGeneralPopupLocation = generalPopupLocationSignal.set;

  return (uuid: string) => {
    setGeneralPopupLocation(null);
    deleteHighlight(uuid);
  };
}

export const useGetHighlightByUuid = () => {
  return createCallback((uuid: string) => {
    return highlightsUuidMap()?.[uuid];
  });
};

export const hasHighlights = createBlockMemo(() => {
  return Object.values(highlightStore.get ?? {}).some(
    (page) => Object.values(page ?? {}).length > 0
  );
});
