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
  inspect,
  optimisticMutationDispositionOf,
  type QueryRevalidation,
  selectAll,
} from '@graphql-cache/index';
import type { Property, PropertyDefinitionDomain } from '@property/types';
import { isInstantiatedProperty } from '@property/utils/typeGuards';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyTargetEntityType } from '@service-properties/generated/schemas/propertyTargetEntityType';
import {
  GroupSoupDocument,
  GroupSoupMembershipDocument,
  SoupDocument,
  SoupMembershipDocument,
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
import { toGraphqlPropertyTargetEntityType } from './entity';

export type GraphqlEntityPropertyOptionsInput = {
  entityType: EntityType | PropertyTargetEntityType;
  entityId: string;
  properties: Array<{
    property: Property | PropertyDefinitionDomain;
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
 * Queries that must re-read the entity after commit because a property record
 * the entity had never carried cannot be linked optimistically: the assignment
 * id arrives with the response, while `properties` is a link list on the entity
 * record that a bare record write does not extend.
 *
 * Only cached instances already holding the entity are revalidated, so an
 * unrelated loaded list is never refetched.
 *
 * Discovery reads through the id-only membership documents: a denormalized read
 * misses whenever ANY selected field was never written for ANY item in the
 * variant (a channel row carries no `properties`, so a full-item selection can
 * miss a variant that does hold the entity). Membership selects `__typename` and
 * `id` only, which every cached item has. Both membership documents select the
 * same cached fields as their list counterparts, so one inspection per field
 * finds every variant — including the single-entity ones the properties query
 * loads, which the list document then refetches as a superset.
 */
async function newPropertyLinkRevalidations(
  entityId: string
): Promise<QueryRevalidation[]> {
  const host = getGraphqlCacheHost();
  if (!host) return [];

  const [flatPages, groupedPages] = await Promise.all([
    inspect(
      host,
      selectAll(SoupMembershipDocument).field('user').field('soup')
    ),
    inspect(
      host,
      selectAll(GroupSoupMembershipDocument).field('user').field('groupSoup')
    ),
  ]);

  const holdsEntity = (items: readonly { id: string }[] | undefined) =>
    items?.some((item) => item.id === entityId) ?? false;

  return [
    ...flatPages
      .filter(({ value }) => holdsEntity(value?.items))
      .map(({ variables }) => ({ document: SoupDocument, variables })),
    ...groupedPages
      .filter(({ value }) => value?.bins.some((bin) => holdsEntity(bin.items)))
      .map(({ variables }) => ({ document: GroupSoupDocument, variables })),
  ];
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
      update.nextOptionIds
    );
    return record ? [record] : [];
  });
  const revalidations =
    optimisticProperties.length < input.properties.length
      ? await newPropertyLinkRevalidations(input.entityId)
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
