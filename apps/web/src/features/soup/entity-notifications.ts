import type { EntityData } from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import { toNotificationEntity } from '@entity/utils/notification';
import type { NotificationSource } from '@notifications/notification-source';
import {
  getAllNotificationsFromGroup,
  stackNotifications,
} from '@notifications/notification-stacking';
import {
  compositeEntity,
  type UnifiedNotification,
} from '@notifications/types';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';

function channelThreadNotificationIds(
  notifications: UnifiedNotification[],
  threadId?: string
): Set<string> {
  const ids = new Set<string>();

  if (threadId !== undefined) {
    for (const notification of notifications) {
      const belongsToThread = match(notification.notification_metadata)
        .with(
          { tag: 'channel_message_send' },
          (metadata) => metadata.content.messageId === threadId
        )
        .with(
          { tag: 'channel_mention' },
          (metadata) =>
            (metadata.content.threadId ?? metadata.content.messageId) ===
            threadId
        )
        .with(
          { tag: 'channel_message_reply' },
          (metadata) => metadata.content.threadId === threadId
        )
        .otherwise(() => false);
      if (belongsToThread) ids.add(notification.id);
    }
    return ids;
  }

  for (const stack of stackNotifications(notifications)) {
    if (
      stack.type !== 'channel_message_reply' &&
      stack.type !== 'channel_mention'
    ) {
      continue;
    }
    for (const notification of getAllNotificationsFromGroup(stack)) {
      ids.add(notification.id);
    }
  }
  return ids;
}

/**
 * Splits notifications shared by channel and channel-thread entities into the
 * stack rendered by each Inbox row.
 */
export function scopeChannelNotificationsForEntity(
  entity: EntityData,
  notifications: UnifiedNotification[]
): UnifiedNotification[] {
  if (entity.type === 'channel') {
    const threadIds = channelThreadNotificationIds(notifications);
    return notifications.filter(
      (notification) => !threadIds.has(notification.id)
    );
  }
  if (entity.type === 'channel_thread') {
    const threadIds = channelThreadNotificationIds(
      notifications,
      entity.messageId
    );
    return notifications.filter((notification) =>
      threadIds.has(notification.id)
    );
  }
  return notifications;
}

type EntityWithRawNotifications = EntityData & {
  notifications?: UnifiedNotification[] | Accessor<UnifiedNotification[]>;
};

/**
 * Normalizes GraphQL notification arrays and the global notification source
 * into the accessor shape expected by reusable list-entity components.
 */
export function withEntityNotifications(
  entity: EntityWithRawNotifications,
  source: NotificationSource,
  options: { scopeChannelThreads?: boolean } = {}
): WithNotification<EntityData> {
  const attached = entity.notifications;
  const read = (): UnifiedNotification[] => {
    if (typeof attached === 'function') return attached();
    if (Array.isArray(attached)) return attached;
    return (
      source.notificationsByEntity()[
        compositeEntity(toNotificationEntity(entity))
      ] ?? []
    );
  };
  return {
    ...entity,
    notifications: () => {
      const notifications = read();
      return options.scopeChannelThreads
        ? scopeChannelNotificationsForEntity(entity, notifications)
        : notifications;
    },
  };
}
