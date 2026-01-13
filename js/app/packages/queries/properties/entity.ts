import { toast } from '@core/component/Toast/Toast';
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
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { propertiesKeys } from './keys';

/**
 * Query hook for fetching properties for a single entity.
 */
export function useEntityPropertiesQuery(
  entityType: Accessor<EntityType>,
  entityId: Accessor<string>,
  includeMetadata: boolean
) {
  return useQuery(
    () => ({
      queryKey: propertiesKeys.entity({
        entityType: entityType(),
        entityId: entityId(),
      }).queryKey,
      queryFn: async () => {
        const data = await throwOnErr(
          async () =>
            await propertiesServiceClient.getEntityProperties({
              entity_type: entityType(),
              entity_id: entityId(),
              query: { include_metadata: includeMetadata },
            })
        );
        return data.properties.map(entityPropertyFromApi);
      },
      staleTime: 0,
    }),
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

/**
 * Invalidates and refetches all property queries for a specific entity.
 */
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

/**
 * Mutation to save an entity property value.
 */
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

/**
 * Mutation to delete a property from an entity.
 */
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

/**
 * Mutation to add an entity property without an initial value.
 * Users can set the value later.
 */
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
