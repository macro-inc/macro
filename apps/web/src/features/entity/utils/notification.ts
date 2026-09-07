import { ENABLE_DOCUMENT_MENTION_NOTIFICATIONS } from '@core/constant/featureFlags';
import type { Entity, NotificationType } from '@core/types';
import type { NotificationStack } from '@notifications/notification-stacking';
import type { UnifiedNotification } from '@notifications/types';
import type { ItemEntity } from '@queries/preview';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { match, P } from 'ts-pattern';
import type { EntityData } from '../types/entity';
import type { Notification } from '../types/notification';

type CallStartedNotificationMetadata = {
  tag: 'call_started';
  content: {
    channel_name?: string | null;
  };
};

type KnownNotificationMetadata =
  | UnifiedNotification['notification_metadata']
  | CallStartedNotificationMetadata;

const CHANNEL_NOTIFICATION_TYPES = [
  'channel_mention',
  'channel_message_send',
  'channel_message_reply',
  'document_mention',
] as const;

export function notificationIsRead(notification: UnifiedNotification): boolean {
  if (notification.viewed_at || notification.done) return true;

  if (notification.entity_type === 'channel') {
    const notificationType = notification.notification_metadata?.tag ?? '';
    if (
      !(CHANNEL_NOTIFICATION_TYPES as readonly string[]).includes(
        notificationType
      )
    ) {
      return true;
    }
  }

  return false;
}

export function toNotificationEntity(entity: EntityData): Entity {
  if (entity.type === 'email') {
    return { type: 'email_thread', id: entity.id };
  }

  if (entity.type === 'foreign') {
    return { type: 'foreign_entity', id: entity.id };
  }

  if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
    return { type: 'channel', id: entity.channelId };
  }

  return entity;
}

/**
 * Item types the notification service can mute. Keep aligned with
 * `MUTED_ENTITY_TYPE_LABELS` and the events that actually fan out.
 */
const MUTEABLE_ITEM_TYPES = new Set([
  'calendar_event',
  'call',
  'channel',
  'chat',
  'document',
  'email_thread',
  'foreign_entity',
  'project',
  'reminder',
]);

/**
 * Canonical unsubscribe `item_type`. Frontend rows use `email` / `foreign`;
 * notifications and the mute API store `email_thread` / `foreign_entity`.
 */
export function normalizeMuteItemType(type: string): string {
  return match(type)
    .with('email', () => 'email_thread')
    .with('foreign', () => 'foreign_entity')
    .otherwise((value) => value);
}

/**
 * The unsubscribe row that mutes notifications for this entity.
 *
 * Uses {@link toNotificationEntity} so the stored item matches the
 * notification's primary entity — outbound delivery filters unsubscribes by
 * that entity's `item_id`. Channel threads therefore mute the parent
 * channel, which is also how their notifications are attached.
 */
export function muteItemForEntity(
  entity: EntityData
): UserUnsubscribe | undefined {
  return muteItemForRef(toNotificationEntity(entity));
}

/** Same mapping for a bare id/type (favorites, already-canonical refs). */
export function muteItemForRef(entity: {
  id: string;
  type: string;
}): UserUnsubscribe | undefined {
  const item_type = normalizeMuteItemType(entity.type);
  if (!MUTEABLE_ITEM_TYPES.has(item_type)) return undefined;
  return { item_id: entity.id, item_type };
}

/**
 * Preview fetch key for a muted item. Only types the preview pipeline
 * actually serves — reminder and GitHub have no batch preview fetcher.
 */
export function muteItemPreviewEntity(
  item: UserUnsubscribe
): ItemEntity | undefined {
  return match<string, ItemEntity | undefined>(
    normalizeMuteItemType(item.item_type)
  )
    .with('email_thread', () => ({ id: item.item_id, type: 'email' }))
    .with(
      'channel',
      'calendar_event',
      'document',
      'chat',
      'project',
      'call',
      (type) => ({ id: item.item_id, type })
    )
    .otherwise(() => undefined);
}

export type MuteItemFallbackIconType =
  | 'calendar'
  | 'call'
  | 'channel'
  | 'chat'
  | 'default'
  | 'email'
  | 'githubPullRequest'
  | 'md'
  | 'project'
  | 'reminder';

/** Icon used before a preview loads, or when the type has no preview. */
export function muteItemFallbackIconType(
  itemType: string
): MuteItemFallbackIconType {
  return match(normalizeMuteItemType(itemType))
    .with('channel', 'chat', 'call', 'project', 'reminder', (type) => type)
    .with('document', () => 'md' as const)
    .with('email_thread', () => 'email' as const)
    .with('calendar_event', () => 'calendar' as const)
    .with('foreign_entity', () => 'githubPullRequest' as const)
    .otherwise(() => 'default' as const);
}

export function isMutedItem(
  muted: readonly UserUnsubscribe[],
  item: UserUnsubscribe
): boolean {
  const type = normalizeMuteItemType(item.item_type);
  return muted.some(
    (entry) =>
      entry.item_id === item.item_id &&
      normalizeMuteItemType(entry.item_type) === type
  );
}

export function entityIsMuted(
  muted: readonly UserUnsubscribe[],
  entity: EntityData
): boolean {
  const item = muteItemForEntity(entity);
  return item !== undefined && isMutedItem(muted, item);
}

/**
 * Filters out invalid notification types that shouldn't be displayed
 */
export function filterValidNotifications(
  notifications: Notification[] | undefined
): Notification[] {
  if (!notifications) return [];

  return notifications.filter((n) => {
    return (
      n.notification_event_type !== undefined &&
      (ENABLE_DOCUMENT_MENTION_NOTIFICATIONS ||
        n.notification_event_type !== 'document_mention')
    );
  });
}

/** filters out notifications that are marked as done */
export function filterNotDoneNotifications(
  notifications: Notification[]
): Notification[] {
  return notifications.filter((n) => !n.done);
}

export function extractNotificationSenderIds(
  notifications: UnifiedNotification[],
  maxCount: number = 3,
  reverse = false
): string[] {
  const senderIds = new Set<string>();

  for (const notification of notifications) {
    if (senderIds.size >= maxCount) break;

    if (notification.sender_id) {
      senderIds.add(notification.sender_id);
    }
  }

  const arr = Array.from(senderIds);
  if (reverse) arr.reverse();
  return arr;
}

/**
 * Gets a human-readable action text for a notification based on its type
 * Returns a short verb phrase like "mentioned", "replied", "shared", etc.
 */
export function getNotificationActionText(n: Notification): string {
  const tag = n.notification_metadata.tag as NotificationType;

  return match(tag)
    .with('channel_mention', () => 'mentioned')
    .with('channel_message_send', () => 'sent')
    .with('channel_message_reply', () => 'replied')
    .with('document_mention', () => 'mentioned')
    .with('mentioned_in_document_comment', () => 'mentioned')
    .with('replied_to_document_comment_thread', () => 'replied')
    .with('commented_on_document', () => 'commented')
    .with('channel_invite', () => 'invited')
    .with('new_email', () => 'emailed')
    .with('invite_to_team', () => 'invited')
    .with('task_assigned', () => 'assigned')
    .with('ai_response', () => 'responded')
    .with('github_pr_status_changed', () => 'updated')
    .with('github_pr_check_run', () => {
      const meta = n.notification_metadata;
      if (
        meta.tag === 'github_pr_check_run' &&
        meta.content.state === 'failed'
      ) {
        return 'failed';
      }

      return 'completed';
    })
    .with('github_review_requested', () => 'requested')
    .with('github_pr_comment', () => 'commented')
    .with('github_pr_mention', () => 'mentioned')
    .with('github_pr_review', () => 'reviewed')
    .with('call_started', () => 'called')
    .with('reminder', () => 'reminder')
    .with('calendar_event_reminder', () => 'starting soon')
    .with('inbox_reauth_required', () => 'needs reconnection')
    .exhaustive();
}

export function extractMessageContent(notification: Notification): string {
  const n = notification as UnifiedNotification;
  const meta = n.notification_metadata as KnownNotificationMetadata;

  return match(meta)
    .with({ tag: 'channel_mention' }, (m) => m.content.messageContent || '')
    .with(
      { tag: 'channel_message_send' },
      (m) => m.content.messageContent || ''
    )
    .with(
      { tag: 'channel_message_reply' },
      (m) => m.content.messageContent || ''
    )
    .with({ tag: 'document_mention' }, (m) => m.content.documentName || '')
    .with({ tag: 'mentioned_in_document_comment' }, (m) => m.content.text || '')
    .with(
      { tag: 'replied_to_document_comment_thread' },
      (m) => m.content.text || ''
    )
    .with({ tag: 'commented_on_document' }, (m) => m.content.text || '')
    .with({ tag: 'new_email' }, (m) => m.content.subject || '')
    .with({ tag: 'task_assigned' }, (m) => m.content.taskName ?? '')
    .with({ tag: 'ai_response' }, (m) => m.content.summary || '')
    .with(
      { tag: P.union('github_pr_status_changed', 'github_review_requested') },
      (m) => m.content.title || m.content.displayName || ''
    )
    .with(
      { tag: 'github_pr_check_run' },
      (m) =>
        m.content.checkName || m.content.title || m.content.displayName || ''
    )
    .with(
      { tag: 'github_pr_comment' },
      (m) =>
        m.content.commentSnippet ||
        m.content.title ||
        m.content.displayName ||
        ''
    )
    .with(
      { tag: 'github_pr_mention' },
      (m) =>
        m.content.textSnippet || m.content.title || m.content.displayName || ''
    )
    .with(
      { tag: 'github_pr_review' },
      (m) =>
        m.content.reviewSnippet ||
        m.content.title ||
        m.content.displayName ||
        ''
    )
    .with({ tag: 'channel_invite' }, () => '')
    .with({ tag: 'invite_to_team' }, () => '')
    .with({ tag: 'call_started' }, (m) => m.content.channel_name ?? '')
    .with({ tag: 'reminder' }, (m) => m.content.description)
    .with({ tag: 'calendar_event_reminder' }, (m) => m.content.title || '')
    .with({ tag: 'inbox_reauth_required' }, (m) => m.content.emailAddress || '')
    .exhaustive();
}

/**
 * Checks if a notification or notification stack is unread
 * A notification is unread if it hasn't been viewed (!viewedAt) and isn't done (!done)
 * A notification stack is unread if ANY notification in the stack is unread
 */
export function isNotificationUnread(
  item: Notification | NotificationStack
): boolean {
  if ('notifications' in item && Array.isArray(item.notifications)) {
    const stack = item as NotificationStack;
    return stack.notifications.some((n) => !notificationIsRead(n));
  }
  return !notificationIsRead(item as Notification);
}
