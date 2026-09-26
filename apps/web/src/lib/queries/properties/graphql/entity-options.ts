/**
 * GraphQL transport for entity-property option selections (the tag picker).
 *
 * The REST twin's optimism writes the normy-normalized Soup cache, which the
 * GraphQL transport never populates, so a selection committed there would only
 * surface on a full reload. Here the optimism is a normalized-cache write of
 * the same property records Soup rows and the properties query already read.
 *
 * A property the entity has never carried gets a record under a temporary id,
 * linked into the entity's `properties` with a record-rooted update, so a first
 * tag shows at once and survives offline queueing. The response's `effects`
 * carry the refreshed entity with its real assignments; the server never writes
 * the temporary record, so settlement drops its link and the real one stands.
 */

import {
  type CacheHost,
  executeOptimisticMutation,
  type OptimisticUpdate,
  optimisticMutationDispositionOf,
  prependUnique,
  readRecordsByKeys,
  selectRecords,
  updateEntityLinks,
} from '@graphql-cache/index';
import type { Property, PropertyDefinitionDomain } from '@property/types';
import { isInstantiatedProperty } from '@property/utils/typeGuards';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyTargetEntityType } from '@service-properties/generated/schemas/propertyTargetEntityType';
import {
  ApplyEntityPropertyOptionDeltasDocument,
  type ApplyEntityPropertyOptionDeltasMutation,
  type ApplyEntityPropertyOptionDeltasMutationVariables,
  EntityPropertyAssignmentsFragmentDoc,
  type GraphqlPropertyTargetEntityType,
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

/** Soup record type per property target; users have no Soup record. */
const SOUP_TYPENAMES: Record<
  GraphqlPropertyTargetEntityType,
  string | undefined
> = {
  CALL_RECORD: 'GraphqlSoupCall',
  CHANNEL: 'GraphqlSoupChannel',
  CHAT: 'GraphqlSoupChat',
  COMPANY: 'GraphqlSoupCrmCompany',
  DOCUMENT: 'GraphqlSoupDocument',
  PROJECT: 'GraphqlSoupProject',
  THREAD: 'GraphqlSoupEmailThread',
  USER: undefined,
};

const assignmentsSelection = selectRecords(
  EntityPropertyAssignmentsFragmentDoc
);

/**
 * The entity's assignment id per property definition, read through the
 * optimistic view when the commit executes. The picker's captured property can
 * carry a temporary id an earlier commit has since replaced. `undefined` when
 * the entity or its `properties` is not cached.
 */
async function cachedAssignmentIds(
  host: CacheHost,
  recordKey: string
): Promise<Map<string, string> | undefined> {
  try {
    const { records } = await readRecordsByKeys(host, assignmentsSelection, [
      recordKey,
    ]);
    const record = records[0]?.record;
    if (!record) return undefined;
    return new Map(
      record.properties.map((property) => [
        property.propertyDefinitionId,
        property.id,
      ])
    );
  } catch (error) {
    // Optimism is an optimization; the commit itself stays authoritative.
    console.warn('Failed to read cached property assignments', error);
    return undefined;
  }
}

/**
 * Commits one tag-picker selection through GraphQL and returns the reconciled
 * option ids per property. A queued (offline) commit resolves with the
 * requested selection: the durable transaction owns it from that point on.
 */
export async function updateGraphqlEntityPropertyOptions(
  input: GraphqlEntityPropertyOptionsInput
): Promise<EntityPropertyOptionSelection[]> {
  const entityType = toGraphqlPropertyTargetEntityType(input.entityType);
  const variables: ApplyEntityPropertyOptionDeltasMutationVariables = {
    input: {
      entityType,
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

  const host = getGraphqlCacheHost();
  const typename = SOUP_TYPENAMES[entityType];
  const soupEntity =
    host && typename ? { __typename: typename, id: input.entityId } : undefined;
  const cachedAssignments =
    host && soupEntity
      ? await cachedAssignmentIds(
          host,
          `${soupEntity.__typename}:${soupEntity.id}`
        )
      : undefined;

  const updates: OptimisticUpdate[] = [];
  const optimisticProperties = input.properties.flatMap((update) => {
    const assignmentId = cachedAssignments
      ? cachedAssignments.get(getPropertyDefinitionId(update.property))
      : isInstantiatedProperty(update.property)
        ? update.property.propertyId
        : undefined;
    if (assignmentId) {
      return [
        buildOptimisticEntityPropertyOptions(
          update.property,
          assignmentId,
          update.nextOptionIds
        ),
      ];
    }
    // Without additions the server creates no assignment, and without a
    // cached entity there is no list to link a temporary record into.
    if (update.nextOptionIds.length === 0 || !soupEntity) return [];
    const temporaryId = crypto.randomUUID();
    updates.push(
      updateEntityLinks(
        soupEntity,
        'properties',
        prependUnique({ __typename: 'GraphqlProperty', id: temporaryId })
      )
    );
    return [
      buildOptimisticEntityPropertyOptions(
        update.property,
        temporaryId,
        update.nextOptionIds
      ),
    ];
  });

  const result = await executeOptimisticMutation(
    getGraphqlSoupClient(),
    ApplyEntityPropertyOptionDeltasDocument,
    variables,
    {
      applyEntityPropertyOptionDeltas: {
        properties: optimisticProperties,
        effects: [],
      },
    },
    { uuid: crypto.randomUUID(), updates }
  ).toPromise();

  const disposition = optimisticMutationDispositionOf<
    ApplyEntityPropertyOptionDeltasMutation,
    ApplyEntityPropertyOptionDeltasMutationVariables
  >(result);
  if (disposition?.kind === 'queued') return requested;
  if (disposition?.kind === 'permanently-failed') throw disposition.error;
  if (result.error) throw result.error;

  const properties =
    disposition?.kind === 'committed'
      ? disposition.data.applyEntityPropertyOptionDeltas.properties
      : result.data?.applyEntityPropertyOptionDeltas.properties;
  if (!properties) {
    throw new Error('applyEntityPropertyOptionDeltas returned no data');
  }

  return properties.map((property) => ({
    propertyDefinitionId: property.propertyDefinitionId,
    optionIds:
      property.value?.__typename === 'GraphqlSelectOptionPropertyValue'
        ? property.value.optionIds
        : [],
  }));
}
