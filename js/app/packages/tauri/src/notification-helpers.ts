import type { BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { NotificationType } from '@core/types';
import type { TypedNotification } from '@notifications';
import { match, P } from 'ts-pattern';

export function isHighPriorityNotification(
  notification: TypedNotification<NotificationType>
): boolean {
  const type = notification.notificationEventType;

  if (type === 'channel_mention' || type === 'document_mention') {
    return true;
  }

  if (
    type === 'item_shared_user' ||
    type === 'item_shared_organization' ||
    type === 'channel_message_document'
  ) {
    return true;
  }

  if (
    'notificationMetadata' in notification &&
    notification.notificationMetadata &&
    typeof notification.notificationMetadata === 'object' &&
    'channelType' in notification.notificationMetadata
  ) {
    return notification.notificationMetadata.channelType === 'direct_message';
  }

  return false;
}

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

function safeFileTypeToBlockName(
  fileType: string | undefined | null
): BlockName | 'unknown' {
  return fileTypeToBlockName(fileType) ?? 'unknown';
}

export function generateDeepLinkUrl(
  notification: TypedNotification<NotificationType>
): string | null {
  return match(notification)
    .with({ notificationEventType: P.union(...CHANNEL_EVENT_TYPES) }, (n) => {
      const channelId = n.eventItemId;
      const messageId = n.notificationMetadata.messageId;
      const threadId =
        'threadId' in n.notificationMetadata
          ? n.notificationMetadata.threadId
          : undefined;

      const params = new URLSearchParams();
      params.set('message_id', messageId);
      if (threadId) params.set('thread_id', threadId);

      return `macro://channel/${channelId}?${params.toString()}`;
    })
    .with({ notificationEventType: 'new_email' }, (n) => {
      const threadId = n.notificationMetadata.threadId;
      return `macro://email/${threadId}`;
    })
    .with({ notificationEventType: 'channel_invite' }, (n) => {
      return `macro://channel/${n.eventItemId}`;
    })
    .with(
      {
        notificationEventType: P.union(
          'item_shared_user',
          'item_shared_organization'
        ),
      },
      (n) => {
        const itemType = n.notificationMetadata.itemType;
        const blockName = safeFileTypeToBlockName(itemType);
        return `macro://${blockName}/${n.eventItemId}`;
      }
    )
    .with(
      {
        notificationEventType: P.union(
          'document_mention',
          'channel_message_document'
        ),
      },
      (n) => {
        const fileType = n.notificationMetadata.fileType;
        const blockName = safeFileTypeToBlockName(fileType);
        return `macro://${blockName}/${n.eventItemId}`;
      }
    )
    .with(
      {
        notificationEventType: P.union('invite_to_team', 'reject_team_invite'),
      },
      () => null
    )
    .exhaustive();
}
