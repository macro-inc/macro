import type { SplitManager } from '@app/component/split-layout/layoutManager';
import type { BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { NotificationType } from '@core/types';
import type { TypedNotification } from '@notifications';
import { errAsync, ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';

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
  type: BlockName | 'component',
  id: string
) {
  const isSplitOpen = layoutManager.hasSplit(type, id);

  if (!isSplitOpen) {
    layoutManager.createNewSplit({
      type,
      id,
    });
  }
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
  const channelId = notification.eventItemId;
  const messageId = notification.notificationMetadata.messageId;
  openSplitIfNotOpen(layoutManager, 'channel', channelId);

  const orchestrator = layoutManager.getOrchestrator();

  const handle = await orchestrator.getBlockHandle(channelId, 'channel');

  handle?.goToLocationFromParams({
    messageId,
    threadId: channelId,
  });
}

function safeFileTypeToBlockName(fileType: string | undefined | null) {
  return fileTypeToBlockName(fileType) ?? 'unknown';
}

type NotSupportedError = {
  tag: 'NotSupportedError';
  notificationType: NotificationType;
};

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
        openSplitIfNotOpen(lm, 'channel', n.eventItemId)
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
          n.eventItemId
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
          n.eventItemId
        )
    )
    .with(
      {
        notificationEventType: P.union('invite_to_team', 'reject_team_invite'),
      },
      () => null
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
