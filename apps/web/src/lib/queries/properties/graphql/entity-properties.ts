import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import {
  EntityPropertiesDocument,
  type EntityPropertiesQuery,
  type GraphqlEntityFilterAst,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlProperties,
} from '@service-storage/graphql-soup';
import { match } from 'ts-pattern';

const NIL_ENTITY_ID = '00000000-0000-0000-0000-000000000000';
const MAX_NETWORK_ONLY_ERROR_ATTEMPTS = 2;

async function retry<T>(
  operation: () => Promise<T>,
  shouldRetry: (result: T) => boolean,
  maxAttempts = Number.POSITIVE_INFINITY
): Promise<T> {
  let attempts = 0;
  while (true) {
    const result = await operation();
    attempts += 1;
    if (!shouldRetry(result) || attempts >= maxAttempts) return result;
  }
}

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

/** Fetches one Soup-backed entity's properties from the network. */
export async function fetchGraphqlEntityProperties(
  entityType: EntityType,
  entityId: string
): Promise<SoupProperty[] | undefined> {
  const input = buildEntityPropertiesInput(entityType, entityId);
  if (!input) return undefined;

  const request = () =>
    getGraphqlSoupClient()
      .query(
        EntityPropertiesDocument,
        { input },
        { requestPolicy: 'network-only' }
      )
      .toPromise();

  // urql may deduplicate this with an active cache-and-network operation. Once
  // that operation settles, retry so a genuine network-only request is sent.
  // Then retry genuine network errors once before surfacing them.
  const result = await retry(
    () =>
      retry(
        request,
        (candidate) =>
          candidate.operation.context.requestPolicy !== 'network-only'
      ),
    (candidate) => candidate.error?.networkError != null,
    MAX_NETWORK_ONLY_ERROR_ATTEMPTS
  );

  if (result.error) throw result.error;
  return mapGraphqlEntityProperties(result.data, entityId);
}
