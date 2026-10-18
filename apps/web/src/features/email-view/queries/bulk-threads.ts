import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { catchToResult } from '@core/util/result';
import { queryKeys } from '@entity';
import { queryClient } from '@queries/client';
import { updateNotificationsForEntities } from '@queries/notification/entity-mutations';
import { bulkMarkNotificationsAsUndone } from '@queries/notification/user-notifications';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { refreshSoupEntities } from '@queries/soup/refresh';
import { emailClient } from '@service-email/client';
import type {
  ApiBulkThreadAction,
  ApiBulkThreadCursor,
} from '@service-email/generated/schemas';
import type { EmailBulkQuery } from './bulk-query';

export type EmailBulkTargetsRequest = {
  query: EmailBulkQuery;
  /** "Select all below": start at this thread, inclusive. */
  fromThreadId?: string;
  cursor?: ApiBulkThreadCursor;
};

/** Network capabilities a bulk selection needs, in production form. */
export const emailBulkThreads = {
  listTargets: (request: EmailBulkTargetsRequest) =>
    emailClient.listBulkThreadTargets({
      ...request.query,
      fromThreadId: request.fromThreadId,
      cursor: request.cursor,
    }),

  applyAction: (threadIds: string[], action: ApiBulkThreadAction) =>
    emailClient.applyBulkThreadAction({ threadIds, action }),

  /** Done also acknowledges each thread's notifications, as a single Done does. */
  markNotificationsDone: (threadIds: string[]) =>
    catchToResult(async () => {
      const notifications = await updateNotificationsForEntities({
        entities: threadIds.map((id) => ({ type: 'email' as const, id })),
        operation: 'MARK_DONE',
      });
      return notifications.map((notification) => notification.id);
    }),

  restoreNotifications: (notificationIds: string[]) =>
    catchToResult(() => bulkMarkNotificationsAsUndone(notificationIds)),

  /** Revalidate every mounted mail list after the server accepted changes. */
  refreshLists: async (threadIds: string[]) => {
    if (isFeatureEnabled(enableGraphqlSoup)) {
      await refreshActiveGraphqlSoupQueries();
      return;
    }
    await Promise.all([
      refreshSoupEntities(threadIds),
      queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
    ]);
  },
};

export type EmailBulkThreads = typeof emailBulkThreads;
