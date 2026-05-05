import type { NotificationType } from '@core/types';

export const NOTIFICATION_LABEL_BY_TYPE: Record<NotificationType, string> = {
  channel_mention: 'MENTION',
  channel_message_send: 'MESSAGE',
  channel_message_reply: 'REPLY',
  document_mention: 'MENTION',
  mentioned_in_document_comment: 'MENTION',
  replied_to_document_comment_thread: 'REPLY',
  commented_on_document: 'COMMENT',
  channel_invite: 'INVITE',
  new_email: 'EMAIL',
  invite_to_team: 'INVITE',
  task_assigned: 'ASSIGNED',
  ai_response: 'AI',
  'call-started': 'CALL',
} as const;
