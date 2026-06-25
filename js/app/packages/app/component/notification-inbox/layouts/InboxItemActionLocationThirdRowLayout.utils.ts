import { type EntityIconSelector } from '@core/component/EntityIcon';
import {
  differenceInDays,
  differenceInHours,
  differenceInMilliseconds,
  differenceInMonths,
  differenceInWeeks,
  differenceInYears,
  format,
} from 'date-fns';
import {
  type InboxItem as InboxItemData,
  parseInboxSenderName,
} from '../InboxItem';

export function getNotificationTag(item: InboxItemData) {
  return item.notification?.notification_metadata.tag;
}

export function isGroupedChannelThread(item: InboxItemData) {
  const content = item.notification?.notification_metadata.content as
    | { threadId?: string | null }
    | undefined;
  return Boolean(
    item.subItems?.length &&
      item.notification?.notification_metadata.tag?.startsWith('channel_') &&
      content?.threadId
  );
}

export function getInboxItemIconTarget(
  item: InboxItemData
): EntityIconSelector {
  if (item.entitySubType === 'task') return 'task';
  if (
    item.entityType === 'channel_message' ||
    item.entityType === 'channel_thread'
  ) {
    return 'channel';
  }
  if (item.entityType === 'document') return 'md';
  if (item.entityType === 'foreign') return 'default';
  return item.entityType as EntityIconSelector;
}

export function getGithubLocationLabel(item: InboxItemData) {
  const content = item.notification?.notification_metadata.content as
    | { owner?: string; repo?: string; number?: number }
    | undefined;
  if (!content?.owner || !content.repo || content.number == null) {
    return undefined;
  }
  return `${content.owner}/${content.repo}#${content.number}`;
}

export function getGithubTitle(item: InboxItemData) {
  const content = item.notification?.notification_metadata.content as
    | { title?: string }
    | undefined;
  return content?.title;
}

export function getLocationText(item: InboxItemData, nested?: boolean) {
  const tag = getNotificationTag(item);
  if (
    nested ||
    item.channelType === 'direct_message' ||
    tag === 'task_assigned'
  ) {
    return undefined;
  }
  if (item.entityType === 'email' || tag === 'new_email') return undefined;
  if (item.entityType === 'channel') return item.targetName ?? item.entityName;
  if (item.notification?.notification_metadata.tag?.startsWith('github_')) {
    return getGithubLocationLabel(item) ?? item.targetName ?? item.entityName;
  }
  return item.targetName ?? item.entityName;
}

export function getActionText(item: InboxItemData, nested?: boolean) {
  switch (getNotificationTag(item)) {
    case 'channel_mention':
      return nested ? 'mentioned you' : 'mentioned you in';
    case 'channel_message_reply':
      return 'replied';
    case 'channel_message_send':
      return 'sent a message';
    case 'document_mention':
      return 'shared';
    case 'mentioned_in_document_comment':
      return nested ? 'mentioned you' : 'mentioned you in';
    case 'replied_to_document_comment_thread':
      return nested ? 'replied' : 'replied in';
    case 'new_email':
      return 'sent an email';
    case 'task_assigned':
      return 'assigned you a task';
    case 'ai_response':
      return 'responded';
    case 'github_pr_status_changed': {
      const content = item.notification?.notification_metadata.content as
        | { status?: string }
        | undefined;
      return content?.status === 'merged'
        ? 'merged a PR'
        : (item.action ?? 'updated');
    }
    default:
      return item.action ?? 'updated';
  }
}

export function getEmailSubject(item: InboxItemData) {
  const content = item.notification?.notification_metadata.content as
    | { subject?: string }
    | undefined;
  return content?.subject;
}

export function getGroupCount(item: InboxItemData) {
  return (item.subItems?.length ?? 0) + 1;
}

export function getGroupUnreadCount(item: InboxItemData) {
  return (
    (item.unread ? 1 : 0) +
    (item.subItems?.filter((sub) => sub.unread).length ?? 0)
  );
}

export function getContentText(item: InboxItemData, groupRoot?: boolean) {
  if (groupRoot) return item.content || item.entityName || item.targetName;
  if (item.notification?.notification_metadata.tag === 'new_email') {
    return (
      getEmailSubject(item) ||
      item.entityName ||
      item.targetName ||
      item.content
    );
  }
  if (item.notification?.notification_metadata.tag === 'document_mention') {
    return item.entityName || item.targetName || item.content;
  }
  if (item.notification?.notification_metadata.tag === 'task_assigned') {
    return item.entityName || item.targetName || item.content;
  }
  if (item.notification?.notification_metadata.tag?.startsWith('github_')) {
    return (
      getGithubTitle(item) || item.entityName || item.targetName || item.content
    );
  }
  if (item.entityType === 'channel' || item.entityType === 'channel_thread')
    return;
  return item.content || item.entityName || item.targetName || undefined;
}

export function formatCompactRelativeTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const now = new Date();
  const ageMs = differenceInMilliseconds(now, date);
  if (ageMs < 12 * 60 * 60 * 1000) return format(date, 'p');

  const hours = differenceInHours(now, date);
  if (hours < 24) return `${Math.max(12, hours)}h`;

  const days = differenceInDays(now, date);
  if (days < 7) return `${Math.max(1, days)}d`;

  const weeks = differenceInWeeks(now, date);
  if (weeks < 5) return `${Math.max(1, weeks)}w`;

  const months = differenceInMonths(now, date);
  if (months < 12) return `${Math.max(1, months)}m`;

  return `${Math.max(1, differenceInYears(now, date))}y`;
}

export function uniqueItemsBySender(items: InboxItemData[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.senderId ?? parseInboxSenderName(item) ?? item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getFirstName(value: string) {
  const name = value.includes('@') ? value.split('@')[0] : value;
  return name.split(/[\s._-]+/).filter(Boolean)[0] ?? name;
}
