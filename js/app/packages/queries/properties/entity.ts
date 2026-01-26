import { toast } from '@core/component/Toast/Toast';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import { throwOnErr } from '@core/util/maybeResult';
import {
  type InfiniteData,
  type QueryKey,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
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
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import type { SoupPage } from '../../service-clients/service-storage/generated/schemas/soupPage';
import type { SoupProperty } from '../../service-clients/service-storage/generated/schemas/soupProperty';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { propertiesKeys } from './keys';
import { queryKeys } from '../../macro-entity/src/queries/key';
import type { BulkEntityPropertiesData } from './bulk';

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

function bulkIncludesEntityPredicate(queryKey: QueryKey, entityId: string) {
  return (
    queryKey.includes('properties') &&
    queryKey.includes('bulk') &&
    queryKey.some(
      (subKey) => Array.isArray(subKey) && subKey.includes(entityId)
    )
  );
}

export function invalidatePropertiesForEntity(
  entityType: EntityType,
  entityId: string
) {
  queryClient.invalidateQueries({
    queryKey: propertiesKeys.entity({ entityType, entityId }).queryKey,
  });

  // This invalidates any bulk query including this entity
  queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      bulkIncludesEntityPredicate(queryKey, entityId),
  });
}

export type SaveEntityPropertyParams = {
  entityId: string;
  entityType: EntityType;
  property: Property;
  apiValues: PropertyApiValues;
};

export function useSaveEntityPropertyMutation(
  callbacks?: MutationCallbacks<void, Error, SaveEntityPropertyParams>
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
    ...withCallbacks<void, Error, SaveEntityPropertyParams>(
      {
        onError(error) {
          console.error('Failed to save property', error);
          toast.failure('Failed to save property');
        },
        onSettled: (_data, _error, variables) => {
          invalidatePropertiesForEntity(
            variables.entityType,
            variables.entityId
          );

          // If the status property was changed, also invalidate DSS
          // so that tasks can reappear in Signal when marked un-done
          if (
            variables.property.propertyDefinitionId ===
            SYSTEM_PROPERTY_IDS.STATUS
          ) {
            queryClient.invalidateQueries({ queryKey: queryKeys.all.dss });
          }
        },
      },
      callbacks
    ),
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
  previousBulkProperties: [QueryKey, BulkEntityPropertiesData | undefined][];
  previousDss: [QueryKey, InfiniteData<SoupPage, unknown> | undefined][];
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

/**
 * Updates DSS query data to set the status property to COMPLETED for a given entity.
 */
function updateDssStatusToCompleted(
  data: InfiniteData<SoupPage, unknown> | undefined,
  entityId: string
): InfiniteData<SoupPage, unknown> | undefined {
  if (!data) return data;

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => {
        // SoupApiItem has { tag, data } structure where data contains the entity
        if ('data' in item && item.data && 'id' in item.data) {
          const itemData = item.data as {
            id: string;
            properties?: SoupProperty[];
          };
          if (itemData.id === entityId && itemData.properties) {
            // Use Object.assign to preserve the original type while updating properties
            const updatedData = {
              ...item.data,
              properties: updateStatusPropertyToCompleted(itemData.properties),
            };
            return {
              ...item,
              data: updatedData,
            } as typeof item;
          }
        }
        return item;
      }),
    })),
    pageParams: data.pageParams,
  };
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
      // Cancel any in-flight queries that might overwrite our optimistic update
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: propertiesKeys.entity({
            entityType: vars.entityType,
            entityId: vars.entityId,
          }).queryKey,
        }),
        queryClient.cancelQueries({
          predicate: ({ queryKey }) =>
            bulkIncludesEntityPredicate(queryKey, vars.entityId),
        }),
        queryClient.cancelQueries({ queryKey: queryKeys.all.dss }),
      ]);

      // Snapshot previous data for rollback
      const previousEntityProperties = queryClient.getQueriesData<Property[]>({
        queryKey: propertiesKeys.entity({
          entityType: vars.entityType,
          entityId: vars.entityId,
        }).queryKey,
      });

      const previousBulkProperties =
        queryClient.getQueriesData<BulkEntityPropertiesData>({
          predicate: ({ queryKey }) =>
            bulkIncludesEntityPredicate(queryKey, vars.entityId),
        });

      const previousDss = queryClient.getQueriesData<
        InfiniteData<SoupPage, unknown>
      >({
        queryKey: queryKeys.all.dss,
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

      // Optimistically update bulk properties queries
      queryClient.setQueriesData<BulkEntityPropertiesData>(
        {
          predicate: ({ queryKey }) =>
            bulkIncludesEntityPredicate(queryKey, vars.entityId),
        },
        (old) => {
          if (!old || !old[vars.entityId]) return old;
          return {
            ...old,
            [vars.entityId]: updateStatusPropertyToCompleted(
              old[vars.entityId]
            ),
          };
        }
      );

      // Optimistically update DSS queries (embedded properties on entities)
      queryClient.setQueriesData<InfiniteData<SoupPage, unknown>>(
        { queryKey: queryKeys.all.dss },
        (old) => updateDssStatusToCompleted(old, vars.entityId)
      );

      return {
        previousEntityProperties,
        previousBulkProperties,
        previousDss,
      };
    },
    onError: (
      error: Error,
      _vars: SetPropertyStatusCompleteParams,
      context: SetPropertyStatusCompleteContext | undefined
    ) => {
      console.error('Failed to set status complete', error);

      // Rollback optimistic updates
      if (context) {
        for (const [key, data] of context.previousEntityProperties) {
          queryClient.setQueryData(key, data);
        }
        for (const [key, data] of context.previousBulkProperties) {
          queryClient.setQueryData(key, data);
        }
        for (const [key, data] of context.previousDss) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: (_data, _error, variables) => {
      invalidatePropertiesForEntity(variables.entityType, variables.entityId);
      // Also invalidate DSS to ensure consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.all.dss });
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
            });
          });
        },
      },
      callbacks
    ),
  }));
}
