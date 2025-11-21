import type { PDFViewer } from '@block-pdf/PdfViewer';
import {
  FindState,
  type IUpdateFindControlStateEvent,
} from '@block-pdf/PdfViewer/EventBus';
import type { FindController } from '@block-pdf/PdfViewer/FindController';
import { useScrollToCommentThread } from '@block-pdf/store/comments/commentOperations';
import { activeCommentThreadSignal } from '@block-pdf/store/comments/commentStore';
import {
  createBlockEffect,
  createBlockSignal,
  createBlockStore,
  useBlockId,
} from '@core/block';
import {
  setTempRedirectLocation,
  type TempRedirectLocation,
} from '@core/signal/location';
import { buildSimpleEntityUrl } from '@core/util/url';
import { waitForSignal } from '@core/util/waitForSignal';
import { createCallback } from '@solid-primitives/rootless';
import type { Accessor } from 'solid-js';
import { z } from 'zod';
import { pdfViewLocation } from './document';
import {
  updateFindControlStateSignal,
  useGetRootViewer,
  viewerHasVisiblePagesSignal,
  viewerReadySignal,
} from './pdfViewer';

/**
 * Extracts terms from macro_em tags in the highlighted content.
 * Returns array of text strings that should be highlighted, preserving order and duplicates.
 */
function extractMacroEmTerms(highlightedContent: string): string[] {
  const terms: string[] = [];
  const macroEmRegex = /<macro_em>(.*?)<\/macro_em>/gs;
  const matches = Array.from(highlightedContent.matchAll(macroEmRegex));

  for (const match of matches) {
    terms.push(match[1].trim());
  }

  return terms;
}

/**
 * Applies custom highlights using phraseSearch: false to highlight all macro_em terms
 * in a single search pass, filtered to only matches within the snippet boundaries.
 */
async function applyCustomHighlights(
  viewer: PDFViewer,
  findController: FindController,
  findControllerStateEventSignal: Accessor<
    IUpdateFindControlStateEvent | undefined
  >,
  pageIndex: number,
  highlightedContent: string,
  snippetStartPos: number,
  snippetEndPos: number
) {
  // Extract the terms to highlight from macro_em tags
  const terms = extractMacroEmTerms(highlightedContent);

  if (terms.length === 0) {
    console.warn('No macro_em terms found to highlight');
    return;
  }

  // Join all terms with spaces for multi-term search
  // phraseSearch: false will create an alternation regex (term1|term2|term3)
  const query = terms.join(' ');

  // Save the current scroll position to restore after search
  const currentScrollTop = viewer.container().scrollTop;

  // Perform single search with phraseSearch: false to highlight all terms
  viewer.search({
    query,
    again: false,
    phraseSearch: false,
    caseSensitive: true,
    entireWord: false,
    highlightAll: true,
    findPrevious: false,
  });

  // Wait for search to complete
  const searchResult = await waitForSignal(
    findControllerStateEventSignal,
    (val) => {
      return (
        val?.state === FindState.FOUND || val?.state === FindState.NOT_FOUND
      );
    }
  );

  // Restore the scroll position to where we were before the search
  viewer.container().scrollTop = currentScrollTop;

  if (searchResult?.state === FindState.NOT_FOUND) {
    console.warn('Terms not found:', terms);
    return;
  }

  if (!searchResult) {
    console.warn('Search result is undefined');
    return;
  }

  // Log pageMatches and pageMatchesLength for debugging
  const pageMatches = findController.pageMatches;
  const pageMatchesLength = findController.pageMatchesLength;

  if (!pageMatches || !pageMatchesLength) {
    console.warn('pageMatches or pageMatchesLength is undefined');
    return;
  }

  const filteredMatches: number[] = [];
  const filteredLengths: number[] = [];

  const targetPageMatches = pageMatches[pageIndex] || [];
  const targetPageLengths = pageMatchesLength[pageIndex] || [];

  for (let i = 0; i < targetPageMatches.length; i++) {
    const matchStart = targetPageMatches[i];
    const matchEnd = matchStart + targetPageLengths[i];

    // Only keep matches that are completely within the snippet bounds
    if (matchStart >= snippetStartPos && matchEnd <= snippetEndPos) {
      filteredMatches.push(matchStart);
      filteredLengths.push(targetPageLengths[i]);
    }
  }

  // Clear matches on all pages
  if (findController._pageMatches && findController._pageMatchesLength) {
    for (let i = 0; i < pageMatches.length; i++) {
      findController._pageMatches[i] = [];
      findController._pageMatchesLength[i] = [];
    }

    // Set only the filtered matches on the target page
    findController._pageMatches[pageIndex] = filteredMatches;
    findController._pageMatchesLength[pageIndex] = filteredLengths;
  }

  findController._matchesCountTotal = filteredMatches.length;

  // Force re-render with the filtered matches
  findController._updateAllPages();

  viewer.markPageHighlightsSelected(pageIndex);
}

export const useGoToTempRedirect = () => {
  const [activeThreadId, setActiveThreadId] = activeCommentThreadSignal;
  const scrollToCommentThread = useScrollToCommentThread();

  return (documentId: string, state: TempRedirectLocation) => {
    if (state.itemId !== documentId) {
      return;
    }
    setTempRedirectLocation(undefined);

    const threadId = state.location?.threadId;
    if (!threadId) return;

    const prevActiveThreadId = activeThreadId();
    setActiveThreadId(threadId);

    // if the thread is already active, scroll to it directly
    // Note that there is already a block effect in comment operations that will
    // scroll to a new active thread signal on change
    if (prevActiveThreadId === threadId) {
      scrollToCommentThread(threadId);
    }
  };
};

export enum LocationType {
  General = 'general',
  Precise = 'precise',
  Annotation = 'annotation',
}

type LocationTypeMap = {
  general: GeneralLocation;
  precise: PreciseLocation;
  annotation: AnnotationLocation;
  search: SearchLocation;
};

/**
 * Types of PDF locations, ordered by increasing precision.
 */
export const PdfLocationTypes = ['general', 'precise', 'annotation'] as const;
export type PdfLocationType = (typeof PdfLocationTypes)[number];

/**
 * Map showing which location types can be used for each fidelity level.
 * Higher fidelity levels can use all lower fidelity locations.
 */
export const LOCATION_FIDELITY_MAP: Record<PdfLocationType, PdfLocationType[]> =
  {
    general: ['general'],
    precise: ['precise', 'general'],
    annotation: ['annotation', 'precise', 'general'],
  } as const;

export interface GeneralLocation {
  type: 'general';
  pageIndex: number;
  y: number;
}

export interface PreciseLocation {
  type: 'precise';
  pageIndex: number;
  y: number;
  x: number;
  width: number;
  height: number;
}

export interface AnnotationLocation {
  type: 'annotation';
  pageIndex: number;
  id: string;
}

export interface SearchLocation {
  type: 'search';
  pageIndex: number;
  matchNum: number;
  term: string;
  snippet: string;
  highlightedContent: string;
}

export type PdfLocation =
  | GeneralLocation
  | PreciseLocation
  | AnnotationLocation
  | SearchLocation;

export const PdfOrderInfoSchema = z.object({
  pageIndex: z.number(),
  pageOrder: z.number().optional(),
});

export type PdfOrderInfo = z.infer<typeof PdfOrderInfoSchema>;

export const locationChangedSignal = createBlockSignal<boolean>(false);

export const pendingLocationParamsSignal = createBlockSignal<
  Record<string, string> | undefined
>();

// TODO: fix the aboslute clusterfuck that is location params
createBlockEffect(() => {
  const viewerReady = viewerReadySignal() && viewerHasVisiblePagesSignal.get();
  const params = pendingLocationParamsSignal();
  if (viewerReady && params) {
    // TODO: do we need to clear all overlays here
    const getViewer = useGetRootViewer();
    const viewer = getViewer();
    viewer?.clearAllOverlays();

    goToLinkLocationFromParams(params);
  }
});

export const locationStore = createBlockStore<{
  general: GeneralLocation | undefined;
  precise: PreciseLocation | undefined;
  annotation: AnnotationLocation | undefined;
  search: SearchLocation | undefined;
}>({
  general: undefined,
  precise: undefined,
  annotation: undefined,
  search: undefined,
});

export function useSetLocationStore() {
  const setLocationStore_ = locationStore.set;

  const setLocationStore = <T extends PdfLocationType>(
    type: T,
    location: Omit<LocationTypeMap[T], 'type'> | undefined
  ): void => {
    if (type === 'precise') {
      setLocationStore_('annotation', undefined);
    }

    const l: LocationTypeMap[T] | undefined = location
      ? ({
          ...location,
          type,
        } as LocationTypeMap[T])
      : undefined;
    setLocationStore_(type, l);
  };

  return createCallback(setLocationStore);
}

export const generalPopupLocationSignal = createBlockSignal<{
  pageIndex: number;
  element: HTMLElement;
  hasHighlight?: boolean;
  hasComment?: boolean;
} | null>(null);

export const URL_PARAMS = {
  pageNumber: 'pdf_page_number',
  yPos: 'pdf_page_y',
  x: 'pdf_page_x',
  width: 'pdf_width',
  height: 'pdf_height',
  annotationId: 'pdf_ann_id',
  searchPage: 'pdf_search_page',
  searchMatchNumOnPage: 'pdf_search_match_num',
  searchTerm: 'pdf_search_term',
  searchSnippet: 'pdf_search_snippet',
  highlightedContent: 'pdf_highlighted_content',
} as const;

/**
 * Converts a location into URL parameters for sharing.
 *
 * @param location - The PDF location to convert
 * @returns URL with location parameters
 */
export function locationToUrl(location: PdfLocation | undefined): string {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  // Clear existing parameters
  Object.values(URL_PARAMS).forEach((param) => params.delete(param));

  if (!location) {
    return url.toString();
  }

  const format = (n: number) => Number(n.toFixed(3)).toString();

  switch (location.type) {
    case 'general':
      params.set(URL_PARAMS.pageNumber, format(location.pageIndex));
      params.set(URL_PARAMS.yPos, format(location.y));
      break;

    case 'precise':
      params.set(URL_PARAMS.pageNumber, format(location.pageIndex));
      params.set(URL_PARAMS.yPos, format(location.y));
      params.set(URL_PARAMS.x, format(location.x));
      params.set(URL_PARAMS.width, format(location.width));
      params.set(URL_PARAMS.height, format(location.height));
      break;

    case 'annotation':
      params.set(URL_PARAMS.annotationId, location.id);
      break;
  }

  return url.toString();
}

/**
 * Selects the most appropriate location for the desired fidelity level.
 * Higher precision locations are preferred when available.
 *
 * @param fidelity - Desired fidelity level
 * @param locations - Available locations
 * @returns Most appropriate location for the fidelity level, or undefined if none available
 *
 */
export function selectLocationForFidelity(
  fidelity: PdfLocationType,
  locations: Partial<Record<PdfLocationType, PdfLocation>>
): PdfLocation | undefined {
  // Get allowed location types for this fidelity level
  const allowedTypes = LOCATION_FIDELITY_MAP[fidelity];

  // Filter to available locations of allowed types, and sort by precision (reverse order of PdfLocationTypes)
  const validLocations = Object.entries(locations)
    .filter(
      ([type, location]) =>
        location && allowedTypes.includes(type as PdfLocationType)
    )
    .sort(
      ([a], [b]) =>
        PdfLocationTypes.indexOf(b as PdfLocationType) -
        PdfLocationTypes.indexOf(a as PdfLocationType)
    );

  return validLocations[0]?.[1];
}

export function useCreateShareUrl() {
  const locationStore_ = locationStore.get;
  const blockId = useBlockId();

  /**
   * Creates a shareable URL with location information at the specified fidelity level.
   *
   * @param fidelity - Desired fidelity level for the share URL
   * @param copy - Whether to copy the URL to the clipboard
   * @returns URL string with location parameters
   */
  const createShareUrl = (
    fidelity: PdfLocationType,
    copy: boolean = true
  ): string => {
    const locations = {
      general: locationStore_.general,
      precise: locationStore_.precise,
      annotation: locationStore_.annotation,
      search: locationStore_.search,
    };
    const location = selectLocationForFidelity(fidelity, locations);
    const url = locationToUrl(location);
    const params = Object.fromEntries(new URL(url).searchParams);
    const updatedUrl = buildSimpleEntityUrl(
      {
        type: 'pdf',
        id: blockId,
      },
      params
    );
    if (copy && updatedUrl) {
      navigator.clipboard.writeText(updatedUrl);
    }
    return url;
  };
  return createCallback(createShareUrl);
}

/**
 * Parses params into a PDF location.
 * Returns most precise location type possible based on available parameters.
 *
 * @param searchParams - URL search parameters to parse
 * @returns PDF location object or null if no valid location found
 */
export function parseLocationFromBlockParams(
  params: Record<string, string>
): PdfLocation | null {
  // Check for annotation first as it's highest priority
  const id = params[URL_PARAMS.annotationId];
  if (id?.trim()) {
    return {
      type: 'annotation',
      pageIndex: 1,
      id,
    };
  }

  // Next highest priority is a search result
  const searchPage = params[URL_PARAMS.searchPage];
  const searchMatchNumOnPage = params[URL_PARAMS.searchMatchNumOnPage];
  const searchTerm = params[URL_PARAMS.searchTerm];
  const searchSnippet = params[URL_PARAMS.searchSnippet];
  const highlightedContent = params[URL_PARAMS.highlightedContent];

  if (
    searchPage &&
    searchMatchNumOnPage &&
    searchTerm &&
    searchSnippet &&
    highlightedContent
  ) {
    return {
      type: 'search',
      pageIndex: Number(searchPage) + 1,
      matchNum: Number(searchMatchNumOnPage),
      term: searchTerm,
      snippet: searchSnippet,
      highlightedContent,
    };
  }

  const pageIndex = Number(params[URL_PARAMS.pageNumber]);
  const y = Number(params[URL_PARAMS.yPos]);

  if (isNaN(pageIndex) || isNaN(y) || pageIndex < 1) {
    return null;
  }

  const x = Number(params[URL_PARAMS.x]);
  const width = Number(params[URL_PARAMS.width]);
  const height = Number(params[URL_PARAMS.height]);

  if (!isNaN(x) && !isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
    return {
      type: 'precise',
      pageIndex,
      y,
      x,
      width,
      height,
    };
  }

  // Fall back to general location
  return {
    type: 'general',
    pageIndex,
    y,
  };
}

export type LocationSearchParams = {
  annotationId?: string;
  searchPage?: string;
  searchMatchNumOnPage?: string;
  searchTerm?: string;
  searchSnippet?: string;
  highlightedContent?: string;
  pageNumber?: string;
  yPos?: string;
  x?: string;
  width?: string;
  height?: string;
};

/**
 * Parses URL search parameters into a PDF location.
 * Returns most precise location type possible based on available parameters.
 *
 * @param searchParams - URL search parameters to parse
 * @returns PDF location object or null if no valid location found
 */
export function parseLocationFromUrl(
  params: LocationSearchParams
): PdfLocation | null {
  // Check for annotation first as it's highest priority

  const id = params.annotationId;
  if (id?.trim()) {
    return {
      type: 'annotation',
      pageIndex: 1,
      id,
    };
  }

  // Next highest priority is a search result
  const searchPage = params.searchPage;
  const searchMatchNumOnPage = params.searchMatchNumOnPage;
  const searchTerm = params.searchTerm;
  const searchSnippet = params.searchSnippet;
  const highlightedContent = params.highlightedContent;

  if (
    searchPage &&
    searchMatchNumOnPage &&
    searchTerm &&
    searchSnippet &&
    highlightedContent
  ) {
    return {
      type: 'search',
      pageIndex: Number(searchPage) + 1,
      matchNum: Number(searchMatchNumOnPage),
      term: searchTerm,
      snippet: searchSnippet,
      highlightedContent,
    };
  }

  const pageIndex = Number(params.pageNumber);
  const y = Number(params.yPos);

  if (isNaN(pageIndex) || isNaN(y) || pageIndex < 1) {
    return null;
  }

  const x = Number(params.x);
  const width = Number(params.width);
  const height = Number(params.height);

  if (!isNaN(x) && !isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
    return {
      type: 'precise',
      pageIndex,
      y,
      x,
      width,
      height,
    };
  }

  // Fall back to general location
  return {
    type: 'general',
    pageIndex,
    y,
  };
}

/**
 * Go to the given location in the pdf viewer
 *
 * @param location - The location to go to
 */
export async function goToPdfLocation(location: PdfLocation) {
  const getRootViewer = useGetRootViewer();
  const viewer = getRootViewer();
  const documentId = useBlockId();
  const findControllerStateEventSignal = updateFindControlStateSignal.get;
  if (!viewer || !documentId) return;

  switch (location.type) {
    case 'general':
      await viewer.scrollTo({
        pageNumber: location.pageIndex,
        yPos: location.y,
      });
      break;
    case 'precise':
      await viewer.scrollTo({
        pageNumber: location.pageIndex,
        yPos: location.y,
      });
      viewer.generateOverlayForSelectionRect(location.pageIndex - 1, location);
      break;
    case 'annotation':
      // TODO: implement specific annotation navigation, e.g. comments
      await viewer.scrollTo({
        pageNumber: location.pageIndex,
        yPos: 0,
      });
      break;
    case 'search':
      // Go to the page of the match
      await viewer.scrollTo({
        pageNumber: location.pageIndex,
        yPos: 0,
      });

      // Save the current scroll position to restore after search
      const currentScrollTop = viewer.container().scrollTop;

      // Normalize the snippet by replacing all whitespace characters with spaces
      const normalizedSnippet = location.snippet.replace(/\s+/g, ' ').trim();

      // Use the snippet to find the location in the PDF
      viewer.search({
        query: normalizedSnippet,
        again: false,
        phraseSearch: true,
        caseSensitive: true,
        entireWord: false,
        highlightAll: false,
        findPrevious: false,
      });

      // Wait for the find controller to be ready
      const findControllerStateEvent = await waitForSignal(
        findControllerStateEventSignal,
        (val) =>
          val?.state === FindState.FOUND || val?.state === FindState.NOT_FOUND
      );

      viewer.container().scrollTop = currentScrollTop;

      if (!findControllerStateEvent) return;

      // Break early if we can't find the match
      if (findControllerStateEvent.state === FindState.NOT_FOUND) {
        console.warn('unable to find match', { location });
        break;
      }

      const findController = findControllerStateEvent.source;

      // Get the snippet's position on the page before navigating
      const pageIdx = location.pageIndex - 1; // Convert to 0-indexed

      if (
        !findController._selected ||
        !findController._pageMatches ||
        !findController._pageMatchesLength
      ) {
        console.error('FindController state is incomplete');
        break;
      }

      const snippetMatchIdx = findController._selected.matchIdx;
      const snippetStartPos =
        findController._pageMatches[pageIdx]?.[snippetMatchIdx];
      const snippetLength =
        findController._pageMatchesLength[pageIdx]?.[snippetMatchIdx];

      if (snippetStartPos === undefined || snippetLength === undefined) {
        console.error('Could not find snippet position');
        break;
      }

      const snippetEndPos = snippetStartPos + snippetLength;

      // Since we have a FOUND state, we can jump to the correct match
      for (let i = 0; i < location.matchNum; i++) {
        findController._nextMatch();
      }

      // Clear the snippet search highlights without resetting state
      // This preserves the findController's ability to emit events
      findController._highlightMatches = false;
      findController._updateAllPages();

      // Apply custom highlights based on macro_em tags
      await applyCustomHighlights(
        viewer,
        findController,
        findControllerStateEventSignal,
        pageIdx,
        location.highlightedContent,
        snippetStartPos,
        snippetEndPos
      );

      // flash the highlights
      setTimeout(() => {
        findController._reset();
        findController._updateAllPages();
      }, 1000);

      break;
  }
}

// TODO: this should be a hook
const goToPreviousLocation = () => {
  const getViewer = useGetRootViewer();
  const viewer = getViewer();

  // since this is not a hook we wait an arbitrary amount of time for the signal to be set
  waitForSignal(pdfViewLocation, (location) => !!location, 300).then(
    (prevLocationHash) => {
      if (viewer && prevLocationHash) {
        viewer.goToLocationHash(prevLocationHash);
      }
    }
  );
};

/**
 * Go to the location in the pdf viewer based on the current url
 */
export async function goToLinkLocation(params: LocationSearchParams) {
  const location = parseLocationFromUrl(params);
  if (location) {
    return await goToPdfLocation(location);
  }

  goToPreviousLocation();
}

/**
 * Go to the location in the pdf viewer based on the params
 */
export async function goToLinkLocationFromParams(
  params: Record<string, string>
) {
  const location = parseLocationFromBlockParams(params);
  if (location) {
    return await goToPdfLocation(location);
  }

  goToPreviousLocation();
}
