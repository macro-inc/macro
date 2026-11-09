import {
  agentTurnEnding,
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
import type { InboxCardKind, InboxStackItem } from '../core/inbox-row';

/**
 * What a row says: a muted "actor verb place" line and its subject. The line
 * shares `getNotificationAction`'s vocabulary with the other notification
 * surfaces, which isn't translated yet, so it stays in English with them.
 */
export type InboxRowDisplay = {
  action: string;
  subject: string;
};

/** What a card says, in as many lines as it has something to say. */
export type InboxCardDisplay = {
  /** Who did it, and what they did when that isn't obvious. */
  who: string;
  /** What it is about: a subject, channel, document, session or task. */
  what?: string;
  /** What was said, as Markdown. */
  body?: string;
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
    .with({ tag: 'agent_session_settled' }, ({ content }) =>
      agentTurnEnding(content.stopReason)
    )
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

/** What a notification says, beyond what its card already names. */
const spokenText = (notification: UnifiedNotification) =>
  match(notification.notification_metadata)
    .with({ tag: 'new_email' }, ({ content }) => content.snippet)
    .with(
      { tag: 'channel_invite' },
      ({ content }) => content.messageContent ?? undefined
    )
    .otherwise(() => getNotificationContent(notification));

/** Drops a line that repeats one above it, and never leaves the first empty. */
const withoutRepeats = (
  card: { who: string; what?: string; body?: string },
  fallback: string
): InboxCardDisplay => {
  const what = card.what && card.what !== card.who ? card.what : undefined;
  const body =
    card.body && card.body !== card.who && card.body !== card.what
      ? card.body
      : undefined;
  if (card.who) return { who: card.who, what, body };
  return what ? { who: what, body } : { who: body ?? fallback };
};

/**
 * Describe a row's card, as a stack or one notification: who did it, what it is
 * about when that isn't who, and what was said. Cards are only as tall as they
 * have something to say: an email has all three lines, a message in a channel
 * has no middle one, and a task has no last one.
 */
export function describeInboxCard(
  row: NotificationInboxRow,
  names: Names
): InboxCardDisplay {
  const entityName = row.content.entity.name;
  const latest = row.content.notifications[0];
  if (!latest) return { who: entityName };

  const single = describeInboxRow(row, names);
  const metadata = latest.notification_metadata;
  const isStack = row.count > 1;
  const sender = senderOf(row, latest, names);
  const senders = row.content.notifications
    .map((notification) => senderOf(row, notification, names) ?? '')
    .filter((name) => name !== '');
  const who = isStack ? nameList(senders) : (sender ?? '');
  const spoken = spokenText(latest);
  // A stack with several people says who said its newest line.
  const body =
    spoken && sender && new Set(senders).size > 1
      ? `${sender}: ${spoken}`
      : spoken;
  const place = channelPlace(metadata.content as ChannelContent);
  const target = getNotificationTargetName(latest);
  const inPlace = (text: string) => (place ? `${text} in ${place}` : text);
  // A message says itself, and its badge says when it is a mention.
  const channelDeed = () =>
    metadata.tag === 'channel_message_send' ||
    metadata.tag === 'channel_mention'
      ? who
      : join(who, stackVerb(latest));

  const card = match(row.type)
    .with('channel_thread', 'channel_mention', () =>
      isStack
        ? { who: inPlace(who), what: rootMessage(row), body }
        : { who: inPlace(channelDeed()), body }
    )
    .with('channel_messages', () => {
      if (isStack) {
        return place ? { who, what: place, body } : { who, body };
      }
      if (metadata.tag !== 'channel_invite') {
        return { who: inPlace(channelDeed()), body };
      }
      return metadata.content.isDirectMessage
        ? { who: single.action, body }
        : {
            who: join(who, 'invited you'),
            what: metadata.content.channelName,
            body,
          };
    })
    .with(
      'discussion_mention',
      'discussion_messages',
      'discussion_thread',
      () => ({
        who: isStack ? `${who} commented` : join(who, stackVerb(latest)),
        what: target ?? entityName,
        body,
      })
    )
    .with('agent', () => ({
      who: join(who, stackVerb(latest)),
      what: target ?? entityName,
      body,
    }))
    .with('pull_request', () => ({
      who: join(who, stackVerb(latest)),
      what: entityName,
      // Its status repeats the title, so it names the pull request instead.
      body: spoken && spoken !== entityName ? body : target,
    }))
    .with('email', () =>
      metadata.tag === 'reminder'
        ? { who: single.action, what: single.subject }
        : { who, what: single.subject, body }
    )
    .with('calendar_event', () =>
      metadata.tag === 'calendar_event_reminder'
        ? { who: 'Upcoming event', what: single.subject, body: spoken }
        : { who: single.action, what: single.subject }
    )
    .with(
      'task',
      'calendar_join_request',
      'access_requested',
      'access_granted',
      () => ({ who: single.action, what: single.subject })
    )
    .with('other', () => ({ who: single.action, body: single.subject }))
    .exhaustive();

  return withoutRepeats(card, entityName);
}

/**
 * The kind of notification a row is. A stack's newest notification decides,
 * except that a mention stays one: it is why the row is there.
 */
export function inboxCardKind(row: NotificationInboxRow): InboxCardKind {
  const metadata = row.content.notifications[0]?.notification_metadata;
  const isDirect =
    (metadata?.content as ChannelContent | undefined)?.channelType ===
    'directMessage';
  return match(row.type)
    .returnType<InboxCardKind>()
    .with('channel_mention', 'discussion_mention', () => 'mention')
    .with('channel_thread', () =>
      metadata?.tag === 'channel_message_reaction' ? 'reaction' : 'reply'
    )
    .with('channel_messages', () => {
      if (metadata?.tag === 'channel_invite') return 'invite';
      if (metadata?.tag === 'channel_message_reaction') return 'reaction';
      return isDirect ? 'message' : 'channel';
    })
    .with('discussion_thread', () => 'reply')
    .with('discussion_messages', () => 'comment')
    .with('email', () => (metadata?.tag === 'reminder' ? 'reminder' : 'email'))
    .with('agent', () => 'agent')
    .with('task', () => 'task')
    .with('pull_request', () => 'pull_request')
    .with('calendar_event', 'calendar_join_request', () => 'event')
    .with('access_requested', 'access_granted', () => 'access')
    .with('other', () =>
      metadata?.tag === 'invite_to_team' ? 'invite' : 'other'
    )
    .exhaustive();
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
