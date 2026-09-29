import { createUrqlInfiniteQuery } from '@app/lib/urql-solid';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { registerActivityRevalidator } from '@queries/activity/push-registry';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '@queries/soup/graphql/active-queries';
import { buildGraphqlEntitySoupInput } from '@queries/soup/graphql/entity-input';
import {
  type GraphqlFilterPropertiesExpr,
  type GraphqlInitiativeExpr,
  SoupDocument,
  type SoupInput,
  type SoupQuery,
  type SoupQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { mapGraphqlProperties } from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import type { ProjectRow, ProjectsSource } from '../context/projects-context';
import type { ProjectFilters } from '../core/project';
import { projectProperties } from './project-properties';

/** Use the same bounded, authorized Soup cursor as tasks, scoped to initiatives. */
export function projectSoupInput(filters: ProjectFilters): SoupInput {
  const input = buildGraphqlEntitySoupInput(
    'INITIATIVE',
    '00000000-0000-0000-0000-000000000000'
  );
  if (!input?.initial) throw new Error('Initiative Soup input is unavailable');
  const predicates: GraphqlInitiativeExpr[] = [{ literal: { include: true } }];
  if (filters.query)
    predicates.push({ literal: { nameContains: filters.query } });
  if (filters.dueBefore)
    predicates.push({ literal: { dueBefore: filters.dueBefore } });
  if (filters.dueAfter)
    predicates.push({ literal: { dueAfter: filters.dueAfter } });
  const properties: GraphqlFilterPropertiesExpr[] = [];
  for (const [propertyDefinitionId, option] of [
    [SYSTEM_PROPERTY_IDS.STATUS, filters.status],
    [SYSTEM_PROPERTY_IDS.PRIORITY, filters.priority],
  ] as const) {
    if (option)
      properties.push({
        literal: {
          entityType: 'INITIATIVE',
          propertyDefinitionId,
          value: { selectOption: option },
        },
      });
  }
  if (filters.assignee)
    properties.push({
      literal: {
        entityType: 'INITIATIVE',
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
        value: { entityRef: filters.assignee },
      },
    });
  return {
    initial: {
      ...input.initial,
      limit: 50,
      sortMethod: filters.sort === 'created' ? 'CREATED_AT' : 'UPDATED_AT',
      sortDirection: 'DESC',
      filters: {
        ...input.initial.filters,
        initiativeFilter: predicates.reduce((left, right) => ({
          and: { left, right },
        })),
        ...(properties.length
          ? {
              propertiesFilter: properties.reduce((left, right) => ({
                and: { left, right },
              })),
            }
          : {}),
      },
    },
  };
}

const accessLevels = {
  VIEW: 'view',
  COMMENT: 'comment',
  EDIT: 'edit',
  OWNER: 'owner',
} as const;

/** Project presentation over the shared Soup entity contract; folders stay distinct. */
export function projectSoupRows(
  items: SoupQuery['user']['soup']['items']
): ProjectRow[] {
  return items.flatMap((item) => {
    if (item.__typename !== 'GraphqlSoupInitiative') return [];
    const permission = item.viewerPermission;
    return [
      {
        project: {
          id: item.id,
          name: item.displayName ?? 'Untitled project',
          descriptionSurfaceId: item.descriptionSurfaceId ?? '',
          updatedAt: item.metadata.updatedAt ?? '',
          access:
            permission?.__typename === 'GraphqlAccessLevelPermission'
              ? accessLevels[permission.accessLevel]
              : undefined,
        },
        properties: projectProperties(mapGraphqlProperties(item.properties)),
      },
    ];
  });
}

export function createProjectSoupSource(
  soupClient: () => Client,
  filters: Accessor<ProjectFilters>,
  enabled: Accessor<boolean>
): ProjectsSource {
  const input = createMemo(() => projectSoupInput(filters()));
  const client = createMemo(soupClient);
  const query = createUrqlInfiniteQuery<
    SoupQuery,
    SoupQueryVariables,
    string | null
  >(() => {
    const initial = input();
    return {
      query: SoupDocument,
      client: client(),
      enabled: enabled(),
      initialPageParam: null,
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      variables: (cursor) => ({
        input: cursor
          ? {
              continuation: {
                cursor,
                expand: true,
                sortDirection: initial.initial?.sortDirection,
              },
            }
          : initial,
      }),
      getNextPageParam: (page) => page.user.soup.nextCursor,
    };
  });
  const refresh = async () => {
    if (!enabled()) return;
    const result = await query.refetch({ requestPolicy: 'network-only' });
    if (result.error) throw result.error;
  };
  onCleanup(registerActivityRevalidator({ client, refresh }));
  onCleanup(registerActiveGraphqlSoupQuery({ isEnabled: enabled, refresh }));
  onCleanup(
    registerGraphqlSoupRevalidations(() => {
      if (!enabled() || !query.isSuccess) return [];
      return (query.data?.pageParams ?? [null]).map((cursor) => ({
        document: SoupDocument,
        variables: {
          input: cursor
            ? {
                continuation: {
                  cursor,
                  expand: true,
                  sortDirection: input().initial?.sortDirection,
                },
              }
            : input(),
        },
      }));
    })
  );
  const accessLost = () =>
    query.error?.graphQLErrors.some((error) =>
      ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'].includes(
        String(error.extensions.code)
      )
    );
  return {
    rows: () => {
      if (!enabled() || query.isPending || accessLost()) return undefined;
      // urql exposes a plain store, so failed background reads may retain the
      // last authorized pages without triggering a Solid resource suspension.
      const data = query.data;
      return data
        ? projectSoupRows(data.pages.flatMap((page) => page.user.soup.items))
        : undefined;
    },
    loading: () => enabled() && query.isPending,
    error: () => (enabled() ? (query.error ?? undefined) : undefined),
    hasMore: () => enabled() && query.hasNextPage,
    loadingMore: () => enabled() && query.isFetchingNextPage,
    loadMore: async () => {
      if (enabled()) await query.fetchNextPage();
    },
    refresh,
  };
}
