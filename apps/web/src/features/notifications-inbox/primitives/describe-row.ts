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
import type { InboxStackItem } from '../core/inbox-row';

/**
 * What a row says: a muted "actor verb place" line and its subject. The line
 * shares `getNotificationAction`'s vocabulary with the other notification
 * surfaces, which isn't translated yet, so it stays in English with them.
 */
export type InboxRowDisplay = {
  action: string;
  subject: string;
};

/** What a card says: what it is about, then who. */
export type InboxCardDisplay = {
  title: string;
  detail: string;
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
  const latest = row.content.notifications[0];
  if (!latest) return { action: '', subject: row.content.entity.name };
  return describeNotification(row, latest, actorName(row, latest, names));
}

function describeNotification(
  row: NotificationInboxRow,
  latest: UnifiedNotification,
  actor: string | undefined
): InboxRowDisplay {
  const entityName = row.content.entity.name;
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

/**
 * Who sent one notification of a stack. The row's actor speaks for its newest
 * notification only, so the older ones name their own sender.
 */
const senderOf = (
  row: NotificationInboxRow,
  notification: UnifiedNotification,
  names: Names
) =>
  (notification === row.content.notifications[0]
    ? actorName(row, notification, names)
    : undefined) ??
  names.senderName(notification) ??
  (notification.sender_id
    ? names.userName(notification.sender_id)
    : undefined) ??
  getNotificationSenderFallbackName(notification);

/** "Sam", "Sam and Noor", "Sam, Noor and Mara", "Sam, Noor and 3 others". */
const nameList = (all: readonly string[]) => {
  const unique = [...new Set(all)];
  const [first = '', second, third] = unique;
  if (unique.length <= 1) return first;
  if (unique.length === 2) return `${first} and ${second}`;
  if (unique.length === 3) return `${first}, ${second} and ${third}`;
  return `${first}, ${second} and ${unique.length - 2} others`;
};

/** What one notification did, for a stack that already names its place. */
const stackVerb = (notification: UnifiedNotification) =>
  match(notification.notification_metadata)
    .with({ tag: P.union('channel_message_send', 'new_email') }, () => '')
    .with(
      {
        tag: P.union(
          'channel_mention',
          'mentioned_in_document_comment',
          'github_pr_mention',
          'agent_session_mentioned'
        ),
      },
      () => 'mentioned you'
    )
    .with(
      {
        tag: P.union(
          'channel_message_reply',
          'replied_to_document_comment_thread'
        ),
      },
      () => 'replied'
    )
    .with({ tag: 'channel_message_reaction' }, () => 'reacted')
    .with(
      { tag: P.union('commented_on_document', 'github_pr_comment') },
      () => 'commented'
    )
    .with(
      { tag: P.union('initiative_discussion', 'crm_discussion') },
      ({ content }) =>
        match(content.reason as string)
          .with('mention', () => 'mentioned you')
          .with('reply', () => 'replied')
          .otherwise(() => 'commented')
    )
    .with({ tag: 'agent_session_settled' }, () => 'finished')
    .with({ tag: 'agent_session_waiting_for_input' }, () => 'needs your answer')
    .with({ tag: 'ai_response' }, () => 'responded')
    .with({ tag: 'github_pr_status_changed' }, () => 'updated')
    .with({ tag: 'github_review_requested' }, () => 'wants your review')
    .with({ tag: 'github_pr_review' }, () => 'reviewed')
    .otherwise(() =>
      getNotificationAction(notification).replace(/ (in|on|to)$/, '')
    );

/** The top-level message a thread row is about, when one of its notifications carries it. */
const rootMessage = (row: NotificationInboxRow) => {
  if (!row.threadId) return undefined;
  for (const { notification_metadata: metadata } of row.content.notifications) {
    const root = match(metadata)
      .with(
        {
          tag: P.union(
            'channel_message_send',
            'channel_mention',
            'channel_message_reaction'
          ),
        },
        ({ content }) =>
          content.messageId === row.threadId
            ? content.messageContent
            : undefined
      )
      .otherwise(() => undefined);
    if (root) return root;
  }
  return undefined;
};

/**
 * Describe a row's card. A single notification says what it is about and who
 * did it; a stack names what its notifications share (the message, channel,
 * session, document or thread) and everyone in it.
 */
export function describeInboxCard(
  row: NotificationInboxRow,
  names: Names
): InboxCardDisplay {
  const single = describeInboxRow(row, names);
  const latest = row.content.notifications[0];
  if (row.count <= 1 || !latest) {
    return { title: single.subject, detail: single.action };
  }

  const entityName = row.content.entity.name;
  const senders = row.content.notifications.map(
    (notification) => senderOf(row, notification, names) ?? ''
  );
  const who = nameList(senders.filter((sender) => sender !== ''));
  const place = channelPlace(
    latest.notification_metadata.content as ChannelContent
  );
  const target = getNotificationTargetName(latest);

  return match(row.type)
    .with('channel_thread', 'channel_mention', () => ({
      title: rootMessage(row) ?? single.subject,
      detail: place ? `${who} in ${place}` : who,
    }))
    .with('channel_messages', () =>
      place
        ? { title: place, detail: `${who} posted` }
        : { title: who || entityName, detail: single.subject }
    )
    .with(
      'discussion_mention',
      'discussion_messages',
      'discussion_thread',
      () => ({
        title: target ?? entityName,
        detail: `${who} commented`,
      })
    )
    .with('agent', () => ({
      title: target ?? entityName,
      detail: join(who, stackVerb(latest)),
    }))
    .with('pull_request', () => ({
      title: entityName,
      detail: join(who, stackVerb(latest)),
    }))
    .with('email', () => ({ title: single.subject, detail: who }))
    .otherwise(() => ({ title: single.subject, detail: single.action }));
}

/** Describe one notification of a stack, without the place its card names. */
export function describeStackItem(
  row: NotificationInboxRow,
  notification: UnifiedNotification,
  names: Names
): InboxStackItem {
  const sender = senderOf(row, notification, names);
  return {
    id: notification.id,
    by: join(sender, stackVerb(notification)),
    text: describeNotification(row, notification, sender).subject,
    at: new Date(notification.created_at),
  };
}
