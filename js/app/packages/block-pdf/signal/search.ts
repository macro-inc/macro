import type { PDFViewer } from '@block-pdf/PdfViewer';
import { createBlockSignal } from '@core/block';
import {
  FindState,
  type IMatchesCount,
  type IUpdateFindControlStateEvent,
} from '../PdfViewer/EventBus';
import type { FindController } from '../PdfViewer/FindController';
import {
  type TPageToSectionMap,
  useGetPageToSectionMap,
} from '../store/tableOfContents';
import TocUtils from '../util/TocUtils';
import { generatePhrases } from '../util/wordSearchUtils';
import {
  updateFindControlStateSignal,
  updateFindMatchesCountSignal,
  useGetRootViewer,
} from './pdfViewer';

export const searchSignal = createBlockSignal<string>('');
export const isSearchOpenSignal = createBlockSignal<boolean>(false);

enum SearchMatchType {
  Word = 'word',
  Entity = 'entity',
}
type BaseMatch = {
  type: SearchMatchType;
};
type EntityMatch = BaseMatch & {
  type: SearchMatchType.Entity;
  matchPhrase: string;
  yPos: number;
  id: number;
  page: number;
};
type WordMatch = BaseMatch & {
  startPos: number; // The started index of the match on a given page
  endPos: number; // The ending index of the match on a given page
  page: number; // 0 indexed
  prePhrase: string; // The phrase to show the match
  postPhrase: string; // The phrase to show the match
  matchPhrase: string; // The phrase to show the match
  section: string; // The section of the match (can be empty)
  matchNumber: number; // The number of the match relative to it's page
  type: SearchMatchType.Word;
};
type Match = EntityMatch | WordMatch;

function useMergedEventSignal() {
  const updateFindControlState = updateFindControlStateSignal.get;
  const updateFindMatchesCount = updateFindMatchesCountSignal.get;

  return (): IUpdateFindControlStateEvent | null => {
    const controlStateEvent = updateFindControlState();
    const matchesCount = updateFindMatchesCount();

    if (!controlStateEvent) return null;

    // If the result of the state is NOT_FOUND we need to return here
    // to prevent us from going to the final return statement which will cause bugs
    if (controlStateEvent.state === FindState.NOT_FOUND) {
      return {
        ...controlStateEvent,
        state: FindState.NOT_FOUND,
        matchesCount: { total: 0, current: 0 },
      };
    }

    // The find controller actually marks the result as FOUND on reset, so this prevents a match result when there is none
    if (
      controlStateEvent.state === FindState.FOUND &&
      !controlStateEvent.source._highlightMatches
    ) {
      return null;
    }

    // there is a secondary match count event that supplements the search with a count on initial searches
    if (
      (controlStateEvent.state === FindState.FOUND ||
        controlStateEvent.state === FindState.WRAPPED) &&
      controlStateEvent.matchesCount.total === 0 &&
      matchesCount?.matchesCount.total === 0
    ) {
      return {
        ...controlStateEvent,
        state: FindState.PENDING,
      };
    }

    return {
      ...controlStateEvent,
      matchesCount: {
        current:
          // Sometimes the matchesCount and controlStateEvent current is out of sync when it shouldn't be
          // To fix this if we only do the Math.max when the total isn't the same it fixes the issue that was present
          controlStateEvent.matchesCount.total !==
          matchesCount?.matchesCount.total
            ? Math.max(
                controlStateEvent.matchesCount.current,
                matchesCount?.matchesCount.current ?? 0
              )
            : controlStateEvent.matchesCount.current,
        total: Math.max(
          controlStateEvent.matchesCount.total,
          matchesCount?.matchesCount.total ?? 0
        ),
      },
    };
  };
}

function getWordMatches(
  pageToSectionMap: TPageToSectionMap,
  findController: FindController
): WordMatch[] {
  if (
    !findController._pageMatches ||
    findController._pageMatches.length === 0 ||
    !findController._pageMatchesLength ||
    findController._pageMatchesLength.length === 0
  )
    return [];

  const pagesReadyCount = findController._pageMatches.length;
  const matches: WordMatch[] = [];

  // We need to loop through all of the pages and their matches
  for (let pageIndex = 0; pageIndex < pagesReadyCount; pageIndex++) {
    // an array of the matches start positions
    const pageMatchesStartPos: number[] | undefined =
      findController._pageMatches[pageIndex];
    const pageMatchesLength: number[] | undefined =
      findController._pageMatchesLength[pageIndex];

    const pageContent = findController._pageContentsAsTextLayer?.[pageIndex];

    if (
      !pageMatchesStartPos ||
      pageMatchesStartPos.length === 0 ||
      !pageMatchesLength ||
      pageMatchesLength.length === 0 ||
      !pageContent ||
      pageContent.length === 0
    ) {
      continue;
    }

    for (
      let matchNumber = 0;
      matchNumber < pageMatchesStartPos.length;
      matchNumber++
    ) {
      // In each page find all positions of match
      const startPos = pageMatchesStartPos[matchNumber];
      const endPos =
        pageMatchesStartPos[matchNumber] + pageMatchesLength[matchNumber];
      const { prePhrase, postPhrase, matchPhrase } = generatePhrases({
        startPos,
        endPos,
        page: pageContent,
      });
      const section =
        TocUtils.getNearestSection({
          page: pageIndex,
          yPos: startPos,
          pageToSectionMap,
        })?.title ?? '';
      matches.push({
        startPos,
        endPos,
        page: pageIndex,
        prePhrase,
        postPhrase,
        matchPhrase,
        section,
        matchNumber,
        type: SearchMatchType.Word,
      });
    }
  }

  return matches;
}

export function useSearchStart() {
  const getRootViewer = useGetRootViewer();
  return (args: Parameters<PDFViewer['search']>[0]) => {
    getRootViewer()?.search(args);
  };
}

export function useSearchResults() {
  const mergedEvent = useMergedEventSignal();
  const pageToSectionMap = useGetPageToSectionMap();

  return (): {
    query: string;
    matches: WordMatch[];
    count: IMatchesCount;
  } | null => {
    const results = mergedEvent();
    if (!results) return null;

    if (results.state === FindState.NOT_FOUND)
      return {
        query: results.rawQuery,
        matches: [],
        count: {
          total: 0,
          current: 0,
        },
      };

    const findController = results.source;
    const matches = getWordMatches(pageToSectionMap(), findController);
    if (matches.length === 0) {
      return null;
    }

    return {
      query: results.rawQuery,
      matches,
      count: {
        ...results.matchesCount,
      },
    };
  };
}

export function useJumpToResult() {
  const getRootViewer = useGetRootViewer();
  const mergedEvent = useMergedEventSignal();

  return (match: Match) => {
    if (match.type === SearchMatchType.Word) {
      mergedEvent()?.source?.scrollWordSearchMatchIntoView({
        pageIndex: match.page,
        matchIndex: match.matchNumber,
      });
    } else {
      getRootViewer()?.scrollTo({
        pageNumber: match.page + 1,
        yPos: match.yPos,
      });
    }
  };
}

export function useSearchReset() {
  const getRootViewer = useGetRootViewer();
  return () => {
    getRootViewer()?.resetSearch();
  };
}
