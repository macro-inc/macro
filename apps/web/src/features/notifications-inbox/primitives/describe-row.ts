import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
} from '@notifications/notification-metadata';
import { getNotificationSenderFallbackName } from '@notifications/notification-sender';
import type { UnifiedNotification } from '@notifications/types';
import { match, P } from 'ts-pattern';
import type {
  NotificationInboxRow,
  NotificationsInboxContext,
} from '../context/notifications-inbox-context';

/** What a row says: a muted "actor verb place" line and its subject. */
export type InboxRowDisplay = {
  action: string;
  subject: string;
};

type Names = Pick<NotificationsInboxContext, 'userName' | 'senderName'>;

/**
 * The name a row shows for who it is from. A row from no one in Macro names
 * the sender its notification carries; an unknown kind of actor names no one.
 */
function actorName(
  row: NotificationInboxRow,
  latest: UnifiedNotification,
  names: Names
): string | undefined {
  return match(row.actor)
    .with(
      undefined,
      () =>
        names.senderName(latest) ?? getNotificationSenderFallbackName(latest)
    )
    .with(
      { kind: 'user' },
      (actor) => names.senderName(latest) ?? names.userName(actor.id)
    )
    .with(
      { kind: 'agent' },
      (actor) => actor.name ?? getNotificationSenderFallbackName(latest)
    )
    .with({ kind: 'macro' }, () => 'Macro')
    .with({ kind: 'other' }, () => undefined)
    .exhaustive();
}

const join = (...parts: (string | undefined)[]) =>
  parts.filter((part) => part !== undefined && part !== '').join(' ');

type ChannelContent = { channelType?: string; channelName?: string };

/** Where a channel event happened; a DM says nothing, a channel names itself. */
const channelPlace = (content: ChannelContent) => {
  if (content.channelType === 'directMessage' || !content.channelName) return;
  return content.channelType === 'public' || content.channelType === 'team'
    ? `#${content.channelName}`
    : content.channelName;
};

/** Channel verbs drop their preposition in a DM, which needs no place. */
function channelAction(
  actor: string | undefined,
  notification: UnifiedNotification,
  content: ChannelContent
) {
  const place = channelPlace(content);
  if (place) return join(actor, getNotificationAction(notification), place);
  const dmVerb = match(notification.notification_metadata.tag)
    .with('channel_mention', () => 'mentioned you')
    .with('channel_message_reply', () => 'replied')
    .with('channel_message_reaction', () => 'reacted to your message')
    .otherwise(() => 'sent you a message');
  return join(actor, dmVerb);
}

/**
 * Describe a row from its newest notification: who did what, where, and the
 * subject a reader scans for — the email subject, the message or comment,
 * the task, pull request, event, or item.
 */
export function describeInboxRow(
  row: NotificationInboxRow,
  names: Names
): InboxRowDisplay {
  const entityName = row.content.entity.name;
  const latest = row.content.notifications[0];
  if (!latest) return { action: '', subject: entityName };
  const actor = actorName(row, latest, names);
  const content = getNotificationContent(latest);
  const target = getNotificationTargetName(latest);

  return match(latest.notification_metadata)
    .with(
      {
        tag: P.union(
          'channel_mention',
          'channel_message_send',
          'channel_message_reply',
          'channel_message_reaction'
        ),
      },
      (metadata) => ({
        action: channelAction(actor, latest, metadata.content),
        subject: content ?? entityName,
      })
    )
    .with({ tag: 'channel_invite' }, (metadata) => ({
      action: metadata.content.isDirectMessage
        ? join(actor, 'started a conversation')
        : join(actor, 'invited you to', metadata.content.channelName),
      subject:
        metadata.content.messageContent ||
        metadata.content.channelName ||
        entityName,
    }))
    .with({ tag: 'new_email' }, (metadata) => ({
      action: join(
        actor,
        row.count > 1 ? 'responded to thread' : 'sent you an email'
      ),
      subject: metadata.content.subject || entityName,
    }))
    .with({ tag: 'task_assigned' }, (metadata) => ({
      action: join(actor, 'assigned you a task'),
      subject: metadata.content.taskName ?? entityName,
    }))
    .with({ tag: 'entity_access_requested' }, (metadata) => ({
      action: join(actor, `requested ${metadata.content.accessLevel} access`),
      subject: metadata.content.entityName || entityName,
    }))
    .with({ tag: 'entity_access_granted' }, (metadata) => ({
      action: join(actor, `granted you ${metadata.content.accessLevel} access`),
      subject: metadata.content.entityName || entityName,
    }))
    .with({ tag: 'reminder' }, () => ({
      action: 'Reminder',
      subject: content || entityName,
    }))
    .with({ tag: 'calendar_event_reminder' }, () => ({
      action: join('Upcoming event', content ? `· ${content}` : undefined),
      subject: target ?? entityName,
    }))
    .with({ tag: 'calendar_event_join_request' }, () => ({
      action: join(actor, 'asked to join'),
      subject: target ?? entityName,
    }))
    .with({ tag: 'ai_response' }, () => ({
      action: 'Macro responded',
      subject: content ?? entityName,
    }))
    .with(
      {
        tag: P.union(
          'agent_session_settled',
          'agent_session_waiting_for_input',
          'agent_session_mentioned'
        ),
      },
      (metadata) => ({
        action: join(actor, getNotificationAction(latest), target),
        subject: content ?? metadata.content.sessionName,
      })
    )
    .otherwise(() => ({
      // Discussions, comments, pull requests, document mentions: the
      // verb names the place, and the content is what was said.
      action: join(actor, getNotificationAction(latest), target),
      subject: content ?? target ?? entityName,
    }));
}
