import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/maybeResult';
import type { WithSearch, EntityData } from '@entity';
import { soupKeys } from '@queries/soup/keys';
import { useSearchResponseItemMapper } from '@queries/soup/transform-utils';
import { searchClient } from '@service-search/client';
import type { UnifiedSearchRequest } from '@service-search/generated/models';
import { useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { buildSearchTerms } from './search-utils';

export type SearchSoupQueryArgs = {
  params: {
    cursor?: string | null;
    page_size?: number;
  };
  body: UnifiedSearchRequest;
};

interface SearchQueryOptions {
  enabled: boolean;
}

/** Search service won't accept text less than 3 characters */
export const validateSearchServiceText = (text: string) => {
  return text.length >= 3;
};

export const useSearchSoupQuery = (
  args: Accessor<SearchSoupQueryArgs>,
  options?: Accessor<SearchQueryOptions>
) => {
  const pageSize = createMemo(() => args().params.page_size);

  const request = createMemo(() => args().body);

  const terms = createMemo(() => {
    const query = request().query?.trim();
    const hasQuery = query && query.length > 0;
    const terms = request().terms?.map((t) => t.trim());
    const hasTerms = terms && terms.length > 0;
    if (hasTerms && hasQuery) {
      console.error('Cannot have both query and terms');
      return [];
    }
    if (hasTerms) {
      // NOTE: we currently assume that a singleton terms array is a query
      return terms.length === 1 ? buildSearchTerms(terms[0]) : terms;
    }
    if (hasQuery) {
      return buildSearchTerms(query);
    }
    return [];
  });

  const validSearchTerms = createMemo(() => {
    return terms().length > 0 && terms().every(validateSearchServiceText);
  });

  const enabled = createMemo(() => {
    if (options?.().enabled === false) return false;

    return ENABLE_SEARCH_SERVICE && validSearchTerms();
  });

  const mapSearchResponseItem = useSearchResponseItemMapper();

  return useInfiniteQuery(() => ({
    queryKey: soupKeys.search({ params: args().params, body: request() })
      .queryKey,
    queryFn: async (ctx) => {
      return throwOnErr(
        async () =>
          await searchClient.search({
            params: ctx.pageParam,
            request: { ...request(), terms: terms() },
          })
      );
    },
    initialPageParam: {
      cursor: null as string | null,
      page_size: pageSize(),
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.next_cursor) return;
      return {
        cursor: lastPage.next_cursor,
        page_size: pageSize(),
      };
    },
    select: (data) => {
      const searchQuery = terms()[0];
      return data.pages.flatMap((page) => {
        return page.results
          .map((result) => mapSearchResponseItem(result, searchQuery))
          .filter((entity): entity is WithSearch<EntityData> => !!entity);
      });
    },
    enabled: enabled(),
    placeholderData: (p) => p,
    meta: { normalize: false },
  }));
};
