import { filterSoupItemByRequestBody } from '@app/features/next-soup/filters/query-filters';
import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import {
  makeGroupComparator,
  parseGroupMeta,
  resolveGroupMetaForKey,
  serializeGroupByField,
} from '@queries/soup/grouped/api';
import type { GroupByField, GroupMeta } from '@queries/soup/grouped/types';
import { soupKeys } from '@queries/soup/keys';
import {
  isDisplayableSoupItem,
  isInstructionsMdDoc,
  mapApiSoupItemToEntity,
  mapSoupPageToEntityList,
} from '@queries/soup/transform-utils';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { storageServiceClient } from '@service-storage/client';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { ApiEntityFilterAst } from '@service-storage/generated/schemas/apiEntityFilterAst';
import type { EntityFilters } from '@service-storage/generated/schemas/entityFilters';
import type { Params } from '@service-storage/generated/schemas/params';
import type { PostSoupAstRequestAllOf } from '@service-storage/generated/schemas/postSoupAstRequestAllOf';
import type { PostSoupRequest } from '@service-storage/generated/schemas/postSoupRequest';
import {
  fetchGraphqlGroupedSoup,
  fetchGraphqlSoup,
} from '@service-storage/graphql-soup';
import { type StaleTime, useInfiniteQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  makeGraphqlGroupedSoupInput,
  makeGraphqlSoupInput,
} from './graphql-ast';

export type SoupParams = Params;

export type SoupBody = Omit<PostSoupRequest, keyof SoupParams>;

export type SoupItemsQueryFilters = EntityFilters;

export type SoupItemsQueryArgs = {
  params: SoupParams;
  body: SoupBody;
};

export type SoupAstParams = Params;

export type SoupAstBody = ApiEntityFilterAst & PostSoupAstRequestAllOf;

export type SoupAstItemsQueryArgs = {
  params: SoupAstParams;
  body: SoupAstBody;
  groupBy?: GroupByField;
  transport?: 'rest' | 'graphql';
};

export type SoupApiItemFilter = (item: SoupApiItem) => boolean;

interface SoupItemsQueryOptions {
  enabled?: boolean;
  staleTime?: StaleTime;
  meta?: {
    groupBy?: GroupByField;
    groupKey?: string;
    itemFilter?: (item: SoupApiItem) => boolean;
  };
  showSupportedForeignEntities?: boolean;
}

/**
 * Cached page for `useSoupAstItemsQuery`. Discriminated by `kind`:
 * - `grouped`: items pool keyed by id, `groups[].itemIds` describes order.
 *   Parent never paginates when grouped — per-group queries handle load-more.
 * - `flat`: items array; standard infinite-query pagination.
 */
export type SoupAstItemsPage = SoupAstItemsGroupedPage | SoupAstItemsFlatPage;

export type SoupAstItemsGroupedPage = {
  kind: 'grouped';
  items: Record<string, SoupApiItem>;
  groups: GroupMeta[];
  nextCursor: null;
};

export type SoupAstItemsFlatPage = {
  kind: 'flat';
  items: SoupApiItem[];
  nextCursor: string | null;
};

export type SoupAstItemsData = {
  entities: EntityData[];
  groups: GroupMeta[] | undefined;
  /** Raw API item pool. Only present when query is grouped. */
  itemsById?: SoupAstItemsGroupedPage['items'];
};

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
        return mapSoupPageToEntityList(page, {
          instructionsIdQuery,
          showSupportedForeignEntities:
            options?.().showSupportedForeignEntities,
        });
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

  return useInfiniteQuery(() => {
    const { params, body, groupBy, transport } = args();

    return {
      queryKey: soupKeys.astItems({ params, body, groupBy, transport })
        .queryKey,
      queryFn: async (ctx): Promise<SoupAstItemsPage> => {
        if (groupBy) {
          let sort_method = params.sort_method ?? undefined;

          // TODO(dev-rb/soup): This is temporary fix since we don't support
          // 'frecency' for group by. Replace with proper types
          if (sort_method === 'frecency') {
            sort_method = 'updated_at';
          }

          const fetchRest = async () => {
            const response = await throwOnErr(
              async () =>
                await storageServiceClient.getGroupedSoupAstItems({
                  params: {
                    group_by: serializeGroupByField(groupBy),
                    per_group_limit: params.limit,
                    sort_method,
                  },
                  body,
                })
            );

            return {
              items: response.items,
              groups: response.groups.map(parseGroupMeta),
            };
          };

          const fetchGraphql = async () => {
            const response = await fetchGraphqlGroupedSoup(
              makeGraphqlGroupedSoupInput({
                params: { ...params, sort_method },
                body,
                groupBy,
              })
            );

            return {
              items: response.items,
              groups: response.groups.map((group): GroupMeta => {
                const firstItem = response.items[group.itemIds[0] ?? ''];
                const resolved = resolveGroupMetaForKey(
                  groupBy,
                  group.key,
                  firstItem
                );
                return {
                  key: group.key,
                  label: resolved?.label ?? group.key,
                  displayOrder: resolved?.displayOrder ?? null,
                  totalCount: group.totalCount,
                  itemIds: group.itemIds,
                  nextCursor: group.nextCursor,
                };
              }),
            };
          };

          const response =
            transport === 'graphql'
              ? await fetchGraphql().catch((error: unknown) => {
                  if (
                    error instanceof Error &&
                    error.message.startsWith('Unsupported GraphQL Soup AST:')
                  ) {
                    console.warn(error.message);
                    return fetchRest();
                  }
                  throw error;
                })
              : await fetchRest();

          return {
            kind: 'grouped',
            items: response.items,
            groups: response.groups,
            nextCursor: null,
          };
        }

        const fetchRest = () =>
          throwOnErr(
            async () =>
              await storageServiceClient.getSoupAstItems({
                params: {
                  cursor: ctx.pageParam,
                },
                body: {
                  ...body,
                  ...params,
                },
              })
          );

        const fetchGraphql = async () =>
          await fetchGraphqlSoup(
            makeGraphqlSoupInput({
              params,
              body,
              cursor: ctx.pageParam,
            })
          );

        const response =
          transport === 'graphql'
            ? await fetchGraphql().catch((error: unknown) => {
                if (
                  error instanceof Error &&
                  error.message.startsWith('Unsupported GraphQL Soup AST:')
                ) {
                  console.warn(error.message);
                  return fetchRest();
                }
                throw error;
              })
            : await fetchRest();

        return {
          kind: 'flat',
          items: response.items,
          nextCursor: response.next_cursor ?? null,
        };
      },
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage): string | null => {
        if (lastPage.kind === 'grouped') return null;
        return lastPage.nextCursor;
      },
      select: (data): SoupAstItemsData => {
        const firstPage = data.pages[0];

        if (firstPage?.kind === 'grouped') {
          const groups = firstPage.groups
            .slice()
            .sort(makeGroupComparator(groupBy));

          const itemsById = firstPage.items;
          const entities: EntityData[] = [];

          for (const g of groups) {
            for (const id of g.itemIds) {
              const item = itemsById[id];

              let displayable = false;

              if (item.tag === 'foreignEntity') {
                displayable =
                  options?.().showSupportedForeignEntities === true &&
                  item.data.foreignEntitySource === 'github_pull_request';
              } else {
                displayable =
                  item && !isInstructionsMdDoc(item, instructionsIdQuery);
              }
              if (displayable && isDisplayableSoupItem(item)) {
                const mapped = mapApiSoupItemToEntity(item);
                entities.push(mapped);
              }
            }
          }

          return { entities, groups, itemsById };
        }

        const entities = data.pages.flatMap((page) => {
          if (page.kind !== 'flat') return [];

          return mapSoupPageToEntityList(
            { items: page.items, next_cursor: null },
            {
              instructionsIdQuery,
              showSupportedForeignEntities:
                options?.().showSupportedForeignEntities,
            }
          );
        });

        return { entities, groups: undefined };
      },
      enabled: options?.().enabled,
      staleTime: options?.().staleTime,
      placeholderData: (prev, prevQuery) => {
        // Keep the previous rows on screen while params/filters change, but
        // not across a grouping switch — the old groups would render under
        // the new grouping (e.g. status groups while assignee groups load).
        const prevGroupBy = (
          prevQuery?.meta as SoupItemsQueryOptions['meta'] | undefined
        )?.groupBy;

        if (JSON.stringify(prevGroupBy) !== JSON.stringify(groupBy)) {
          return undefined;
        }

        return prev;
      },
      meta: {
        ...options?.().meta,
        groupBy,
        normalize: true,
      },
    };
  });
};
