import type { SplitManager } from '@app/component/split-layout/layoutManager';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { NotificationType } from '@core/types';
import { getNotificationById } from '@queries/notification/user-notifications';
import { errAsync, ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';
import {
  tryToTypedNotification,
  type TypedNotification,
} from './notification-metadata';

/**
 * Notification event types that are all handled by opening a channel
 * with a specific message and optionally a thread id
 */
const ChannelNotificationType = {
  channel_mention: NotificationType.channel_mention,
  channel_message_send: NotificationType.channel_message_send,
  channel_message_reply: NotificationType.channel_message_reply,
} as const satisfies Partial<Record<string, NotificationType>>;

type ChannelNotificationType =
  (typeof ChannelNotificationType)[keyof typeof ChannelNotificationType];

const CHANNEL_EVENT_TYPES = Object.values(ChannelNotificationType) as [
  ChannelNotificationType,
  ...ChannelNotificationType[],
];

/**
 * Opens a split if it is not already open.
 *
 * @param layoutManager The layout manager to use.
 * @param type The type of the block to open.
 * @param id The id of the block to open.
 * @returns A result async that resolves to void if the split was opened successfully, or an error if the split could not be opened.
 */
function openSplitIfNotOpen(
  layoutManager: SplitManager,
  type: BlockName | BlockAlias | 'component',
  id: string
) {
  const existing = layoutManager.getSplitByContent(type, id);
  if (existing) {
    existing.activate();
    return;
  }
  layoutManager.createNewSplit({
    content: { type, id },
    activate: true,
    referredFrom: null,
  });
}

/**
 * Opens a channel notification.
 *
 * @param notification The notification to open.
 * @param layoutManager The layout manager to use.
 * @returns A result async that resolves to void if the notification was opened successfully, or an error if the notification could not be opened.
 */
async function openChannelNotification(
  notification: TypedNotification<ChannelNotificationType>,
  layoutManager: SplitManager
) {
  const channelId = notification.entity_id;
  const messageId = notification.notificationMetadata.messageId;
  const threadId =
    'threadId' in notification.notificationMetadata
      ? notification.notificationMetadata.threadId
      : undefined;
  openSplitIfNotOpen(layoutManager, 'channel', channelId);

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

type NotTypedError = {
  tag: 'NotTypedError';
  notificationId: string;
};

export type OpenNotificationFromIdError =
  | NotSupportedError
  | NotFoundError
  | NotTypedError;

function getSupportedHandler(
  notification: TypedNotification<NotificationType>
): ((layoutManager: SplitManager) => Promise<void>) | null {
  return match(notification)
    .with(
      { notificationEventType: P.union(...CHANNEL_EVENT_TYPES) },
      (n) => (lm: SplitManager) => openChannelNotification(n, lm)
    )
    .with(
      { notificationEventType: 'new_email' },
      (n) => async (lm: SplitManager) => {
        openSplitIfNotOpen(lm, 'email', n.notificationMetadata.threadId);
      }
    )
    .with(
      { notificationEventType: 'channel_invite' },
      (n) => async (lm: SplitManager) =>
        openSplitIfNotOpen(lm, 'channel', n.entity_id)
    )
    .with(
      {
        notificationEventType: P.union(
          'item_shared_user',
          'item_shared_organization'
        ),
      },
      (n) => async (lm: SplitManager) =>
        openSplitIfNotOpen(
          lm,
          safeFileTypeToBlockName(n.notificationMetadata.itemType),
          n.entity_id
        )
    )
    .with(
      {
        notificationEventType: P.union(
          'document_mention',
          'channel_message_document'
        ),
      },
      (n) => async (lm: SplitManager) =>
        openSplitIfNotOpen(
          lm,
          safeFileTypeToBlockName(n.notificationMetadata.fileType),
          n.entity_id
        )
    )
    .with(
      {
        notificationEventType: P.union('invite_to_team', 'reject_team_invite'),
      },
      () => null
    )
    .with(
      { notificationEventType: 'task_assigned' },
      (n) => async (lm: SplitManager) => {
        openSplitIfNotOpen(lm, 'task', n.notificationMetadata.taskId);
      }
    )
    .exhaustive();
}

/**
 * Opens the notification given the layout manager.
 * Some notifications are not supported and will return an error.
 *
 * @param notification The notification to open.
 * @param layoutManager The layout manager to use.
 * @returns A result async that resolves to void if the notification was opened successfully, or an error if the notification is not supported.
 */
export function openNotification(
  notification: TypedNotification<NotificationType>,
  layoutManager: SplitManager
): ResultAsync<void, NotSupportedError> {
  const handler = getSupportedHandler(notification);
  if (!handler) {
    return errAsync({
      tag: 'NotSupportedError',
      notificationType: notification.notificationEventType,
    });
  }
  return ResultAsync.fromSafePromise(handler(layoutManager));
}

export function openNotificationFromId(
  notificationId: string,
  layoutManager: SplitManager
): ResultAsync<void, OpenNotificationFromIdError> {
  return ResultAsync.fromSafePromise(
    getNotificationById(notificationId)
  ).andThen((unified) => {
    if (!unified) {
      const err: NotFoundError = { tag: 'NotFoundError', notificationId };
      return errAsync(err);
    }

    const typed = tryToTypedNotification(unified);
    if (!typed) {
      const err: NotTypedError = { tag: 'NotTypedError', notificationId };
      return errAsync(err);
    }

    return openNotification(typed, layoutManager);
  });
}
