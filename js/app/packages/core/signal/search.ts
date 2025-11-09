import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { isErr, type MaybeResult } from '@core/util/maybeResult';
import { logger } from '@observability';
import { createMemo, createResource } from 'solid-js';
import { searchClient } from '../../service-search/client';
import type { ChatSearchResponse } from '../../service-search/generated/models/chatSearchResponse';
import type { DocumentSearchResponse } from '../../service-search/generated/models/documentSearchResponse';
import type { EmailSearchResponseItem } from '../../service-search/generated/models/emailSearchResponseItem';

function createSearchResource<T>(
  searchTerm: () => string,
  searchFn: (term: string) => Promise<MaybeResult<string, T>>
) {
  return createResource(searchTerm, async (term) => {
    if (!ENABLE_SEARCH_SERVICE) return null;
    if (term.length < 3) {
      // HACK: returning null instead of undefined makes the command bar not crash
      return null;
    }
    // TODO: debouncing
    const result = await searchFn(term);
    if (isErr(result)) {
      console.error('Failed to get search query');
      // HACK: returning null instead of undefined makes the command bar not crash
      return null;
    }
    const [, data] = result;
    return data as T;
  });
}

export function createSearchDocumentsResource(searchTerm: () => string) {
  return createSearchResource<DocumentSearchResponse>(searchTerm, (term) =>
    searchClient.searchDocuments({
      match_type: 'partial',
      query: term,
    })
  );
}

export function useSearchDocuments(searchTerm: () => string) {
  const [resource] = createSearchDocumentsResource(searchTerm);
  return createMemo(() => {
    return resource ? resource.latest : undefined;
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

  const fetchSearchEmails = async (
    term: string,
    {
      value,
      refetching,
    }: {
      value?: fetchSearchEmailsResult;
      refetching?: boolean | { page?: number };
    }
  ) => {
    const nullResult = {
      results: [],
      nextPage: 0,
      hasMore: false,
    };
    if (!ENABLE_SEARCH_SERVICE) return nullResult;
    if (term.length < 3) return nullResult;

    const pageNumber =
      refetching && typeof refetching === 'object' && refetching.page
        ? refetching.page
        : 0;
    const result = await searchClient.searchEmails({
      request: {
        match_type: 'partial',
        query: term,
      },
      params: { page: pageNumber, page_size: pageSize },
    });
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
  return createSearchResource<ChatSearchResponse>(searchTerm, (term) =>
    searchClient.searchChats({
      match_type: 'partial',
      query: term,
    })
  );
}

export function useSearchChats(searchTerm: () => string) {
  const [resource] = createSearchChatsResource(searchTerm);
  return createMemo(() => {
    return resource ? resource.latest : undefined;
  });
}

// TODO: would be nice to rework things to all use createSearchResource again... sigh
export function createUnifiedSearchResource(
  searchTerm: () => string,
  pageNumber: () => number
) {
  const combined = () => [searchTerm(), pageNumber()] as const;
  return createResource(combined, async ([term, page]) => {
    if (!ENABLE_SEARCH_SERVICE) return null;
    if (term.length < 3) return null;
    const result = await searchClient.search({
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
    });
    if (isErr(result)) {
      console.error('Failed to get search query');
      return null;
    }
    const [, data] = result;
    return data;
  });
}

export function useSearch(
  searchTerm: () => string,
  pageNumber: () => number = () => 0
) {
  const [resource] = createUnifiedSearchResource(searchTerm, pageNumber);
  return createMemo(() => {
    return resource ? resource.latest : undefined;
  });
}
