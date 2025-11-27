import type { BlockName } from '@core/block';
import { type EntityType, NotificationType } from '@core/types';
import type { NotificationEventType } from '@service-notification/generated/schemas';
import type { TypedNotification } from './notification-metadata';
import type {
  DocumentNameResolver,
  UserNameResolver,
} from './notification-resolvers';

export type NotificationData = {
  actor?: { id: string };
  action: string;
  type: NotificationEventType;
  target?: {
    type: EntityType;
    id?: string;
    name?: string | null;
    show?: boolean;
  };
  content?: string | null;
  meta?: {
    blockName?: BlockName;
    messageId?: string;
    threadId?: string;
    fileType?: string | null;
    itemType?: string;
    itemId?: string;
    permissionLevel?: string | null;
    sender?: string | null;
    subject?: string;
    snippet?: string;
  };
};

export const NOTIFICATION_LABEL_BY_TYPE: Record<NotificationType, string> = {
  [NotificationType.channel_mention]: 'MENTION',
  [NotificationType.channel_message_send]: 'MESSAGE',
  [NotificationType.channel_message_reply]: 'REPLY',
  [NotificationType.document_mention]: 'MENTION',
  [NotificationType.channel_message_document]: 'DOCUMENT',
  [NotificationType.item_shared_user]: 'SHARED',
  [NotificationType.item_shared_organization]: 'SHARED',
  [NotificationType.channel_invite]: 'INVITE',
  [NotificationType.new_email]: 'EMAIL',
  [NotificationType.invite_to_team]: 'INVITE',
  [NotificationType.reject_team_invite]: 'REJECTED',
} as const;

const extractors: {
  [K in NotificationEventType]: (
    n: TypedNotification<K>
  ) => NotificationData | null;
} = {
  item_shared_user: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: m.sharedBy ? { id: m.sharedBy! } : undefined,
      action: 'shared',
      target: {
        type: m.itemType?.toLowerCase() as EntityType,
        id: m.itemId,
        name: m.itemName,
      },
      content: m.itemName ?? undefined,
      meta: {
        permissionLevel: m.permissionLevel,
        itemType: m.itemType,
        itemId: m.itemId,
      },
    };
  },
  item_shared_organization: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: m.sharedBy ? { id: m.sharedBy! } : undefined,
      action: 'shared',
      target: {
        type: m.itemType?.toLowerCase() as EntityType,
        id: m.itemId,
        name: m.itemName,
      },
      content: m.itemName ?? undefined,
      meta: {
        permissionLevel: m.permissionLevel,
        itemType: m.itemType,
        itemId: m.itemId,
      },
    };
  },
  channel_mention: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: n.senderId ? { id: n.senderId! } : undefined,
      action: 'mentioned you in',
      target: {
        type: 'channel',
        id: n.eventItemId,
        show: n.notificationMetadata.channelType !== 'direct_message',
      },
      content: m.messageContent,
      meta: {
        messageId: m.messageId,
      },
    };
  },
  document_mention: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: n.senderId ? { id: n.senderId! } : undefined,
      action: 'mentioned you in',
      target: { type: 'document', id: n.eventItemId, name: m.documentName },
      content: m.documentName,
      meta: {
        fileType: m.fileType,
      },
    };
  },
  channel_invite: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: m.invitedBy ? { id: m.invitedBy! } : undefined,
      action: 'invited you to',
      target: { type: 'channel', id: n.eventItemId, name: m.channelName },
      content: m.channelName,
    };
  },
  channel_message_send: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: m.sender ? { id: m.sender! } : undefined,
      action: 'sent a message in',
      target: {
        type: 'channel',
        id: n.eventItemId,
        show: n.notificationMetadata.channelType !== 'direct_message',
      },
      content: m.messageContent,
      meta: {
        messageId: m.messageId,
      },
    };
  },
  channel_message_reply: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: m.userId ? { id: m.userId! } : undefined,
      action: 'replied in',
      target: {
        type: 'channel',
        id: n.eventItemId,
        show: n.notificationMetadata.channelType !== 'direct_message',
      },
      content: m.messageContent,
      meta: {
        messageId: m.messageId,
        threadId: m.threadId,
      },
    };
  },
  channel_message_document: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: m.owner ? { id: m.owner! } : undefined,
      action: 'shared with you',
      target: { type: 'document', id: n.eventItemId, name: m.documentName },
      content: m.documentName,
      meta: {
        fileType: m.fileType,
      },
    };
  },
  new_email: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: m.sender ? { id: m.sender! } : undefined,
      action: 'sent a new email',
      target: { type: 'email', id: n.eventItemId, show: false },
      content: m.subject,
      meta: {
        sender: m.sender,
        subject: m.subject,
        snippet: m.snippet,
      },
    };
  },
  invite_to_team: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: m.invitedBy ? { id: m.invitedBy! } : undefined,
      action: 'invited you to',
      target: { type: 'team', id: n.eventItemId, name: m.teamName },
      content: m.teamName,
    };
  },
  reject_team_invite: (n) => {
    const m = n.notificationMetadata;
    if (!m) return null;
    return {
      type: n.notificationEventType,
      actor: undefined,
      action: 'rejected your team invitation',
      target: { type: 'team', id: n.eventItemId },
      content: undefined,
    };
  },
};

type NotificationDataError = 'no_extractor' | 'no_extracted_data';

export function extractNotificationData<T extends NotificationEventType>(
  notification: TypedNotification<T>
): NotificationData | NotificationDataError {
  const extractor = extractors[notification.notificationEventType];
  if (!extractor) return 'no_extractor';
  return extractor(notification as any) ?? 'no_extracted_data';
}
