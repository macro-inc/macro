import type { SplitManager } from '@app/component/split-layout/layoutManager';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { NotificationType } from '@core/types';
import type { UnifiedNotification } from './types';
import { getNotificationById } from '@queries/notification/user-notifications';
import { errAsync, ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';
import type { NotificationSource } from './notification-source';

const CHANNEL_EVENT_TYPES = [
  'channel_mention',
  'channel_message_send',
  'channel_message_reply',
] as const;

/**
 * Opens a split if it is not already open.
 */
function openSplitIfNotOpen(
  layoutManager: SplitManager,
  type: BlockName | BlockAlias | 'component',
  id: string,
  newSplit: boolean = false
) {
  const existing = layoutManager.getSplitByContent(type, id);
  if (existing) {
    existing.activate();
    return;
  }
  layoutManager.openWithSplit(
    { type, id },
    {
      activate: true,
      referredFrom: null,
      preferNewSplit: newSplit,
    }
  );
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
  let messageId: string | undefined;
  let threadId: string | undefined;

  const tag = notification.notification_metadata.tag;
  if (tag === 'channel_mention') {
    messageId = notification.notification_metadata.content.messageId;
    threadId = notification.notification_metadata.content.threadId ?? undefined;
  } else if (tag === 'channel_message_send') {
    messageId = notification.notification_metadata.content.messageId;
  } else if (tag === 'channel_message_reply') {
    messageId = notification.notification_metadata.content.messageId;
    threadId = notification.notification_metadata.content.threadId;
  }

  openSplitIfNotOpen(layoutManager, 'channel', channelId, newSplit);

  const orchestrator = layoutManager.getOrchestrator();
  const handle = await orchestrator.getBlockHandle(channelId, 'channel');

  handle?.goToLocationFromParams({
    [CHANNEL_URL_PARAMS.message]: messageId,
    [CHANNEL_URL_PARAMS.thread]: threadId,
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
    .with('new_email', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'new_email') return null;
      return async (lm: SplitManager, newSplit: boolean = false) => {
        openSplitIfNotOpen(lm, 'email', meta.content.threadId, newSplit);
      };
    })
    .with(
      'channel_invite',
      () =>
        async (lm: SplitManager, newSplit: boolean = false) =>
          openSplitIfNotOpen(lm, 'channel', notification.entity_id, newSplit)
    )
    .with('document_mention', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'document_mention') return null;
      return async (lm: SplitManager, newSplit: boolean = false) =>
        openSplitIfNotOpen(
          lm,
          safeFileTypeToBlockName(meta.content.fileType),
          notification.entity_id,
          newSplit
        );
    })
    .with('invite_to_team', () => null)
    .with('task_assigned', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'task_assigned') return null;
      return async (lm: SplitManager, newSplit: boolean = false) => {
        openSplitIfNotOpen(lm, 'task', meta.content.taskId, newSplit);
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
          newSplit
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
