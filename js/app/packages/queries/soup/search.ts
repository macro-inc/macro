import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/maybeResult';
import type { EntityData, WithSearch } from '@entity';
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
  enabled?: boolean;
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

  const request = createMemo(() => {
    const body = args().body;
    return {
      ...body,
      query: body.query?.trim(),
    };
  });

  const validSearch = createMemo(() => {
    return validateSearchServiceText(request().query);
  });

  const enabled = createMemo(() => {
    if (options?.().enabled === false) return false;

    return ENABLE_SEARCH_SERVICE && validSearch();
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
      const searchQuery = request().query;
      return data.pages.flatMap((page) => {
        return page.results
          .flatMap((result) => mapSearchResponseItem(result, searchQuery))
          .filter((entity): entity is WithSearch<EntityData> => !!entity);
      });
    },
    enabled: enabled(),
    placeholderData: (p) => p,
    meta: { normalize: false },
  }));
};
