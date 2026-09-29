import type { ChannelEntity } from '@entity/types/entity';
import type {
  Notification,
  WithNotification,
} from '@entity/types/notification';
import { fetchGraphqlEntityNotifications } from '@service-storage/graphql-notifications';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';

/**
 * Refresh a bounded list projection before choosing a message target. Even an
 * empty unread edge can be stale after a new notification arrives. Only rows
 * without that projection keep their existing notification source.
 */
export function hydrateChannelNotificationSelection(
  channel: ChannelEntity,
  applyLocalOverrides?: (notification: Notification) => Notification
): WithNotification<ChannelEntity> | Promise<WithNotification<ChannelEntity>> {
  if (channel.unreadNotifications === undefined) return channel;
  return fetchChannelNotificationSelection(channel, applyLocalOverrides);
}

async function fetchChannelNotificationSelection(
  channel: ChannelEntity,
  applyLocalOverrides?: (notification: Notification) => Notification
): Promise<WithNotification<ChannelEntity>> {
  // Snapshot identity before the await. Callers often pass Solid store proxies
  // from the rail list; those can lose fields if the query refreshes mid-fetch.
  const channelId = channel.id;
  const name = channel.name;
  const ownerId = channel.ownerId;
  const channelType = channel.channelType;
  const isParticipant = channel.isParticipant;
  const target = channel.target;
  const input = buildGraphqlEntitySoupInput('CHANNEL', channelId);
  if (!input) throw new Error('Invalid channel notification selection');
  const notifications = await fetchGraphqlEntityNotifications(input, channelId);
  return {
    type: 'channel',
    id: channelId,
    name,
    ownerId,
    channelType,
    isParticipant,
    ...(target ? { target } : {}),
    unreadNotifications: undefined,
    notifications: () =>
      applyLocalOverrides
        ? notifications.map(applyLocalOverrides)
        : notifications,
  };
}
