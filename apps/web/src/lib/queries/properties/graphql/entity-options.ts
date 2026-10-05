/**
 * GraphQL transport for entity-property option selections (the tag picker).
 *
 * The REST twin's optimism writes the normy-normalized Soup cache, which the
 * GraphQL transport never populates, so a selection committed there would only
 * surface on a full reload. Here the optimism is a normalized-cache write of
 * the same property records Soup rows and the properties query already read.
 */

import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
  type QueryRevalidation,
} from '@graphql-cache/index';
import type { Property, PropertyDefinitionDomain } from '@property/types';
import { isInstantiatedProperty } from '@property/utils/typeGuards';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyTargetEntityType } from '@service-properties/generated/schemas/propertyTargetEntityType';
import {
  EntityPropertiesDocument,
  UpdateEntityPropertyOptionsDocument,
  type UpdateEntityPropertyOptionsMutation,
  type UpdateEntityPropertyOptionsMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { buildOptimisticEntityPropertyOptions } from '../graphql-optimistic';
import {
  type EntityPropertyOptionSelection,
  getEntityPropertyOptionDeltas,
} from '../option-deltas';
import {
  buildEntityPropertiesVariables,
  toGraphqlPropertyTargetEntityType,
} from './entity';

export type GraphqlEntityPropertyOptionsInput = {
  entityType: EntityType | PropertyTargetEntityType;
  entityId: string;
  properties: Array<{
    property: Property | PropertyDefinitionDomain;
    /** Existing assignment identity when the picker supplies a tag definition. */
    assignmentId?: string;
    currentOptionIds: string[];
    nextOptionIds: string[];
  }>;
};

function getPropertyDefinitionId(
  property: Property | PropertyDefinitionDomain
): string {
  return isInstantiatedProperty(property)
    ? property.propertyDefinitionId
    : property.id;
}

/**
 * A new assignment must be linked into its entity's properties list. Re-reading
 * that one entity updates the normalized parent for every list/detail consumer.
 * Never inspect all cached Soup variants here: backfills can exceed the cache's
 * inspection budget, and cache bookkeeping must not prevent the mutation.
 * The descriptor is durable, so an offline commit also reconciles on replay.
 */
function newPropertyLinkRevalidations(
  entityType: EntityType | PropertyTargetEntityType,
  entityId: string
): QueryRevalidation[] {
  if (!getGraphqlCacheHost()) return [];
  const variables = buildEntityPropertiesVariables(entityType, entityId);
  return variables ? [{ document: EntityPropertiesDocument, variables }] : [];
}

/**
 * Commits one tag-picker selection through GraphQL and returns the reconciled
 * option ids per property. A queued (offline) commit resolves with the
 * requested selection: the durable transaction owns it from that point on.
 */
export async function updateGraphqlEntityPropertyOptions(
  input: GraphqlEntityPropertyOptionsInput
): Promise<EntityPropertyOptionSelection[]> {
  const variables: UpdateEntityPropertyOptionsMutationVariables = {
    input: {
      entityType: toGraphqlPropertyTargetEntityType(input.entityType),
      entityId: input.entityId,
      properties: input.properties.map((update) => {
        const deltas = getEntityPropertyOptionDeltas(
          update.currentOptionIds,
          update.nextOptionIds
        );
        return {
          propertyDefinitionId: getPropertyDefinitionId(update.property),
          addOptionIds: deltas.addOptionIds,
          removeOptionIds: deltas.removeOptionIds,
        };
      }),
    },
  };

  const requested: EntityPropertyOptionSelection[] = input.properties.map(
    (update) => ({
      propertyDefinitionId: getPropertyDefinitionId(update.property),
      optionIds: update.nextOptionIds,
    })
  );

  const optimisticProperties = input.properties.flatMap((update) => {
    const record = buildOptimisticEntityPropertyOptions(
      update.property,
      update.nextOptionIds,
      update.assignmentId
    );
    return record ? [record] : [];
  });
  const revalidations =
    optimisticProperties.length < input.properties.length
      ? newPropertyLinkRevalidations(input.entityType, input.entityId)
      : [];

  const result = await executeOptimisticMutation(
    getGraphqlSoupClient(),
    UpdateEntityPropertyOptionsDocument,
    variables,
    { updateEntityPropertyOptions: optimisticProperties },
    { uuid: crypto.randomUUID(), revalidations }
  ).toPromise();

  const disposition = optimisticMutationDispositionOf<
    UpdateEntityPropertyOptionsMutation,
    UpdateEntityPropertyOptionsMutationVariables
  >(result);
  if (disposition?.kind === 'queued') return requested;
  if (disposition?.kind === 'permanently-failed') throw disposition.error;
  if (result.error) throw result.error;

  const properties =
    disposition?.kind === 'committed'
      ? disposition.data.updateEntityPropertyOptions
      : result.data?.updateEntityPropertyOptions;
  if (!properties) {
    throw new Error('updateEntityPropertyOptions returned no data');
  }

  return properties.map((property) => ({
    propertyDefinitionId: property.propertyDefinitionId,
    optionIds:
      property.value?.__typename === 'GraphqlSelectOptionPropertyValue'
        ? property.value.optionIds
        : [],
  }));
}
