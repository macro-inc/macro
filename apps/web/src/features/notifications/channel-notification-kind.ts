import type { UnifiedNotification } from './types';

export type ChannelNotificationKind = 'none' | 'activity' | 'important';

export type ChannelNotificationWitness = {
  id: string;
  state: UnifiedNotification['state'];
  eventType?: string;
  deletedAt?: string | null;
};

/** Presence, not a count: mentions and thread replies take precedence. */
export function channelNotificationKind(
  notifications: readonly ChannelNotificationWitness[],
  withLocalState: (
    notification: Pick<ChannelNotificationWitness, 'id' | 'state'>
  ) => UnifiedNotification['state'] = (notification) => notification.state
): ChannelNotificationKind {
  let kind: ChannelNotificationKind = 'none';
  for (const notification of notifications) {
    if (notification.deletedAt || withLocalState(notification) !== 'unseen')
      continue;
    if (
      notification.eventType === 'channel_mention' ||
      notification.eventType === 'channel_message_reply'
    )
      return 'important';
    kind = 'activity';
  }
  return kind;
}

export function channelNotificationWitness(notification: UnifiedNotification) {
  return {
    id: notification.id,
    state: notification.state,
    eventType: notification.notification_metadata.tag,
    deletedAt: notification.deleted_at,
  };
}
