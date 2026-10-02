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
    response: {
      markEmailThreadSeen: {
        __typename: 'GraphqlSoupEmailThread' as const,
        id: String(input.threadId),
        isRead: true,
      },
    },
  })),
  optimisticResolver(MarkEmailThreadUnreadDocument, ({ input }) => ({
    response: {
      markEmailThreadUnread: {
        __typename: 'GraphqlSoupEmailThread' as const,
        id: String(input.threadId),
        isRead: false,
      },
    },
  })),
  optimisticResolver(SetEmailThreadArchivedDocument, ({ input }) => ({
    response: {
      setEmailThreadArchived: {
        __typename: 'GraphqlSoupEmailThread' as const,
        id: String(input.threadId),
        inboxVisible: !input.archived,
      },
    },
  })),
  optimisticResolver(UpdateNotificationsDocument, ({ input }) => ({
    response: {
      updateNotifications: input.notificationIds.map((id) => ({
        __typename: 'GraphqlNotification' as const,
        id: String(id),
        // Seen/reopen are conditional transitions; don't invent their outcomes.
        ...(input.operation === 'MARK_DONE' ? { state: 'DONE' as const } : {}),
      })),
    },
  })),
];
