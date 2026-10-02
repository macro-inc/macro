import { MarkEmailThreadSeenDocument } from '../../service-clients/service-storage/graphql/generated/graphql';
import { optimisticResolver } from './optimistic-resolvers';

/** Compile-time contract: recipes are checked against their generated documents. */
export function checkOptimisticMutationTypes() {
  optimisticResolver(MarkEmailThreadSeenDocument, (variables) => {
    // @ts-expect-error Variables must come from the generated mutation.
    variables.threadId;
    return {
      id: String(variables.input.threadId),
      isRead: true,
    };
  });
  // @ts-expect-error Changed records must retain their normalized identity.
  optimisticResolver(MarkEmailThreadSeenDocument, () => ({ isRead: true }));
  optimisticResolver(MarkEmailThreadSeenDocument, () => ({
    id: 'thread',
    // @ts-expect-error Generated scalar types cannot be replaced by strings.
    isRead: 'yes',
  }));
  optimisticResolver(MarkEmailThreadSeenDocument, () => ({
    id: 'thread',
    // @ts-expect-error Entity types must match the generated mutation field.
    __typename: 'GraphqlNotification',
  }));
}
