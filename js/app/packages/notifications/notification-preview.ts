import { NotificationType } from '@core/types';

export const NOTIFICATION_LABEL_BY_TYPE: Record<NotificationType, string> = {
  [NotificationType.channel_mention]: 'MENTION',
  [NotificationType.channel_message_send]: 'MESSAGE',
  [NotificationType.channel_message_reply]: 'REPLY',
  [NotificationType.document_mention]: 'MENTION',
  [NotificationType.channel_invite]: 'INVITE',
  [NotificationType.new_email]: 'EMAIL',
  [NotificationType.invite_to_team]: 'INVITE',
  [NotificationType.task_assigned]: 'ASSIGNED',
} as const;
