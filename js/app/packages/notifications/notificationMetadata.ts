import type { UnifiedNotification } from '@service-notification/client';
import type {
  ChannelInviteMetadata,
  ChannelMentionMetadata,
  ChannelMessageSendMetadata,
  ChannelReplyMetadata,
  DocumentMentionMetadata,
  InviteToTeamMetadata,
  ItemSharedMetadata,
  ItemSharedOrganizationMetadata,
  NewEmailMetadata,
  NotificationEventType,
} from '@service-notification/generated/schemas';

export interface NotificationMetadataByType {
  [NotificationEventType.item_shared_user]: ItemSharedMetadata;
  [NotificationEventType.item_shared_organization]: ItemSharedOrganizationMetadata;
  [NotificationEventType.channel_mention]: ChannelMentionMetadata;
  [NotificationEventType.document_mention]: DocumentMentionMetadata;
  [NotificationEventType.channel_invite]: ChannelInviteMetadata;
  [NotificationEventType.channel_message_send]: ChannelMessageSendMetadata;
  [NotificationEventType.channel_message_reply]: ChannelReplyMetadata;
  [NotificationEventType.channel_message_document]: DocumentMentionMetadata;
  [NotificationEventType.new_email]: NewEmailMetadata;
  [NotificationEventType.invite_to_team]: InviteToTeamMetadata;
  [NotificationEventType.reject_team_invite]: null;
}

export type UnifiedNotificationMetadata =
  NotificationMetadataByType[keyof NotificationMetadataByType];

export type TypedNotification<T extends NotificationEventType> = Omit<
  UnifiedNotification,
  'notificationEventType' | 'notificationMetadata'
> & {
  notificationEventType: T;
  notificationMetadata: T extends keyof NotificationMetadataByType
    ? NotificationMetadataByType[T]
    : never;
};

export function isItemSharedUser(
  n: UnifiedNotification
): n is TypedNotification<'item_shared_user'> {
  return (
    'notificationEventType' in n &&
    n.notificationEventType === 'item_shared_user'
  );
}

export function isItemSharedOrganization(
  n: UnifiedNotification
): n is TypedNotification<'item_shared_organization'> {
  return (
    'notificationEventType' in n &&
    n.notificationEventType === 'item_shared_organization'
  );
}

export function isChannelMention(
  n: UnifiedNotification
): n is TypedNotification<'channel_mention'> {
  return (
    'notificationEventType' in n &&
    n.notificationEventType === 'channel_mention'
  );
}

export function isDocumentMention(
  n: UnifiedNotification
): n is TypedNotification<'document_mention'> {
  return (
    'notificationEventType' in n &&
    n.notificationEventType === 'document_mention'
  );
}

export function isChannelInvite(
  n: UnifiedNotification
): n is TypedNotification<'channel_invite'> {
  return (
    'notificationEventType' in n && n.notificationEventType === 'channel_invite'
  );
}

export function isChannelMessageSend(
  n: UnifiedNotification
): n is TypedNotification<'channel_message_send'> {
  return (
    'notificationEventType' in n &&
    n.notificationEventType === 'channel_message_send'
  );
}

export function isChannelMessageReply(
  n: UnifiedNotification
): n is TypedNotification<'channel_message_reply'> {
  return (
    'notificationEventType' in n &&
    n.notificationEventType === 'channel_message_reply'
  );
}

export function isChannelMessageDocument(
  n: UnifiedNotification
): n is TypedNotification<'channel_message_document'> {
  return (
    'notificationEventType' in n &&
    n.notificationEventType === 'channel_message_document'
  );
}

export function isNewEmail(
  n: UnifiedNotification
): n is TypedNotification<'new_email'> {
  return (
    'notificationEventType' in n && n.notificationEventType === 'new_email'
  );
}

export function isInviteToTeam(
  n: UnifiedNotification
): n is TypedNotification<'invite_to_team'> {
  return (
    'notificationEventType' in n && n.notificationEventType === 'invite_to_team'
  );
}

export function isRejectTeamInvite(
  n: UnifiedNotification
): n is TypedNotification<'reject_team_invite'> {
  return (
    'notificationEventType' in n &&
    n.notificationEventType === 'reject_team_invite'
  );
}

export function extractMetadata<T extends NotificationEventType>(
  notification: UnifiedNotification,
  type: T
): T extends keyof NotificationMetadataByType
  ? NotificationMetadataByType[T]
  : null {
  if (
    !('notificationEventType' in notification) ||
    notification.notificationEventType !== type ||
    !('notificationMetadata' in notification)
  ) {
    return null as any;
  }
  return notification.notificationMetadata as any;
}

export function isNotificationWithMetadata(
  notification: UnifiedNotification
): notification is UnifiedNotification & {
  notificationEventType: keyof NotificationMetadataByType;
  notificationMetadata: UnifiedNotificationMetadata;
} {
  return (
    'notificationMetadata' in notification &&
    notification.notificationMetadata != null &&
    'notificationEventType' in notification
  );
}

export type UnifiedNotificationWithMetadata<
  T extends keyof NotificationMetadataByType = keyof NotificationMetadataByType,
> = TypedNotification<T>;

export function notificationWithMetadata(
  notification: UnifiedNotification
): TypedNotification<NotificationEventType> | null {
  if (!isNotificationWithMetadata(notification)) return null;
  return notification as TypedNotification<NotificationEventType>;
}
