import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { getDisplayNameParts, tryMacroId } from '@core/user';
import { openExternalUrl } from '@core/util/url';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import {
  getGithubSenderLogin,
  isGithubNotificationType,
} from '@entity/extractors-notification/notification-description-helpers';
import { isEntityDiscussionEvent } from '@notifications/entity-discussion';
import { setDoneOverride } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import { useRespondToCalendarJoinRequestMutation } from '@queries/calendar/join-requests';
import { revalidateNotificationReaders } from '@queries/notification/revalidation';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
  subscribeGraphqlSoupReconnected,
} from '@service-storage/graphql-soup';
import { Show } from 'solid-js';
import {
  type NotificationsInboxContext,
  NotificationsInboxProvider,
} from './context/notifications-inbox-context';
import { openNotificationInSplit } from './open-notification-in-split';
import { createNotificationInboxSource } from './queries/notification-inbox-source';
import { resolveAccessRequest } from './queries/row-actions';
import { NotificationsView } from './views/notifications-view';

const filterStorage = createUserScopedStorage('macro:notifications:filters:v1');

function userName(userId: string): string | undefined {
  const parts = getDisplayNameParts(tryMacroId(userId), {
    emailFallback: 'local-part',
  });
  return parts.firstName || parts.fullName || undefined;
}

function senderName(notification: UnifiedNotification): string | undefined {
  const metadata = notification.notification_metadata;
  if (isEntityDiscussionEvent(metadata) && metadata.content.senderDisplayName) {
    return metadata.content.senderDisplayName;
  }
  // GitHub senders keep their GitHub login, even when linked to Macro.
  if (isGithubNotificationType(metadata.tag)) {
    return getGithubSenderLogin(notification);
  }
  return undefined;
}

function createAppNotificationsInboxContext(
  userId: string,
  answerJoinRequest: NotificationsInboxContext['requests']['answerJoinRequest']
): NotificationsInboxContext {
  return {
    requests: { resolveAccessRequest, answerJoinRequest },
    createFeed: (scope) =>
      createNotificationInboxSource({
        client: getGraphqlSoupClient,
        cacheHost: getGraphqlCacheHost,
        scope,
        enabled: () => true,
        onReconnected: subscribeGraphqlSoupReconnected,
        overrideNotificationsDone: (ids) => setDoneOverride(ids, true),
        revalidateNotifications: revalidateNotificationReaders,
      }),
    userName,
    senderName,
    openUrl: openExternalUrl,
    filterStorage: {
      read: () => filterStorage.read(userId),
      write: (value) => filterStorage.write(userId, value),
    },
  };
}

/** The Notifications view with the app's feed, notification state and navigation. */
export function NotificationsInbox() {
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();
  const { openSettings } = useSettingsState();
  const respondToJoinRequest = useRespondToCalendarJoinRequestMutation();
  const answerJoinRequest: NotificationsInboxContext['requests']['answerJoinRequest'] =
    async (request, accept) => {
      await respondToJoinRequest.mutateAsync({
        request: { id: request.requestId, eventId: request.eventId },
        decision: accept ? 'accept' : 'decline',
      });
    };
  return (
    <Show when={userId()} keyed>
      {(id) => (
        <NotificationsInboxProvider
          value={createAppNotificationsInboxContext(id, answerJoinRequest)}
        >
          <NotificationsView
            onOpenSettings={() => openSettings('Notifications')}
            onOpen={(row, { newSplit }) =>
              openNotificationInSplit(row, {
                newSplit,
                splitHandle: panel.handle,
              })
            }
          />
        </NotificationsInboxProvider>
      )}
    </Show>
  );
}
