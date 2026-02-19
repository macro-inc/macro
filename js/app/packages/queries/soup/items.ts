import { throwOnErr } from '@core/util/maybeResult';
import type { EntityData } from '@entity';
import { soupKeys } from '@queries/soup/keys';
import { mapSoupPageToEntityList } from '@queries/soup/transform-utils';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { storageServiceClient } from '@service-storage/client';
import type { EntityFilters } from '@service-storage/generated/schemas/entityFilters';
import type { Params } from '@service-storage/generated/schemas/params';
import type { PostSoupRequest } from '@service-storage/generated/schemas/postSoupRequest';
import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

export type SoupParams = Params;

export type SoupBody = Omit<PostSoupRequest, keyof SoupParams>;

export type SoupItemsQueryFilters = EntityFilters;

export type SoupItemsQueryArgs = {
  params: SoupParams;
  body: SoupBody;
};

export type UseSoupQueryResult = UseInfiniteQueryResult<EntityData[], Error>;

interface SoupItemsQueryOptions {
  enabled: boolean;
}

export const useSoupItemsQuery = (
  args: Accessor<SoupItemsQueryArgs>,
  options?: Accessor<SoupItemsQueryOptions>
) => {
  const instructionsIdQuery = useInstructionsMdIdQuery();

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
    placeholderData: (p) => p,
  }));
};
