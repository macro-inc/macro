import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import { soupPropertyToProperty } from '@entity/extractors-property/property-helpers';
import type { Property } from '@property/types';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import {
  EntityPropertiesDocument,
  type EntityPropertiesQuery,
  type EntityPropertiesQueryVariables,
  type GraphqlEntityFilterAst,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlProperties,
} from '@service-storage/graphql-soup';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';

const NIL_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Builds an exact-entity Soup query. Every non-target branch is constrained to
 * the nil UUID because an omitted branch means "unfiltered", not "excluded".
 * Users are not represented in Soup and therefore keep using the REST reader.
 */
export function buildEntityPropertiesInput(
  entityType: EntityType,
  entityId: string
): SoupInput | undefined {
  const targetFilter: Partial<GraphqlEntityFilterAst> | undefined = match(
    entityType
  )
    .with('DOCUMENT', 'TASK', () => ({
      documentFilter: { literal: { id: entityId } },
    }))
    .with('PROJECT', () => ({
      projectFilter: { literal: { projectIdSelf: entityId } },
    }))
    .with('CHAT', () => ({
      chatFilter: { literal: { chatId: entityId } },
    }))
    .with('THREAD', () => ({
      emailFilter: { tree: { literal: { threadId: entityId } } },
    }))
    .with('CHANNEL', () => ({
      channelFilter: { literal: { channelId: entityId } },
    }))
    .with('CALL_RECORD', () => ({
      callFilter: { literal: { callId: entityId } },
    }))
    .with('COMPANY', () => ({
      crmCompanyFilter: { literal: { id: entityId } },
    }))
    .with('USER', () => undefined)
    .exhaustive();
  if (!targetFilter) return undefined;

  const filters: GraphqlEntityFilterAst = {
    documentFilter: { literal: { id: NIL_ENTITY_ID } },
    projectFilter: { literal: { projectIdSelf: NIL_ENTITY_ID } },
    chatFilter: { literal: { chatId: NIL_ENTITY_ID } },
    emailFilter: {
      tree: { literal: { threadId: NIL_ENTITY_ID } },
    },
    channelFilter: { literal: { channelId: NIL_ENTITY_ID } },
    channelThreadFilter: { literal: { threadId: NIL_ENTITY_ID } },
    callFilter: { literal: { callId: NIL_ENTITY_ID } },
    crmCompanyFilter: { literal: { id: NIL_ENTITY_ID } },
    foreignEntityFilter: { literal: { id: NIL_ENTITY_ID } },
    ...targetFilter,
  };

  return {
    initial: {
      limit: 1,
      expand: true,
      sortMethod: 'UPDATED_AT',
      emailView: 'ALL',
      filters,
    },
  };
}

type GraphqlEntityPropertiesQueryOptions = {
  entityType: Accessor<EntityType>;
  entityId: Accessor<string>;
  enabled: Accessor<boolean>;
};

/** Creates the live urql query for one Soup-backed entity's properties. */
export function createGraphqlEntityPropertiesQuery(
  options: GraphqlEntityPropertiesQueryOptions
) {
  const input = createMemo(() => {
    const entityId = options.entityId();
    if (!options.enabled() || entityId.length === 0) return undefined;
    return buildEntityPropertiesInput(options.entityType(), entityId);
  });

  const result = createUrqlQuery<
    EntityPropertiesQuery,
    EntityPropertiesQueryVariables,
    Property[]
  >(() => {
    const currentInput = input();
    const entityId = options.entityId();

    return {
      query: EntityPropertiesDocument,
      client: getGraphqlSoupClient(),
      variables: { input: currentInput! },
      enabled: currentInput !== undefined,
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: (data) =>
        (mapGraphqlEntityProperties(data, entityId) ?? []).flatMap(
          (property) => {
            try {
              const mapped = soupPropertyToProperty(property);
              return mapped.isMetadata === true ? [] : [mapped];
            } catch (error) {
              console.warn(
                'Skipping GraphQL property with unsupported type',
                error
              );
              return [];
            }
          }
        ),
    };
  });

  return {
    result,
    isEnabled: () => input() !== undefined,
    refetch: () => result.refetch({ requestPolicy: 'network-only' }),
  };
}

/** Maps one entity's GraphQL query result to the shared Soup property shape. */
export function mapGraphqlEntityProperties(
  data: EntityPropertiesQuery | undefined,
  entityId: string
): SoupProperty[] | undefined {
  if (!data) return undefined;
  const item = data.user.soup.items.find(
    (candidate) => candidate.id === entityId
  );
  return mapGraphqlProperties(item?.properties ?? []);
}
