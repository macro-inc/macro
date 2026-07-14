/**
 * Property-write transport: routes `setEntityProperty` through the GraphQL
 * mutation (normalized-cache-aware) when `ENABLE_GRAPHQL_SOUP` is on, and
 * through the existing REST PUT otherwise. Callers keep REST-shaped inputs;
 * conversion to the GraphQL input types happens here, strongly typed
 * against the generated operation.
 *
 * The atomic tag-option add/remove endpoints intentionally stay on REST:
 * they are server-side deltas, and replacing them with full-value writes
 * would regress concurrent updates.
 */

import { ENABLE_GRAPHQL_SOUP } from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { executeOptimisticMutation } from '@graphql-cache/index';
import { match } from 'ts-pattern';
import { propertiesServiceClient } from '../service-properties/client';
import type { EntityReference } from '../service-properties/generated/schemas/entityReference';
import type { EntityType } from '../service-properties/generated/schemas/entityType';
import type { SetPropertyValue } from '../service-properties/generated/schemas/setPropertyValue';
import {
  type GraphqlEntityReferenceInput,
  type GraphqlPropertyEntityType,
  type GraphqlSetPropertyValue,
  SetEntityPropertyDocument,
  type SetEntityPropertyMutation,
  type SetEntityPropertyMutationVariables,
  type SoupPropertyFieldsFragment,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient } from './graphql-soup';

/**
 * REST entity type → GraphQL enum. The unions are currently identical, but
 * the explicit table keeps divergence a compile error instead of a silent
 * bad request.
 */
const ENTITY_TYPE_TO_GRAPHQL: Record<EntityType, GraphqlPropertyEntityType> = {
  CALL_RECORD: 'CALL_RECORD',
  CHANNEL: 'CHANNEL',
  CHAT: 'CHAT',
  COMPANY: 'COMPANY',
  DOCUMENT: 'DOCUMENT',
  PROJECT: 'PROJECT',
  TASK: 'TASK',
  THREAD: 'THREAD',
  USER: 'USER',
};

export function toGraphqlPropertyEntityType(
  entityType: EntityType
): GraphqlPropertyEntityType {
  return ENTITY_TYPE_TO_GRAPHQL[entityType];
}

function toGraphqlEntityReference(
  reference: EntityReference
): GraphqlEntityReferenceInput {
  return {
    entityId: reference.entity_id,
    entityType: toGraphqlPropertyEntityType(reference.entity_type),
    specificMessageId: reference.specific_message_id ?? null,
  };
}

/** REST `SetPropertyValue` → the GraphQL one-of input. */
export function toGraphqlSetPropertyValue(
  value: SetPropertyValue | null
): GraphqlSetPropertyValue | null {
  if (value === null) return null;
  return match(value)
    .with(
      { type: 'boolean' },
      (v): GraphqlSetPropertyValue => ({
        boolean: v.value,
      })
    )
    .with({ type: 'date' }, (v): GraphqlSetPropertyValue => ({ date: v.value }))
    .with(
      { type: 'number' },
      (v): GraphqlSetPropertyValue => ({
        number: v.value,
      })
    )
    .with(
      { type: 'string' },
      (v): GraphqlSetPropertyValue => ({
        string: v.value,
      })
    )
    .with(
      { type: 'select_option' },
      (v): GraphqlSetPropertyValue => ({
        selectOption: v.option_id,
      })
    )
    .with(
      { type: 'multi_select_option' },
      (v): GraphqlSetPropertyValue => ({
        multiSelectOption: v.option_ids,
      })
    )
    .with(
      { type: 'entity_reference' },
      (v): GraphqlSetPropertyValue => ({
        entityReference: toGraphqlEntityReference(v.reference),
      })
    )
    .with(
      { type: 'multi_entity_reference' },
      (v): GraphqlSetPropertyValue => ({
        multiEntityReference: v.references.map(toGraphqlEntityReference),
      })
    )
    .with({ type: 'link' }, (v): GraphqlSetPropertyValue => ({ link: v.url }))
    .with(
      { type: 'multi_link' },
      (v): GraphqlSetPropertyValue => ({
        multiLink: v.urls,
      })
    )
    .exhaustive();
}

export type SetEntityPropertyArgs = {
  entityType: EntityType;
  entityId: string;
  propertyDefinitionId: string;
  /** REST-shaped value; `null` attaches the property without a value. */
  value: SetPropertyValue | null;
  /**
   * Complete optimistic mutation payload for an *existing* assignment
   * (its stable id updates the normalized record soup queries reference).
   * Omit for new attachments — no assignment id exists until the server
   * responds, so those run without optimism and rely on invalidation.
   */
  optimisticProperty?: SoupPropertyFieldsFragment | undefined;
};

/**
 * Sets or attaches one property on an entity. Rejects on transport or
 * GraphQL errors, matching the REST path's throw-on-error behavior
 * expected by the TanStack mutation hooks.
 */
export async function setEntityProperty(
  args: SetEntityPropertyArgs
): Promise<SoupPropertyFieldsFragment | void> {
  if (!ENABLE_GRAPHQL_SOUP()) {
    await throwOnErr(
      async () =>
        await propertiesServiceClient.setEntityProperty({
          entity_type: args.entityType,
          entity_id: args.entityId,
          property_id: args.propertyDefinitionId,
          body: { value: args.value },
        })
    );
    return;
  }

  const client = getGraphqlSoupClient();
  const variables: SetEntityPropertyMutationVariables = {
    input: {
      entityType: toGraphqlPropertyEntityType(args.entityType),
      entityId: args.entityId,
      propertyDefinitionId: args.propertyDefinitionId,
      value: toGraphqlSetPropertyValue(args.value),
    },
  };
  const result = args.optimisticProperty
    ? await executeOptimisticMutation(
        client,
        SetEntityPropertyDocument,
        variables,
        {
          setEntityProperty: args.optimisticProperty,
        } satisfies SetEntityPropertyMutation
      ).toPromise()
    : await client.mutation(SetEntityPropertyDocument, variables).toPromise();
  if (result.error) {
    throw result.error;
  }
  return result.data?.setEntityProperty;
}
