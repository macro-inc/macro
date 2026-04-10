import { toast } from '@core/component/Toast/Toast';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import { throwOnErr } from '@core/util/maybeResult';
import { type QueryKey, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  entityPropertyFromApi,
  propertyValueToApi,
} from '../../core/component/Properties/api/converters';
import type {
  Property,
  PropertyApiValues,
} from '../../core/component/Properties/types';
import {
  type PropertiesEntityType,
  propertiesServiceClient,
} from '../../service-clients/service-properties/client';
import { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import type { SoupPropertyValue } from '../../service-clients/service-storage/generated/schemas/soupPropertyValue';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { propertiesKeys } from './keys';
import {
  getSoupEntityById,
  optimisticUpdateSoupEntity,
  invalidateSoupEntity,
  type SoupTransaction,
  refetchSoupEntity,
  type SoupEntityTag,
} from '../soup/cache';
import { match, P } from 'ts-pattern';

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

export type SaveEntityPropertyParams = {
  entityId: string;
  entityType: EntityType;
  property: Property;
  apiValues: PropertyApiValues;
};

type SaveEntityPropertyContext = SoupTransaction | undefined;

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

export function useSaveEntityPropertyMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    SaveEntityPropertyParams,
    SaveEntityPropertyContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: SaveEntityPropertyParams) => {
      const propertyValue = propertyValueToApi(
        vars.apiValues,
        vars.property.isMultiSelect
      );

      await throwOnErr(
        async () =>
          await propertiesServiceClient.setEntityProperty({
            entity_type: vars.entityType,
            entity_id: vars.entityId,
            property_id: vars.property.propertyDefinitionId,
            body: {
              value: propertyValue,
            },
          })
      );
    },
    onMutate: async (
      vars: SaveEntityPropertyParams
    ): Promise<SaveEntityPropertyContext> => {
      const current = getSoupEntityById(vars.entityId);
      if (!current || current.tag === 'channel') return;

      const soupValue = apiValuesToSoupPropertyValue(vars.apiValues);
      if (current.data.properties) {
        return optimisticUpdateSoupEntity({
          tag: current.tag,
          data: {
            ...current.data,
            properties: current.data.properties.map((prop) =>
              prop.definition.id === vars.property.propertyDefinitionId
                ? { ...prop, value: soupValue }
                : prop
            ),
          },
          frecency_score: current.frecency_score,
        });
      }
    },
    onError: (
      error: Error,
      _vars: SaveEntityPropertyParams,
      context: SaveEntityPropertyContext
    ) => {
      context?.rollback();
      console.error('Failed to save property', error);
      toast.failure('Failed to save property');
    },
    onSettled: (_data, _error, variables) => {
      invalidatePropertiesForEntity(variables.entityType, variables.entityId);
      invalidateSoupEntity(variables.entityId);
    },
    ...(callbacks
      ? withCallbacks<
          void,
          Error,
          SaveEntityPropertyParams,
          SaveEntityPropertyContext
        >({}, callbacks)
      : {}),
  }));
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

type SetPropertyStatusCompleteContext = {
  previousEntityProperties: [QueryKey, Property[] | undefined][];
  soupTxn?: SoupTransaction;
};

/**
 * Updates a property array to set the status property to COMPLETED.
 * Works with both Property[] (from properties service) and SoupProperty[] (from DSS).
 */
function updateStatusPropertyToCompleted<
  T extends { propertyDefinitionId?: string; definition?: { id: string } },
>(properties: T[]): T[] {
  return properties.map((prop) => {
    const propDefId =
      'propertyDefinitionId' in prop
        ? prop.propertyDefinitionId
        : prop.definition?.id;

    if (propDefId === SYSTEM_PROPERTY_IDS.STATUS) {
      // Handle Property type (from properties service)
      if ('valueType' in prop && prop.valueType === 'SELECT_STRING') {
        return {
          ...prop,
          value: [PROPERTY_OPTION_IDS.STATUS.COMPLETED],
        };
      }
      // Handle SoupProperty type (from DSS)
      if ('value' in prop) {
        return {
          ...prop,
          value: {
            type: 'SelectOption' as const,
            value: [PROPERTY_OPTION_IDS.STATUS.COMPLETED],
          },
        };
      }
    }
    return prop;
  });
}

function propertyEntityTypeToSoupTag(
  entityType: EntityType
): SoupEntityTag | null {
  return match(entityType)
    .with(EntityType.CHANNEL, () => 'channel' as const)
    .with(EntityType.THREAD, () => 'emailThread' as const)
    .with(EntityType.CHAT, () => 'chat' as const)
    .with(P.union(EntityType.COMPANY, EntityType.USER), () => null)
    .with(
      P.union(EntityType.DOCUMENT, EntityType.TASK),
      () => 'document' as const
    )
    .with(EntityType.PROJECT, () => 'project' as const)
    .exhaustive();
}

function withValidSoupTag(
  entityType: EntityType,
  callback: (tag: SoupEntityTag) => void
) {
  const tag = propertyEntityTypeToSoupTag(entityType);
  if (tag) {
    callback(tag);
  }
}

/** Sets the status property to complete for an entity (mark as done) */
export function useSetPropertyStatusCompleteMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    SetPropertyStatusCompleteParams,
    SetPropertyStatusCompleteContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: SetPropertyStatusCompleteParams) => {
      await throwOnErr(
        async () =>
          await propertiesServiceClient.setPropertyStatusComplete({
            entity_type: vars.entityType,
            entity_id: vars.entityId,
          })
      );
    },
    onMutate: async (
      vars: SetPropertyStatusCompleteParams
    ): Promise<SetPropertyStatusCompleteContext> => {
      // Cancel any in-flight property queries
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: propertiesKeys.entity({
            entityType: vars.entityType,
            entityId: vars.entityId,
          }).queryKey,
        }),
      ]);

      // Snapshot previous property data for rollback
      const previousEntityProperties = queryClient.getQueriesData<Property[]>({
        queryKey: propertiesKeys.entity({
          entityType: vars.entityType,
          entityId: vars.entityId,
        }).queryKey,
      });

      // Optimistically update entity properties query
      queryClient.setQueriesData<Property[]>(
        {
          queryKey: propertiesKeys.entity({
            entityType: vars.entityType,
            entityId: vars.entityId,
          }).queryKey,
        },
        (old) => (old ? updateStatusPropertyToCompleted(old) : old)
      );

      // Optimistically update soup queries (embedded properties on entities)
      const current = getSoupEntityById(vars.entityId);

      let soupTxn: SoupTransaction | undefined;
      if (current && current.tag !== 'channel' && current.data.properties) {
        soupTxn = optimisticUpdateSoupEntity({
          tag: current.tag,
          data: {
            ...current.data,
            properties: updateStatusPropertyToCompleted(
              current.data.properties
            ),
          },
          frecency_score: current.frecency_score,
        });
      }

      return {
        previousEntityProperties,
        soupTxn,
      };
    },
    onError: (
      error: Error,
      _vars: SetPropertyStatusCompleteParams,
      context: SetPropertyStatusCompleteContext | undefined
    ) => {
      console.error('Failed to set status complete', error);

      if (context) {
        context.soupTxn?.rollback();
        for (const [key, data] of context.previousEntityProperties) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: (_data, _error, variables) => {
      invalidatePropertiesForEntity(variables.entityType, variables.entityId);
      withValidSoupTag(variables.entityType, (tag) =>
        refetchSoupEntity(variables.entityId, tag)
      );
    },
    ...(callbacks
      ? withCallbacks<
          void,
          Error,
          SetPropertyStatusCompleteParams,
          SetPropertyStatusCompleteContext
        >({}, callbacks)
      : {}),
  }));
}

export type BulkSaveEntityPropertiesParams = {
  properties: Array<{
    entityId: string;
    entityType: EntityType;
    property: { id: string; isMultiSelect: boolean };
    apiValues: PropertyApiValues;
  }>;
};

/** Saves multiple entity properties in bulk using parallel requests */
export function useBulkSaveEntityPropertiesMutation(
  callbacks?: MutationCallbacks<void, Error, BulkSaveEntityPropertiesParams>
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
                property_id: item.property.id,
                body: {
                  value: propertyValue,
                },
              })
          );
        })
      );
    },
    ...withCallbacks<void, Error, BulkSaveEntityPropertiesParams>(
      {
        onError(error) {
          console.error('Failed to bulk save properties', error);
          toast.failure('Failed to save properties');
        },
        onSettled: (_data, error, variables) => {
          if (error) {
            console.error('Failed bulk save properties', variables, error);
            toast.failure('Failed to save properties');
          }

          // Invalidate queries for all affected entities
          const entityGroups = new Map<EntityType, Set<string>>();

          variables.properties.forEach((p) => {
            if (!entityGroups.has(p.entityType)) {
              entityGroups.set(p.entityType, new Set());
            }
            entityGroups.get(p.entityType)!.add(p.entityId);
          });

          entityGroups.forEach((entityIds, entityType) => {
            entityIds.forEach((entityId) => {
              invalidatePropertiesForEntity(entityType, entityId);
              withValidSoupTag(entityType, (tag) =>
                refetchSoupEntity(entityId, tag)
              );
            });
          });
        },
      },
      callbacks
    ),
  }));
}
