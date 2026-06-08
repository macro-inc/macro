import { createInfiniteQueries } from '@app/component/next-soup/soup-view/create-infinite-queries';
import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import {
  parseGroupMeta,
  serializeGroupByField,
} from '@queries/soup/grouped/api';
import type { GroupByField, GroupMeta } from '@queries/soup/grouped/types';
import type {
  SoupApiItemFilter,
  SoupAstBody,
  SoupAstItemsGroupedPage,
  SoupParams,
} from '@queries/soup/items';
import { soupKeys } from '@queries/soup/keys';
import {
  isDisplayableSoupItem,
  isInstructionsMdDoc,
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { storageServiceClient } from '@service-storage/client';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { Accessor } from 'solid-js';

type InitialGroupPage = {
  items: SoupAstItemsGroupedPage['items'];
  groups: GroupMeta[];
};

export type GroupQueryPage = {
  items: InitialGroupPage['items'];
  group: GroupMeta;
};

type GroupQueryData = {
  group: GroupMeta;
  entities: EntityData[];
};

type CreateGroupedSoupQueriesArgs = {
  initialPage: Accessor<InitialGroupPage | undefined>;
  groupByField: Accessor<GroupByField | undefined>;
  soupParams: Accessor<SoupParams>;
  soupBody: Accessor<SoupAstBody>;
  queryOptions: Accessor<{
    enabled?: boolean;
    meta?: {
      groupBy?: GroupByField;
      groupKey?: string;
      itemFilter?: SoupApiItemFilter;
    };
  }>;
};

export function createGroupedSoupQueries(args: CreateGroupedSoupQueriesArgs) {
  const instructionsIdQuery = useInstructionsMdIdQuery();

  const mapItemToEntity = (item: SoupApiItem) => {
    if (!isDisplayableSoupItem(item)) return;
    if (isInstructionsMdDoc(item, instructionsIdQuery)) return;

    return mapApiSoupItemToEntity(item);
  };

  const combineGroupPages = (
    pages: GroupQueryPage[],
    itemFilter: SoupApiItemFilter | undefined
  ): GroupQueryData | undefined => {
    let group: GroupMeta | undefined;
    let items: Record<string, SoupApiItem> = {};

    for (const page of pages) {
      group = group
        ? {
            ...page.group,
            itemIds: [...group.itemIds, ...page.group.itemIds],
          }
        : page.group;
      items = { ...items, ...page.items };
    }

    if (!group) return;

    const entities: EntityData[] = [];
    for (const id of group.itemIds) {
      const item = items[id];
      if (!item) continue;
      if (itemFilter && !itemFilter(item)) continue;

      const entity = mapItemToEntity(item);
      if (entity) entities.push(entity);
    }

    return { group, entities };
  };

  return createInfiniteQueries<GroupQueryPage, GroupQueryData | undefined>(
    () => {
      const field = args.groupByField();
      const initialGroupedPage = args.initialPage();

      if (!field || !initialGroupedPage) {
        return [];
      }

      const options = args.queryOptions();

      return initialGroupedPage.groups.map((group) => {
        const initialPage = { items: initialGroupedPage.items, group };

        return {
          key: group.key,
          queryKey: soupKeys.groupedGroup({
            params: args.soupParams(),
            body: args.soupBody(),
            groupBy: field,
            groupKey: group.key,
          }).queryKey,
          queryFn: async (ctx: { pageParam: string | null }) => {
            if (ctx.pageParam == null) {
              return initialPage;
            }

            const response = await throwOnErr(async () =>
              storageServiceClient.getGroupedSoupAstGroupPage({
                params: {
                  cursor: ctx.pageParam ?? undefined,
                  group_by: serializeGroupByField(field),
                  group_key: group.key,
                  limit: args.soupParams().limit,
                },
                body: args.soupBody(),
              })
            );

            return {
              items: response.items,
              group: parseGroupMeta(response.group),
            };
          },
          getNextPageParam: (lastPage: GroupQueryPage): string | null => {
            return lastPage.group.nextCursor;
          },
          placeholderData: {
            pages: [initialPage],
            pageParams: [null],
          },
          select: (pages) => combineGroupPages(pages, options.meta?.itemFilter),
          enabled: options.enabled,
          meta: {
            ...options.meta,
            groupBy: field,
            groupKey: group.key,
            normalize: true,
          },
          staleTime: Infinity,
        };
      });
    }
  );
}
