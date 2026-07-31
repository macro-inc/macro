import { createUrqlInfiniteQuery } from '@app/lib/urql-solid';
import type { EntityData } from '@entity';
import {
  makeGraphqlGroupedSoupContinuationInput,
  makeGraphqlGroupedSoupInput,
} from '@queries/soup/graphql-ast';
import { registerGroupedSoupContinuation } from '@queries/soup/grouped/graphql-operation-registry';
import type { GroupByField, GroupMeta } from '@queries/soup/grouped/types';
import type {
  SoupApiItemFilter,
  SoupAstBody,
  SoupAstItemsGroupedPage,
  SoupParams,
} from '@queries/soup/items';
import {
  isDisplayableSoupItem,
  isInstructionsMdDoc,
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import {
  type GroupedSoupInput,
  GroupSoupDocument,
  type GroupSoupQuery,
  type GroupSoupQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlGroupedSoupPage,
} from '@service-storage/graphql-soup';
import {
  type Accessor,
  createComputed,
  createMemo,
  createRoot,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

export type GroupQueryData = {
  entities: EntityData[];
};

type GraphqlGroupConfig = {
  key: string;
  group: GroupMeta;
  field: GroupByField;
  initialInput: GroupedSoupInput;
  enabled: boolean;
  itemFilter: SoupApiItemFilter | undefined;
};

type GraphqlGroupQuery = {
  key: string;
  data: Accessor<GroupQueryData | undefined>;
  hasNextPage: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  fetchNextPage: () => Promise<void>;
  resetToInitialPage: () => void;
  dispose: () => void;
};

type GraphqlGroupedInitialPage = {
  items: SoupAstItemsGroupedPage['items'];
  groups: GroupMeta[];
};

type CreateGraphqlGroupedSoupQueriesArgs = {
  initialPage: Accessor<GraphqlGroupedInitialPage | undefined>;
  groupByField: Accessor<GroupByField | undefined>;
  soupParams: Accessor<
    Omit<SoupParams, 'sort_method'> & {
      sort_method: Exclude<SoupParams['sort_method'], 'frecency'>;
    }
  >;
  soupBody: Accessor<SoupAstBody>;
  enabled: Accessor<boolean>;
  itemFilter: Accessor<SoupApiItemFilter | undefined>;
};

function groupPage(
  data: GroupSoupQuery,
  group: GroupMeta
):
  | {
      items: ReturnType<typeof mapGraphqlGroupedSoupPage>['items'];
      group: GroupMeta;
    }
  | undefined {
  const page = mapGraphqlGroupedSoupPage(data);
  const bin = page.groups.find((candidate) => candidate.key === group.key);
  if (!bin) return;
  return {
    items: page.items,
    group: {
      ...group,
      totalCount: bin.totalCount,
      itemIds: bin.itemIds,
      nextCursor: bin.nextCursor,
    },
  };
}

/** Creates live initial and continuation GroupSoup observers for visible bins. */
export function createGraphqlGroupedSoupQueries(
  args: CreateGraphqlGroupedSoupQueriesArgs
): {
  list: Accessor<GraphqlGroupQuery[]>;
  map: Accessor<Map<string, GraphqlGroupQuery>>;
  resetToInitialPage: () => void;
} {
  const instructionsIdQuery = useInstructionsMdIdQuery();

  const mapItems = (
    items: SoupAstItemsGroupedPage['items'],
    itemIds: readonly string[],
    itemFilter: SoupApiItemFilter | undefined
  ): EntityData[] =>
    itemIds.flatMap((id) => {
      const item = items[id];
      if (!item || !isDisplayableSoupItem(item)) return [];
      if (itemFilter && !itemFilter(item)) return [];
      if (isInstructionsMdDoc(item, instructionsIdQuery)) return [];
      return [mapApiSoupItemToEntity(item)];
    });

  const configs = createMemo<GraphqlGroupConfig[]>(() => {
    const field = args.groupByField();
    const initialPage = args.initialPage();
    if (!field || !initialPage) return [];

    let initialInput: GroupedSoupInput;
    try {
      initialInput = makeGraphqlGroupedSoupInput({
        params: args.soupParams(),
        body: args.soupBody(),
        groupBy: field,
      });
    } catch {
      return [];
    }

    const enabled = args.enabled();
    const itemFilter = args.itemFilter();
    return initialPage.groups.map((group) => ({
      key: group.key,
      group,
      field,
      initialInput,
      enabled,
      itemFilter,
    }));
  });

  const queryByKey = new Map<string, GraphqlGroupQuery>();
  const [revision, setRevision] = createSignal(0);

  const createGroupQuery = (
    key: string,
    initialConfig: GraphqlGroupConfig
  ): GraphqlGroupQuery => {
    let dispose: (() => void) | undefined;

    const queryResult = createRoot((rootDispose) => {
      dispose = rootDispose;
      const getConfig = createMemo(
        () => configs().find((config) => config.key === key) ?? initialConfig
      );

      const query = createUrqlInfiniteQuery<
        GroupSoupQuery,
        GroupSoupQueryVariables,
        string | null,
        GroupQueryData
      >(() => {
        const config = getConfig();
        return {
          query: GroupSoupDocument,
          client: getGraphqlSoupClient(),
          initialPageParam: null,
          variables: (cursor) => {
            if (cursor === null) return { input: config.initialInput };
            const input = makeGraphqlGroupedSoupContinuationInput({
              groupBy: config.field,
              groupKey: config.key,
              cursor,
            });
            registerGroupedSoupContinuation(config.initialInput, input);
            return { input };
          },
          getNextPageParam: (lastPage) =>
            groupPage(lastPage, config.group)?.group.nextCursor,
          select: ({ pages }) => ({
            entities: pages.flatMap((page) => {
              const selected = groupPage(page, config.group);
              return selected
                ? mapItems(
                    selected.items,
                    selected.group.itemIds,
                    config.itemFilter
                  )
                : [];
            }),
          }),
          enabled: config.enabled,
          requestPolicy: 'cache-first',
          keepPreviousData: false,
        };
      });

      const initialData = (): GroupQueryData | undefined => {
        const config = getConfig();
        const initialPage = args.initialPage();
        if (!initialPage) return;
        const group = initialPage.groups.find(
          (candidate) => candidate.key === config.key
        );
        if (!group) return;
        return {
          entities: mapItems(
            initialPage.items,
            group.itemIds,
            config.itemFilter
          ),
        };
      };

      return {
        key,
        data: () => query.data ?? initialData(),
        hasNextPage: () =>
          query.data === undefined
            ? (getConfig().group.nextCursor ?? null) !== null
            : query.hasNextPage,
        isFetchingNextPage: () => query.isFetchingNextPage,
        fetchNextPage: async () => {
          if (query.data === undefined) await query.refetch();
          await query.fetchNextPage();
        },
        resetToInitialPage: query.resetToInitialPage,
      };
    });

    return {
      ...queryResult,
      dispose: () => dispose?.(),
    };
  };

  createComputed(
    on(
      () => configs().map((config) => config.key),
      (keys) => {
        const activeKeys = new Set(keys);
        let changed = false;

        for (const [key, query] of queryByKey) {
          if (activeKeys.has(key)) continue;
          query.dispose();
          queryByKey.delete(key);
          changed = true;
        }

        for (const key of keys) {
          if (queryByKey.has(key)) continue;
          const config = configs().find((candidate) => candidate.key === key);
          if (!config) continue;
          queryByKey.set(key, createGroupQuery(key, config));
          changed = true;
        }

        if (changed) setRevision((value) => value + 1);
      }
    )
  );

  onCleanup(() => {
    for (const query of queryByKey.values()) query.dispose();
    queryByKey.clear();
  });

  const list = createMemo(() => {
    revision();
    return configs().flatMap((config) => {
      const query = queryByKey.get(config.key);
      return query ? [query] : [];
    });
  });
  const map = createMemo(() =>
    list().reduce((queries, query) => {
      queries.set(query.key, query);
      return queries;
    }, new Map<string, GraphqlGroupQuery>())
  );

  return {
    list,
    map,
    resetToInitialPage: () => {
      for (const query of list()) query.resetToInitialPage();
    },
  };
}
