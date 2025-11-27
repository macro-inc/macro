import type { BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { NotificationData } from './notification-preview';

export type NavigationActions = {
  insertSplit: (item: { type: BlockName; id: string }) => void;
  replaceSplit: (item: { type: BlockName; id: string }) => void;
  messageLocation: (
    channelId: string,
    messageId: string,
    threadId?: string
  ) => Promise<void>;
};

export function navigateToNotification({
  data,
  actions,
  shouldInsert = false,
}: {
  data: NotificationData;
  actions: NavigationActions;
  shouldInsert?: boolean;
}): void {
  const { messageLocation } = actions;

  const replaceOrInsertSplit = shouldInsert
    ? actions.insertSplit
    : actions.replaceSplit;

  console.log(replaceOrInsertSplit);

  if (!data.target?.id) return;

  const targetType = data.target.type;
  const targetId = data.target.id;

  switch (targetType) {
    case 'channel':
      if (data.meta?.messageId) {
        replaceOrInsertSplit({ type: 'channel', id: targetId });
        messageLocation(targetId, data.meta.messageId, data.meta.threadId);
      } else {
        replaceOrInsertSplit({ type: 'channel', id: targetId });
      }
      break;

    case 'document':
      if (data.meta?.fileType) {
        const blockType = fileTypeToBlockName(data.meta.fileType) as BlockName;
        replaceOrInsertSplit({ type: blockType, id: targetId });
      }
      break;

    case 'email':
      replaceOrInsertSplit({ type: 'email', id: targetId });
      break;

    case 'team':
      // Team notifications don't have a corresponding block to navigate to
      break;

    default:
      if (data.meta?.itemType) {
        const blockType = data.meta.itemType.toLowerCase() as BlockName;
        replaceOrInsertSplit({ type: blockType, id: targetId });
      }
      break;
  }
}
// import type { BlockName } from '@core/block';
// import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { NotificationType } from '@core/types';
import type { TypedNotification } from '@notifications';
import { errAsync, ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';
import type { SplitManager } from '@app/component/split-layout/layoutManager';

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
