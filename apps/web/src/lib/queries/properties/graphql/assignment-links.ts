import {
  type OptimisticUpdate,
  selectRecord,
  upsertByField,
} from '@graphql-cache/index';
import type { PropertyTargetEntityType } from '@service-properties/generated/schemas/propertyTargetEntityType';
import { PropertyAssignmentParentFragmentDoc } from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';

/**
 * Link one assignment directly to its normalized parent, independent of cached
 * list/detail queries. The durable recipe resolves the server assignment ID on
 * commit and still applies when the parent exists only in cold storage.
 */
export function buildPropertyAssignmentLinks(
  entityType: PropertyTargetEntityType,
  entityId: string,
  propertyId: string,
  propertyDefinitionId: string
): OptimisticUpdate[] {
  const typename = match(entityType)
    .with('DOCUMENT', () => 'GraphqlSoupDocument' as const)
    .with('CHAT', () => 'GraphqlSoupChat' as const)
    .with('PROJECT', () => 'GraphqlSoupProject' as const)
    .with('INITIATIVE', () => 'GraphqlSoupInitiative' as const)
    .with('THREAD', () => 'GraphqlSoupEmailThread' as const)
    .with('CHANNEL', () => 'GraphqlSoupChannel' as const)
    .with('CALL_RECORD', () => 'GraphqlSoupCall' as const)
    .with('COMPANY', () => 'GraphqlSoupCrmCompany' as const)
    .with('USER', () => undefined)
    .exhaustive();
  if (!typename) return [];

  return [
    upsertByField(
      selectRecord(PropertyAssignmentParentFragmentDoc, {
        __typename: typename,
        id: entityId,
      }).field('properties'),
      {
        entity: { __typename: 'GraphqlProperty', id: propertyId },
        whereField: 'propertyDefinitionId',
        equals: propertyDefinitionId,
      }
    ),
  ];
}
