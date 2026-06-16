import type { UnifiedNotification } from '@notifications';
import { format, isSameDay, isSameYear, subDays } from 'date-fns';

export const getNotificationTime = (
  notification: UnifiedNotification
): number => {
  const time = Date.parse(notification.created_at ?? notification.updated_at);
  return Number.isNaN(time) ? 0 : time;
};

export const sortNotifications = (
  notifications: UnifiedNotification[]
): UnifiedNotification[] =>
  notifications.toSorted(
    (a, b) => getNotificationTime(b) - getNotificationTime(a)
  );

export const getDateGroupKey = (time: number): string =>
  format(new Date(time), 'yyyy-M-d');

export const getDateGroupLabel = (time: number): string => {
  const date = new Date(time);
  const now = new Date();

  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, subDays(now, 1))) return 'Yesterday';

  return format(
    date,
    isSameYear(date, now) ? 'EEEE, MMMM d' : 'EEEE, MMMM d, yyyy'
  );
};

const githubNotificationTags = new Set([
  'github_pr_status_changed',
  'github_review_requested',
  'github_pr_comment',
  'github_pr_mention',
  'github_pr_review',
]);

type GithubNotificationMetadata = Extract<
  UnifiedNotification['notification_metadata'],
  {
    tag:
      | 'github_pr_status_changed'
      | 'github_review_requested'
      | 'github_pr_comment'
      | 'github_pr_mention'
      | 'github_pr_review';
  }
>;

const isGithubNotificationMetadata = (
  metadata: UnifiedNotification['notification_metadata']
): metadata is GithubNotificationMetadata =>
  githubNotificationTags.has(metadata.tag);

const isGithubNotification = (notification: UnifiedNotification): boolean =>
  isGithubNotificationMetadata(notification.notification_metadata);

const getGithubGroupKey = (notification: UnifiedNotification): string => {
  const metadata = notification.notification_metadata;
  if (!isGithubNotificationMetadata(metadata)) return notification.id;

  return metadata.content.foreignEntityId || metadata.content.githubKey;
};

const getDocumentCommentThreadId = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'mentioned_in_document_comment':
    case 'replied_to_document_comment_thread':
      return `${notification.entity_id}:${metadata.content.threadId}`;
    case 'commented_on_document':
      return notification.entity_id;
    default:
      return undefined;
  }
};

const getEmailThreadId = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;
  if (metadata.tag !== 'new_email') return undefined;
  return metadata.content.threadId;
};

export const getNotificationGroupKey = (
  notification: UnifiedNotification
): string | undefined => {
  if (isGithubNotification(notification)) {
    return `github:${getGithubGroupKey(notification)}`;
  }

  const documentCommentThreadId = getDocumentCommentThreadId(notification);
  if (documentCommentThreadId) {
    return `document-comments:${documentCommentThreadId}`;
  }

  const emailThreadId = getEmailThreadId(notification);
  if (emailThreadId) return `email:${emailThreadId}`;

  return undefined;
};

export const getChannelMessageId = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_message_send':
    case 'channel_message_reply':
    case 'channel_mention':
      return metadata.content.messageId;
    default:
      return undefined;
  }
};

export const getChannelThreadId = (
  notification: UnifiedNotification
): string | undefined => {
  const metadata = notification.notification_metadata;

  switch (metadata.tag) {
    case 'channel_message_reply':
      return metadata.content.threadId;
    case 'channel_mention':
      return metadata.content.threadId ?? undefined;
    default:
      return undefined;
  }
};

export const isChannelNotification = (
  notification: UnifiedNotification
): boolean => getChannelMessageId(notification) !== undefined;

export const getChannelNode = (
  notification: UnifiedNotification,
  id: string
): string => `${notification.entity_id}:${id}`;

export const getChannelGroupKey = (
  notification: UnifiedNotification,
  referencedThreadIds: Set<string>
): string => {
  const messageId = getChannelMessageId(notification);
  const threadId = getChannelThreadId(notification);
  const messageNode = messageId
    ? getChannelNode(notification, messageId)
    : undefined;

  if (threadId) return getChannelNode(notification, threadId);
  if (messageNode && referencedThreadIds.has(messageNode)) return messageNode;
  return `${notification.entity_id}:root`;
};
