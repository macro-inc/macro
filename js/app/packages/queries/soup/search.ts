import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/maybeResult';
import type { WithSearch, EntityData } from '@entity';
import { soupKeys } from '@queries/soup/keys';
import { useSearchResponseItemMapper } from '@queries/soup/transform-utils';
import { searchClient } from '@service-search/client';
import type { UnifiedSearchRequest } from '@service-search/generated/models';
import { useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';

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

export const useSearchSoupQuery = (
  args: Accessor<SearchSoupQueryArgs>,
  options?: Accessor<SearchQueryOptions>
) => {
  const pageSize = createMemo(() => args().params.page_size);

  const request = createMemo(() => args().body);

  const terms = createMemo(() => {
    const query = request().query;
    const hasQuery = query && query.length > 0;
    const terms = request().terms;
    const hasTerms = terms && terms.length > 0;
    if (hasTerms && hasQuery) {
      console.error('Cannot have both query and terms');
      return [];
    }
    if (hasTerms) {
      return terms;
    }
    if (hasQuery) {
      return [query];
    }
    return [];
  });

  const validSearchTerms = createMemo(() => {
    return terms().length > 0 && terms().every((term) => term.length >= 3);
  });

  const enabled = createMemo(() => {
    if (options?.().enabled === false) return false;

    if (!terms().length) return true;

    return ENABLE_SEARCH_SERVICE && validSearchTerms();
  });

  const mapSearchResponseItem = useSearchResponseItemMapper();

  return useInfiniteQuery(() => ({
    queryKey: soupKeys.search(args()).queryKey,
    queryFn: async (ctx) => {
      return throwOnErr(
        async () =>
          await searchClient.search({
            params: ctx.pageParam,
            request: { ...request() },
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
  }));
};
