import { optimisticResolver } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  DismissIdeaDocument,
  DismissRoutineSuggestionDocument,
  MarkEmailThreadSeenDocument,
  MarkEmailThreadUnreadDocument,
  SetEmailThreadArchivedDocument,
  SetEmailThreadsArchivedDocument,
  UpdateNotificationsDocument,
} from '../service-clients/service-storage/graphql/generated/graphql';
import { entityOptimisticResolvers } from './entity-optimistic-resolvers';

/** Local mutation semantics. Only predicted fields enter the optimistic layer. */
export const soupOptimisticResolvers = [
  ...entityOptimisticResolvers,
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
  // Which threads fail is the server's call; it reloads them with their
  // unchanged state.
  optimisticResolver(SetEmailThreadsArchivedDocument, ({ input }) => ({
    threads: input.threadIds.map((id) => ({
      __typename: 'GraphqlSoupEmailThread' as const,
      id: String(id),
      inboxVisible: !input.archived,
    })),
  })),
  optimisticResolver(DismissRoutineSuggestionDocument, ({ suggestionId }) => ({
    __typename: 'GraphqlRoutineSuggestion',
    id: String(suggestionId),
    state: 'DISMISSED' as const,
  })),
  optimisticResolver(DismissIdeaDocument, ({ ideaId }) => ({
    __typename: 'GraphqlIdea',
    id: String(ideaId),
    state: 'DISMISSED' as const,
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
