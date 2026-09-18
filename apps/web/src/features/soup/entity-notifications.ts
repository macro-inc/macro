import type {
  ChannelEntity,
  ChannelMessageEntity,
  ChannelThreadEntity,
  EntityData,
} from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import { toNotificationEntity } from '@entity/utils/notification';
import { channelThreadRootId } from '@notifications/channel-thread-root';
import type { NotificationSource } from '@notifications/notification-source';
import {
  compositeEntity,
  type UnifiedNotification,
} from '@notifications/types';
import type { Accessor } from 'solid-js';

function channelThreadNotificationIds(
  notifications: UnifiedNotification[]
): Set<string> {
  const ids = new Set<string>();

  // Match channel stacking's membership rules without constructing or sorting
  // display stacks. Inbox predicates call this for every channel in the list.
  const mentionedMessageIds = new Set<string>();
  const activeThreadIds = new Set<string>();
  for (const notification of notifications) {
    const metadata = notification.notification_metadata;
    if (metadata.tag === 'channel_mention') {
      mentionedMessageIds.add(metadata.content.messageId);
      if (metadata.content.threadId != null) {
        activeThreadIds.add(metadata.content.threadId);
      }
    } else if (metadata.tag === 'channel_message_reply') {
      activeThreadIds.add(metadata.content.threadId);
    }
  }

  for (const notification of notifications) {
    const metadata = notification.notification_metadata;
    if (metadata.tag === 'channel_mention') {
      const { messageId, threadId } = metadata.content;
      // Empty thread keys are discarded by the stacker. An orphan root
      // mention is still a standalone mention stack, even with an empty id.
      const key = threadId ?? messageId;
      if (key !== '' || (threadId == null && !activeThreadIds.has(key))) {
        ids.add(notification.id);
      }
    } else if (
      metadata.tag === 'channel_message_send' ||
      metadata.tag === 'channel_message_reply'
    ) {
      const { messageId } = metadata.content;
      if (mentionedMessageIds.has(messageId)) continue;
      const key =
        metadata.tag === 'channel_message_reply'
          ? metadata.content.threadId
          : activeThreadIds.has(messageId)
            ? messageId
            : undefined;
      if (key) ids.add(notification.id);
    }
  }
  return ids;
}

export type ChannelNotificationScopeEntity =
  | Pick<ChannelEntity, 'type'>
  | Pick<ChannelMessageEntity, 'type'>
  | Pick<ChannelThreadEntity, 'type' | 'messageId'>;

/**
 * Splits notifications shared by channel and channel-thread entities into the
 * stack rendered by each Inbox row.
 */
export function scopeChannelNotificationsForEntity(
  entity: ChannelNotificationScopeEntity,
  notifications: UnifiedNotification[]
): UnifiedNotification[] {
  if (entity.type === 'channel') {
    const threadIds = channelThreadNotificationIds(notifications);
    return notifications.filter(
      (notification) => !threadIds.has(notification.id)
    );
  }
  if (entity.type === 'channel_thread') {
    const threadIds = new Set<string>();
    for (const notification of notifications) {
      const metadata = notification.notification_metadata;
      const belongsToThread =
        metadata.tag === 'channel_message_send'
          ? metadata.content.messageId === entity.messageId
          : channelThreadRootId(notification) === entity.messageId;
      if (belongsToThread) threadIds.add(notification.id);
    }
    return notifications.filter((notification) =>
      threadIds.has(notification.id)
    );
  }
  return notifications;
}

export type EntityWithRawNotifications<T extends EntityData> = T & {
  notifications?: UnifiedNotification[] | Accessor<UnifiedNotification[]>;
};

/**
 * Reads attached GraphQL notifications or the global source with the same
 * channel-thread scoping for membership checks and rendered rows.
 */
export function getEntityNotifications<T extends EntityData>(
  entity: EntityWithRawNotifications<T>,
  source: NotificationSource,
  options: { scopeChannelThreads?: boolean } = {}
): UnifiedNotification[] {
  const attached = entity.notifications;
  const read = (): UnifiedNotification[] => {
    const raw = typeof attached === 'function' ? attached() : attached;
    if (Array.isArray(raw)) {
      const applyOverrides = source.withLocalOverrides;
      return applyOverrides ? raw.map(applyOverrides) : raw;
    }
    return (
      source.notificationsByEntity()[
        compositeEntity(toNotificationEntity(entity))
      ] ?? []
    );
  };
  const notifications = read();
  return options.scopeChannelThreads &&
    (entity.type === 'channel' ||
      entity.type === 'channel_message' ||
      entity.type === 'channel_thread')
    ? scopeChannelNotificationsForEntity(entity, notifications)
    : notifications;
}

/** Attach the reactive accessor expected by reusable list-entity components. */
export function withEntityNotifications<T extends EntityData>(
  entity: EntityWithRawNotifications<T>,
  source: NotificationSource,
  options: { scopeChannelThreads?: boolean } = {}
): WithNotification<T> {
  return {
    ...entity,
    notifications: () => getEntityNotifications(entity, source, options),
  };
}
