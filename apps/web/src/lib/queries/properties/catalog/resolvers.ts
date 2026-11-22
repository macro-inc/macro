import { optimisticResolver } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  DeletePropertyDefinitionDocument,
  DeletePropertyOptionDocument,
  UpdatePropertyOptionDocument,
} from '@service-storage/graphql/generated/graphql';

/** Hide the record at once; the cache keeps its tombstone when the server agrees. */
function deletion(graphqlTypeName: string, entityId: string) {
  return {
    prediction: {
      __typename: 'GraphqlCacheDeletion' as const,
      graphqlTypeName,
      entityId,
    },
    options: {
      identityBindings: [
        {
          localKey: `${graphqlTypeName}:${entityId}`,
          responsePath: [],
          deleteRecord: true,
        },
      ],
    },
  };
}

/**
 * Catalog writes whose outcome the client knows. Lists drop deleted records
 * and re-sort options by display order as they read, so no list is patched.
 */
export const propertyCatalogOptimisticResolvers = [
  // A null color, like an absent one, leaves the color as it is.
  optimisticResolver(UpdatePropertyOptionDocument, ({ input }) => ({
    __typename: 'GraphqlPropertyOption' as const,
    id: String(input.optionId),
    ...(input.value != null
      ? {
          value: {
            __typename: 'GraphqlStringPropertyOptionValue' as const,
            stringValue: input.value,
          },
        }
      : {}),
    ...(input.color != null ? { color: input.color } : {}),
    ...(input.displayOrder != null ? { displayOrder: input.displayOrder } : {}),
  })),
  optimisticResolver(
    DeletePropertyOptionDocument,
    ({ optionId }) =>
      deletion('GraphqlPropertyOption', String(optionId)).prediction,
    ({ optionId }) =>
      deletion('GraphqlPropertyOption', String(optionId)).options
  ),
  optimisticResolver(
    DeletePropertyDefinitionDocument,
    ({ propertyDefinitionId }) =>
      deletion('GraphqlPropertyDefinition', String(propertyDefinitionId))
        .prediction,
    ({ propertyDefinitionId }) =>
      deletion('GraphqlPropertyDefinition', String(propertyDefinitionId))
        .options
  ),
];
