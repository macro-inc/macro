import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import { buildEntityPropertiesInput } from '@queries/properties/graphql/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  type ActivityEventFieldsFragment,
  EntityActivityDocument,
  type EntityActivityQuery,
  type EntityActivityQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createMemo } from 'solid-js';

/** One activity event as both activity queries return it. */
export type ActivityEvent = ActivityEventFieldsFragment;

/** Rows requested for a side-panel activity preview. */
export const ENTITY_ACTIVITY_PREVIEW_LIMIT = 20;

type EntityActivityQueryOptions = {
  entityType: Accessor<EntityType>;
  entityId: Accessor<string>;
  enabled: Accessor<boolean>;
  limit?: number;
};

/**
 * Live urql query for one Soup-backed entity's recent activity, newest
 * first. Reuses the exact-single-entity Soup input builder from the
 * properties query, so the same entity types are supported (everything but
 * `USER`) and the query pauses (`isEnabled` false) for the rest.
 */
export function createEntityActivityQuery(options: EntityActivityQueryOptions) {
  const input = createMemo(() => {
    const entityId = options.entityId();
    if (!options.enabled() || entityId.length === 0) return undefined;
    return buildEntityPropertiesInput(options.entityType(), entityId);
  });

  const result = createUrqlQuery<
    EntityActivityQuery,
    EntityActivityQueryVariables,
    ActivityEvent[]
  >(() => {
    const currentInput = input();
    const entityId = options.entityId();

    return {
      query: EntityActivityDocument,
      client: getGraphqlSoupClient(),
      variables: {
        input: currentInput!,
        limit: options.limit ?? ENTITY_ACTIVITY_PREVIEW_LIMIT,
      },
      enabled: currentInput !== undefined,
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: (data) =>
        data.user.soup.items.find((item) => item.id === entityId)?.activity ??
        [],
    };
  });

  return {
    result,
    isEnabled: () => input() !== undefined,
  };
}
