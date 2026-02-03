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
  TaskAssignedMetadata,
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
  [NotificationEventType.task_assigned]: TaskAssignedMetadata;
}

export type UnifiedNotificationMetadata =
  NotificationMetadataByType[keyof NotificationMetadataByType];

/**
 * A notification with a specific event type.
 * Use `getMetadata(notification)` to access the typed metadata content.
 */
export type TypedNotification<
  T extends NotificationEventType = NotificationEventType,
> = UnifiedNotification & {
  notificationEventType: T;
};

/**
 * Extract the typed metadata content from a notification.
 * The API returns notificationMetadata in { tag, content } format - this extracts the content.
 */
export function getMetadata<T extends NotificationEventType>(
  n: TypedNotification<T>
): T extends keyof NotificationMetadataByType
  ? NotificationMetadataByType[T]
  : never {
  // The notificationMetadata is { tag, content } format from the API
  const metadata = n.notificationMetadata as { tag: string; content: unknown };
  return metadata.content as T extends keyof NotificationMetadataByType
    ? NotificationMetadataByType[T]
    : never;
}

function isNotificationType<T extends NotificationEventType>(
  n: UnifiedNotification,
  type: T
): n is TypedNotification<T> {
  return n.notificationEventType === type;
}

export function isItemSharedUser(
  n: UnifiedNotification
): n is TypedNotification<'item_shared_user'> {
  return isNotificationType(n, 'item_shared_user');
}

export function isItemSharedOrganization(
  n: UnifiedNotification
): n is TypedNotification<'item_shared_organization'> {
  return isNotificationType(n, 'item_shared_organization');
}

export function isChannelMention(
  n: UnifiedNotification
): n is TypedNotification<'channel_mention'> {
  return isNotificationType(n, 'channel_mention');
}

export function isDocumentMention(
  n: UnifiedNotification
): n is TypedNotification<'document_mention'> {
  return isNotificationType(n, 'document_mention');
}

export function isChannelInvite(
  n: UnifiedNotification
): n is TypedNotification<'channel_invite'> {
  return isNotificationType(n, 'channel_invite');
}

export function isChannelMessageSend(
  n: UnifiedNotification
): n is TypedNotification<'channel_message_send'> {
  return isNotificationType(n, 'channel_message_send');
}

export function isChannelMessageReply(
  n: UnifiedNotification
): n is TypedNotification<'channel_message_reply'> {
  return isNotificationType(n, 'channel_message_reply');
}

export function isChannelMessageDocument(
  n: UnifiedNotification
): n is TypedNotification<'channel_message_document'> {
  return isNotificationType(n, 'channel_message_document');
}

export function isNewEmail(
  n: UnifiedNotification
): n is TypedNotification<'new_email'> {
  return isNotificationType(n, 'new_email');
}

export function isInviteToTeam(
  n: UnifiedNotification
): n is TypedNotification<'invite_to_team'> {
  return isNotificationType(n, 'invite_to_team');
}

export function isRejectTeamInvite(
  n: UnifiedNotification
): n is TypedNotification<'reject_team_invite'> {
  return isNotificationType(n, 'reject_team_invite');
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

export function tryToTypedNotification(
  notification: UnifiedNotification
): TypedNotification<NotificationEventType> | null {
  if (!isNotificationWithMetadata(notification)) return null;
  return notification as TypedNotification<NotificationEventType>;
}
