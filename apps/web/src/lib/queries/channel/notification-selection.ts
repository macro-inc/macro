import type { ChannelEntity } from '@entity/types/entity';
import type {
  Notification,
  WithNotification,
} from '@entity/types/notification';
import { fetchGraphqlEntityNotifications } from '@service-storage/graphql-notifications';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';

/**
 * Return immediately when no fetch is needed. A limit-one unread edge needs
 * hydration to determine message targets, mark-read IDs, and thread membership.
 */
export function hydrateChannelNotificationSelection(
  channel: ChannelEntity,
  applyLocalOverrides?: (notification: Notification) => Notification
): WithNotification<ChannelEntity> | Promise<WithNotification<ChannelEntity>> {
  if (channel.unreadNotifications === undefined) return channel;
  if (channel.unreadNotifications.length === 0) {
    return { ...channel, notifications: () => [] };
  }
  return fetchChannelNotificationSelection(channel, applyLocalOverrides);
}

async function fetchChannelNotificationSelection(
  channel: ChannelEntity,
  applyLocalOverrides?: (notification: Notification) => Notification
): Promise<WithNotification<ChannelEntity>> {
  const input = buildGraphqlEntitySoupInput('CHANNEL', channel.id);
  if (!input) throw new Error('Invalid channel notification selection');
  const notifications = await fetchGraphqlEntityNotifications(
    input,
    channel.id
  );
  return {
    ...channel,
    unreadNotifications: undefined,
    notifications: () =>
      applyLocalOverrides
        ? notifications.map(applyLocalOverrides)
        : notifications,
  };
}
