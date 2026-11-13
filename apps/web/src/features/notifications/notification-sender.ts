import { match } from 'ts-pattern';
import type { UnifiedNotification } from './types';

type PingAgent = { name: string; avatarUrl?: string | null };

type SenderMetadataContent = {
  sender?: string;
  senderDisplayName?: string | null;
  senderGithubLogin?: string;
  senderProfilePictureUrl?: string | null;
  botName?: string;
  routineName?: string;
  computerName?: string;
  mentionedBy?: string;
  agent?: PingAgent | null;
};

const senderContent = (
  notification: UnifiedNotification
): SenderMetadataContent | undefined =>
  (notification.notification_metadata as { content?: SenderMetadataContent })
    .content;

/**
 * The sender name carried in the notification metadata, for notifications
 * whose sender is not (only) a Macro user id: email senders, agents, bots and
 * GitHub logins.
 */
export function getNotificationSenderFallbackName(
  notification: UnifiedNotification
): string | undefined {
  const content = senderContent(notification);

  return match(notification.notification_metadata.tag)
    .with('new_email', () => content?.sender ?? undefined)
    .with('ai_response', () => 'Macro agent')
    .with('routine_run_finished', () => content?.routineName)
    .with('agent_sign_in_expiry', () => content?.computerName)
    .with('computer_setup', () => content?.computerName)
    .with(
      'ping',
      () => content?.agent?.name ?? notification.sender_id ?? undefined
    )
    .with(
      'agent_session_settled',
      'agent_session_waiting_for_input',
      () => content?.botName
    )
    .with(
      'agent_session_mentioned',
      () => content?.mentionedBy ?? content?.botName
    )
    .with(
      'channel_message_send',
      () => content?.sender ?? notification.sender_id ?? undefined
    )
    .with(
      'commented_on_document',
      'mentioned_in_document_comment',
      'replied_to_document_comment_thread',
      'crm_discussion',
      () => content?.senderDisplayName ?? undefined
    )
    .with(
      'github_pr_status_changed',
      'github_review_requested',
      'github_pr_comment',
      'github_pr_mention',
      'github_pr_review',
      () => content?.senderGithubLogin ?? notification.sender_id ?? undefined
    )
    .otherwise(() => undefined);
}

/** The sender's avatar when the notification metadata carries one. */
export function getNotificationSenderAvatarUrl(
  notification: UnifiedNotification
): string | undefined {
  const content = senderContent(notification);
  return (
    content?.senderProfilePictureUrl ?? content?.agent?.avatarUrl ?? undefined
  );
}

export type NotificationAgentSender = {
  name: string;
  avatarUrl?: string;
};

/**
 * The agent that authored a comment notification. Agent-authored comments
 * carry no `sender_id` (it only holds human senders); the agent's name and
 * avatar travel in the metadata instead.
 */
export function getNotificationAgentSender(
  notification: UnifiedNotification
): NotificationAgentSender | undefined {
  // Agent code sends pings as its user, so they keep the
  // user's id as sender and read as from the agent.
  if (notification.notification_metadata.tag === 'ping') {
    const agent = senderContent(notification)?.agent;
    if (!agent?.name) return undefined;
    return { name: agent.name, avatarUrl: agent.avatarUrl ?? undefined };
  }

  if (notification.sender_id) return undefined;

  return match(notification.notification_metadata.tag)
    .with(
      'commented_on_document',
      'mentioned_in_document_comment',
      'replied_to_document_comment_thread',
      'crm_discussion',
      () => {
        const name = getNotificationSenderFallbackName(notification)?.trim();
        if (!name) return undefined;
        const avatarUrl =
          senderContent(notification)?.senderProfilePictureUrl ?? undefined;
        return { name, avatarUrl };
      }
    )
    .otherwise(() => undefined);
}

/**
 * The user a notification reads as being from. A ping an agent
 * sent keeps its user's id as sender but reads as from the agent alone, so it
 * names no user.
 */
export function getNotificationUserSenderId(
  notification: UnifiedNotification
): string | undefined {
  const fromAgent =
    notification.notification_metadata.tag === 'ping' &&
    getNotificationAgentSender(notification) !== undefined;
  return fromAgent ? undefined : (notification.sender_id ?? undefined);
}

/** Unique agent senders across a stack, by name, preserving order. */
export function getUniqueAgentSenders(
  notifications: UnifiedNotification[]
): NotificationAgentSender[] {
  const byName = new Map<string, NotificationAgentSender>();
  for (const notification of notifications) {
    const agent = getNotificationAgentSender(notification);
    if (agent && !byName.has(agent.name)) byName.set(agent.name, agent);
  }
  return Array.from(byName.values());
}
