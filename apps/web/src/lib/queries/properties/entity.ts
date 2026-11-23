import { analytics } from '@app/lib/analytics';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { buildSimpleEntityUrl } from '@core/util/url';
import { optimisticMutationDispositionOf } from '@graphql-cache/exchange/optimistic';
import { Telemetry } from '@macro-inc/observability';
import { entityPropertyFromApi } from '@property/api/converters';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { isInstantiatedProperty } from '@property/utils';
import { refreshCrmAssociatedSoupQueries } from '@queries/soup/crm-association';
import { ownTouchStamp } from '@queries/soup/normalized-cache/own-touch';
import { DeleteEntityPropertyDocument } from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
  hasGraphqlCacheHost,
} from '@service-storage/graphql-soup';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { CombinedError } from '@urql/core';
import { type Accessor, batch } from 'solid-js';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import type { PropertyTargetEntityType } from '../../service-clients/service-properties/generated/schemas/propertyTargetEntityType';
import type { SoupProperty } from '../../service-clients/service-storage/generated/schemas/soupProperty';
import type { SoupPropertyValue } from '../../service-clients/service-storage/generated/schemas/soupPropertyValue';
import { queryClient } from '../client';
import {
  bumpSoupEntityTouchedAt,
  getSoupEntityById,
  invalidateSoupEntity,
  optimisticUpdateSoupEntity,
  type SoupTransaction,
} from '../soup/cache';
import { refreshPropertyQueries } from '../soup/property-queries';
import { type MutationCallbacks, withCallbacks } from '../utils';
import {
  type AddEntityPropertyInput,
  type BulkSaveEntityPropertiesInput,
  createGraphqlAddEntityPropertyMutation,
  createGraphqlBulkSaveEntityPropertiesMutation,
  createGraphqlEntityPropertiesQuery,
  type EntityPropertyMutationDisposition,
  refetchGraphqlInitiativeProperties,
} from './graphql/entity';
import { updateGraphqlEntityPropertyOptions } from './graphql/entity-options';
import { readFirstOpenBlocker } from './graphql/task-dependencies';
import {
  type BulkUpdateEntityPropertyOptionsParams,
  bulkEntityPropertyOptionsKey,
} from './in-flight-options';
import { propertiesKeys } from './keys';
import type { EntityPropertyOptionSelection } from './option-deltas';

function toPropertyTargetEntityType(
  entityType: EntityType | PropertyTargetEntityType
): PropertyTargetEntityType {
  if (entityType === 'TASK') return 'DOCUMENT';
  if (entityType === 'CALENDAR_EVENT') {
    // Not a property target yet; surface a real error instead of a bad request.
    throw new Error('calendar events do not support properties');
  }
  if (entityType === 'CONTACT') {
    throw new Error('crm contacts do not support properties');
  }
  return entityType;
}

/**
 * An entity's properties from the properties service, metadata included, so
 * consumers with different `includeMetadata` values share one cache entry and
 * one request.
 */
async function fetchRestEntityProperties(
  entityType: EntityType,
  entityId: string
): Promise<Property[]> {
  const data = await throwOnErr(
    async () =>
      await propertiesServiceClient.getEntityProperties({
        entity_type: toPropertyTargetEntityType(entityType),
        entity_id: entityId,
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
}

/** Read an entity's current properties through the shared entity query. */
export function fetchEntityProperties(
  entityType: EntityType,
  entityId: string
): Promise<Property[]> {
  return queryClient.fetchQuery({
    queryKey: propertiesKeys.entity({ entityType, entityId }).queryKey,
    queryFn: () => fetchRestEntityProperties(entityType, entityId),
    staleTime: 0,
  });
}

// Cached callbacks outlive the caller; only plain values enter here.
function entityPropertiesQueryOptions(
  entityType: EntityType,
  entityId: string,
  enabled: boolean,
  includeMetadata: boolean
) {
  return queryOptions({
    queryKey: propertiesKeys.entity({ entityType, entityId }).queryKey,
    enabled,
    queryFn: () => fetchRestEntityProperties(entityType, entityId),
    select: (properties: Property[]) =>
      includeMetadata
        ? properties
        : properties.filter((property) => property.isMetadata !== true),
    staleTime: 0,
  });
}

export function useEntityPropertiesQuery(
  entityType: Accessor<EntityType>,
  entityId: Accessor<string>,
  includeMetadata: boolean
) {
  // Metadata properties are computed by the REST properties endpoint and are
  // not part of the GraphQL Soup property edge. USER is not represented in
  // Soup either. The GraphQL adapter owns those eligibility details.
  const graphqlQuery = createGraphqlEntityPropertiesQuery({
    entityType,
    entityId,
    enabled: () => entityType() === 'INITIATIVE' || !includeMetadata,
  });

  const usesGraphql = graphqlQuery.isEnabled;

  const restQuery = useQuery(
    () => {
      const id = entityId();
      return entityPropertiesQueryOptions(
        entityType(),
        id,
        !usesGraphql() && id.length > 0,
        includeMetadata
      );
    },
    () => queryClient
  );

  return {
    get data() {
      if (
        entityType() === 'INITIATIVE' &&
        graphqlQuery.result.error?.graphQLErrors.some((error) =>
          ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'].includes(
            String(error.extensions.code)
          )
        )
      )
        return [];
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
    /** Whether a saved value reaches this query through the cache's own write. */
    get isCacheMaintained() {
      return usesGraphql() && hasGraphqlCacheHost();
    },
  };
}

async function invalidatePropertiesForEntity(
  entityType: EntityType | PropertyTargetEntityType,
  entityId: string
) {
  const invalidate = queryClient.invalidateQueries({
    queryKey: propertiesKeys.entity({ entityType, entityId }).queryKey,
  });
  if (entityType !== 'INITIATIVE') {
    await invalidate;
    return;
  }
  // Attaching/removing a property changes the initiative's property link list,
  // which cannot be inferred from the returned property record alone.
  await Promise.all([invalidate, refetchGraphqlInitiativeProperties(entityId)]);
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
  // GraphQL Soup rows live in the normalized cache, which carries its own
  // optimistic write.
  if (!current) return undefined;
  // channel / foreign entity / channel thread rows are property-less; call
  // records carry properties (tags) and are handled like documents.
  if (
    current.tag === 'channel' ||
    current.tag === 'foreignEntity' ||
    current.tag === 'channelThread' ||
    current.tag === 'calendarEvent' ||
    current.tag === 'harness' ||
    current.tag === 'team' ||
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
      specific_entity_type: property.specificEntityType ?? null,
      created_at: now,
      updated_at: now,
    },
    value,
  };
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
      if (vars.entityType !== 'USER' && vars.entityType !== 'CALENDAR_EVENT') {
        const result = await getGraphqlSoupClient()
          .mutation(DeleteEntityPropertyDocument, {
            entityType: toPropertyTargetEntityType(vars.entityType),
            entityId: vars.entityId,
            entityPropertyId: vars.entityPropertyId,
          })
          .toPromise();
        const disposition = optimisticMutationDispositionOf(result);
        if (disposition?.kind === 'queued') return;
        if (disposition?.kind === 'permanently-failed') throw disposition.error;
        if (result.error) throw result.error;
        if (!result.data) throw new Error('Property removal returned no data');
        return;
      }
      await throwOnErr(
        async () =>
          await propertiesServiceClient.deleteEntityProperty({
            entity_property_id: vars.entityPropertyId,
          })
      );
    },
    ...withCallbacks<void, Error, DeleteEntityPropertyParams>(
      {
        onSuccess: (_data, variables) => {
          // The removed row may have been a Companies or Contacts value.
          fireAndForget(refreshCrmAssociatedSoupQueries(), 'entity-properties');
          invalidateSoupEntity(variables.entityId);
          // Deletion carries an assignment ID, not its definition; refresh property-dependent lists.
          fireAndForget(refreshPropertyQueries(), 'entity-properties');
          return invalidatePropertiesForEntity(
            variables.entityType,
            variables.entityId
          );
        },
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

/** Transport-neutral mutation interface for property attachments. */
export type AddEntityPropertyMutation = {
  readonly isPending: boolean;
  readonly error: Error | null;
  mutate(variables: AddEntityPropertyParams): void;
  mutateAsync(variables: AddEntityPropertyParams): Promise<void>;
};

/** Adds a property through GraphQL. */
export function useAddEntityPropertyMutation(
  callbacks?: MutationCallbacks<void, Error, AddEntityPropertyParams>
): AddEntityPropertyMutation {
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
      return graphqlMutation.isPending;
    },
    get error() {
      return graphqlMutation.error ?? null;
    },
    mutate(variables) {
      graphqlMutation.mutate(variables);
    },
    async mutateAsync(variables) {
      const result = await graphqlMutation.mutateAsync(variables);
      if (result.error) throw result.error;
    },
  };
}

type BulkUpdateEntityPropertyOptionsContext = {
  soupTxn?: SoupTransaction;
};

type BulkUpdateEntityPropertyOptionsResult = {
  selections: EntityPropertyOptionSelection[];
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
    BulkUpdateEntityPropertyOptionsResult,
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
    ): Promise<BulkUpdateEntityPropertyOptionsResult> => {
      // The per-entity scope that serializes commits and the in-flight overlay
      // both read this mutation's state.
      return {
        selections: await updateGraphqlEntityPropertyOptions(variables),
      };
    },
    ...withCallbacks<
      BulkUpdateEntityPropertyOptionsResult,
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
        onSuccess: ({ selections }, variables) => {
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
          for (const selection of selections) {
            fireAndForget(
              refreshPropertyQueries(selection.propertyDefinitionId, {
                includeOptionFilters: true,
                unmaintainedOnly: true,
              }),
              'entity-properties'
            );
          }
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

/** Properties whose values decide which items a CRM record lists. */
const CRM_ASSOCIATION_PROPERTY_IDS: readonly string[] = [
  SYSTEM_PROPERTY_IDS.COMPANIES,
  SYSTEM_PROPERTY_IDS.CONTACTS,
];

/**
 * Whether a property's values decide which items a CRM record lists: the
 * built-in Companies and Contacts properties, and a custom entity property,
 * which lists a task on the records it references.
 */
function decidesCrmAssociation(
  property: Property | PropertyDefinitionDomain
): boolean {
  if (
    CRM_ASSOCIATION_PROPERTY_IDS.includes(getPropertyDefinitionId(property))
  ) {
    return true;
  }
  if (property.valueType !== 'ENTITY') return false;

  // Properties read over GraphQL carry no owner, so the built-in flag decides.
  const builtIn = isInstantiatedProperty(property)
    ? (property.isSystemProperty ?? false)
    : property.isSystem;
  return !builtIn && property.owner.scope !== 'database';
}

function invalidatePropertySaveCaches(
  item: BulkSaveEntityPropertiesParams['properties'][number]
): void {
  fireAndForget(
    invalidatePropertiesForEntity(item.entityType, item.entityId),
    'entity-properties'
  );
  invalidateSoupEntity(item.entityId);
  fireAndForget(
    refreshPropertyQueries(getPropertyDefinitionId(item.property)),
    'entity-properties'
  );
  // CRM record lists resolve membership on the server, not from these rows.
  if (decidesCrmAssociation(item.property)) {
    fireAndForget(refreshCrmAssociatedSoupQueries(), 'entity-properties');
  }
}

function handleCommittedPropertySave(
  item: BulkSaveEntityPropertiesParams['properties'][number],
  disposition: EntityPropertyMutationDisposition
): void {
  if (disposition.kind !== 'committed') return;

  // A saved property is the viewer's own touch (a PropertyChanged activity),
  // so Recent moves the item now rather than after a later refetch.
  bumpSoupEntityTouchedAt(item.entityId);
  trackTaskPropertySave(
    item.entityId,
    getPropertyDefinitionId(item.property),
    item.apiValues
  );
}

async function reportBulkPropertySaveFailure(
  error: Error,
  variables: BulkSaveEntityPropertiesParams
): Promise<void> {
  Telemetry.error(error, { surface: 'task-properties' });
  const blockedError =
    error instanceof CombinedError
      ? error.graphQLErrors.find(
          (error) => error.extensions.code === 'TASK_BLOCKED'
        )
      : undefined;
  if (!blockedError) {
    toast.failure('Failed to save properties');
    return;
  }
  const item = variables.properties.find(
    (item) =>
      getPropertyDefinitionId(item.property) === SYSTEM_PROPERTY_IDS.STATUS
  );
  const rejectedId = blockedError.extensions.taskId;
  const taskId = typeof rejectedId === 'string' ? rejectedId : item?.entityId;
  const blockerId = taskId
    ? await readFirstOpenBlocker(getGraphqlCacheHost(), taskId)
    : undefined;
  const destination = blockerId ?? taskId;
  toast.failure(t('entityActions.taskBlockedCompletion'), {
    actions: destination
      ? [
          {
            label: blockerId
              ? t('entityActions.taskOpenBlocker')
              : t('entityActions.taskViewBlockers'),
            onClick: () =>
              window.location.assign(
                buildSimpleEntityUrl({ type: 'task', id: destination })
              ),
          },
        ]
      : undefined,
  });
}

/** Transport-neutral mutation interface exposed to property consumers. */
export type BulkSaveEntityPropertiesMutation = {
  readonly isPending: boolean;
  readonly error: Error | null;
  mutate(variables: BulkSaveEntityPropertiesParams): void;
  mutateAsync(variables: BulkSaveEntityPropertiesParams): Promise<void>;
};

/** Saves entity properties through GraphQL. */
export function useBulkSaveEntityPropertiesMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    BulkSaveEntityPropertiesParams,
    BulkSaveEntityPropertiesContext
  >
): BulkSaveEntityPropertiesMutation {
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
          await reportBulkPropertySaveFailure(error, variables);
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
      return graphqlMutation.isPending;
    },
    get error() {
      return graphqlMutation.error ?? null;
    },
    mutate(variables) {
      graphqlMutation.mutate(variables);
    },
    async mutateAsync(variables) {
      const result = await graphqlMutation.mutateAsync(variables);
      if (result.error) throw result.error;
    },
  };
}
