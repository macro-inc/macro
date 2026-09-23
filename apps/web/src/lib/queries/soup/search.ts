import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { throwOnErr } from '@core/util/result';
import type { ChannelMessageEntity, EntityData, WithSearch } from '@entity';
import { soupKeys } from '@queries/soup/keys';
import {
  createSearchResponseItemMapper,
  mapChannelSearchResultItem,
} from '@queries/soup/transform-utils';
import {
  type ChannelSearchRequest,
  searchClient,
} from '@service-search/client';
import type { UnifiedSearchRequest } from '@service-search/generated/models';
import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/solid-query';
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

// Only plain request values and channel names enter the cached callbacks.
function searchSoupQueryOptions(
  args: SearchSoupQueryArgs,
  channels: ReadonlyArray<{ id: string; name?: string | null }>,
  enabled: boolean
) {
  const mapSearchResponseItem = createSearchResponseItemMapper(channels);
  return infiniteQueryOptions({
    queryKey: soupKeys.search({ params: args.params, body: args.body })
      .queryKey,
    queryFn: async (ctx) => {
      return throwOnErr(
        async () =>
          await searchClient.search(
            {
              params: ctx.pageParam,
              request: { ...args.body },
            },
            { signal: ctx.signal }
          )
      );
    },
    initialPageParam: {
      cursor: null as string | null,
      page_size: args.params.page_size,
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.next_cursor) return;
      return {
        cursor: lastPage.next_cursor,
        page_size: args.params.page_size,
      };
    },
    select: (data) => {
      const searchQuery = args.body.query;
      return data.pages.flatMap((page) => {
        return page.results
          .flatMap((result) => mapSearchResponseItem(result, searchQuery))
          .filter((entity): entity is WithSearch<EntityData> => !!entity);
      });
    },
    enabled: enabled,
    placeholderData: (p) => p,
    meta: { normalize: false },
  });
}

export const useSearchSoupQuery = (
  args: Accessor<SearchSoupQueryArgs>,
  options?: Accessor<SearchQueryOptions>
) => {
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

  const { channels } = useChannelsContext();
  const channelNames = createMemo(() =>
    channels().map(({ id, name }) => ({ id, name }))
  );

  return useInfiniteQuery(() =>
    searchSoupQueryOptions(
      { params: args().params, body: request() },
      channelNames(),
      enabled()
    )
  );
};

type SearchChannelQueryArgs = {
  params: {
    cursor?: string | null;
    page_size?: number;
  };
  body: ChannelSearchRequest;
};

function searchChannelQueryOptions(
  args: SearchChannelQueryArgs,
  channels: ReadonlyArray<{ id: string; name?: string | null }>,
  enabled: boolean
) {
  return infiniteQueryOptions({
    queryKey: ['search-channel', args.params, args.body] as const,
    queryFn: async (ctx) => {
      return throwOnErr(
        async () =>
          await searchClient.searchChannel(
            {
              params: ctx.pageParam,
              request: { ...args.body },
            },
            { signal: ctx.signal }
          )
      );
    },
    initialPageParam: {
      cursor: null as string | null,
      page_size: args.params.page_size,
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.next_cursor) return;
      return {
        cursor: lastPage.next_cursor,
        page_size: args.params.page_size,
      };
    },
    select: (data) => {
      const items = data.pages.flatMap((page) =>
        page.results.flatMap((item) =>
          mapChannelSearchResultItem(item, channels)
        )
      ) as WithSearch<ChannelMessageEntity>[];
      // stable per query so first page is enough
      const totalCount = data.pages[0]?.total_count;
      return { items, totalCount };
    },
    enabled: enabled,
    placeholderData: (p) => p,
    meta: { normalize: false },
  });
}

/**
 * Hits the channel-only `/search/channel` endpoint. Use this for the in-channel
 * find-bar so we can pass `sort: 'thread'` (PR #3150) — unified search doesn't
 * accept that field. Response transforms identical to the unified path's
 * `channel` case via the shared `mapChannelSearchResultItem` helper.
 */
export const useSearchChannelQuery = (
  args: Accessor<SearchChannelQueryArgs>,
  options?: Accessor<SearchQueryOptions>
) => {
  const channelsContext = useChannelsContext();
  const channels = channelsContext.channels;

  const request = createMemo(() => {
    const body = args().body;
    return {
      ...body,
      query: body.query?.trim(),
    };
  });

  const validSearch = createMemo(() => {
    const q = request().query;
    return !!q && validateSearchServiceText(q);
  });

  const enabled = createMemo(() => {
    if (options?.().enabled === false) return false;
    return ENABLE_SEARCH_SERVICE && validSearch();
  });

  const channelNames = createMemo(() =>
    channels().map(({ id, name }) => ({ id, name }))
  );
  return useInfiniteQuery(() =>
    searchChannelQueryOptions(
      { params: args().params, body: request() },
      channelNames(),
      enabled()
    )
  );
};
