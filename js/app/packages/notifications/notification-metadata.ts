import type { UnifiedNotification } from '@service-notification/client';
import type {
  NotifEventOneOf,
  NotifEventOneOfFive,
  NotifEventOneOfNine,
  NotifEventOneOfOnefive,
  NotifEventOneOfOneone,
  NotifEventOneOfOnethree,
  NotifEventOneOfSeven,
  NotifEventOneOfThree,
} from '@service-notification/generated/schemas';

// Type narrowing helpers for notification metadata discriminated union
// Each helper narrows the notificationMetadata to its specific variant
//
// Mapping:
// - NotifEventOneOf = channel_mention
// - NotifEventOneOfThree = document_mention
// - NotifEventOneOfFive = channel_invite
// - NotifEventOneOfSeven = channel_message_send
// - NotifEventOneOfNine = channel_message_reply
// - NotifEventOneOfOneone = new_email
// - NotifEventOneOfOnethree = invite_to_team
// - NotifEventOneOfOnefive = task_assigned

export function isChannelMention(
  n: UnifiedNotification
): n is UnifiedNotification & { notificationMetadata: NotifEventOneOf } {
  return n.notificationMetadata.tag === 'channel_mention';
}

export function isDocumentMention(
  n: UnifiedNotification
): n is UnifiedNotification & { notificationMetadata: NotifEventOneOfThree } {
  return n.notificationMetadata.tag === 'document_mention';
}

export function isChannelInvite(
  n: UnifiedNotification
): n is UnifiedNotification & { notificationMetadata: NotifEventOneOfFive } {
  return n.notificationMetadata.tag === 'channel_invite';
}

export function isChannelMessageSend(
  n: UnifiedNotification
): n is UnifiedNotification & { notificationMetadata: NotifEventOneOfSeven } {
  return n.notificationMetadata.tag === 'channel_message_send';
}

export function isChannelMessageReply(
  n: UnifiedNotification
): n is UnifiedNotification & { notificationMetadata: NotifEventOneOfNine } {
  return n.notificationMetadata.tag === 'channel_message_reply';
}

export function isNewEmail(
  n: UnifiedNotification
): n is UnifiedNotification & { notificationMetadata: NotifEventOneOfOneone } {
  return n.notificationMetadata.tag === 'new_email';
}

export function isInviteToTeam(
  n: UnifiedNotification
): n is UnifiedNotification & { notificationMetadata: NotifEventOneOfOnethree } {
  return n.notificationMetadata.tag === 'invite_to_team';
}

export function isTaskAssigned(
  n: UnifiedNotification
): n is UnifiedNotification & { notificationMetadata: NotifEventOneOfOnefive } {
  return n.notificationMetadata.tag === 'task_assigned';
}

// Helper functions for derived notification data

export function getNotificationAction(n: UnifiedNotification): string {
  switch (n.notificationMetadata.tag) {
    case 'channel_mention':
      return 'mentioned you in';
    case 'document_mention':
      return 'mentioned you in';
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
      return 'notified you';
  }
}

export function getNotificationTargetName(n: UnifiedNotification): string | undefined {
  const m = n.notificationMetadata;
  switch (m.tag) {
    case 'channel_invite':
      return m.content.channelName;
    case 'document_mention':
      return m.content.documentName;
    case 'invite_to_team':
      return m.content.teamName;
    case 'task_assigned':
      return m.content.taskName ?? undefined;
    default:
      return undefined;
  }
}

export function getNotificationContent(n: UnifiedNotification): string | undefined {
  const m = n.notificationMetadata;
  switch (m.tag) {
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply':
      return m.content.messageContent;
    case 'document_mention':
      return m.content.documentName;
    case 'new_email':
      return m.content.subject;
    case 'task_assigned':
      return m.content.taskName ?? undefined;
    default:
      return undefined;
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
      return true;
    default:
      return true;
  }
}
