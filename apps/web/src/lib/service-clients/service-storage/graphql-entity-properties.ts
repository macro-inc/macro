import { match } from 'ts-pattern';
import type { EntityType } from '../service-properties/generated/schemas/entityType';
import type { SoupProperty } from './generated/schemas/soupProperty';
import {
  EntityPropertiesDocument,
  type GraphqlEntityFilterAst,
  type SoupInput,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient, mapGraphqlProperties } from './graphql-soup';

const NIL_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Builds an exact-entity Soup query. Every non-target branch is constrained to
 * the nil UUID because an omitted branch means "unfiltered", not "excluded".
 * Users are not represented in Soup and therefore keep using the REST reader.
 */
export function buildEntityPropertiesSoupInput(
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

/** Fetches persisted properties for one Soup-backed entity via GraphQL. */
export async function getGraphqlEntityProperties(
  entityType: EntityType,
  entityId: string
): Promise<SoupProperty[] | undefined> {
  const input = buildEntityPropertiesSoupInput(entityType, entityId);
  if (!input) return undefined;

  const result = await getGraphqlSoupClient()
    .query(
      EntityPropertiesDocument,
      { input },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  if (result.error) throw result.error;

  const item = result.data?.user.soup.items.find(
    (candidate) => candidate.id === entityId
  );
  return mapGraphqlProperties(item?.properties ?? []);
}
