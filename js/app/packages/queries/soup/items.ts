import { filterSoupItemByRequestBody } from '@app/component/next-soup/filters/query-filters';
import { throwOnErr } from '@core/util/maybeResult';
import type { EntityData } from '@entity';
import { soupKeys } from '@queries/soup/keys';
import { mapSoupPageToEntityList } from '@queries/soup/transform-utils';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { storageServiceClient } from '@service-storage/client';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { EntityFilterAst } from '@service-storage/generated/schemas/entityFilterAst';
import type { EntityFilters } from '@service-storage/generated/schemas/entityFilters';
import type { Params } from '@service-storage/generated/schemas/params';
import type { PostSoupAstRequestAllOf } from '@service-storage/generated/schemas/postSoupAstRequestAllOf';
import type { PostSoupRequest } from '@service-storage/generated/schemas/postSoupRequest';
import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  type StaleTime,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

export type SoupParams = Params;

export type SoupBody = Omit<PostSoupRequest, keyof SoupParams>;

export type SoupItemsQueryFilters = EntityFilters;

export type SoupItemsQueryArgs = {
  params: SoupParams;
  body: SoupBody;
};

export type SoupAstParams = Params;

export type SoupAstBody = EntityFilterAst & PostSoupAstRequestAllOf;

export type SoupAstItemsQueryArgs = {
  params: SoupAstParams;
  body: SoupAstBody;
};

export type UseSoupQueryResult = UseInfiniteQueryResult<EntityData[], Error>;

export type SoupApiItemFilter = (item: SoupApiItem) => boolean;

interface SoupItemsQueryOptions {
  enabled?: boolean;
  staleTime?: StaleTime;
}

export const useSoupItemsQuery = (
  args: Accessor<SoupItemsQueryArgs>,
  options?: Accessor<SoupItemsQueryOptions>
) => {
  const instructionsIdQuery = useInstructionsMdIdQuery();

  const itemFilter: SoupApiItemFilter = (item: SoupApiItem) => {
    const body = args().body;
    if (!body) return true;
    return filterSoupItemByRequestBody(item, body);
  };

  return useInfiniteQuery(() => ({
    queryKey: soupKeys.items(args()).queryKey,
    queryFn: async (ctx) => {
      const { params, body } = args();

      return throwOnErr(
        async () =>
          await storageServiceClient.getSoupItems({
            params: { cursor: ctx.pageParam },
            body: {
              ...body,
              ...params,
            },
          })
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      return lastPage.next_cursor;
    },
    select: (data) => {
      return data.pages.flatMap((page) => {
        return mapSoupPageToEntityList(page, { instructionsIdQuery });
      });
    },
    enabled: options?.().enabled,
    staleTime: options?.().staleTime,
    placeholderData: (p) => p,
    meta: { itemFilter, normalize: true },
  }));
};

export const useSoupAstItemsQuery = (
  args: Accessor<SoupAstItemsQueryArgs>,
  options?: Accessor<SoupItemsQueryOptions>
) => {
  const instructionsIdQuery = useInstructionsMdIdQuery();

  return useInfiniteQuery(() => ({
    queryKey: soupKeys.astItems(args()).queryKey,
    queryFn: async (ctx) => {
      const { params, body } = args();

      return throwOnErr(
        async () =>
          await storageServiceClient.getSoupAstItems({
            params: { cursor: ctx.pageParam },
            body: {
              ...body,
              ...params,
            },
          })
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      return lastPage.next_cursor;
    },
    select: (data) => {
      return data.pages.flatMap((page) => {
        return mapSoupPageToEntityList(page, { instructionsIdQuery });
      });
    },
    enabled: options?.().enabled,
    staleTime: options?.().staleTime,
    placeholderData: (p) => p,
    meta: { normalize: true },
  }));
};
