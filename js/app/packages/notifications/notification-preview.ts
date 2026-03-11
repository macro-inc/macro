import type { NotificationType } from '@core/types';

export const NOTIFICATION_LABEL_BY_TYPE: Record<NotificationType, string> = {
  channel_mention: 'MENTION',
  channel_message_send: 'MESSAGE',
  channel_message_reply: 'REPLY',
  document_mention: 'MENTION',
  mentioned_in_document_comment: 'MENTION',
  channel_invite: 'INVITE',
  new_email: 'EMAIL',
  invite_to_team: 'INVITE',
  task_assigned: 'ASSIGNED',
  ai_response: 'AI',
} as const;
