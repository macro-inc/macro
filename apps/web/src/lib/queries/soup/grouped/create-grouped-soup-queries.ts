import { deepEqual } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import { Telemetry } from '@macro-inc/observability';
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
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
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
import { mergeGroupInitialPage } from './merge-group-initial-page';

type InitialGroupPage = {
  cachedMail?: boolean;
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
  groupedPaging?: Accessor<
    | import('../graphql/create-grouped-soup-live-query').GroupedSoupPaging
    | undefined
  >;
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
      /** Gates optimistic cache inserts only — fetched rows never run through it. */
      insertFilter?: SoupApiItemFilter;
    };
  }>;
};

// Retained by the query cache after the group unmounts: plain snapshots only.
function groupPageQueryFn(input: {
  initialPage: GroupQueryPage;
  field: GroupByField;
  groupKey: string;
  soupParams: SoupParams;
  soupBody: SoupAstBody;
}) {
  return async (ctx: { pageParam: string | null }): Promise<GroupQueryPage> => {
    if (ctx.pageParam == null) {
      return input.initialPage;
    }

    const response = await throwOnErr(async () =>
      storageServiceClient.getGroupedSoupAstGroupPage({
        params: {
          cursor: ctx.pageParam,
          group_by: serializeGroupByField(input.field),
          group_key: input.groupKey,
          limit: input.soupParams.limit,
          sort_method: groupedSortMethod(input.soupParams.sort_method),
        },
        body: input.soupBody,
      })
    );

    return {
      items: response.items,
      group: parseGroupMeta(response.group),
    };
  };
}

function getNextGroupPageParam(lastPage: GroupQueryPage): string | null {
  return lastPage.group.nextCursor;
}

export function createGroupedSoupQueries(args: CreateGroupedSoupQueriesArgs) {
  const usesGraphql = () => args.transport() === 'graphql';
  const queryClient = useQueryClient();

  const mapItemToEntity = (item: SoupApiItem) => {
    if (!isDisplayableSoupItem(item)) return;

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
    const soupParams = args.soupParams();
    const soupBody = args.soupBody();

    return initialGroupedPage.groups.map((group) => {
      const initialPage = makeInitialPage(initialGroupedPage, group);

      return {
        key: group.key,
        queryKey: soupKeys.groupedGroup({
          params: soupParams,
          body: soupBody,
          groupBy: field,
          groupKey: group.key,
        }).queryKey,
        queryFn: groupPageQueryFn({
          initialPage,
          field,
          groupKey: group.key,
          soupParams,
          soupBody,
        }),
        getNextPageParam: getNextGroupPageParam,
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
    groupedPaging: args.groupedPaging,
    initialPage: args.initialPage,
    enabled: () => usesGraphql() && args.queryOptions().enabled === true,
    itemFilter: () => args.queryOptions().meta?.itemFilter,
  });

  const [groupDataVersion, setGroupDataVersion] = createSignal(0);
  // In-flight continuation re-walks per group; a Load More waits for its own.
  const rewalks = new Map<string, Promise<void>>();

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
        // Paging during a re-walk would cancel its refetch midway.
        await rewalks.get(query.key);
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

  const resetRestToInitialPage = (
    initialGroupedPage = args.initialPage(),
    keepLoadedPages = false
  ) => {
    const field = args.groupByField();
    if (!field || !initialGroupedPage) return;

    const stale = new Map<string, GroupQueryPage>();
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
          (existing) => {
            if (!keepLoadedPages) {
              return { pages: [initialPage], pageParams: [null] };
            }
            const merged = mergeGroupInitialPage(
              existing,
              initialPage,
              (page) => page.group.nextCursor
            );
            if (merged.stale) stale.set(group.key, initialPage);
            return merged.data;
          }
        );
      }

      setGroupDataVersion((version) => version + 1);
    });
    // The kept pages chained from the old first page. A refetch re-walks them
    // from the new boundary while the rows already loaded stay on screen.
    const rewalk = async (
      query: { key: string; refetch: () => Promise<{ isError: boolean }> },
      initialPage: GroupQueryPage
    ) => {
      const queryKey = soupKeys.groupedGroup({
        params: args.soupParams(),
        body: args.soupBody(),
        groupBy: field,
        groupKey: query.key,
      }).queryKey;
      const span = Telemetry.span('soup.grouped_rest_rewalk');
      span.setAttr('grouping.group_key', query.key);
      await span.run(async () => {
        const result = await query.refetch();
        if (!result.isError) {
          span.setAttr('grouping.rewalk_outcome', 'replaced');
          return;
        }
        // A chain that could not be rebuilt falls back to its first page
        // rather than keeping rows that follow the old boundary, unless a
        // later parent page already replaced that first page.
        let outcome = 'superseded';
        queryClient.setQueryData<InfiniteData<GroupQueryPage, string | null>>(
          queryKey,
          (existing) => {
            if (!existing || !deepEqual(existing.pages[0], initialPage)) {
              return existing;
            }
            outcome = 'reset';
            return { pages: [initialPage], pageParams: [null] };
          }
        );
        span.setAttr('grouping.rewalk_outcome', outcome);
        span.error('continuation rewalk failed');
      });
      setGroupDataVersion((version) => version + 1);
    };
    for (const query of queries.list()) {
      const initialPage = stale.get(query.key);
      if (!initialPage) continue;
      const run = async () => {
        try {
          await rewalk(query, initialPage);
        } finally {
          if (rewalks.get(query.key) === pending) rewalks.delete(query.key);
        }
      };
      const pending = run();
      rewalks.set(query.key, pending);
      fireAndForget(pending, 'grouped-soup');
    }
  };

  // A refetched parent page carries each group's first page again; the pages
  // a Load More already fetched stay, so the list never collapses under the
  // reader. Only an explicit refresh starts every group over.
  createEffect(
    on(
      () => args.initialPage(),
      (initialGroupedPage) => {
        if (!usesGraphql()) resetRestToInitialPage(initialGroupedPage, true);
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
