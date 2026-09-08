import type { EntityData, Notification, WithNotification } from '@entity';
import {
  getSortedKeyProperties,
  soupPropertyToProperty,
} from '@entity/extractors-property/property-helpers';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import {
  differenceInDays,
  differenceInMilliseconds,
  differenceInMonths,
  differenceInWeeks,
  differenceInYears,
} from 'date-fns';
import { match } from 'ts-pattern';

/**
 * Soup attaches notifications per `toNotificationEntity`, which maps a
 * `channel_thread` to its whole channel — so its notifications come back
 * channel-wide. Scope them to this thread's own message: the sends/mentions for
 * the message, and replies whose `threadId` is the message.
 */
export function scopeThreadNotifications(
  entity: WithNotification<EntityData>
): WithNotification<EntityData> {
  if (entity.type !== 'channel_thread') return entity;

  const notifications = entity.notifications;
  if (!notifications) return entity;

  const messageId = entity.messageId;
  return {
    ...entity,
    notifications: () =>
      notifications().filter((notification) =>
        match(notification.notification_metadata)
          .with(
            { tag: 'channel_message_send' },
            (m) => m.content.messageId === messageId
          )
          .with(
            { tag: 'channel_mention' },
            (m) => m.content.messageId === messageId
          )
          .with(
            { tag: 'channel_message_reply' },
            (m) => m.content.threadId === messageId
          )
          .otherwise(() => false)
      ),
  };
}

function notificationContent(notification: Notification): string | undefined {
  const content = notification.notification_metadata.content as
    | {
        messageContent?: string;
        text?: string;
        snippet?: string;
        summary?: string;
        commentSnippet?: string;
        textSnippet?: string;
        reviewSnippet?: string;
      }
    | undefined;
  switch (notification.notification_metadata.tag) {
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply':
      return content?.messageContent;
    case 'mentioned_in_document_comment':
    case 'replied_to_document_comment_thread':
    case 'commented_on_document':
      return content?.text;
    case 'new_email':
      return content?.snippet || undefined;
    case 'ai_response':
      return content?.summary;
    case 'github_pr_comment':
      return content?.commentSnippet;
    case 'github_pr_mention':
      return content?.textSnippet;
    case 'github_pr_review':
      return content?.reviewSnippet;
    default:
      return undefined;
  }
}

export function getNotificationTag(notification?: Notification) {
  return notification?.notification_metadata.tag;
}

const channelMessageContent = (entity: EntityData): string | undefined => {
  if (entity.type === 'channel') return entity.latestRootMessage?.content;
  if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
    return entity.content;
  }
  return undefined;
};

export function itemContent(
  entity: EntityData,
  notification?: Notification
): string | undefined {
  const meta = notification?.notification_metadata;

  if (meta?.tag === 'document_mention') {
    return meta.content.messageContent;
  }

  if (meta?.tag === 'call_started') {
    return;
  }

  const channel = channelMessageContent(entity);
  if (channel) return channel;
  return notification ? notificationContent(notification) : undefined;
}

export function getGithubLocationLabel(
  entity: EntityData,
  notification?: Notification
) {
  if (
    entity.type === 'foreign' &&
    entity.foreignSource === 'github_pull_request'
  ) {
    const { owner, repo, number } = entity.metadata;
    return `${owner}/${repo}#${number}`;
  }
  const content = notification?.notification_metadata.content as
    | { owner?: string; repo?: string; number?: number }
    | undefined;
  if (!content?.owner || !content.repo || content.number == null) {
    return undefined;
  }
  return `${content.owner}/${content.repo}#${content.number}`;
}

export function getGithubTitle(
  entity: EntityData,
  notification?: Notification
) {
  if (
    entity.type === 'foreign' &&
    entity.foreignSource === 'github_pull_request'
  ) {
    return entity.metadata.name;
  }
  const content = notification?.notification_metadata.content as
    | { title?: string }
    | undefined;

  return content?.title;
}

export function getEmailSubject(notification?: Notification) {
  const content = notification?.notification_metadata.content as
    | { subject?: string }
    | undefined;
  return content?.subject;
}

/** Key task properties (pills), derived from the document entity. */
export function getInboxTaskProperties(entity: EntityData) {
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
  const ageMs = Math.max(0, differenceInMilliseconds(now, date));
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return 'now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = differenceInDays(now, date);
  if (days < 7) return `${Math.max(1, days)}d`;

  const weeks = differenceInWeeks(now, date);
  if (weeks < 5) return `${Math.max(1, weeks)}w`;

  const months = differenceInMonths(now, date);
  if (months < 12) return `${Math.max(1, months)}mo`;

  return `${Math.max(1, differenceInYears(now, date))}y`;
}

export function getFirstName(value: string) {
  const name = value.includes('@') ? value.split('@')[0] : value;
  return name.split(/[\s._-]+/).filter(Boolean)[0] ?? name;
}
