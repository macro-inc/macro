import type { UnifiedNotification } from './types';
import { match } from 'ts-pattern';

// Helper functions for derived notification data

export function getNotificationAction(n: UnifiedNotification): string {
  return match(n.notification_metadata.tag)
    .with('channel_mention', () => 'mentioned you in')
    .with('document_mention', () => 'sent a document')
    .with('mentioned_in_document_comment', () => 'mentioned you in')
    .with('channel_message_send', () => 'sent a message in')
    .with('ai_response', () => 'AI responded')
    .with('channel_message_reply', () => 'replied in')
    .with('channel_invite', () => 'invited you to')
    .with('new_email', () => 'sent a new email')
    .with('invite_to_team', () => 'invited you to')
    .with('task_assigned', () => 'assigned you a task')
    .exhaustive();
}

export function getNotificationTargetName(
  n: UnifiedNotification
): string | undefined {
  const m = n.notification_metadata;
  return match(m)
    .with({ tag: 'channel_invite' }, (m) => m.content.channelName)
    .with({ tag: 'document_mention' }, (m) => m.content.documentName)
    .with(
      { tag: 'mentioned_in_document_comment' },
      (m) => m.content.documentName
    )
    .with({ tag: 'invite_to_team' }, (m) => m.content.teamName)
    .with({ tag: 'task_assigned' }, (m) => m.content.taskName ?? undefined)
    .with({ tag: 'channel_mention' }, () => undefined)
    .with({ tag: 'channel_message_send' }, () => undefined)
    .with({ tag: 'ai_response' }, () => undefined)
    .with({ tag: 'channel_message_reply' }, () => undefined)
    .with({ tag: 'new_email' }, () => undefined)
    .exhaustive();
}

export function getNotificationContent(
  n: UnifiedNotification
): string | undefined {
  const m = n.notification_metadata;
  return match(m)
    .with({ tag: 'channel_mention' }, (m) => m.content.messageContent)
    .with({ tag: 'channel_message_send' }, (m) => m.content.messageContent)
    .with({ tag: 'ai_response' }, (m) => m.content.summary)
    .with({ tag: 'channel_message_reply' }, (m) => m.content.messageContent)
    .with({ tag: 'document_mention' }, (m) => m.content.documentName)
    .with({ tag: 'mentioned_in_document_comment' }, (m) => m.content.text)
    .with({ tag: 'new_email' }, (m) => m.content.subject)
    .with({ tag: 'task_assigned' }, (m) => m.content.taskName ?? undefined)
    .with({ tag: 'channel_invite' }, () => undefined)
    .with({ tag: 'invite_to_team' }, () => undefined)
    .exhaustive();
}

export function shouldShowNotificationTarget(n: UnifiedNotification): boolean {
  const m = n.notification_metadata;
  return match(m)
    .with(
      { tag: 'channel_mention' },
      (m) => m.content.channelType !== 'directMessage'
    )
    .with(
      { tag: 'channel_message_send' },
      (m) => m.content.channelType !== 'directMessage'
    )
    .with(
      { tag: 'channel_message_reply' },
      (m) => m.content.channelType !== 'directMessage'
    )
    .with({ tag: 'ai_response' }, () => false)
    .with({ tag: 'new_email' }, () => false)
    .with({ tag: 'task_assigned' }, () => true)
    .with({ tag: 'document_mention' }, () => true)
    .with({ tag: 'mentioned_in_document_comment' }, () => true)
    .with({ tag: 'channel_invite' }, () => true)
    .with({ tag: 'invite_to_team' }, () => true)
    .exhaustive();
}
