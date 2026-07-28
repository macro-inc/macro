import { analytics } from '@app/lib/analytics';
import { toast } from '@core/component/Toast/Toast';
import { ENABLE_GRAPHQL_SOUP } from '@core/constant/featureFlags';
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
import { useMutation, useMutationState, useQuery } from '@tanstack/solid-query';
import { type Accessor, batch } from 'solid-js';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import type { PropertyTargetEntityType } from '../../service-clients/service-properties/generated/schemas/propertyTargetEntityType';
import type { SoupProperty } from '../../service-clients/service-storage/generated/schemas/soupProperty';
import type { SoupPropertyValue } from '../../service-clients/service-storage/generated/schemas/soupPropertyValue';
import {
  type SetEntityPropertyDisposition,
  setEntityProperty,
} from '../../service-clients/service-storage/graphql-properties';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '../../service-clients/service-storage/graphql-soup';
import { queryClient } from '../client';
import {
  getSoupEntityById,
  invalidateSoupEntity,
  optimisticUpdateSoupEntity,
  type SoupTransaction,
} from '../soup/cache';
import {
  buildOptimisticGroupedPropertyUpdates,
  groupedPropertyKeys,
} from '../soup/grouped/graphql-optimistic';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { buildOptimisticSetEntityProperty } from './graphql-optimistic';
import { propertiesKeys } from './keys';

function toPropertyTargetEntityType(
  entityType: EntityType | PropertyTargetEntityType
): PropertyTargetEntityType {
  return entityType === 'TASK' ? 'DOCUMENT' : entityType;
}

export function useEntityPropertiesQuery(
  entityType: Accessor<EntityType>,
  entityId: Accessor<string>,
  includeMetadata: boolean
) {
  return useQuery(
    () => {
      const type = entityType();
      const id = entityId();
      return {
        queryKey: propertiesKeys.entity({
          entityType: type,
          entityId: id,
        }).queryKey,
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
  // channel / foreign entity / channel thread rows are property-less; call
  // records carry properties (tags) and are handled like documents.
  if (
    !current ||
    current.tag === 'channel' ||
    current.tag === 'foreignEntity' ||
    current.tag === 'channelThread' ||
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
        onError(error) {
          console.error('Failed to delete property', error);
          toast.failure('Failed to delete property');
        },
        onSettled: (_data, _error, variables) => {
          invalidatePropertiesForEntity(
            variables.entityType,
            variables.entityId
          );
        },
      },
      callbacks
    ),
  }));
}

type AddEntityPropertyParams = {
  entityId: string;
  entityType: EntityType | PropertyTargetEntityType;
  propertyDefinitionId: string;
};

/** Adds property without initial value - user sets it later */
export function useAddEntityPropertyMutation(
  callbacks?: MutationCallbacks<void, Error, AddEntityPropertyParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: AddEntityPropertyParams) => {
      // New attachments have no assignment id until the server responds, so
      // this write is never optimistic.
      try {
        const disposition = await setEntityProperty({
          entityType: toPropertyTargetEntityType(vars.entityType),
          entityId: vars.entityId,
          propertyDefinitionId: vars.propertyDefinitionId,
          value: null,
        });
        if (disposition.kind === 'permanently-failed') {
          throw disposition.error;
        }
      } catch (error) {
        if (ENABLE_GRAPHQL_SOUP()) {
          console.error('Failed to add property', error);
          toast.failure('Failed to add property');
        }
        throw error;
      }
    },
    ...withCallbacks<void, Error, AddEntityPropertyParams>(
      {
        onError(error) {
          if (ENABLE_GRAPHQL_SOUP()) return;
          console.error('Failed to add property', error);
          toast.failure('Failed to add property');
        },
        onSettled: (_data, _error, variables) => {
          if (ENABLE_GRAPHQL_SOUP()) return;
          invalidatePropertiesForEntity(
            variables.entityType,
            variables.entityId
          );
        },
      },
      callbacks
    ),
  }));
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
      onError: (error, _vars, context) => {
        context?.soupTxn?.rollback();
        console.error(failureMessage, error);
        toast.failure(failureMessage);
      },
      onSettled: (_data, _error, variables) => {
        invalidatePropertiesForEntity(variables.entityType, variables.entityId);
        invalidateSoupEntity(variables.entityId);
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

type EntityPropertyOptionDelta = {
  type: 'add' | 'remove';
  optionId: string;
};

function getEntityPropertyOptionDeltas(
  currentOptionIds: string[],
  nextOptionIds: string[]
): EntityPropertyOptionDelta[] {
  const current = new Set(currentOptionIds);
  const next = new Set(nextOptionIds);
  return [
    ...currentOptionIds
      .filter((optionId) => !next.has(optionId))
      .map((optionId) => ({ type: 'remove' as const, optionId })),
    ...nextOptionIds
      .filter((optionId) => !current.has(optionId))
      .map((optionId) => ({ type: 'add' as const, optionId })),
  ];
}

type BulkUpdateEntityPropertyOptionsParams = {
  entityId: string;
  entityType: EntityType;
  properties: Array<{
    property: Property | PropertyDefinitionDomain;
    currentOptionIds: string[];
    nextOptionIds: string[];
  }>;
};

/** A property's reconciled final option ids after a bulk update. */
export type EntityPropertyOptionSelection = {
  propertyDefinitionId: string;
  optionIds: string[];
};

type BulkUpdateEntityPropertyOptionsContext = {
  soupTxn?: SoupTransaction;
};

/**
 * Mutation-cache key for an entity's bulk option updates. Used both as the
 * mutation's serialization scope and to read its in-flight variables for
 * optimistic display.
 */
function bulkEntityPropertyOptionsKey(entityId: string) {
  return ['bulkEntityPropertyOptions', entityId] as const;
}

/**
 * Optimistic overlay for a query-backed tag source: the option ids an in-flight
 * bulk update is applying to a property, so a query-backed view reflects the
 * change before its refetch lands. Returns `undefined` when nothing is in
 * flight for the property, so callers fall back to the persisted value. On
 * settle the mutation leaves `pending` and the overlay disappears — no manual
 * rollback. Soup-backed sources don't need this: their optimism rides the
 * soup-cache update in the mutation lifecycle below.
 */
export function useInFlightEntityPropertyOptions(entityId: string) {
  const inFlight = useMutationState(() => ({
    filters: {
      mutationKey: bulkEntityPropertyOptionsKey(entityId),
      status: 'pending' as const,
    },
    select: (mutation) =>
      mutation.state.variables as
        | BulkUpdateEntityPropertyOptionsParams
        | undefined,
  }));

  return (propertyDefinitionId: string): string[] | undefined => {
    const pending = inFlight();
    // Latest in-flight update targeting this property wins.
    for (let index = pending.length - 1; index >= 0; index--) {
      const match = pending[index]?.properties.find(
        (update) =>
          getPropertyDefinitionId(update.property) === propertyDefinitionId
      );
      if (match) return match.nextOptionIds;
    }
    return undefined;
  };
}

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
                add_option_ids: deltas
                  .filter((delta) => delta.type === 'add')
                  .map((delta) => delta.optionId),
                remove_option_ids: deltas
                  .filter((delta) => delta.type === 'remove')
                  .map((delta) => delta.optionId),
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
        },
        onError: (error, _variables, context) => {
          context?.soupTxn?.rollback();
          console.error('Failed to update tags', error);
          toast.failure(
            thrownResultErrorHasCode(error, 'FORBIDDEN')
              ? 'Edit permissions are required to update tags'
              : 'Failed to update tags'
          );
        },
        onSettled: (_data, _error, variables) => {
          invalidateSoupEntity(variables.entityId);
          // Returned so the mutation stays `pending` until the refetch lands,
          // keeping the in-flight optimistic overlay visible through the
          // reconcile with no flash back to the stale value.
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

type BulkSaveEntityPropertiesParams = {
  properties: Array<{
    entityId: string;
    entityType: EntityType | PropertyTargetEntityType;
    property: Property | PropertyDefinitionDomain;
    apiValues: PropertyApiValues;
  }>;
};

type BulkSaveEntityPropertiesContext = {
  usesGraphqlSoup: boolean;
  /** Index-aligned with `variables.properties`; empty on the GraphQL path. */
  soupTxns: Array<SoupTransaction | undefined>;
};

type BulkSaveEntityPropertiesResult = {
  /** Index-aligned with the submitted properties. */
  dispositions: SetEntityPropertyDisposition[];
};

class BulkSaveEntityPropertiesError extends Error {
  constructor(readonly result: BulkSaveEntityPropertiesResult) {
    super('One or more properties permanently failed to save');
    this.name = 'BulkSaveEntityPropertiesError';
  }
}

type QueuedPropertySave = BulkSaveEntityPropertiesParams['properties'][number];
const queuedPropertySaves = new Map<string, QueuedPropertySave>();
let settlementHost:
  | NonNullable<ReturnType<typeof getGraphqlCacheHost>>
  | undefined;
let unsubscribeSettlements: (() => void) | undefined;

function ensurePropertySettlementListener(): void {
  const host = getGraphqlCacheHost();
  if (!host || host === settlementHost) return;

  unsubscribeSettlements?.();
  settlementHost = host;
  unsubscribeSettlements = host.onMutationSettled((settlement) => {
    const item = queuedPropertySaves.get(settlement.transactionId);
    if (!item) return;
    queuedPropertySaves.delete(settlement.transactionId);

    if (settlement.status === 'committed') {
      trackTaskPropertySave(
        item.entityId,
        getPropertyDefinitionId(item.property),
        item.apiValues
      );
      return;
    }

    const error = new Error(settlement.error);
    console.error('Queued property save permanently failed', error);
    toast.failure('Failed to save properties');
  });
}

function handleAcceptedPropertySaves(
  variables: BulkSaveEntityPropertiesParams,
  result: BulkSaveEntityPropertiesResult
): void {
  for (const [index, disposition] of result.dispositions.entries()) {
    const item = variables.properties[index];
    if (!item) continue;
    if (disposition.kind === 'committed') {
      trackTaskPropertySave(
        item.entityId,
        getPropertyDefinitionId(item.property),
        item.apiValues
      );
    } else if (disposition.kind === 'queued') {
      queuedPropertySaves.set(disposition.transactionId, item);
      ensurePropertySettlementListener();
    }
  }
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

/** Saves multiple entity properties, durably queueing GraphQL writes. */
export function useBulkSaveEntityPropertiesMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    BulkSaveEntityPropertiesParams,
    BulkSaveEntityPropertiesContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: BulkSaveEntityPropertiesParams): Promise<void> => {
      const usesGraphqlSoup = ENABLE_GRAPHQL_SOUP();
      const save = async (
        item: BulkSaveEntityPropertiesParams['properties'][number]
      ) => {
        const propertyValue = propertyValueToApi(
          item.apiValues,
          item.property.isMultiSelect
        );
        const optimisticProperty = buildOptimisticSetEntityProperty(
          item.property,
          item.apiValues
        );
        let optimisticCache;

        if (usesGraphqlSoup && isInstantiatedProperty(item.property)) {
          // Client construction owns host selection; force it before asking
          // for the host used by inspect-driven relation discovery.
          getGraphqlSoupClient();
          const host = getGraphqlCacheHost();
          if (host) {
            try {
              const oldGroupKeys = groupedPropertyKeys(item.property);
              const newGroupKeys = groupedPropertyKeys(item.apiValues);
              optimisticCache = await buildOptimisticGroupedPropertyUpdates({
                host,
                entityId: item.entityId,
                entityType: item.entityType,
                propertyDefinitionId: item.property.propertyDefinitionId,
                oldGroupKeys: oldGroupKeys ?? [],
                newGroupKeys: newGroupKeys ?? [],
                revalidateOnly:
                  oldGroupKeys === undefined || newGroupKeys === undefined,
              });
            } catch (error) {
              // Relation discovery is an optimization. Property writes still
              // proceed with normalized entity optimism when cache inspection
              // is unavailable.
              console.warn('Failed to build grouped Soup optimism', error);
            }
          }
        }

        return await setEntityProperty({
          entityType: toPropertyTargetEntityType(item.entityType),
          entityId: item.entityId,
          propertyDefinitionId: getPropertyDefinitionId(item.property),
          value: propertyValue,
          optimisticProperty,
          optimisticCache,
        });
      };

      try {
        let dispositions: SetEntityPropertyDisposition[];
        if (usesGraphqlSoup) {
          // Begin each durable layer sequentially so later relation recipes see
          // the effective result of earlier property edits.
          dispositions = [];
          for (const item of vars.properties) {
            dispositions.push(await save(item));
          }
        } else {
          dispositions = await Promise.all(vars.properties.map(save));
        }

        const result = { dispositions };
        handleAcceptedPropertySaves(vars, result);
        if (
          dispositions.some(
            (disposition) => disposition.kind === 'permanently-failed'
          )
        ) {
          const error = new BulkSaveEntityPropertiesError(result);
          if (usesGraphqlSoup) reportBulkPropertySaveFailure(error);
          throw error;
        }
      } catch (error) {
        if (
          usesGraphqlSoup &&
          !(error instanceof BulkSaveEntityPropertiesError)
        ) {
          reportBulkPropertySaveFailure(
            error instanceof Error ? error : new Error(String(error))
          );
        }
        throw error;
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
        ): BulkSaveEntityPropertiesContext => {
          const usesGraphqlSoup = ENABLE_GRAPHQL_SOUP();
          return {
            usesGraphqlSoup,
            soupTxns: usesGraphqlSoup
              ? []
              : batch(() =>
                  vars.properties.map((item) =>
                    optimisticUpdateSoupEntityProperty(
                      item.entityId,
                      item.property,
                      apiValuesToSoupPropertyValue(item.apiValues)
                    )
                  )
                ),
          };
        },
        onError(
          error: Error,
          _variables: BulkSaveEntityPropertiesParams,
          context: BulkSaveEntityPropertiesContext | undefined
        ) {
          if (context?.usesGraphqlSoup) return;
          rollbackBulkSoupTransactions(context);
          reportBulkPropertySaveFailure(error);
        },
        onSettled: (_data, _error, variables, context) => {
          if (context?.usesGraphqlSoup) return;
          batch(() => {
            for (const p of variables.properties) {
              invalidatePropertiesForEntity(p.entityType, p.entityId);
              invalidateSoupEntity(p.entityId);
            }
          });
        },
      },
      callbacks
    ),
  }));
}
