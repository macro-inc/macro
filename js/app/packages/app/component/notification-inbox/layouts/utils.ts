import { type EntityIconSelector } from '@core/component/EntityIcon';
import { macroIdToEmail, tryMacroId } from '@core/user';
import {
  getSortedKeyProperties,
  soupPropertyToProperty,
} from '@entity/extractors-property/property-helpers';
import {
  differenceInDays,
  differenceInHours,
  differenceInMilliseconds,
  differenceInMonths,
  differenceInWeeks,
  differenceInYears,
  format,
} from 'date-fns';
import type { UnifiedNotification } from '@notifications/types';
import type { Property as PropertyT } from '@property/types';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { match } from 'ts-pattern';
import {
  type InboxItem as InboxItemData,
  inboxItemSenderId,
  inboxItemSenderName,
  parseInboxSenderName,
} from '../InboxItem';
import { notificationContent } from '../notification-extractors';

// ---------------------------------------------------------------------------
// Entity/notification accessors — everything is derived from these now that
// `InboxItem` is just { entity, notification, …generic state }.
// ---------------------------------------------------------------------------

const notificationOf = (item: InboxItemData) =>
  item.notification as UnifiedNotification | undefined;

export function getNotificationTag(item: InboxItemData) {
  return item.notification?.notification_metadata.tag;
}

export function getEntityName(item: InboxItemData): string | undefined {
  return item.entity.name || undefined;
}

const channelTypeOf = (item: InboxItemData): string | undefined => {
  const entity = item.entity;
  return entity.type === 'channel' ||
    entity.type === 'channel_message' ||
    entity.type === 'channel_thread'
    ? entity.channelType
    : undefined;
};

const entitySubTypeOf = (item: InboxItemData): string | undefined =>
  item.entity.type === 'document' ? item.entity.subType?.type : undefined;

const channelMessageContent = (item: InboxItemData): string | undefined => {
  const entity = item.entity;
  if (entity.type === 'channel') return entity.latestMessage?.content;
  if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
    return entity.content;
  }
  return undefined;
};

const itemContent = (item: InboxItemData): string | undefined => {
  const channel = channelMessageContent(item);
  if (channel) return channel;
  const notification = notificationOf(item);
  return notification ? notificationContent(notification) : undefined;
};

// ---------------------------------------------------------------------------

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
  const entity = item.entity;
  if (entitySubTypeOf(item) === 'task') return 'task';
  if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
    return 'channel';
  }
  if (entity.type === 'document') return 'md';
  if (entity.type === 'foreign') return 'default';
  return entity.type as EntityIconSelector;
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

const hashChannel = (
  item: InboxItemData,
  value: string | undefined
): string | undefined => {
  if (!value) return undefined;
  const type = item.entity.type;
  if (
    type === 'channel' ||
    type === 'channel_message' ||
    type === 'channel_thread'
  ) {
    return value.startsWith('#') ? value : `#${value}`;
  }
  return value;
};

const githubActionText = (item: InboxItemData): string => {
  if (getNotificationTag(item) === 'github_pr_status_changed') {
    const content = item.notification?.notification_metadata.content as
      | { status?: string }
      | undefined;
    if (content?.status === 'merged') return 'merged a PR';
  }
  return 'updated';
};

export interface InboxItemText {
  /** Verb shown in the action row, e.g. "replied in". */
  action: string;
  /** Where it happened, display-ready (channels prefixed with #). */
  location?: string;
  /** Message / preview body. */
  content?: string;
}

/**
 * Single source for an item's rendered text: one `match` over the notification
 * tag yields the action verb, location, and content together — replacing the
 * separate getActionText / getLocationText / getContentText switches.
 */
export function getInboxItemText(
  item: InboxItemData,
  opts: { nested?: boolean; groupRoot?: boolean } = {}
): InboxItemText {
  const nested = opts.nested ?? false;
  const name = getEntityName(item);
  const content = itemContent(item);
  const dm = channelTypeOf(item) === 'direct_message';

  const channelLocation = nested || dm ? undefined : hashChannel(item, name);
  const githubLocation = nested
    ? undefined
    : (getGithubLocationLabel(item) ?? name);
  const entityLocation = nested ? undefined : name;

  const text = match(getNotificationTag(item))
    .with('channel_mention', () => ({
      action: nested ? 'mentioned you' : 'mentioned you in',
      location: channelLocation,
      content,
    }))
    .with('channel_message_reply', () => ({
      action: 'replied',
      location: channelLocation,
      content,
    }))
    .with('channel_message_send', () => ({
      action: 'sent a message',
      location: channelLocation,
      content,
    }))
    .with('document_mention', () => ({
      action: 'shared',
      location: entityLocation,
      content: name || content,
    }))
    .with('mentioned_in_document_comment', () => ({
      action: nested ? 'mentioned you' : 'mentioned you in',
      location: entityLocation,
      content,
    }))
    .with('replied_to_document_comment_thread', () => ({
      action: nested ? 'replied' : 'replied in',
      location: entityLocation,
      content,
    }))
    .with('new_email', () => ({
      action: 'sent an email',
      location: undefined,
      content: getEmailSubject(item) || name || content,
    }))
    .with('task_assigned', () => ({
      action: 'assigned you a task',
      location: undefined,
      content: name || content,
    }))
    .with('ai_response', () => ({
      action: 'responded',
      location: entityLocation,
      content,
    }))
    .with(
      'github_pr_status_changed',
      'github_review_requested',
      'github_pr_comment',
      'github_pr_mention',
      'github_pr_review',
      () => ({
        action: githubActionText(item),
        location: githubLocation,
        content: getGithubTitle(item) || name || content,
      })
    )
    .otherwise(() => ({
      action: 'updated',
      location: entityLocation,
      content,
    }));

  return opts.groupRoot ? { ...text, content: content || name } : text;
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

/** Key task properties (pills), derived from the document entity. */
export function getInboxTaskProperties(
  item: InboxItemData
): PropertyT[] | undefined {
  const entity = item.entity;
  if (entity.type !== 'document') return undefined;
  if (!('properties' in entity) || !entity.properties?.length) return undefined;

  const keyProperties = getSortedKeyProperties(
    entity.properties.map((property: SoupProperty) =>
      soupPropertyToProperty(property)
    )
  );
  return keyProperties.length ? keyProperties : undefined;
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
    const key =
      inboxItemSenderId(item) ?? parseInboxSenderName(item) ?? item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getFirstName(value: string) {
  const name = value.includes('@') ? value.split('@')[0] : value;
  return name.split(/[\s._-]+/).filter(Boolean)[0] ?? name;
}

// Assumes the item is grouped; callers only render the group icon for groups.
export function shouldUseGroupIcon(item: InboxItemData) {
  const tag = getNotificationTag(item);
  return (
    channelTypeOf(item) !== 'direct_message' &&
    item.entity.type !== 'email' &&
    tag !== 'new_email' &&
    !(
      entitySubTypeOf(item) === 'task' &&
      (tag === 'mentioned_in_document_comment' ||
        tag === 'replied_to_document_comment_thread' ||
        tag === 'commented_on_document')
    )
  );
}

export function getSenderDisplayName(item: InboxItemData) {
  const macroId = tryMacroId(
    inboxItemSenderId(item) ?? inboxItemSenderName(item) ?? ''
  );
  return macroId ? macroIdToEmail(macroId) : parseInboxSenderName(item);
}

export function getSenderFirstName(item: InboxItemData) {
  return getFirstName(getSenderDisplayName(item));
}
