import { toast } from '@core/component/Toast/Toast';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import { throwOnErr } from '@core/util/maybeResult';
import { type QueryKey, useMutation, useQuery } from '@tanstack/solid-query';
import { batch, type Accessor } from 'solid-js';
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

function optimisticUpdateSoupEntityProperties(
  entityId: string,
  updates: Map<string, SoupPropertyValue>
): SoupTransaction | undefined {
  const current = getSoupEntityById(entityId);
  if (
    !current ||
    current.tag === 'channel' ||
    current.tag === 'callRecord' ||
    !current.data.properties
  ) {
    return undefined;
  }

  return optimisticUpdateSoupEntity({
    tag: current.tag,
    data: {
      ...current.data,
      properties: current.data.properties.map((prop) =>
        updates.has(prop.definition.id)
          ? { ...prop, value: updates.get(prop.definition.id)! }
          : prop
      ),
    },
    frecency_score: current.frecency_score,
  });
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
    onMutate: (vars: SaveEntityPropertyParams): SaveEntityPropertyContext =>
      optimisticUpdateSoupEntityProperties(
        vars.entityId,
        new Map([
          [
            vars.property.propertyDefinitionId,
            apiValuesToSoupPropertyValue(vars.apiValues),
          ],
        ])
      ),
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

function updateStatusPropertyToCompleted(properties: Property[]): Property[] {
  return properties.map((prop) =>
    prop.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS &&
    prop.valueType === 'SELECT_STRING'
      ? { ...prop, value: [PROPERTY_OPTION_IDS.STATUS.COMPLETED] }
      : prop
  );
}

const STATUS_COMPLETED_SOUP_VALUE: SoupPropertyValue = {
  type: 'SelectOption',
  value: [PROPERTY_OPTION_IDS.STATUS.COMPLETED],
};

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
      const soupTxn = optimisticUpdateSoupEntityProperties(
        vars.entityId,
        new Map([[SYSTEM_PROPERTY_IDS.STATUS, STATUS_COMPLETED_SOUP_VALUE]])
      );

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
                property_id: item.property.id,
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
          const updatesByEntity = new Map<
            string,
            Map<string, SoupPropertyValue>
          >();
          for (const item of vars.properties) {
            let bucket = updatesByEntity.get(item.entityId);
            if (!bucket) {
              bucket = new Map();
              updatesByEntity.set(item.entityId, bucket);
            }
            bucket.set(
              item.property.id,
              apiValuesToSoupPropertyValue(item.apiValues)
            );
          }

          const soupTxns = batch<SoupTransaction[]>(() => {
            const txns: SoupTransaction[] = [];
            for (const [entityId, updates] of updatesByEntity) {
              const txn = optimisticUpdateSoupEntityProperties(
                entityId,
                updates
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

          // Invalidate (not refetch) to avoid racing the properties-service
          // write against the storage-service list read and clobbering the
          // optimistic update with stale data.
          batch(() => {
            const seenEntityIds = new Set<string>();
            for (const p of variables.properties) {
              invalidatePropertiesForEntity(p.entityType, p.entityId);
              if (!seenEntityIds.has(p.entityId)) {
                seenEntityIds.add(p.entityId);
                invalidateSoupEntity(p.entityId);
              }
            }
          });
        },
      },
      callbacks
    ),
  }));
}
