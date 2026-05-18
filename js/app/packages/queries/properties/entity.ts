import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, batch } from 'solid-js';
import {
  entityPropertyFromApi,
  propertyValueToApi,
} from '../../core/component/Properties/api/converters';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '../../core/component/Properties/types';
import { isInstantiatedProperty } from '../../core/component/Properties/utils';
import {
  type PropertiesEntityType,
  propertiesServiceClient,
} from '../../service-clients/service-properties/client';
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
          return data.properties.map(entityPropertyFromApi);
        },
        staleTime: 0,
      };
    },
    () => queryClient
  );
}

export function invalidatePropertiesForEntity(
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
  if (
    !current ||
    current.tag === 'channel' ||
    current.tag === 'call' ||
    !current.data.properties
  ) {
    return undefined;
  }

  const propertyDefinitionId = getPropertyDefinitionId(property);
  const existing = current.data.properties;
  const isAlreadyAttached = existing.some(
    (prop) => prop.definition.id === propertyDefinitionId
  );

  // If the property is already attached, swap its value. Otherwise append a
  // fabricated SoupProperty so the row updates without waiting for the
  // settled-refetch — necessary when editing a previously-unset property
  // that the entity didn't ship with (e.g. via `buildStubProperty`).
  const nextProperties: SoupProperty[] = isAlreadyAttached
    ? existing.map((prop) =>
        prop.definition.id === propertyDefinitionId ? { ...prop, value } : prop
      )
    : [...existing, fabricateSoupProperty(property, value)];

  return optimisticUpdateSoupEntity({
    tag: current.tag,
    data: {
      ...current.data,
      properties: nextProperties,
    },
    frecency_score: current.frecency_score,
  });
}

function fabricateSoupProperty(
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

export type DeleteEntityPropertyParams = {
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

export type AddEntityPropertyParams = {
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

export type SetPropertyStatusCompleteParams = {
  entityType: PropertiesEntityType;
  entityId: string;
};

export type BulkSaveEntityPropertiesParams = {
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
        },
      },
      callbacks
    ),
  }));
}
