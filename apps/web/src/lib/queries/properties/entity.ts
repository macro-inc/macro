import { analytics } from '@app/lib/analytics';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import {
  entityPropertyFromApi,
  propertyValueToApi,
} from '@property/api/converters';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { isInstantiatedProperty } from '@property/utils';
import { ownTouchStamp } from '@queries/soup/normalized-cache/own-touch';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, batch } from 'solid-js';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import type { PropertyTargetEntityType } from '../../service-clients/service-properties/generated/schemas/propertyTargetEntityType';
import type { SoupProperty } from '../../service-clients/service-storage/generated/schemas/soupProperty';
import type { SoupPropertyValue } from '../../service-clients/service-storage/generated/schemas/soupPropertyValue';
import { queryClient } from '../client';
import {
  getSoupEntityById,
  invalidateSoupEntity,
  optimisticUpdateSoupEntity,
  type SoupTransaction,
} from '../soup/cache';
import { type MutationCallbacks, withCallbacks } from '../utils';
import {
  type AddEntityPropertyInput,
  type BulkSaveEntityPropertiesInput,
  createGraphqlAddEntityPropertyMutation,
  createGraphqlBulkSaveEntityPropertiesMutation,
  createGraphqlEntityPropertiesQuery,
  type EntityPropertyMutationDisposition,
} from './graphql/entity';
import { updateGraphqlEntityPropertyOptions } from './graphql/entity-options';
import {
  type BulkUpdateEntityPropertyOptionsParams,
  bulkEntityPropertyOptionsKey,
} from './in-flight-options';
import { propertiesKeys } from './keys';
import {
  type EntityPropertyOptionSelection,
  getEntityPropertyOptionDeltas,
} from './option-deltas';

function toPropertyTargetEntityType(
  entityType: EntityType | PropertyTargetEntityType
): PropertyTargetEntityType {
  if (entityType === 'TASK') return 'DOCUMENT';
  if (entityType === 'CALENDAR_EVENT') {
    // Not a property target yet; surface a real error instead of a bad request.
    throw new Error('calendar events do not support properties');
  }
  return entityType;
}

async function setRestEntityProperty(args: {
  entityType: EntityType | PropertyTargetEntityType;
  entityId: string;
  propertyDefinitionId: string;
  value: ReturnType<typeof propertyValueToApi>;
}): Promise<EntityPropertyMutationDisposition> {
  try {
    await throwOnErr(
      async () =>
        await propertiesServiceClient.setEntityProperty({
          entity_type: toPropertyTargetEntityType(args.entityType),
          entity_id: args.entityId,
          property_id: args.propertyDefinitionId,
          body: { value: args.value },
        })
    );
    return { kind: 'committed' };
  } catch (error) {
    return {
      kind: 'permanently-failed',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function useEntityPropertiesQuery(
  entityType: Accessor<EntityType>,
  entityId: Accessor<string>,
  includeMetadata: boolean
) {
  const graphqlSoupFlag = useFeatureFlag(enableGraphqlSoup);

  // Metadata properties are computed by the REST properties endpoint and are
  // not part of the GraphQL Soup property edge. USER is not represented in
  // Soup either. The GraphQL adapter owns those eligibility details.
  const graphqlQuery = createGraphqlEntityPropertiesQuery({
    entityType,
    entityId,
    enabled: () => graphqlSoupFlag().enabled && !includeMetadata,
  });

  const usesGraphql = graphqlQuery.isEnabled;

  const restQuery = useQuery(
    () => {
      const type = entityType();
      const id = entityId();
      return {
        queryKey: propertiesKeys.entity({
          entityType: type,
          entityId: id,
        }).queryKey,
        enabled: !usesGraphql() && id.length > 0,
        queryFn: async () => {
          // Always fetch with metadata so consumers with different
          // `includeMetadata` values share one cache entry and one request.
          const data = await throwOnErr(
            async () =>
              await propertiesServiceClient.getEntityProperties({
                entity_type: toPropertyTargetEntityType(type),
                entity_id: id,
                query: { include_metadata: true },
              })
          );
          return data.properties.flatMap((property) => {
            try {
              return [entityPropertyFromApi(property)];
            } catch (error) {
              console.warn('Skipping property with unsupported type', error);
              return [];
            }
          });
        },
        select: (properties: Property[]) =>
          includeMetadata
            ? properties
            : properties.filter((property) => property.isMetadata !== true),
        staleTime: 0,
      };
    },
    () => queryClient
  );

  return {
    get data() {
      return usesGraphql() ? graphqlQuery.result.data : restQuery.data;
    },
    get error() {
      return usesGraphql() ? graphqlQuery.result.error : restQuery.error;
    },
    get isLoading() {
      return usesGraphql()
        ? graphqlQuery.result.isLoading
        : restQuery.isLoading;
    },
    get isFetching() {
      return usesGraphql()
        ? graphqlQuery.result.isFetching
        : restQuery.isFetching;
    },
    refetch() {
      if (entityId().length === 0) return Promise.resolve(undefined);
      return usesGraphql() ? graphqlQuery.refetch() : restQuery.refetch();
    },
  };
}

function invalidatePropertiesForEntity(
  entityType: EntityType | PropertyTargetEntityType,
  entityId: string
) {
  return queryClient.invalidateQueries({
    queryKey: propertiesKeys.entity({ entityType, entityId }).queryKey,
  });
}

function getPropertyDefinitionId(
  property: Property | PropertyDefinitionDomain
): string {
  return isInstantiatedProperty(property)
    ? property.propertyDefinitionId
    : property.id;
}

function optimisticUpdateSoupEntityProperties(
  entityId: string,
  updates: {
    property: Property | PropertyDefinitionDomain;
    value: SoupPropertyValue;
  }[]
): SoupTransaction | undefined {
  const current = getSoupEntityById(entityId);
  if (!current) {
    // A miss here means the write silently lost its optimism. Expected on the
    // GraphQL transport, whose rows live in the normalized cache instead and
    // carry their own optimistic write.
    if (!isFeatureEnabled(enableGraphqlSoup)) {
      console.warn(
        'no soup cache entry for entity; skipping optimistic property update',
        entityId
      );
    }
    return undefined;
  }
  // channel / foreign entity / channel thread rows are property-less; call
  // records carry properties (tags) and are handled like documents.
  if (
    current.tag === 'channel' ||
    current.tag === 'foreignEntity' ||
    current.tag === 'channelThread' ||
    current.tag === 'calendarEvent' ||
    !current.data.properties
  ) {
    return undefined;
  }

  const nextProperties = [...current.data.properties];
  for (const { property, value } of updates) {
    const propertyDefinitionId = getPropertyDefinitionId(property);
    const index = nextProperties.findIndex(
      (prop) => prop.definition.id === propertyDefinitionId
    );
    const existingProp = nextProperties[index];
    const nextProp: SoupProperty = existingProp
      ? {
          ...existingProp,
          definition: {
            ...existingProp.definition,
            // HACK (seamus): we need to change something other than value in
            // order to get normy to update the cache. Changing
            // definition.updated_at is INCORRECT, but it's currently harmless.
            updated_at: new Date().toISOString(),
          },
          value,
        }
      : buildSoupProperty(property, value);

    if (index === -1) nextProperties.push(nextProp);
    else nextProperties[index] = nextProp;
  }

  return optimisticUpdateSoupEntity({
    tag: current.tag,
    data: {
      ...current.data,
      properties: nextProperties,
    },
    frecency_score: current.frecency_score,
    // A property change is a PropertyChanged activity, i.e. a touch
    // (own-touch.ts).
    touched_at: ownTouchStamp(entityId),
  });
}

function optimisticUpdateSoupEntityProperty(
  entityId: string,
  property: Property | PropertyDefinitionDomain,
  value: SoupPropertyValue
): SoupTransaction | undefined {
  return optimisticUpdateSoupEntityProperties(entityId, [{ property, value }]);
}

function buildSoupProperty(
  property: Property | PropertyDefinitionDomain,
  value: SoupPropertyValue
): SoupProperty {
  const now = new Date().toISOString();
  const instantiated = isInstantiatedProperty(property);
  return {
    id: instantiated ? property.propertyId : property.id,
    definition: {
      id: getPropertyDefinitionId(property),
      display_name: property.displayName,
      data_type: property.valueType,
      is_metadata: instantiated
        ? (property.isMetadata ?? false)
        : property.isMetadata,
      is_multi_select: property.isMultiSelect,
      is_system: instantiated
        ? (property.isSystemProperty ?? false)
        : property.isSystem,
      owner: property.owner,
      specific_entity_type: property.specificEntityType ?? undefined,
      created_at: now,
      updated_at: now,
    },
    value,
  };
}

/**
 * Converts PropertyApiValues to the SoupProperty value format for optimistic updates.
 */
function apiValuesToSoupPropertyValue(
  apiValues: PropertyApiValues
): SoupPropertyValue {
  switch (apiValues.valueType) {
    case 'STRING':
      return apiValues.value != null
        ? { type: 'String', value: apiValues.value }
        : null;
    case 'NUMBER':
      return apiValues.value != null
        ? { type: 'Number', value: apiValues.value }
        : null;
    case 'BOOLEAN':
      return apiValues.value != null
        ? { type: 'Boolean', value: apiValues.value }
        : null;
    case 'DATE':
      return apiValues.value != null
        ? { type: 'Date', value: apiValues.value.toISOString() }
        : null;
    case 'SELECT_STRING':
    case 'SELECT_NUMBER':
      return apiValues.values != null && apiValues.values.length > 0
        ? { type: 'SelectOption', value: apiValues.values }
        : null;
    case 'ENTITY':
      return apiValues.refs != null && apiValues.refs.length > 0
        ? { type: 'EntityReference', value: apiValues.refs }
        : null;
    case 'LINK':
      return apiValues.values != null && apiValues.values.length > 0
        ? { type: 'Link', value: apiValues.values }
        : null;
    default:
      return null;
  }
}

type DeleteEntityPropertyParams = {
  entityPropertyId: string;
  entityType: EntityType;
  entityId: string;
};

export function useDeleteEntityPropertyMutation(
  callbacks?: MutationCallbacks<void, Error, DeleteEntityPropertyParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: DeleteEntityPropertyParams) => {
      await throwOnErr(
        async () =>
          await propertiesServiceClient.deleteEntityProperty({
            entity_property_id: vars.entityPropertyId,
          })
      );
    },
    ...withCallbacks<void, Error, DeleteEntityPropertyParams>(
      {
        onSuccess: (_data, variables) =>
          invalidatePropertiesForEntity(
            variables.entityType,
            variables.entityId
          ),
        onError(error, variables) {
          console.error('Failed to delete property', error);
          toast.failure('Failed to delete property');
          return invalidatePropertiesForEntity(
            variables.entityType,
            variables.entityId
          );
        },
      },
      callbacks
    ),
  }));
}

type AddEntityPropertyParams = AddEntityPropertyInput;

function useRestAddEntityPropertyMutation(
  callbacks?: MutationCallbacks<void, Error, AddEntityPropertyParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: AddEntityPropertyParams) => {
      const disposition = await setRestEntityProperty({
        entityType: vars.entityType,
        entityId: vars.entityId,
        propertyDefinitionId: vars.propertyDefinitionId,
        value: null,
      });
      if (disposition.kind === 'permanently-failed') {
        throw disposition.error;
      }
    },
    ...withCallbacks<void, Error, AddEntityPropertyParams>(
      {
        onSuccess: (_data, variables) =>
          invalidatePropertiesForEntity(
            variables.entityType,
            variables.entityId
          ),
        onError(error, variables) {
          console.error('Failed to add property', error);
          toast.failure('Failed to add property');
          return invalidatePropertiesForEntity(
            variables.entityType,
            variables.entityId
          );
        },
      },
      callbacks
    ),
  }));
}

/** Transport-neutral mutation interface for property attachments. */
export type AddEntityPropertyMutation = {
  readonly isPending: boolean;
  readonly error: Error | null;
  mutate(variables: AddEntityPropertyParams): void;
  mutateAsync(variables: AddEntityPropertyParams): Promise<void>;
};

/** Adds a property through GraphQL or the REST fallback. */
export function useAddEntityPropertyMutation(
  callbacks?: MutationCallbacks<void, Error, AddEntityPropertyParams>
): AddEntityPropertyMutation {
  const restMutation = useRestAddEntityPropertyMutation(callbacks);
  const graphqlMutation = createGraphqlAddEntityPropertyMutation<unknown>({
    onMutate: (variables) =>
      callbacks?.onMutate?.(variables, undefined as never),
    onSuccess: async (variables, context) => {
      await invalidatePropertiesForEntity(
        variables.entityType,
        variables.entityId
      );
      await callbacks?.onSuccess?.(
        undefined,
        variables,
        context,
        undefined as never
      );
    },
    onError: async (error, variables, context) => {
      console.error('Failed to add property', error);
      toast.failure('Failed to add property');
      await invalidatePropertiesForEntity(
        variables.entityType,
        variables.entityId
      );
      await callbacks?.onError?.(error, variables, context, undefined as never);
    },
    onSettled: async (error, variables, context) => {
      await callbacks?.onSettled?.(
        undefined,
        error,
        variables,
        context,
        undefined as never
      );
    },
  });

  return {
    get isPending() {
      return isFeatureEnabled(enableGraphqlSoup)
        ? graphqlMutation.isPending
        : restMutation.isPending;
    },
    get error() {
      return isFeatureEnabled(enableGraphqlSoup)
        ? graphqlMutation.error
        : (restMutation.error ?? null);
    },
    mutate(variables) {
      if (isFeatureEnabled(enableGraphqlSoup)) {
        graphqlMutation.mutate(variables);
      } else {
        restMutation.mutate(variables);
      }
    },
    async mutateAsync(variables) {
      if (isFeatureEnabled(enableGraphqlSoup)) {
        const result = await graphqlMutation.mutateAsync(variables);
        if (result.error) throw result.error;
      } else {
        await restMutation.mutateAsync(variables);
      }
    },
  };
}

type EntityPropertyOptionParams = {
  entityId: string;
  entityType: EntityType | PropertyTargetEntityType;
  property: Property | PropertyDefinitionDomain;
  optionId: string;
  /**
   * Full option-id array to show optimistically (current value ± optionId). The
   * server applies the single-option delta atomically under a row lock; this
   * array only drives the local cache so the UI updates instantly.
   */
  optimisticOptionIds: string[];
};

type EntityPropertyOptionContext = {
  soupTxn?: SoupTransaction;
};

function entityPropertyOptionCallbacks(
  failureMessage: string,
  callbacks?: MutationCallbacks<
    void,
    Error,
    EntityPropertyOptionParams,
    EntityPropertyOptionContext
  >
) {
  return withCallbacks<
    void,
    Error,
    EntityPropertyOptionParams,
    EntityPropertyOptionContext
  >(
    {
      onMutate: (vars): EntityPropertyOptionContext => {
        const value: SoupPropertyValue =
          vars.optimisticOptionIds.length > 0
            ? { type: 'SelectOption', value: vars.optimisticOptionIds }
            : null;
        const soupTxn = optimisticUpdateSoupEntityProperty(
          vars.entityId,
          vars.property,
          value
        );
        return { soupTxn };
      },
      onSuccess: (_data, variables) => {
        invalidateSoupEntity(variables.entityId);
        return invalidatePropertiesForEntity(
          variables.entityType,
          variables.entityId
        );
      },
      onError: (error, variables, context) => {
        context?.soupTxn?.rollback();
        invalidateSoupEntity(variables.entityId);
        console.error(failureMessage, error);
        toast.failure(failureMessage);
        return invalidatePropertiesForEntity(
          variables.entityType,
          variables.entityId
        );
      },
    },
    callbacks
  );
}

/**
 * Adds a single option to a multi-select value via the atomic delta endpoint.
 * Unlike the full-value save, concurrent edits to the same value merge instead
 * of clobbering each other.
 */
export function useAddEntityPropertyOptionMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    EntityPropertyOptionParams,
    EntityPropertyOptionContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: EntityPropertyOptionParams) => {
      await throwOnErr(
        async () =>
          await propertiesServiceClient.addEntityPropertyOption({
            entity_type: toPropertyTargetEntityType(vars.entityType),
            entity_id: vars.entityId,
            property_id: getPropertyDefinitionId(vars.property),
            option_id: vars.optionId,
          })
      );
    },
    ...entityPropertyOptionCallbacks('Failed to add tag', callbacks),
  }));
}

/**
 * Removes a single option from a multi-select value via the atomic delta
 * endpoint. A no-op server-side if the option is already gone.
 */
export function useRemoveEntityPropertyOptionMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    EntityPropertyOptionParams,
    EntityPropertyOptionContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: EntityPropertyOptionParams) => {
      await throwOnErr(
        async () =>
          await propertiesServiceClient.removeEntityPropertyOption({
            entity_type: toPropertyTargetEntityType(vars.entityType),
            entity_id: vars.entityId,
            property_id: getPropertyDefinitionId(vars.property),
            option_id: vars.optionId,
          })
      );
    },
    ...entityPropertyOptionCallbacks('Failed to remove tag', callbacks),
  }));
}

type BulkUpdateEntityPropertyOptionsContext = {
  soupTxn?: SoupTransaction;
};

/**
 * Persists a complete multi-select selection across one or more properties in a
 * single transactional request, then reconciles the soup cache from the final
 * option ids the server returns (which may differ from the optimistic value if a
 * concurrent edit merged in). The optimistic soup update is atomic and rolls
 * back as a whole on failure. Commits for the same entity are serialized via a
 * mutation scope, so concurrent edits can't interleave and corrupt optimistic
 * state.
 */
export function useBulkUpdateEntityPropertyOptionsMutation(
  entityId: string,
  callbacks?: MutationCallbacks<
    EntityPropertyOptionSelection[],
    Error,
    BulkUpdateEntityPropertyOptionsParams,
    BulkUpdateEntityPropertyOptionsContext
  >
) {
  return useMutation(() => ({
    mutationKey: bulkEntityPropertyOptionsKey(entityId),
    scope: { id: `entity-property-options:${entityId}` },
    mutationFn: async (
      variables: BulkUpdateEntityPropertyOptionsParams
    ): Promise<EntityPropertyOptionSelection[]> => {
      // The transport swaps, the mutation shell does not: the per-entity scope
      // that serializes commits and the in-flight overlay both read this
      // mutation's state, whichever cache the selection lands in.
      if (isFeatureEnabled(enableGraphqlSoup)) {
        return updateGraphqlEntityPropertyOptions(variables);
      }
      const response = await throwOnErr(async () =>
        propertiesServiceClient.bulkUpdateEntityPropertyOptions({
          entity_type: toPropertyTargetEntityType(variables.entityType),
          entity_id: variables.entityId,
          body: {
            properties: variables.properties.map((update) => {
              const deltas = getEntityPropertyOptionDeltas(
                update.currentOptionIds,
                update.nextOptionIds
              );
              return {
                property_id: getPropertyDefinitionId(update.property),
                add_option_ids: deltas.addOptionIds,
                remove_option_ids: deltas.removeOptionIds,
              };
            }),
          },
        })
      );
      return response.properties.map((property) => ({
        propertyDefinitionId: property.property_id,
        optionIds: property.option_ids,
      }));
    },
    ...withCallbacks<
      EntityPropertyOptionSelection[],
      Error,
      BulkUpdateEntityPropertyOptionsParams,
      BulkUpdateEntityPropertyOptionsContext
    >(
      {
        onMutate: (variables) => {
          const soupTxn = optimisticUpdateSoupEntityProperties(
            variables.entityId,
            variables.properties.map((update) => ({
              property: update.property,
              value:
                update.nextOptionIds.length > 0
                  ? { type: 'SelectOption', value: update.nextOptionIds }
                  : null,
            }))
          );
          return { soupTxn };
        },
        onSuccess: (selections, variables) => {
          const propertyByDefinitionId = new Map(
            variables.properties.map((update) => [
              getPropertyDefinitionId(update.property),
              update.property,
            ])
          );
          optimisticUpdateSoupEntityProperties(
            variables.entityId,
            selections.flatMap((selection) => {
              const property = propertyByDefinitionId.get(
                selection.propertyDefinitionId
              );
              if (!property) return [];
              return [
                {
                  property,
                  value:
                    selection.optionIds.length > 0
                      ? {
                          type: 'SelectOption' as const,
                          value: selection.optionIds,
                        }
                      : null,
                },
              ];
            })
          );
          invalidateSoupEntity(variables.entityId);
          return invalidatePropertiesForEntity(
            variables.entityType,
            variables.entityId
          );
        },
        onError: (error, variables, context) => {
          context?.soupTxn?.rollback();
          invalidateSoupEntity(variables.entityId);
          console.error('Failed to update tags', error);
          toast.failure(
            thrownResultErrorHasCode(error, 'FORBIDDEN')
              ? 'Edit permissions are required to update tags'
              : 'Failed to update tags'
          );
          return invalidatePropertiesForEntity(
            variables.entityType,
            variables.entityId
          );
        },
      },
      callbacks
    ),
  }));
}

/**
 * Task system property ids → the `property` name reported on `update_entity`.
 * Non-task properties (custom properties, tags, ...) are not tracked here.
 */
const TRACKED_TASK_PROPERTIES: Record<string, string> = {
  [SYSTEM_PROPERTY_IDS.STATUS]: 'status',
  [SYSTEM_PROPERTY_IDS.PRIORITY]: 'priority',
  [SYSTEM_PROPERTY_IDS.ASSIGNEES]: 'assignees',
  [SYSTEM_PROPERTY_IDS.DUE_DATE]: 'due_date',
};

/**
 * Emits a generic `update_entity` event for a saved task system property.
 * Gated on the property being one of the task system properties, so saves on
 * other entities/properties never fire. Call only on save success.
 */
function trackTaskPropertySave(
  entityId: string,
  propertyId: string,
  apiValues: PropertyApiValues
) {
  const property = TRACKED_TASK_PROPERTIES[propertyId];
  if (!property) return;

  const detail: Record<string, unknown> = {};
  if (property === 'status') {
    const newStatus =
      apiValues.valueType === 'SELECT_STRING'
        ? (apiValues.values?.[0] ?? undefined)
        : undefined;
    if (!newStatus) return;
    detail.newStatus = newStatus;
    detail.completed = newStatus === PROPERTY_OPTION_IDS.STATUS.COMPLETED;
  } else if (property === 'priority') {
    detail.newPriority =
      apiValues.valueType === 'SELECT_STRING'
        ? (apiValues.values?.[0] ?? undefined)
        : undefined;
  } else if (property === 'assignees') {
    detail.assigneeCount =
      apiValues.valueType === 'ENTITY' ? (apiValues.refs?.length ?? 0) : 0;
  } else if (property === 'due_date') {
    detail.hasDueDate =
      apiValues.valueType === 'DATE' && apiValues.value != null;
  }

  analytics.track('update_entity', {
    entityType: 'task',
    entityId,
    property,
    source: 'property_editor',
    ...detail,
  });
}

type BulkSaveEntityPropertiesParams = BulkSaveEntityPropertiesInput;

type BulkSaveEntityPropertiesContext = {
  /** Index-aligned with `variables.properties`. */
  soupTxns: Array<SoupTransaction | undefined>;
};

type BulkSaveEntityPropertiesResult = {
  /** Index-aligned with the submitted properties. */
  dispositions: EntityPropertyMutationDisposition[];
};

class BulkSaveEntityPropertiesError extends Error {
  constructor(readonly result: BulkSaveEntityPropertiesResult) {
    super('One or more properties permanently failed to save');
    this.name = 'BulkSaveEntityPropertiesError';
  }
}

function invalidatePropertySaveCaches(
  item: BulkSaveEntityPropertiesParams['properties'][number]
): void {
  void invalidatePropertiesForEntity(item.entityType, item.entityId);
  invalidateSoupEntity(item.entityId);
}

function handleCommittedPropertySave(
  item: BulkSaveEntityPropertiesParams['properties'][number],
  disposition: EntityPropertyMutationDisposition
): void {
  if (disposition.kind !== 'committed') return;

  trackTaskPropertySave(
    item.entityId,
    getPropertyDefinitionId(item.property),
    item.apiValues
  );
}

function reportBulkPropertySaveFailure(error: Error): void {
  console.error('Failed to bulk save properties', error);
  toast.failure('Failed to save properties');
}

function rollbackBulkSoupTransactions(
  context: BulkSaveEntityPropertiesContext | undefined
): void {
  if (!context?.soupTxns.length) return;
  batch(() => {
    for (let i = context.soupTxns.length - 1; i >= 0; i--) {
      context.soupTxns[i]?.rollback();
    }
  });
}

function useRestBulkSaveEntityPropertiesMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    BulkSaveEntityPropertiesParams,
    BulkSaveEntityPropertiesContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: BulkSaveEntityPropertiesParams): Promise<void> => {
      const dispositions = await Promise.all(
        vars.properties.map(async (item) => {
          const disposition = await setRestEntityProperty({
            entityType: item.entityType,
            entityId: item.entityId,
            propertyDefinitionId: getPropertyDefinitionId(item.property),
            value: propertyValueToApi(
              item.apiValues,
              item.property.isMultiSelect
            ),
          });
          handleCommittedPropertySave(item, disposition);
          return disposition;
        })
      );
      const result = { dispositions };
      if (
        dispositions.some(
          (disposition) => disposition.kind === 'permanently-failed'
        )
      ) {
        throw new BulkSaveEntityPropertiesError(result);
      }
    },
    ...withCallbacks<
      void,
      Error,
      BulkSaveEntityPropertiesParams,
      BulkSaveEntityPropertiesContext
    >(
      {
        onMutate: (
          vars: BulkSaveEntityPropertiesParams
        ): BulkSaveEntityPropertiesContext => ({
          soupTxns: batch(() =>
            vars.properties.map((item) =>
              optimisticUpdateSoupEntityProperty(
                item.entityId,
                item.property,
                apiValuesToSoupPropertyValue(item.apiValues)
              )
            )
          ),
        }),
        onError: (error, _variables, context) => {
          rollbackBulkSoupTransactions(context);
          reportBulkPropertySaveFailure(error);
        },
        onSettled: (_data, _error, variables) => {
          batch(() => {
            for (const item of variables.properties) {
              invalidatePropertySaveCaches(item);
            }
          });
        },
      },
      callbacks
    ),
  }));
}

/** Transport-neutral mutation interface exposed to property consumers. */
export type BulkSaveEntityPropertiesMutation = {
  readonly isPending: boolean;
  readonly error: Error | null;
  mutate(variables: BulkSaveEntityPropertiesParams): void;
  mutateAsync(variables: BulkSaveEntityPropertiesParams): Promise<void>;
};

/** Saves entity properties through GraphQL or the REST fallback. */
export function useBulkSaveEntityPropertiesMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    BulkSaveEntityPropertiesParams,
    BulkSaveEntityPropertiesContext
  >
): BulkSaveEntityPropertiesMutation {
  const restMutation = useRestBulkSaveEntityPropertiesMutation(callbacks);
  const graphqlMutation =
    createGraphqlBulkSaveEntityPropertiesMutation<BulkSaveEntityPropertiesContext>(
      {
        onMutate: async (variables) =>
          (await callbacks?.onMutate?.(variables, undefined as never)) ?? {
            soupTxns: [],
          },
        onCommitted: handleCommittedPropertySave,
        onSuccess: async (variables, context) => {
          await callbacks?.onSuccess?.(
            undefined,
            variables,
            context ?? { soupTxns: [] },
            undefined as never
          );
        },
        onError: async (error, variables, context) => {
          reportBulkPropertySaveFailure(error);
          await callbacks?.onError?.(
            error,
            variables,
            context ?? { soupTxns: [] },
            undefined as never
          );
        },
        onSettled: async (error, variables, context) => {
          batch(() => {
            for (const item of variables.properties) {
              invalidatePropertySaveCaches(item);
            }
          });
          await callbacks?.onSettled?.(
            undefined,
            error,
            variables,
            context ?? { soupTxns: [] },
            undefined as never
          );
        },
      }
    );

  return {
    get isPending() {
      return isFeatureEnabled(enableGraphqlSoup)
        ? graphqlMutation.isPending
        : restMutation.isPending;
    },
    get error() {
      return isFeatureEnabled(enableGraphqlSoup)
        ? graphqlMutation.error
        : (restMutation.error ?? null);
    },
    mutate(variables) {
      if (isFeatureEnabled(enableGraphqlSoup)) {
        graphqlMutation.mutate(variables);
      } else {
        restMutation.mutate(variables);
      }
    },
    async mutateAsync(variables) {
      if (isFeatureEnabled(enableGraphqlSoup)) {
        const result = await graphqlMutation.mutateAsync(variables);
        if (result.error) throw result.error;
      } else {
        await restMutation.mutateAsync(variables);
      }
    },
  };
}
