import { channelThreadRootId } from '@notifications/channel-thread-root';
import type { ChannelThreadEntity } from '../types/entity';
import type { WithNotification } from '../types/notification';

/** Prefer current channel names over notification snapshots and thread placeholders. */
export function getChannelThreadName(
  entity: WithNotification<Pick<ChannelThreadEntity, 'channelId' | 'threadId'>>,
  channelsById: Readonly<Record<string, { name?: string | null } | undefined>>
): string {
  const currentName = channelsById[entity.channelId]?.name?.trim();
  if (currentName) return currentName;

  for (const notification of entity.notifications?.() ?? []) {
    if (
      notification.entity_type !== 'channel' ||
      notification.entity_id !== entity.channelId
    ) {
      continue;
    }

    const metadata = notification.notification_metadata;
    if (
      metadata.tag !== 'channel_message_reply' &&
      metadata.tag !== 'channel_mention' &&
      metadata.tag !== 'channel_message_send'
    ) {
      continue;
    }

    const rootId =
      metadata.tag === 'channel_message_send'
        ? metadata.content.messageId
        : channelThreadRootId(notification);
    if (rootId !== entity.threadId) continue;

    const name = metadata.content.channelName?.trim();
    if (name) return name;
  }

  return 'Unknown channel';
}
