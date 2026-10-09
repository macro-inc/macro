import { optimisticResolver } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  DeleteEntityPropertyDocument,
  RenameEntitiesDocument,
  type RenameEntityInput,
  UpdateInitiativeDocument,
} from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';
import { buildPropertyRemovalLinks } from './properties/graphql/assignment-links';

function renamedEntity({ entity, displayName }: RenameEntityInput) {
  const fields = { id: String(entity.id), displayName };
  return match(entity.type)
    .with('DOCUMENT', () => ({
      ...fields,
      __typename: 'GraphqlSoupDocument' as const,
      documentName: displayName,
    }))
    .with('CHAT', () => ({
      ...fields,
      __typename: 'GraphqlSoupChat' as const,
      chatName: displayName,
    }))
    .with('PROJECT', () => ({
      ...fields,
      __typename: 'GraphqlSoupProject' as const,
      projectName: displayName,
    }))
    .with('CHANNEL', () => ({
      ...fields,
      __typename: 'GraphqlSoupChannel' as const,
      channelName: displayName,
    }))
    .with('CALL', () => ({
      ...fields,
      __typename: 'GraphqlSoupCall' as const,
      customName: displayName,
    }))
    .otherwise(() => undefined);
}

export const entityOptimisticResolvers = [
  optimisticResolver(RenameEntitiesDocument, ({ inputs }) => {
    const items = (Array.isArray(inputs) ? inputs : [inputs]).map(
      renamedEntity
    );
    if (items.some((item) => !item)) return undefined;
    return {
      results: items.flatMap((item) =>
        item
          ? [
              {
                __typename: 'GraphqlMutationSuccess' as const,
                effects: [{ __typename: 'SoupUpdated' as const, item }],
              },
            ]
          : []
      ),
    };
  }),
  optimisticResolver(UpdateInitiativeDocument, ({ initiativeId, input }) => {
    // Sharing changes must retain their authoritative permission/error result.
    if (input.sharePermission != null) return undefined;
    if (input.name == null && input.memberIds == null) return undefined;
    return {
      __typename: 'GraphqlSoupInitiative',
      id: String(initiativeId),
      ...(input.name != null ? { displayName: input.name } : {}),
      ...(input.memberIds != null
        ? { memberIds: input.memberIds.map(String) }
        : {}),
    };
  }),
  optimisticResolver(
    DeleteEntityPropertyDocument,
    ({ entityType, entityPropertyId }) =>
      entityType === 'USER'
        ? undefined
        : {
            __typename: 'GraphqlCacheDeletion',
            graphqlTypeName: 'GraphqlProperty',
            entityId: String(entityPropertyId),
          },
    ({ entityType, entityId, entityPropertyId }) => ({
      updates: buildPropertyRemovalLinks(
        entityType,
        entityId,
        String(entityPropertyId)
      ),
    })
  ),
];
