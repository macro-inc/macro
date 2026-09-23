import type { ChannelEntity } from '@entity/types/entity';
import type {
  Notification,
  WithNotification,
} from '@entity/types/notification';
import { fetchGraphqlEntityNotifications } from '@service-storage/graphql-notifications';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';

/** A limit-one edge cannot determine all mark-read IDs or thread membership. */
export async function hydrateChannelNotificationSelection(
  channel: ChannelEntity,
  applyLocalOverrides?: (notification: Notification) => Notification
): Promise<WithNotification<ChannelEntity>> {
  if (channel.unreadNotifications === undefined) return channel;
  if (channel.unreadNotifications.length === 0) {
    return { ...channel, notifications: () => [] };
  }
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
