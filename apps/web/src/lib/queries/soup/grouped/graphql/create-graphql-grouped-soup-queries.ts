import { createUrqlInfiniteQuery } from '@app/lib/urql-solid';
import type { EntityData } from '@entity';
import {
  makeGraphqlGroupedSoupContinuationInput,
  makeGraphqlGroupedSoupInput,
} from '@queries/soup/graphql/ast';
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
  soupParams: Accessor<SoupParams>;
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

/** Derives initial bins from the live parent and observes loaded continuations. */
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
      const [continuationRevision, setContinuationRevision] = createSignal(0);
      const [isFetchingFirstPage, setIsFetchingFirstPage] = createSignal(false);

      const createContinuationQuery = (firstCursor: string) => {
        let continuationDispose: (() => void) | undefined;

        return createRoot((continuationRootDispose) => {
          continuationDispose = continuationRootDispose;
          const [activated, setActivated] = createSignal(false);
          let initialPageDidSettle = false;
          let settleInitialPage = () => undefined;
          const initialPageSettled = new Promise<void>((resolve) => {
            settleInitialPage = () => {
              if (initialPageDidSettle) return;
              initialPageDidSettle = true;
              resolve();
            };
          });

          const query = createUrqlInfiniteQuery<
            GroupSoupQuery,
            GroupSoupQueryVariables,
            string,
            GroupQueryData
          >(() => {
            const config = getConfig();
            return {
              query: GroupSoupDocument,
              client: getGraphqlSoupClient(),
              initialPageParam: firstCursor,
              variables: (cursor) => {
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
              enabled: activated() && config.enabled,
              requestPolicy: 'cache-first',
              keepPreviousData: false,
            };
          });

          createComputed(() => {
            if (!activated()) return;
            if (
              !getConfig().enabled ||
              (query.isFetched && !query.isFetching)
            ) {
              settleInitialPage();
            }
          });
          onCleanup(settleInitialPage);

          return {
            firstCursor,
            query,
            activate: () => {
              setActivated(true);
              return initialPageSettled;
            },
            dispose: () => continuationDispose?.(),
          };
        });
      };

      let continuation: ReturnType<typeof createContinuationQuery> | undefined;
      let firstPagePromise: Promise<void> | undefined;

      const getContinuation = () => {
        continuationRevision();
        return continuation;
      };

      const disposeContinuation = () => {
        continuation?.dispose();
        continuation = undefined;
        firstPagePromise = undefined;
        setIsFetchingFirstPage(false);
        setContinuationRevision((value) => value + 1);
      };

      const initialData = createMemo<GroupQueryData | undefined>(() => {
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
      });

      const data = createMemo<GroupQueryData | undefined>(() => {
        const initial = initialData();
        if (!initial) return;
        const continued = getContinuation()?.query.data;
        if (!continued) return initial;
        return { entities: [...initial.entities, ...continued.entities] };
      });

      const trackFirstPage = (action: Promise<unknown>): Promise<void> => {
        setIsFetchingFirstPage(true);
        const tracked = action
          .then(() => undefined)
          .finally(() => {
            if (firstPagePromise !== tracked) return;
            firstPagePromise = undefined;
            setIsFetchingFirstPage(false);
          });
        firstPagePromise = tracked;
        return tracked;
      };

      const startContinuation = async (cursor: string): Promise<void> => {
        continuation = createContinuationQuery(cursor);
        setContinuationRevision((value) => value + 1);
        await trackFirstPage(continuation.activate());
      };

      const fetchNextPage = async (): Promise<void> => {
        const config = getConfig();
        if (!config.enabled) return;
        if (firstPagePromise) return firstPagePromise;

        let current = getContinuation();
        if (!current) {
          const cursor = config.group.nextCursor;
          if (cursor === null) return;
          await startContinuation(cursor);
          return;
        }

        if (current.query.data === undefined) {
          const cursor = getConfig().group.nextCursor;
          if (cursor === null) return;
          if (cursor !== current.firstCursor) {
            disposeContinuation();
            await startContinuation(cursor);
            return;
          }
          await trackFirstPage(current.query.refetch());
          return;
        }

        await current.query.fetchNextPage();
      };

      onCleanup(disposeContinuation);

      return {
        key,
        data,
        hasNextPage: () => {
          const current = getContinuation();
          return current?.query.data === undefined
            ? getConfig().group.nextCursor !== null
            : current.query.hasNextPage;
        },
        isFetchingNextPage: () =>
          isFetchingFirstPage() ||
          (getContinuation()?.query.isFetchingNextPage ?? false),
        fetchNextPage,
        resetToInitialPage: disposeContinuation,
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
