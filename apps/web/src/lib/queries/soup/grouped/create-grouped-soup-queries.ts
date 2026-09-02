import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import { useQueryClient } from '@queries/client';
import { createInfiniteQueries } from '@queries/create-infinite-queries';
import { groupedCacheVersion } from '@queries/soup/cache';
import {
  groupedSortMethod,
  parseGroupMeta,
  serializeGroupByField,
} from '@queries/soup/grouped/api';
import type { GroupByField, GroupMeta } from '@queries/soup/grouped/types';
import type {
  SoupApiItemFilter,
  SoupAstBody,
  SoupAstItemsGroupedPage,
  SoupAstItemsQueryTransport,
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
import type { InfiniteData } from '@tanstack/solid-query';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  untrack,
} from 'solid-js';
import { createGraphqlGroupedSoupQueries } from './graphql/create-graphql-grouped-soup-queries';

type InitialGroupPage = {
  items: SoupAstItemsGroupedPage['items'];
  groups: GroupMeta[];
};

export type GroupQueryPage = {
  items: InitialGroupPage['items'];
  group: GroupMeta;
};

export type GroupQueryData = {
  entities: EntityData[];
};

export type CreateGroupedSoupQueriesArgs = {
  initialPage: Accessor<InitialGroupPage | undefined>;
  groupByField: Accessor<GroupByField | undefined>;
  soupParams: Accessor<SoupParams>;
  soupBody: Accessor<SoupAstBody>;
  transport: Accessor<SoupAstItemsQueryTransport>;
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
  const usesGraphql = () => args.transport() === 'graphql';
  const instructionsIdQuery = useInstructionsMdIdQuery();
  const queryClient = useQueryClient();

  const mapItemToEntity = (item: SoupApiItem) => {
    if (!isDisplayableSoupItem(item)) return;
    if (isInstructionsMdDoc(item, instructionsIdQuery)) return;

    return mapApiSoupItemToEntity(item);
  };

  const mapPageToEntities = (
    page: GroupQueryPage,
    itemFilter: SoupApiItemFilter | undefined
  ): EntityData[] => {
    const entities: EntityData[] = [];

    for (const id of page.group.itemIds) {
      const item = page.items[id];
      if (!item) continue;
      if (itemFilter && !itemFilter(item)) continue;

      const entity = mapItemToEntity(item);
      if (entity) entities.push(entity);
    }

    return entities;
  };

  const combineGroupPages = (
    pages: GroupQueryPage[],
    itemFilter: SoupApiItemFilter | undefined
  ): GroupQueryData | undefined => {
    if (pages.length === 0) return;

    return {
      entities: pages.flatMap((page) => mapPageToEntities(page, itemFilter)),
    };
  };

  const makeInitialPage = (
    initialGroupedPage: InitialGroupPage,
    group: GroupMeta
  ): GroupQueryPage => {
    const groupItems: InitialGroupPage['items'] = {};
    for (const id of group.itemIds) {
      const item = initialGroupedPage.items[id];
      if (item) groupItems[id] = item;
    }
    return { items: groupItems, group };
  };

  const configs = createMemo(() => {
    const field = args.groupByField();
    const initialGroupedPage = args.initialPage();

    if (usesGraphql() || !field || !initialGroupedPage) {
      return [];
    }

    const options = args.queryOptions();

    return initialGroupedPage.groups.map((group) => {
      const initialPage = makeInitialPage(initialGroupedPage, group);

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
                cursor: ctx.pageParam,
                group_by: serializeGroupByField(field),
                group_key: group.key,
                limit: args.soupParams().limit,
                sort_method: groupedSortMethod(args.soupParams().sort_method),
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
        select: (pages: GroupQueryPage[]) =>
          combineGroupPages(pages, options.meta?.itemFilter),
        initialData: {
          pages: [initialPage],
          pageParams: [null],
        },
        enabled: false,
        meta: {
          ...options.meta,
          groupBy: field,
          groupKey: group.key,
          normalize: false,
        },
        staleTime: Infinity,
      };
    });
  });

  const queries = createInfiniteQueries<
    GroupQueryPage,
    GroupQueryData | undefined
  >(configs);
  const graphqlQueries = createGraphqlGroupedSoupQueries({
    initialPage: args.initialPage,
    groupByField: args.groupByField,
    soupParams: args.soupParams,
    soupBody: args.soupBody,
    enabled: () => usesGraphql() && args.queryOptions().enabled === true,
    itemFilter: () => args.queryOptions().meta?.itemFilter,
  });

  const [groupDataVersion, setGroupDataVersion] = createSignal(0);

  const list = createMemo(() => {
    if (usesGraphql()) return graphqlQueries.list();

    return queries.list().map((query) => ({
      ...query,
      data: () => {
        groupDataVersion();
        // External cache patches (optimistic property edits, WS inserts)
        // bump this since query.data is read untracked.
        groupedCacheVersion();
        return untrack(query.data);
      },
      fetchNextPage: async () => {
        const result = await query.fetchNextPage();
        setGroupDataVersion((version) => version + 1);
        return result;
      },
    }));
  });

  const map = createMemo(() => {
    const next = new Map<string, ReturnType<typeof list>[number]>();
    for (const query of list()) {
      next.set(query.key, query);
    }
    return next;
  });

  const resetRestToInitialPage = (initialGroupedPage = args.initialPage()) => {
    const field = args.groupByField();
    if (!field || !initialGroupedPage) return;

    batch(() => {
      for (const group of initialGroupedPage.groups) {
        const initialPage = makeInitialPage(initialGroupedPage, group);
        const queryKey = soupKeys.groupedGroup({
          params: args.soupParams(),
          body: args.soupBody(),
          groupBy: field,
          groupKey: group.key,
        }).queryKey;

        queryClient.setQueryData<InfiniteData<GroupQueryPage, string | null>>(
          queryKey,
          {
            pages: [initialPage],
            pageParams: [null],
          }
        );
      }

      setGroupDataVersion((version) => version + 1);
    });
  };

  createEffect(
    on(
      () => args.initialPage(),
      (initialGroupedPage) => {
        if (!usesGraphql()) resetRestToInitialPage(initialGroupedPage);
      },
      { defer: true }
    )
  );

  return {
    ...queries,
    list,
    map,
    resetToInitialPage: () => {
      resetRestToInitialPage();
      graphqlQueries.resetToInitialPage();
    },
  };
}
