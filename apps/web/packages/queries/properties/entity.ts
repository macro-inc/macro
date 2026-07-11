import { analytics } from '@app/lib/analytics';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
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
import { useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, batch } from 'solid-js';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
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
import { propertiesKeys } from './keys';

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
          includeMetadata,
        }).queryKey,
        queryFn: async () => {
          const data = await throwOnErr(
            async () =>
              await propertiesServiceClient.getEntityProperties({
                entity_type: type,
                entity_id: id,
                query: { include_metadata: includeMetadata },
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
        staleTime: 0,
      };
    },
    () => queryClient
  );
}

function invalidatePropertiesForEntity(
  entityType: EntityType,
  entityId: string
) {
  queryClient.invalidateQueries({
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

function optimisticUpdateSoupEntityProperty(
  entityId: string,
  property: Property | PropertyDefinitionDomain,
  value: SoupPropertyValue
): SoupTransaction | undefined {
  const current = getSoupEntityById(entityId);
  // channel / call / foreign entities are property-less.
  if (
    !current ||
    current.tag === 'channel' ||
    current.tag === 'call' ||
    current.tag === 'foreignEntity' ||
    current.tag === 'channelThread' ||
    !current.data.properties
  ) {
    return undefined;
  }

  const propertyDefinitionId = getPropertyDefinitionId(property);
  const existing = current.data.properties;
  const existingProp = existing.find(
    (prop) => prop.definition.id === propertyDefinitionId
  );

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

  const nextProperties = existing.map((prop) =>
    prop.definition.id === nextProp.definition.id ? nextProp : prop
  );

  if (
    nextProperties.every(
      (prop) => prop.definition.id !== nextProp.definition.id
    )
  ) {
    nextProperties.push(nextProp);
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

function buildSoupProperty(
  property: Property | PropertyDefinitionDomain,
  value: SoupPropertyValue
): SoupProperty {
  const now = new Date().toISOString();
  const instantiated = isInstantiatedProperty(property);
  return {
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
  entityType: EntityType;
  propertyDefinitionId: string;
};

/** Adds property without initial value - user sets it later */
export function useAddEntityPropertyMutation(
  callbacks?: MutationCallbacks<void, Error, AddEntityPropertyParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: AddEntityPropertyParams) => {
      await throwOnErr(
        async () =>
          await propertiesServiceClient.setEntityProperty({
            entity_type: vars.entityType,
            entity_id: vars.entityId,
            property_id: vars.propertyDefinitionId,
            body: {
              value: null,
            },
          })
      );
    },
    ...withCallbacks<void, Error, AddEntityPropertyParams>(
      {
        onError(error) {
          console.error('Failed to add property', error);
          toast.failure('Failed to add property');
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

type EntityPropertyOptionParams = {
  entityId: string;
  entityType: EntityType;
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
            entity_type: vars.entityType,
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
            entity_type: vars.entityType,
            entity_id: vars.entityId,
            property_id: getPropertyDefinitionId(vars.property),
            option_id: vars.optionId,
          })
      );
    },
    ...entityPropertyOptionCallbacks('Failed to remove tag', callbacks),
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
    entityType: EntityType;
    property: Property | PropertyDefinitionDomain;
    apiValues: PropertyApiValues;
  }>;
};

type BulkSaveEntityPropertiesContext = {
  soupTxns: SoupTransaction[];
};

/** Saves multiple entity properties in bulk using parallel requests */
export function useBulkSaveEntityPropertiesMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    BulkSaveEntityPropertiesParams,
    BulkSaveEntityPropertiesContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: BulkSaveEntityPropertiesParams) => {
      await Promise.all(
        vars.properties.map((item) => {
          const propertyValue = propertyValueToApi(
            item.apiValues,
            item.property.isMultiSelect
          );

          return throwOnErr(
            async () =>
              await propertiesServiceClient.setEntityProperty({
                entity_type: item.entityType,
                entity_id: item.entityId,
                property_id: getPropertyDefinitionId(item.property),
                body: {
                  value: propertyValue,
                },
              })
          );
        })
      );
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
          const soupTxns = batch<SoupTransaction[]>(() => {
            const txns: SoupTransaction[] = [];
            for (const item of vars.properties) {
              const txn = optimisticUpdateSoupEntityProperty(
                item.entityId,
                item.property,
                apiValuesToSoupPropertyValue(item.apiValues)
              );
              if (txn) txns.push(txn);
            }
            return txns;
          });
          return { soupTxns };
        },
        onError(
          error: Error,
          _vars: BulkSaveEntityPropertiesParams,
          context: BulkSaveEntityPropertiesContext | undefined
        ) {
          // Reverse order: later transactions snapshotted state that already
          // included earlier updates, so they must unwind first.
          if (context?.soupTxns.length) {
            batch(() => {
              for (let i = context.soupTxns.length - 1; i >= 0; i--) {
                context.soupTxns[i].rollback();
              }
            });
          }
          console.error('Failed to bulk save properties', error);
          toast.failure('Failed to save properties');
        },
        onSettled: (_data, error, variables) => {
          if (error) {
            console.error('Failed bulk save properties', variables, error);
            toast.failure('Failed to save properties');
          }
          batch(() => {
            for (const p of variables.properties) {
              invalidatePropertiesForEntity(p.entityType, p.entityId);
              invalidateSoupEntity(p.entityId);
            }
          });
          if (!error) {
            for (const p of variables.properties) {
              trackTaskPropertySave(
                p.entityId,
                getPropertyDefinitionId(p.property),
                p.apiValues
              );
            }
          }
        },
      },
      callbacks
    ),
  }));
}
