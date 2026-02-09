import type { UnifiedNotification } from '@service-notification/client';

// Helper functions for derived notification data

export function getNotificationAction(n: UnifiedNotification): string {
  switch (n.notificationMetadata.tag) {
    case 'channel_mention':
      return 'mentioned you in';
    case 'document_mention':
      return 'sent a document';
    case 'mentioned_in_document_comment':
      return 'mentioned you in'
    case 'channel_message_send':
      return 'sent a message in';
    case 'channel_message_reply':
      return 'replied in';
    case 'channel_invite':
      return 'invited you to';
    case 'new_email':
      return 'sent a new email';
    case 'invite_to_team':
      return 'invited you to';
    case 'task_assigned':
      return 'assigned you a task';
    default:
      const _exhaustive: never = n.notificationMetadata;
      throw new Error(`Unhandled case: ${_exhaustive}`);
  }
}

export function getNotificationTargetName(
  n: UnifiedNotification
): string | undefined {
  const m = n.notificationMetadata;
  switch (m.tag) {
    case 'channel_invite':
      return m.content.channelName;
    case 'document_mention':
      return m.content.documentName;
    case 'mentioned_in_document_comment':
      return m.content.documentName;
    case 'invite_to_team':
      return m.content.teamName;
    case 'task_assigned':
      return m.content.taskName ?? undefined;
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply':
    case 'new_email':
      return undefined;
    default:
      const _exhaustive: never = m;
      throw new Error(`Unhandled case: ${_exhaustive}`);
  }
}

export function getNotificationContent(
  n: UnifiedNotification
): string | undefined {
  const m = n.notificationMetadata;
  switch (m.tag) {
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply':
      return m.content.messageContent;
    case 'document_mention':
      return m.content.documentName;
    case 'mentioned_in_document_comment':
      return m.content.text;
    case 'new_email':
      return m.content.subject;
    case 'task_assigned':
      return m.content.taskName ?? undefined;
    case 'channel_invite':
    case 'invite_to_team':
      return undefined;
    default:
      const _exhaustive: never = m;
      throw new Error(`Unhandled case: ${_exhaustive}`);
  }
}

export function shouldShowNotificationTarget(n: UnifiedNotification): boolean {
  const m = n.notificationMetadata;
  switch (m.tag) {
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply':
      return m.content.channelType !== 'directMessage';
    case 'new_email':
      return false;
    case 'task_assigned':
    case 'document_mention':
    case 'mentioned_in_document_comment':
    case 'channel_invite':
    case 'invite_to_team':
      return true;
    default:
      const _exhaustive: never = m;
      throw new Error(`Unhandled case: ${_exhaustive}`);
  }
}
