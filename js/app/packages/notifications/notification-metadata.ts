import { match, P } from 'ts-pattern';
import { GITHUB_EVENT_TYPES } from './github-event-types';
import type { UnifiedNotification } from './types';

// Helper functions for derived notification data

export function getNotificationAction(n: UnifiedNotification): string {
  return match(n.notification_metadata.tag)
    .with('channel_mention', () => 'mentioned you in')
    .with('document_mention', () => 'sent a document')
    .with('mentioned_in_document_comment', () => 'mentioned you in')
    .with('replied_to_document_comment_thread', () => 'replied in')
    .with('commented_on_document', () => 'commented on')
    .with('channel_message_send', () => 'sent a message in')
    .with('ai_response', () => 'AI responded')
    .with('channel_message_reply', () => 'replied in')
    .with('call_started', () => 'started a call')
    .with('channel_invite', () => 'invited you to')
    .with('new_email', () => 'sent a new email')
    .with('invite_to_team', () => 'invited you to')
    .with('task_assigned', () => 'assigned you a task')
    .with('github_pr_status_changed', () => 'updated a pull request')
    .with('github_pr_check_run', () => {
      const meta = n.notification_metadata;
      if (
        meta.tag === 'github_pr_check_run' &&
        meta.content.state === 'failed'
      ) {
        return 'failed a check on';
      }

      return 'completed a check on';
    })
    .with('github_review_requested', () => 'requested your review on')
    .with('github_pr_comment', () => 'commented on')
    .with('github_pr_mention', () => 'mentioned you in')
    .with('github_pr_review', () => 'reviewed')
    .with('inbox_reauth_required', () => 'needs reconnection')
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
    .with(
      { tag: 'replied_to_document_comment_thread' },
      (m) => m.content.documentName
    )
    .with({ tag: 'commented_on_document' }, (m) => m.content.documentName)
    .with({ tag: 'invite_to_team' }, (m) => m.content.teamName)
    .with({ tag: 'task_assigned' }, (m) => m.content.taskName ?? undefined)
    .with(
      { tag: P.union(...GITHUB_EVENT_TYPES) },
      (m) => `${m.content.owner}/${m.content.repo}#${m.content.number}`
    )
    .with({ tag: 'channel_mention' }, () => undefined)
    .with({ tag: 'channel_message_send' }, () => undefined)
    .with({ tag: 'ai_response' }, () => undefined)
    .with({ tag: 'channel_message_reply' }, () => undefined)
    .with({ tag: 'call_started' }, (m) => m.content.channel_name ?? undefined)
    .with({ tag: 'new_email' }, () => undefined)
    .with({ tag: 'inbox_reauth_required' }, () => undefined)
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
    .with({ tag: 'call_started' }, () => undefined)
    .with({ tag: 'document_mention' }, (m) => m.content.documentName)
    .with({ tag: 'mentioned_in_document_comment' }, (m) => m.content.text)
    .with({ tag: 'replied_to_document_comment_thread' }, (m) => m.content.text)
    .with({ tag: 'commented_on_document' }, (m) => m.content.text)
    .with({ tag: 'new_email' }, (m) => m.content.subject)
    .with({ tag: 'task_assigned' }, (m) => m.content.taskName ?? undefined)
    .with(
      { tag: P.union('github_pr_status_changed', 'github_review_requested') },
      (m) => m.content.title || m.content.displayName
    )
    .with(
      { tag: 'github_pr_check_run' },
      (m) => m.content.checkName || m.content.title || m.content.displayName
    )
    .with(
      { tag: 'github_pr_comment' },
      (m) =>
        m.content.commentSnippet || m.content.title || m.content.displayName
    )
    .with(
      { tag: 'github_pr_mention' },
      (m) => m.content.textSnippet || m.content.title || m.content.displayName
    )
    .with(
      { tag: 'github_pr_review' },
      (m) => m.content.reviewSnippet || m.content.title || m.content.displayName
    )
    .with({ tag: 'channel_invite' }, () => undefined)
    .with({ tag: 'invite_to_team' }, () => undefined)
    .with({ tag: 'inbox_reauth_required' }, (m) => m.content.emailAddress)
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
    .with({ tag: 'call_started' }, () => true)
    .with({ tag: 'new_email' }, () => false)
    .with({ tag: 'task_assigned' }, () => true)
    .with({ tag: P.union(...GITHUB_EVENT_TYPES) }, () => true)
    .with({ tag: 'document_mention' }, () => true)
    .with({ tag: 'mentioned_in_document_comment' }, () => true)
    .with({ tag: 'replied_to_document_comment_thread' }, () => true)
    .with({ tag: 'commented_on_document' }, () => true)
    .with({ tag: 'channel_invite' }, () => true)
    .with({ tag: 'invite_to_team' }, () => true)
    .with({ tag: 'inbox_reauth_required' }, () => false)
    .exhaustive();
}
