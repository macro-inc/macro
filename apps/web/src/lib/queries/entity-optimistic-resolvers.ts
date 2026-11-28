import type { OptimisticPatch } from '@graphql-cache/exchange/optimistic';
import { optimisticResolver } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  DeleteEntityPropertyDocument,
  MoveEntitiesDocument,
  type MoveEntityInput,
  RenameEntitiesDocument,
  type RenameEntityInput,
  SetEntityAppearanceDocument,
  type SetEntityAppearanceMutation,
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

function movedEntity({ entity, projectId }: MoveEntityInput) {
  const fields = { id: String(entity.id) };
  const folder = projectId == null ? null : String(projectId);
  return match(entity.type)
    .with('DOCUMENT', () => ({
      ...fields,
      __typename: 'GraphqlSoupDocument' as const,
      projectId: folder,
    }))
    .with('CHAT', () => ({
      ...fields,
      __typename: 'GraphqlSoupChat' as const,
      projectId: folder,
    }))
    .with('EMAIL_THREAD', () => ({
      ...fields,
      __typename: 'GraphqlSoupEmailThread' as const,
      projectId: folder,
    }))
    .with('PROJECT', () => ({
      ...fields,
      __typename: 'GraphqlSoupProject' as const,
      parentId: folder,
    }))
    .otherwise(() => undefined);
}

export const entityOptimisticResolvers = [
  optimisticResolver(SetEntityAppearanceDocument, ({ input }) => {
    const { entity, icon, color } = input;
    if (entity.type !== 'DOCUMENT' && entity.type !== 'INITIATIVE')
      return undefined;
    const glyph =
      icon?.emoji != null
        ? { kind: 'emoji', value: icon.emoji }
        : icon?.macro != null
          ? { kind: 'macro', name: icon.macro }
          : null;
    const prediction: OptimisticPatch<
      SetEntityAppearanceMutation['setEntityAppearance']
    > = {
      __typename: 'GraphqlMutationSuccess',
      effects: [
        {
          __typename: 'SoupUpdated',
          item: {
            __typename:
              entity.type === 'DOCUMENT'
                ? 'GraphqlSoupDocument'
                : 'GraphqlSoupInitiative',
            id: String(entity.id),
            appearance:
              glyph || color
                ? { icon: glyph, color: color?.toLowerCase() ?? null }
                : null,
          },
        },
      ],
    };
    return prediction;
  }),
  optimisticResolver(MoveEntitiesDocument, ({ inputs }) => {
    const items = (Array.isArray(inputs) ? inputs : [inputs]).map(movedEntity);
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
