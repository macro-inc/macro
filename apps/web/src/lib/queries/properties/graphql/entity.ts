import { createUrqlMutation } from '@app/lib/urql-solid/create-urql-mutation';
import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import type { UrqlMutationExecutor } from '@app/lib/urql-solid/types';
import { soupPropertyToProperty } from '@entity/extractors-property/property-helpers';
import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
} from '@graphql-cache/index';
import { propertyValueToApi } from '@property/api/converters';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { isInstantiatedProperty } from '@property/utils/typeGuards';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyTargetEntityType } from '@service-properties/generated/schemas/propertyTargetEntityType';
import type { SetPropertyValue } from '@service-properties/generated/schemas/setPropertyValue';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import {
  EntityPropertiesDocument,
  type EntityPropertiesQuery,
  type EntityPropertiesQueryVariables,
  type GraphqlEntityFilterAst,
  type GraphqlEntityReferenceInput,
  type GraphqlPropertyTargetEntityType,
  type GraphqlSetPropertyValue,
  SetEntityPropertyDocument,
  type SetEntityPropertyMutation,
  type SetEntityPropertyMutationVariables,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
  mapGraphqlProperties,
} from '@service-storage/graphql-soup';
import { CombinedError, type OperationResult } from '@urql/core';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import { v5 as uuidv5 } from 'uuid';
import {
  buildOptimisticGroupedPropertyUpdates,
  groupedPropertyKeys,
} from '../../soup/grouped/graphql-optimistic';
import { buildOptimisticSetEntityProperty } from '../graphql-optimistic';

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
    .with('CALENDAR_EVENT', () => ({
      calendarEventFilter: { literal: { id: entityId } },
    }))
    .with('USER', () => undefined)
    .exhaustive();
  if (!targetFilter) return undefined;

  const filters: GraphqlEntityFilterAst = {
    calendarEventFilter: { literal: { id: NIL_ENTITY_ID } },
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

export type GraphqlEntityPropertyMutationInput =
  | {
      kind: 'save';
      entityType: EntityType | PropertyTargetEntityType;
      entityId: string;
      property: Property | PropertyDefinitionDomain;
      apiValues: PropertyApiValues;
    }
  | {
      kind: 'add';
      entityType: EntityType | PropertyTargetEntityType;
      entityId: string;
      propertyDefinitionId: string;
    };

export type EntityPropertyMutationDisposition =
  | {
      kind: 'committed';
      property?: SetEntityPropertyMutation['setEntityProperty'];
    }
  | { kind: 'queued'; transactionId: string }
  | { kind: 'permanently-failed'; error: Error };

type SetEntityPropertyArgs = {
  entityType: GraphqlPropertyTargetEntityType;
  entityId: string;
  propertyDefinitionId: string;
  value: SetPropertyValue | null;
  optimisticProperty?: ReturnType<typeof buildOptimisticSetEntityProperty>;
  optimisticCache?: Awaited<
    ReturnType<typeof buildOptimisticGroupedPropertyUpdates>
  >;
};

function toGraphqlEntityReference(
  reference: EntityReference
): GraphqlEntityReferenceInput {
  return {
    entityId: reference.entity_id,
    entityType: reference.entity_type,
    specificMessageId: reference.specific_message_id ?? null,
  };
}

function toGraphqlSetPropertyValue(
  value: SetPropertyValue | null
): GraphqlSetPropertyValue | null {
  if (value === null) return null;
  return match(value)
    .with({ type: 'boolean' }, (v) => ({ boolean: v.value }))
    .with({ type: 'date' }, (v) => ({ date: v.value }))
    .with({ type: 'number' }, (v) => ({ number: v.value }))
    .with({ type: 'string' }, (v) => ({ string: v.value }))
    .with({ type: 'select_option' }, (v) => ({ selectOption: v.option_id }))
    .with({ type: 'multi_select_option' }, (v) => ({
      multiSelectOption: v.option_ids,
    }))
    .with({ type: 'entity_reference' }, (v) => ({
      entityReference: toGraphqlEntityReference(v.reference),
    }))
    .with({ type: 'multi_entity_reference' }, (v) => ({
      multiEntityReference: v.references.map(toGraphqlEntityReference),
    }))
    .with({ type: 'link' }, (v) => ({ link: v.url }))
    .with({ type: 'multi_link' }, (v) => ({ multiLink: v.urls }))
    .exhaustive();
}

/** Maps a REST property target type onto its GraphQL enum. */
export function toGraphqlPropertyTargetEntityType(
  entityType: EntityType | PropertyTargetEntityType
): GraphqlPropertyTargetEntityType {
  if (entityType === 'TASK') return 'DOCUMENT';
  if (entityType === 'CALENDAR_EVENT') {
    throw new Error('calendar events do not support properties');
  }
  return entityType;
}

function getPropertyDefinitionId(
  property: Property | PropertyDefinitionDomain
): string {
  return isInstantiatedProperty(property)
    ? property.propertyDefinitionId
    : property.id;
}

async function prepareMutationArgs(
  input: GraphqlEntityPropertyMutationInput
): Promise<SetEntityPropertyArgs> {
  if (input.kind === 'add') {
    return {
      entityType: toGraphqlPropertyTargetEntityType(input.entityType),
      entityId: input.entityId,
      propertyDefinitionId: input.propertyDefinitionId,
      value: null,
    };
  }

  const optimisticProperty = buildOptimisticSetEntityProperty(
    input.property,
    input.apiValues
  );
  let optimisticCache;

  if (isInstantiatedProperty(input.property)) {
    const host = getGraphqlCacheHost();
    if (host) {
      try {
        const oldGroupKeys = groupedPropertyKeys(input.property);
        const newGroupKeys = groupedPropertyKeys(input.apiValues);
        optimisticCache = await buildOptimisticGroupedPropertyUpdates({
          host,
          entityId: input.entityId,
          propertyDefinitionId: input.property.propertyDefinitionId,
          oldGroupKeys: oldGroupKeys ?? [],
          newGroupKeys: newGroupKeys ?? [],
          revalidateOnly:
            oldGroupKeys === undefined || newGroupKeys === undefined,
        });
      } catch (error) {
        // Relation discovery is an optimization. The normalized property write
        // remains valid when cache inspection is unavailable.
        console.warn('Failed to build grouped Soup optimism', error);
      }
    }
  }

  return {
    entityType: toGraphqlPropertyTargetEntityType(input.entityType),
    entityId: input.entityId,
    propertyDefinitionId: getPropertyDefinitionId(input.property),
    value: propertyValueToApi(input.apiValues, input.property.isMultiSelect),
    optimisticProperty,
    optimisticCache,
  };
}

function mutationDisposition(
  result: OperationResult<
    SetEntityPropertyMutation,
    SetEntityPropertyMutationVariables
  >
): EntityPropertyMutationDisposition {
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

const ENTITY_PROPERTY_OPTIMISTIC_UUID_NAMESPACE =
  '1697e6bc-0d9a-4dd2-bc3f-bd33bcb6f607';

/** Stable coalescing UUID for one absolute entity-property value slot. */
export function entityPropertyOptimisticMutationUuid(args: {
  entityType: GraphqlPropertyTargetEntityType;
  entityId: string;
  propertyDefinitionId: string;
}): string {
  return uuidv5(
    JSON.stringify([
      'setEntityProperty',
      args.entityType,
      args.entityId,
      args.propertyDefinitionId,
    ]),
    ENTITY_PROPERTY_OPTIMISTIC_UUID_NAMESPACE
  );
}

const executeGraphqlEntityPropertyMutation: UrqlMutationExecutor<
  SetEntityPropertyMutation,
  SetEntityPropertyMutationVariables,
  GraphqlEntityPropertyMutationInput
> = async ({ client, mutation, input, context }) => {
  const args = await prepareMutationArgs(input);
  const variables: SetEntityPropertyMutationVariables = {
    input: {
      entityType: args.entityType,
      entityId: args.entityId,
      propertyDefinitionId: args.propertyDefinitionId,
      value: toGraphqlSetPropertyValue(args.value),
    },
  };

  const mutationResult = await (args.optimisticProperty
    ? executeOptimisticMutation(
        client,
        mutation,
        variables,
        { setEntityProperty: args.optimisticProperty },
        {
          ...args.optimisticCache,
          uuid: entityPropertyOptimisticMutationUuid(args),
        }
      ).toPromise()
    : client.mutation(mutation, variables, context).toPromise());
  const disposition = mutationDisposition(mutationResult);
  if (
    disposition.kind === 'queued' &&
    mutationResult.data == null &&
    args.optimisticProperty
  ) {
    return {
      ...mutationResult,
      data: { setEntityProperty: args.optimisticProperty },
      error: undefined,
    };
  }
  if (disposition.kind !== 'permanently-failed' || mutationResult.error) {
    return mutationResult;
  }
  return {
    ...mutationResult,
    error:
      disposition.error instanceof CombinedError
        ? disposition.error
        : new CombinedError({ networkError: disposition.error }),
  };
};

export type AddEntityPropertyInput = {
  entityType: EntityType | PropertyTargetEntityType;
  entityId: string;
  propertyDefinitionId: string;
};

type GraphqlAddMutationOptions<Context> = {
  onMutate?: (input: AddEntityPropertyInput) => Context | Promise<Context>;
  onSuccess?: (
    input: AddEntityPropertyInput,
    context: Context | undefined
  ) => void | Promise<void>;
  onError?: (
    error: Error,
    input: AddEntityPropertyInput,
    context: Context | undefined
  ) => void | Promise<void>;
  onSettled?: (
    error: Error | null,
    input: AddEntityPropertyInput,
    context: Context | undefined
  ) => void | Promise<void>;
};

/** Creates the callback-driven urql mutation for property attachments. */
export function createGraphqlAddEntityPropertyMutation<Context = void>(
  options: GraphqlAddMutationOptions<Context> = {}
) {
  return createUrqlMutation<
    SetEntityPropertyMutation,
    SetEntityPropertyMutationVariables,
    AddEntityPropertyInput,
    Context
  >(() => ({
    mutation: SetEntityPropertyDocument,
    client: getGraphqlSoupClient(),
    execute: ({ client, mutation, input, context }) =>
      executeGraphqlEntityPropertyMutation({
        client,
        mutation,
        input: { kind: 'add', ...input },
        context,
      }),
    onMutate: options.onMutate,
    onSuccess: (_data, input, context) => options.onSuccess?.(input, context),
    onError: (error, input, context) =>
      options.onError?.(error, input, context),
    onSettled: (_data, error, input, context) =>
      options.onSettled?.(error, input, context),
  }));
}

export type BulkSaveEntityPropertiesInput = {
  properties: Array<{
    entityType: EntityType | PropertyTargetEntityType;
    entityId: string;
    property: Property | PropertyDefinitionDomain;
    apiValues: PropertyApiValues;
  }>;
};

type GraphqlBulkMutationOptions<Context> = {
  onMutate?: (
    input: BulkSaveEntityPropertiesInput
  ) => Context | Promise<Context>;
  onCommitted?: (
    item: BulkSaveEntityPropertiesInput['properties'][number],
    disposition: Extract<
      EntityPropertyMutationDisposition,
      { kind: 'committed' }
    >
  ) => void | Promise<void>;
  onSuccess?: (
    input: BulkSaveEntityPropertiesInput,
    context: Context | undefined
  ) => void | Promise<void>;
  onError?: (
    error: Error,
    input: BulkSaveEntityPropertiesInput,
    context: Context | undefined
  ) => void | Promise<void>;
  onSettled?: (
    error: Error | null,
    input: BulkSaveEntityPropertiesInput,
    context: Context | undefined
  ) => void | Promise<void>;
};

/** Creates one callback-driven urql mutation for a bulk property save. */
export function createGraphqlBulkSaveEntityPropertiesMutation<Context = void>(
  options: GraphqlBulkMutationOptions<Context> = {}
) {
  return createUrqlMutation<
    SetEntityPropertyMutation,
    SetEntityPropertyMutationVariables,
    BulkSaveEntityPropertiesInput,
    Context
  >(() => ({
    mutation: SetEntityPropertyDocument,
    client: getGraphqlSoupClient(),
    execute: async ({ client, mutation, input, context }) => {
      let latestResult:
        | OperationResult<
            SetEntityPropertyMutation,
            SetEntityPropertyMutationVariables
          >
        | undefined;
      let permanentError: Error | undefined;

      // Begin each durable layer sequentially so later relation recipes see
      // the effective result of earlier property edits.
      for (const item of input.properties) {
        latestResult = await executeGraphqlEntityPropertyMutation({
          client,
          mutation,
          input: { kind: 'save', ...item },
          context,
        });
        const disposition = mutationDisposition(latestResult);
        if (disposition.kind === 'committed') {
          await options.onCommitted?.(item, disposition);
        } else if (disposition.kind === 'permanently-failed') {
          permanentError ??= disposition.error;
        }
      }

      if (!latestResult) {
        throw new Error(
          'bulk property mutation requires at least one property'
        );
      }
      if (!permanentError) return latestResult;

      return {
        ...latestResult,
        error:
          permanentError instanceof CombinedError
            ? permanentError
            : new CombinedError({ networkError: permanentError }),
      };
    },
    onMutate: options.onMutate,
    onSuccess: (_data, input, context) => options.onSuccess?.(input, context),
    onError: (error, input, context) =>
      options.onError?.(error, input, context),
    onSettled: (_data, error, input, context) =>
      options.onSettled?.(error, input, context),
  }));
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
