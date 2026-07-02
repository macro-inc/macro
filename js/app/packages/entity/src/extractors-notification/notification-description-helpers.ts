import type { NotificationType } from '@core/types';
import { match } from 'ts-pattern';
import type { Notification } from '../types/notification';

/**
 * Gets unique sender IDs from a notification stack
 * @internal
 */
export function getUniqueSenderIds(notifications: Notification[]): string[] {
  const senderIds = new Set<string>();
  for (const notification of notifications) {
    if (notification.sender_id) {
      senderIds.add(notification.sender_id);
    }
  }
  return Array.from(senderIds);
}

/**
 * GitHub PR notifications are triggered by GitHub users who usually aren't Macro
 * users, so `sender_id` is empty. Their GitHub login lives in the notification
 * metadata instead. Pull it out so the description can name who acted.
 * @internal
 */
export function getGithubSenderLogin(
  notification: Notification
): string | undefined {
  const metadata = notification.notification_metadata;
  const content = (metadata as { content?: unknown }).content;
  if (
    content &&
    typeof content === 'object' &&
    'senderGithubLogin' in content
  ) {
    const login = (content as { senderGithubLogin?: string | null })
      .senderGithubLogin;
    return login ?? undefined;
  }
  return undefined;
}

/**
 * Gets unique GitHub sender logins from a notification stack, preserving order.
 * @internal
 */
export function getUniqueGithubLogins(notifications: Notification[]): string[] {
  const logins = new Set<string>();
  for (const notification of notifications) {
    const login = getGithubSenderLogin(notification);
    if (login) {
      logins.add(login);
    }
  }
  return Array.from(logins);
}

/**
 * Gets the action verb for a notification type
 * @internal
 */
export function getActionVerb(type: NotificationType): string {
  return match(type)
    .with('channel_mention', () => 'mentioned you')
    .with('document_mention', () => 'shared with you')
    .with('mentioned_in_document_comment', () => 'mentioned you')
    .with('replied_to_document_comment_thread', () => 'replied')
    .with('commented_on_document', () => 'commented')
    .with('channel_message_reply', () => 'replied')
    .with('channel_message_send', () => 'sent a message')
    .with('ai_response', () => 'AI responded')
    .with('new_email', () => 'sent an email')
    .with('channel_invite', () => 'invited you')
    .with('invite_to_team', () => 'invited you')
    .with('task_assigned', () => 'assigned you')
    .with('github_pr_status_changed', () => 'updated a pull request')
    .with('github_pr_check_run', () => 'completed a check')
    .with('github_review_requested', () => 'requested your review')
    .with('github_pr_comment', () => 'commented on a pull request')
    .with('github_pr_mention', () => 'mentioned you on a pull request')
    .with('github_pr_review', () => 'reviewed your pull request')
    .with('call_started', () => 'started a call')
    .with('inbox_reauth_required', () => 'needs reconnection')
    .exhaustive();
}

/**
 * Gets a noun for the notification type (for multi-notification descriptions)
 * @internal
 */
export function getTypeNoun(type: NotificationType, count: number): string {
  return match(type)
    .with('channel_message_reply', () => (count === 1 ? 'reply' : 'replies'))
    .with('channel_message_send', () => (count === 1 ? 'message' : 'messages'))
    .with('ai_response', () => (count === 1 ? 'response' : 'responses'))
    .with('channel_mention', () => (count === 1 ? 'mention' : 'mentions'))
    .with('document_mention', () =>
      count === 1 ? 'document shared' : 'documents shared'
    )
    .with('mentioned_in_document_comment', () =>
      count === 1 ? 'mention' : 'mentions'
    )
    .with('replied_to_document_comment_thread', () =>
      count === 1 ? 'reply' : 'replies'
    )
    .with('commented_on_document', () => (count === 1 ? 'comment' : 'comments'))
    .with('new_email', () => (count === 1 ? 'email' : 'emails'))
    .with('channel_invite', () => (count === 1 ? 'invite' : 'invites'))
    .with('invite_to_team', () => (count === 1 ? 'invite' : 'invites'))
    .with('task_assigned', () => (count === 1 ? 'task' : 'tasks'))
    .with('github_pr_status_changed', () =>
      count === 1 ? 'pull request' : 'pull requests'
    )
    .with('github_pr_check_run', () => (count === 1 ? 'check' : 'checks'))
    .with('github_review_requested', () =>
      count === 1 ? 'review request' : 'review requests'
    )
    .with('github_pr_comment', () => (count === 1 ? 'comment' : 'comments'))
    .with('github_pr_mention', () => (count === 1 ? 'mention' : 'mentions'))
    .with('github_pr_review', () => (count === 1 ? 'review' : 'reviews'))
    .with('call_started', () => (count === 1 ? 'call' : 'calls'))
    .with('inbox_reauth_required', () => (count === 1 ? 'inbox' : 'inboxes'))
    .exhaustive();
}

export function getTypePreposition(type: NotificationType): string {
  return match(type)
    .with('document_mention', () => 'by')
    .otherwise(() => 'from');
}
