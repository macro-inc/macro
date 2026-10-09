import { MarkEmailThreadSeenDocument } from '../../service-clients/service-storage/graphql/generated/graphql';
import { optimisticResolver } from './optimistic-resolvers';

/** Compile-time contract: recipes are checked against their generated documents. */
export function checkOptimisticMutationTypes() {
  optimisticResolver(
    MarkEmailThreadSeenDocument,
    (args) => {
      // @ts-expect-error Arguments are typed by the generated mutation variables.
      args.threadId;
      return {
        id: String(args.input.threadId),
        isRead: true,
      };
    },
    (args) => {
      // @ts-expect-error Options receive the same typed arguments.
      args.threadId;
      return {};
    }
  );
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
