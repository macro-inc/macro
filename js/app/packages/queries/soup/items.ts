import { filterSoupItemByRequestBody } from '@app/component/next-soup/filters/query-filters';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import { throwOnErr } from '@core/util/maybeResult';
import type { EntityData } from '@entity';
import {
  parseGroupMeta,
  serializeGroupByField,
} from '@queries/soup/grouped/api';
import type { GroupByField, GroupMeta } from '@queries/soup/grouped/types';
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
  type StaleTime,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
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
  groupBy?: GroupByField;
  groupKey?: string;
};

export type UseSoupQueryResult = UseInfiniteQueryResult<EntityData[], Error>;

export type SoupApiItemFilter = (item: SoupApiItem) => boolean;

interface SoupItemsQueryOptions {
  enabled?: boolean;
  staleTime?: StaleTime;
}

export type SoupAstItemsPage = {
  items: SoupApiItem[];
  nextCursor: string | null;
  groups?: GroupMeta[];
};

export type SoupAstItemsData = {
  entities: EntityData[];
  groups: GroupMeta[] | undefined;
  items: SoupApiItem[];
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

  return useInfiniteQuery(() => {
    const { params, body, groupBy, groupKey } = args();

    return {
      queryKey: soupKeys.astItems({ params, body, groupBy, groupKey }).queryKey,
      queryFn: async (ctx): Promise<SoupAstItemsPage> => {
        if (groupBy) {
          const response = await throwOnErr(
            async () =>
              await storageServiceClient.getGroupedSoupAstItems({
                params: {
                  cursor: ctx.pageParam,
                  group_by: serializeGroupByField(groupBy),
                  group_key: groupKey,
                },
                body: {
                  ...body,
                  ...params,
                },
              })
          );

          const groups = response.groups
            ? (response.groups as Array<Record<string, unknown>>).map(
                parseGroupMeta
              )
            : undefined;

          return {
            items: response.items,
            nextCursor: response.next_cursor ?? null,
            groups,
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
          items: response.items,
          nextCursor: response.next_cursor ?? null,
          groups: [],
        };
      },
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage): string | null => {
        if (groupBy) return null;
        return lastPage.nextCursor;
      },
      select: (data): SoupAstItemsData => {
        const items = data.pages.flatMap((page) => page.items);
        const entities = data.pages.flatMap((page) => {
          return mapSoupPageToEntityList(page, { instructionsIdQuery });
        });
        const rawGroups = data.pages[0]?.groups;
        const groups = rawGroups?.slice().sort(makeGroupComparator(groupBy));

        return { entities, groups, items };
      },
      enabled: options?.().enabled,
      staleTime: options?.().staleTime,
      placeholderData: (p) => p,
      meta: { normalize: true },
    };
  });
};

// Empty group key from backend (rust/cloud-storage/soup/src/domain/models/grouping.rs)
// for items missing a value for the grouped property.
const NOT_SET_GROUP_KEY = '';

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
  '00000001-0000-0000-0003-000000000004', // Critical
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
