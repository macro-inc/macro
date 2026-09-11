import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import { buildGraphqlEntitySoupInput } from '@queries/soup/graphql/entity-input';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  EntityActivityDocument,
  type EntityActivityQuery,
  type EntityActivityQueryVariables,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import { type Accessor, createMemo } from 'solid-js';
import type { ActivityContext } from '../context/activity-context';
import {
  type EntityActivityResult,
  selectEntityActivity,
} from './select-entity-activity';

/** Rows requested for a side-panel activity preview. */
export const ENTITY_ACTIVITY_PREVIEW_LIMIT = 20;

const NIL_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

/** Soup-backed entity kinds the entity activity query can address. */
export type EntityActivityEntityType = EntityType | 'AGENT_SESSION';

type EntityActivityQueryOptions = {
  entityType: Accessor<EntityActivityEntityType>;
  entityId: Accessor<string>;
  enabled: Accessor<boolean>;
  limit?: number;
};

/** Exact Soup input for one entity's activity edge. */
export function buildEntityActivityInput(
  entityType: EntityActivityEntityType,
  entityId: string
): SoupInput | undefined {
  if (entityType === 'AGENT_SESSION') {
    const base = buildGraphqlEntitySoupInput('DOCUMENT', NIL_ENTITY_ID);
    if (!base || !('initial' in base) || !base.initial) return undefined;
    return {
      initial: {
        ...base.initial,
        filters: {
          ...base.initial.filters,
          agentSessionFilter: { literal: { id: entityId } },
        },
      },
    };
  }
  return buildGraphqlEntitySoupInput(entityType, entityId);
}

/**
 * Live urql query for one Soup-backed entity's recent activity, newest
 * first. Reuses the exact-single-entity Soup input builder so the same
 * entity types are supported (everything but `USER`, plus agent sessions)
 * and the query pauses (`isEnabled` false) for the rest.
 */
export function createEntityActivityQuery(
  context: Pick<ActivityContext, 'graphql'>,
  options: EntityActivityQueryOptions
) {
  const input = createMemo(() => {
    const entityId = options.entityId();
    if (!options.enabled() || entityId.length === 0) return undefined;
    return buildEntityActivityInput(options.entityType(), entityId);
  });

  const result = createUrqlQuery<
    EntityActivityQuery,
    EntityActivityQueryVariables,
    EntityActivityResult
  >(() => {
    const currentInput = input();
    const entityId = options.entityId();

    return {
      query: EntityActivityDocument,
      client: context.graphql(),
      variables: {
        input: currentInput!,
        limit: options.limit ?? ENTITY_ACTIVITY_PREVIEW_LIMIT,
      },
      enabled: currentInput !== undefined,
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: (data) => selectEntityActivity(data, entityId),
    };
  });

  return {
    result,
    isEnabled: () => input() !== undefined,
  };
}
