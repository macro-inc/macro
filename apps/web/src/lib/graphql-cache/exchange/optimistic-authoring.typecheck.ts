import { MarkEmailThreadSeenDocument } from '../../service-clients/service-storage/graphql/generated/graphql';
import { optimisticResolver } from './optimistic-resolvers';

/** Compile-time contract: recipes are checked against their generated documents. */
export function checkOptimisticMutationTypes() {
  optimisticResolver(MarkEmailThreadSeenDocument, (variables) => {
    // @ts-expect-error Variables must come from the generated mutation.
    variables.threadId;
    return {
      response: {
        markEmailThreadSeen: {
          id: String(variables.input.threadId),
          isRead: true,
        },
      },
    };
  });
  optimisticResolver(MarkEmailThreadSeenDocument, () => ({
    // @ts-expect-error Changed records must retain their normalized identity.
    response: { markEmailThreadSeen: { isRead: true } },
  }));
  optimisticResolver(MarkEmailThreadSeenDocument, () => ({
    // @ts-expect-error Generated scalar types cannot be replaced by strings.
    response: { markEmailThreadSeen: { id: 'thread', isRead: 'yes' } },
  }));
  optimisticResolver(MarkEmailThreadSeenDocument, () => ({
    // @ts-expect-error The mutation cannot write another response root.
    response: { other: { id: 'thread' } },
  }));
}
