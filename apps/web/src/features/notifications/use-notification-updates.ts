import { queryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import { invalidateEmailLinks } from '@queries/email/link';
import { invalidateEntityNotifications } from '@queries/notification/user-notifications';
import {
  invalidateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/normalized-cache';
import { teamKeys } from '@queries/team/keys';
import { onCleanup } from 'solid-js';
import { match } from 'ts-pattern';
import type { NotificationSource } from './notification-source';
import type { UnifiedNotification } from './types';

function refreshSoupEntity(
  notification: UnifiedNotification,
  entityType: Parameters<typeof refetchSoupEntity>[1]
) {
  void refetchSoupEntity(notification.entity_id, entityType);
  invalidateSoupEntity(notification.entity_id);
  void invalidateEntityNotifications(notification.entity_id);
}

function refreshChannel(
  notification: UnifiedNotification,
  threadId?: string | null
) {
  refreshSoupEntity(notification, 'channel');

  if (!threadId) return;

  void refetchSoupEntity(threadId, 'channelThread');
  invalidateSoupEntity(threadId);
  void invalidateEntityNotifications(threadId);
}

function refreshEmailThread(notification: UnifiedNotification) {
  void refetchSoupEntity(notification.entity_id, 'emailThread');
  invalidateSoupEntity(notification.entity_id);
  void queryClient.invalidateQueries({
    queryKey: emailKeys.threadMessages(notification.entity_id).queryKey,
  });
}

/**
 * Applies domain cache updates for a connection-gateway notification.
 *
 * Known notification types are handled explicitly. Unknown types are ignored
 * so a newer backend cannot break clients that have not added support yet.
 */
export function handleNotificationUpdate(notification: UnifiedNotification) {
  match(notification.notification_metadata)
    .with({ tag: 'channel_mention' }, ({ content }) => {
      refreshChannel(
        notification,
        (content.threadId ?? content.messageId)?.toString()
      );
    })
    .with({ tag: 'document_mention' }, ({ content }) => {
      refreshChannel(notification, content.threadId?.toString());
    })
    .with({ tag: 'mentioned_in_document_comment' }, () => {
      refreshSoupEntity(notification, 'document');
    })
    .with({ tag: 'replied_to_document_comment_thread' }, () => {
      refreshSoupEntity(notification, 'document');
    })
    .with({ tag: 'commented_on_document' }, () => {
      refreshSoupEntity(notification, 'document');
    })
    .with({ tag: 'channel_invite' }, () => {
      refreshChannel(notification);
    })
    .with({ tag: 'channel_message_send' }, () => {
      refreshChannel(notification);
    })
    .with({ tag: 'channel_message_reply' }, ({ content }) => {
      refreshChannel(notification, content.threadId?.toString());
    })
    .with({ tag: 'call_started' }, () => {
      refreshChannel(notification);
    })
    .with({ tag: 'new_email' }, () => {
      refreshEmailThread(notification);
    })
    .with({ tag: 'inbox_reauth_required' }, () => {
      invalidateEmailLinks();
    })
    .with({ tag: 'invite_to_team' }, () => {
      void queryClient.invalidateQueries({
        queryKey: teamKeys.userInvites.queryKey,
      });
    })
    .with({ tag: 'task_assigned' }, () => {
      refreshSoupEntity(notification, 'document');
    })
    .with({ tag: 'ai_response' }, () => {
      refreshSoupEntity(notification, 'chat');
    })
    .with({ tag: 'github_pr_status_changed' }, () => {
      refreshSoupEntity(notification, 'foreignEntity');
    })
    .with({ tag: 'github_pr_check_run' }, () => {
      refreshSoupEntity(notification, 'foreignEntity');
    })
    .with({ tag: 'github_review_requested' }, () => {
      refreshSoupEntity(notification, 'foreignEntity');
    })
    .with({ tag: 'github_pr_comment' }, () => {
      refreshSoupEntity(notification, 'foreignEntity');
    })
    .with({ tag: 'github_pr_mention' }, () => {
      refreshSoupEntity(notification, 'foreignEntity');
    })
    .with({ tag: 'github_pr_review' }, () => {
      refreshSoupEntity(notification, 'foreignEntity');
    })
    .otherwise(() => {
      // Ignore notification types introduced by a newer backend.
    });
}

/** Subscribe globally to notification-driven domain cache updates. */
export function useNotificationUpdates(notificationSource: NotificationSource) {
  const unsubscribe = notificationSource.subscribe(handleNotificationUpdate);
  onCleanup(unsubscribe);
}
