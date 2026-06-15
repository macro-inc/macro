import { filterSoupItemByRequestBody } from '@app/component/next-soup/filters/query-filters';
import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  parseGroupMeta,
  serializeGroupByField,
} from '@queries/soup/grouped/api';
import {
  type GroupByField,
  type GroupMeta,
  NOT_SET_GROUP_KEY,
} from '@queries/soup/grouped/types';
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
import { type StaleTime, useInfiniteQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

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
    const { params, body, groupBy } = args();

    return {
      queryKey: soupKeys.astItems({ params, body, groupBy }).queryKey,
      queryFn: async (ctx): Promise<SoupAstItemsPage> => {
        if (groupBy) {
          const response = await throwOnErr(
            async () =>
              await storageServiceClient.getGroupedSoupAstItems({
                params: {
                  group_by: serializeGroupByField(groupBy),
                  per_group_limit: params.limit,
                },
                body,
              })
          );

          return {
            kind: 'grouped',
            items: response.items,
            groups: response.groups.map(parseGroupMeta),
            nextCursor: null,
          };
        }

        const response = await throwOnErr(
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

// Stable UUIDs from migrations/20251128000001_seed_system_properties.sql.
// Custom (user-created) options fall through to displayOrder.
const STATUS_OPTION_ORDER: readonly string[] = [
  '00000001-0000-0000-0002-000000000001', // Not Started
  '00000001-0000-0000-0002-000000000002', // In Progress
  '00000001-0000-0000-0002-000000000003', // In Review
  NOT_SET_GROUP_KEY,
  '00000001-0000-0000-0002-000000000004', // Completed
  '00000001-0000-0000-0002-000000000005', // Canceled
];

const PRIORITY_OPTION_ORDER: readonly string[] = [
  '00000001-0000-0000-0003-000000000004', // Urgent
  '00000001-0000-0000-0003-000000000003', // High
  '00000001-0000-0000-0003-000000000002', // Medium
  '00000001-0000-0000-0003-000000000001', // Low
  NOT_SET_GROUP_KEY,
];

function keyRank(order: readonly string[], key: string): number {
  const i = order.indexOf(key);
  return i === -1 ? order.length : i;
}

function defaultOrder(a: GroupMeta, b: GroupMeta): number {
  if (a.displayOrder === null && b.displayOrder === null) return 0;
  if (a.displayOrder === null) return 1;
  if (b.displayOrder === null) return -1;
  return a.displayOrder - b.displayOrder;
}

function makeGroupComparator(
  groupBy: GroupByField | undefined
): (a: GroupMeta, b: GroupMeta) => number {
  if (groupBy?.type === 'property') {
    if (groupBy.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS) {
      return (a, b) => {
        const diff =
          keyRank(STATUS_OPTION_ORDER, a.key) -
          keyRank(STATUS_OPTION_ORDER, b.key);
        return diff !== 0 ? diff : defaultOrder(a, b);
      };
    }
    if (groupBy.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PRIORITY) {
      return (a, b) => {
        const diff =
          keyRank(PRIORITY_OPTION_ORDER, a.key) -
          keyRank(PRIORITY_OPTION_ORDER, b.key);
        return diff !== 0 ? diff : defaultOrder(a, b);
      };
    }
    if (groupBy.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES) {
      return (a, b) => {
        const aNotSet = a.key === NOT_SET_GROUP_KEY;
        const bNotSet = b.key === NOT_SET_GROUP_KEY;
        if (aNotSet && bNotSet) return 0;
        if (aNotSet) return 1;
        if (bNotSet) return -1;
        return a.label.localeCompare(b.label);
      };
    }
  }
  return defaultOrder;
}
