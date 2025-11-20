import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { isErr, type MaybeResult } from '@core/util/maybeResult';
import { logger } from '@observability';
import { makeAbortable } from '@solid-primitives/resource';
import { createMemo, createResource } from 'solid-js';
import { searchClient } from '../../service-search/client';
import type { ChatSearchResponse } from '../../service-search/generated/models/chatSearchResponse';
import type { DocumentSearchResponse } from '../../service-search/generated/models/documentSearchResponse';
import type { EmailSearchResponseItem } from '../../service-search/generated/models/emailSearchResponseItem';
import type { UnifiedSearchResponse } from '../../service-search/generated/models/unifiedSearchResponse';

function createSearchResource<T>(
  searchTerm: () => string,
  searchFn: (
    term: string,
    signal: AbortSignal
  ) => Promise<MaybeResult<string, T>>
) {
  const [signal, , filterError] = makeAbortable();
  return createResource(searchTerm, async (term) => {
    if (!ENABLE_SEARCH_SERVICE) return null;
    if (term.length < 3) {
      // HACK: returning null instead of undefined makes the command bar not crash
      return null;
    }
    try {
      const result = await searchFn(term, signal());
      if (isErr(result)) {
        console.error('Failed to get search query');
        // HACK: returning null instead of undefined makes the command bar not crash
        return null;
      }
      const [, data] = result;
      return data as T;
    } catch (err) {
      filterError(err);
      return null;
    }
  });
}

export function createSearchDocumentsResource(searchTerm: () => string) {
  return createSearchResource<DocumentSearchResponse>(
    searchTerm,
    (term, signal) =>
      searchClient.searchDocuments(
        {
          match_type: 'partial',
          query: term,
        },
        { signal }
      )
  );
}

export function useSearchDocuments(searchTerm: () => string) {
  const [resource] = createSearchDocumentsResource(searchTerm);
  return createMemo((): DocumentSearchResponse | undefined => {
    const latest = resource?.latest;
    if (!latest) return undefined;
    return latest;
  });
}

// Note from Peter: I've experimentally altered this to create a paginated resource. If we think this is successful, we should refactor the other createSearch*Resource and useSearch* functions to use this pattern. Note that I've removed useSearchEmails, because I don't think we need to memoize the resource? Whatever is consuming this resource can handle that, I think?
// This method of pagination is naive, in that it only allows for "loading more". If we thought the search results were likely to change, this would be a problem, as it could return duplicate data. But I think search results are fairly stable, and we can live with this for now.
export function createPaginatedEmailSearchResource(
  searchTerm: () => string,
  pageSize: number = 25
) {
  type fetchSearchEmailsResult = {
    results: EmailSearchResponseItem[];
    nextPage: number;
    hasMore: boolean;
  };

  const [signal, , filterError] = makeAbortable();

  const fetchSearchEmails = async (
    term: string,
    info: {
      value?: fetchSearchEmailsResult;
      refetching?: boolean | { page?: number };
    }
  ) => {
    const { value, refetching } = info;
    const nullResult = {
      results: [],
      nextPage: 0,
      hasMore: false,
    };
    if (!ENABLE_SEARCH_SERVICE) return nullResult;
    if (term.length < 3) return nullResult;

    try {
      const pageNumber =
        refetching && typeof refetching === 'object' && refetching.page
          ? refetching.page
          : 0;
      const result = await searchClient.searchEmails(
        {
          request: {
            match_type: 'partial',
            query: term,
          },
          params: { page: pageNumber, page_size: pageSize },
        },
        { signal: signal() }
      );
      if (isErr(result)) {
        logger.error(`Failed to get search query: ${result[0]}`);
        return nullResult;
      }
      const [, data] = result;
      const newResults = data.results ?? [];

      const existingResults = pageNumber > 0 && value ? value.results : [];
      const allResults = [...existingResults, ...newResults];

      const hasMore = newResults.length === pageSize;

      return {
        results: allResults,
        nextPage: pageNumber + 1,
        hasMore,
      };
    } catch (err) {
      filterError(err);
      return nullResult;
    }
  };

  const [data, { refetch }] = createResource(searchTerm, fetchSearchEmails);

  const loadMore = () => {
    const currentData = data();
    if (currentData && currentData.hasMore && !data.loading) {
      const nextPage = currentData.nextPage;
      refetch({ page: nextPage });
    }
  };

  const refresh = () => {
    refetch({ page: 0 });
  };

  return {
    data,
    loadMore,
    refresh,
  };
}

export function createSearchChatsResource(searchTerm: () => string) {
  return createSearchResource<ChatSearchResponse>(searchTerm, (term, signal) =>
    searchClient.searchChats(
      {
        match_type: 'partial',
        query: term,
      },
      { signal }
    )
  );
}

export function useSearchChats(searchTerm: () => string) {
  const [resource] = createSearchChatsResource(searchTerm);
  return createMemo((): ChatSearchResponse | undefined => {
    const latest = resource?.latest;
    if (!latest) return undefined;
    return latest;
  });
}

// TODO: would be nice to rework things to all use createSearchResource again... sigh
export function createUnifiedSearchResource(
  searchTerm: () => string,
  pageNumber: () => number
) {
  const combined = () => [searchTerm(), pageNumber()] as const;
  const [signal, , filterError] = makeAbortable();

  return createResource(combined, async ([term, page]) => {
    if (!ENABLE_SEARCH_SERVICE) return null;
    if (term.length < 3) return null;

    try {
      const result = await searchClient.search(
        {
          request: {
            match_type: 'partial',
            query: term,
            // in order for an index to be searched on, the key needs to exist in "filters"
            filters: {
              channel: {},
              chat: {},
              document: {},
              email: {},
              project: {},
            },
          },
          params: { page, page_size: 10 },
        },
        { signal: signal() }
      );
      if (isErr(result)) {
        console.error('Failed to get search query');
        return null;
      }
      const [, data] = result;
      return data;
    } catch (err) {
      filterError(err);
      return null;
    }
  });
}

export function useSearch(
  searchTerm: () => string,
  pageNumber: () => number = () => 0
) {
  const [resource] = createUnifiedSearchResource(searchTerm, pageNumber);
  return createMemo((): UnifiedSearchResponse | undefined => {
    const latest = resource?.latest;
    if (!latest) return undefined;
    return latest;
  });
}
