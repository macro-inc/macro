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
import {
  executeOptimisticMutation,
  type OptimisticMutationOptions,
  optimisticMutationDispositionOf,
} from '@graphql-cache/index';
import { match } from 'ts-pattern';
import { propertiesServiceClient } from '../service-properties/client';
import type { EntityReference } from '../service-properties/generated/schemas/entityReference';
import type { EntityType } from '../service-properties/generated/schemas/entityType';
import type { PropertyTargetEntityType } from '../service-properties/generated/schemas/propertyTargetEntityType';
import type { SetPropertyValue } from '../service-properties/generated/schemas/setPropertyValue';
import {
  type GraphqlEntityReferenceInput,
  type GraphqlPropertyEntityType,
  type GraphqlPropertyTargetEntityType,
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

const TARGET_ENTITY_TYPE_TO_GRAPHQL: Record<
  PropertyTargetEntityType,
  GraphqlPropertyTargetEntityType
> = {
  CALL_RECORD: 'CALL_RECORD',
  CHANNEL: 'CHANNEL',
  CHAT: 'CHAT',
  COMPANY: 'COMPANY',
  DOCUMENT: 'DOCUMENT',
  PROJECT: 'PROJECT',
  THREAD: 'THREAD',
  USER: 'USER',
};

export function toGraphqlPropertyTargetEntityType(
  entityType: PropertyTargetEntityType
): GraphqlPropertyTargetEntityType {
  return TARGET_ENTITY_TYPE_TO_GRAPHQL[entityType];
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
  entityType: PropertyTargetEntityType;
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
  /** Mutation-scoped persistent normalized-cache relation recipes. */
  optimisticCache?: OptimisticMutationOptions;
};

/** Outcome of submitting one property mutation to its configured transport. */
export type SetEntityPropertyDisposition =
  | { kind: 'committed'; property?: SoupPropertyFieldsFragment }
  | { kind: 'queued'; transactionId: string }
  | { kind: 'permanently-failed'; error: Error };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Sets or durably queues one property assignment. */
export async function setEntityProperty(
  args: SetEntityPropertyArgs
): Promise<SetEntityPropertyDisposition> {
  if (!ENABLE_GRAPHQL_SOUP()) {
    try {
      await throwOnErr(
        async () =>
          await propertiesServiceClient.setEntityProperty({
            entity_type: args.entityType,
            entity_id: args.entityId,
            property_id: args.propertyDefinitionId,
            body: { value: args.value },
          })
      );
      return { kind: 'committed' };
    } catch (error) {
      return { kind: 'permanently-failed', error: asError(error) };
    }
  }

  const client = getGraphqlSoupClient();
  const variables: SetEntityPropertyMutationVariables = {
    input: {
      entityType: toGraphqlPropertyTargetEntityType(args.entityType),
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
        } satisfies SetEntityPropertyMutation,
        args.optimisticCache
      ).toPromise()
    : await client.mutation(SetEntityPropertyDocument, variables).toPromise();
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued') return disposition;
  if (disposition?.kind === 'permanently-failed') return disposition;
  if (disposition?.kind === 'committed') {
    return {
      kind: 'committed',
      property: disposition.data.setEntityProperty,
    };
  }

  if (result.error) {
    return { kind: 'permanently-failed', error: result.error };
  }
  if (!result.data) {
    return {
      kind: 'permanently-failed',
      error: new Error('setEntityProperty mutation returned no data'),
    };
  }
  return { kind: 'committed', property: result.data.setEntityProperty };
}
