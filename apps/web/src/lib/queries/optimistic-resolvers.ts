import { optimisticResolver } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  MarkEmailThreadSeenDocument,
  MarkEmailThreadUnreadDocument,
  SetEmailThreadArchivedDocument,
  UpdateNotificationsDocument,
} from '../service-clients/service-storage/graphql/generated/graphql';

/** Local mutation semantics. Only predicted fields enter the optimistic layer. */
export const soupOptimisticResolvers = [
  optimisticResolver(MarkEmailThreadSeenDocument, ({ input }) => ({
    __typename: 'GraphqlSoupEmailThread',
    id: String(input.threadId),
    isRead: true,
  })),
  optimisticResolver(MarkEmailThreadUnreadDocument, ({ input }) => ({
    __typename: 'GraphqlSoupEmailThread',
    id: String(input.threadId),
    isRead: false,
  })),
  optimisticResolver(SetEmailThreadArchivedDocument, ({ input }) => ({
    __typename: 'GraphqlSoupEmailThread',
    id: String(input.threadId),
    inboxVisible: !input.archived,
  })),
  optimisticResolver(UpdateNotificationsDocument, ({ input }) =>
    input.notificationIds.map((id) => ({
      __typename: 'GraphqlNotification',
      id: String(id),
      // Seen/reopen are conditional transitions; don't invent their outcomes.
      ...(input.operation === 'MARK_DONE' ? { state: 'DONE' as const } : {}),
    }))
  ),
];
