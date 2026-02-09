// NotificationEventType - union of all event type strings
export type NotificationEventType =
  | 'channel_mention'
  | 'channel_message_send'
  | 'channel_message_reply'
  | 'document_mention'
  | 'channel_invite'
  | 'new_email'
  | 'invite_to_team'
  | 'task_assigned';

// Const object for runtime access
export const NotificationEventType = {
  channel_mention: 'channel_mention',
  channel_message_send: 'channel_message_send',
  channel_message_reply: 'channel_message_reply',
  document_mention: 'document_mention',
  channel_invite: 'channel_invite',
  new_email: 'new_email',
  invite_to_team: 'invite_to_team',
  task_assigned: 'task_assigned',
} as const;
