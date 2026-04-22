import type { SplitManager } from '@app/component/split-layout/layoutManager';
import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { NotificationType } from '@core/types';
import type { UnifiedNotification } from './types';
import { getNotificationById } from '@queries/notification/user-notifications';
import { errAsync, ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';
import type { NotificationSource } from './notification-source';
import {
  getChannelParams,
  navigateToChannelMessage,
} from '@block-channel/utils/link';
import { isChannelNotification } from './notification-helpers';
import { CHANNEL_EVENT_TYPES } from './notification-source';
import {
  stackNotifications,
  getMostRecentNotification,
} from './notification-stacking';

/**
 * Opens a split if it is not already open.
 */
function openSplitIfNotOpen(
  layoutManager: SplitManager,
  type: BlockName | BlockAlias | 'component',
  id: string,
  options: { newSplit?: boolean; params?: Record<string, string> } = {}
) {
  const existing = layoutManager.getSplitByContent(type, id);
  if (existing) {
    existing.activate();
    return;
  }
  layoutManager.openWithSplit(
    { type, id, params: options.params },
    {
      activate: true,
      referredFrom: null,
      preferNewSplit: options.newSplit,
    }
  );
}

export function getChannelNotificationParams(
  notification: UnifiedNotification
): { messageId?: string; threadId?: string; params?: Record<string, string> } {
  if (!isChannelNotification(notification)) return {};

  const meta = notification.notification_metadata;
  const { messageId, threadId } = match(meta)
    .with({ tag: 'channel_mention' }, (m) => ({
      messageId: m.content.messageId,
      threadId: m.content.threadId ?? undefined,
    }))
    .with({ tag: 'channel_message_send' }, (m) => ({
      messageId: m.content.messageId,
      threadId: undefined,
    }))
    .with({ tag: 'channel_message_reply' }, (m) => ({
      messageId: m.content.messageId,
      threadId: m.content.threadId,
    }))
    .exhaustive();

  const params = messageId ? getChannelParams(messageId, threadId) : undefined;
  return { messageId, threadId, params };
}

/**
 * Opens a channel notification.
 */
async function openChannelNotification(
  notification: UnifiedNotification,
  layoutManager: SplitManager,
  newSplit: boolean = false
) {
  const channelId = notification.entity_id;
  const { messageId, threadId } = getChannelNotificationParams(notification);

  if (!messageId) {
    openSplitIfNotOpen(layoutManager, 'channel', channelId, { newSplit });
    return;
  }

  const orchestrator = layoutManager.getOrchestrator();
  await navigateToChannelMessage(orchestrator, channelId, messageId, threadId, {
    splitManager: layoutManager,
    preferNewSplit: newSplit,
  });
}

function safeFileTypeToBlockName(fileType: string | undefined | null) {
  return fileTypeToBlockName(fileType) ?? 'unknown';
}

type NotSupportedError = {
  tag: 'NotSupportedError';
  notificationType: NotificationType;
};

type NotFoundError = {
  tag: 'NotFoundError';
  notificationId: string;
};

export type OpenNotificationFromIdError = NotSupportedError | NotFoundError;

function getSupportedHandler(
  notification: UnifiedNotification
): ((layoutManager: SplitManager, newSplit?: boolean) => Promise<void>) | null {
  const tag = notification.notification_metadata.tag;

  return match(tag)
    .with(
      P.union(...CHANNEL_EVENT_TYPES),
      () =>
        (lm: SplitManager, newSplit: boolean = false) =>
          openChannelNotification(notification, lm, newSplit)
    )
    .with(
      'ai_response',
      () =>
        async (lm: SplitManager, newSplit: boolean = false) =>
          openSplitIfNotOpen(lm, 'chat', notification.entity_id, { newSplit })
    )
    .with('new_email', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'new_email') return null;
      return async (lm: SplitManager, newSplit: boolean = false) => {
        openSplitIfNotOpen(lm, 'email', meta.content.threadId, { newSplit });
      };
    })
    .with(
      'channel_invite',
      () =>
        async (lm: SplitManager, newSplit: boolean = false) =>
          openSplitIfNotOpen(lm, 'channel', notification.entity_id, {
            newSplit,
          })
    )
    .with('document_mention', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'document_mention') return null;
      return async (lm: SplitManager, newSplit: boolean = false) =>
        openSplitIfNotOpen(
          lm,
          safeFileTypeToBlockName(meta.content.fileType),
          notification.entity_id,
          { newSplit }
        );
    })
    .with('invite_to_team', () => null)
    .with('task_assigned', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'task_assigned') return null;
      return async (lm: SplitManager, newSplit: boolean = false) => {
        openSplitIfNotOpen(lm, 'task', meta.content.taskId, { newSplit });
      };
    })
    .with('mentioned_in_document_comment', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'mentioned_in_document_comment') return null;
      return async (lm: SplitManager, newSplit: boolean = false) =>
        openSplitIfNotOpen(
          lm,
          safeFileTypeToBlockName(meta.content.fileType),
          notification.entity_id,
          { newSplit }
        );
    })
    .with('replied_to_document_comment_thread', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'replied_to_document_comment_thread') return null;
      return async (lm: SplitManager, newSplit: boolean = false) =>
        openSplitIfNotOpen(
          lm,
          safeFileTypeToBlockName(meta.content.fileType),
          notification.entity_id,
          { newSplit }
        );
    })
    .with('commented_on_document', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'commented_on_document') return null;
      return async (lm: SplitManager, newSplit: boolean = false) =>
        openSplitIfNotOpen(
          lm,
          safeFileTypeToBlockName(meta.content.fileType),
          notification.entity_id,
          { newSplit }
        );
    })
    .exhaustive();
}

/**
 * Opens the notification given the layout manager.
 * Some notifications are not supported and will return an error.
 */
export function openNotification(
  notification: UnifiedNotification,
  layoutManager: SplitManager,
  newSplit: boolean = false
): ResultAsync<void, NotSupportedError> {
  const handler = getSupportedHandler(notification);
  if (!handler) {
    return errAsync({
      tag: 'NotSupportedError',
      notificationType: notification.notification_metadata.tag,
    });
  }
  return ResultAsync.fromSafePromise(handler(layoutManager, newSplit));
}

export function openSingleStackNotification(
  notifications: UnifiedNotification[],
  layoutManager: SplitManager,
  newSplit: boolean = false
): boolean {
  const stacks = stackNotifications(notifications);
  if (stacks.length !== 1) return false;
  const mostRecent = getMostRecentNotification(stacks[0]!);
  openNotification(mostRecent, layoutManager, newSplit);
  return true;
}

export function openNotificationFromId(
  notificationId: string,
  layoutManager: SplitManager,
  notificationSource: NotificationSource
): ResultAsync<void, OpenNotificationFromIdError> {
  // Check notification source first
  const cached = notificationSource
    .notifications()
    .find((n) => n.id === notificationId);
  if (cached) {
    return openNotification(cached, layoutManager);
  }

  // Fetch if not in notification source
  return ResultAsync.fromSafePromise(
    getNotificationById(notificationId)
  ).andThen((unified) => {
    if (!unified) {
      const err: NotFoundError = { tag: 'NotFoundError', notificationId };
      return errAsync(err);
    }
    return openNotification(unified, layoutManager);
  });
}
