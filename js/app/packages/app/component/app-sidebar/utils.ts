import { tryMacroId, useDisplayNameParts } from '@core/user';
import type { UnifiedNotification } from '@notifications';

export function useSenderName(senderId: string | null | undefined) {
  const nameParts = useDisplayNameParts(tryMacroId(senderId ?? ''));
  return () => {
    const firstName = nameParts.firstName();
    const fullName = nameParts.fullName();
    if (firstName || fullName) {
      return firstName || fullName;
    }
    // Fallback: extract name from macro ID format (macro|email@domain.com)
    if (senderId?.startsWith('macro|')) {
      const email = senderId.slice(6);
      const namePart = email.split('@')[0];

      return namePart;
    }
    return null;
  };
}

const CHANNEL_NOTIFICATION_TYPES = [
  'channel_mention',
  'channel_message_send',
  'channel_message_reply',
] as const;

type ChannelNotificationType = (typeof CHANNEL_NOTIFICATION_TYPES)[number];

export function isChannelNotification(
  notification: UnifiedNotification
): notification is UnifiedNotification & {
  notification_event_type: ChannelNotificationType;
} {
  return CHANNEL_NOTIFICATION_TYPES.includes(
    notification.notification_event_type as ChannelNotificationType
  );
}
