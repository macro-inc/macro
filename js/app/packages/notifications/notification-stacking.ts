import { compareDateDesc } from '@core/util/date';
import type { UnifiedNotification } from './types';
import type { NotificationType } from '@core/types';
import {
  isChannelNotification,
  isDocumentCommentNotification,
} from './notification-helpers';
import { match } from 'ts-pattern';

export interface NotificationStack {
  type: NotificationType;
  notifications: UnifiedNotification[];
}

/**
 * Gets the most recent notification from a group (first item, sorted by recency)
 */
export function getMostRecentNotification(
  group: NotificationStack
): UnifiedNotification {
  return group.notifications[0];
}

/**
 * Gets all notifications from a group
 */
export function getAllNotificationsFromGroup(
  group: NotificationStack
): UnifiedNotification[] {
  return group.notifications;
}

/**
 * Gets the threadId from a thread stack (replies, thread-mentions, or absorbed root sends).
 * Works for both channel threads and document comment threads.
 */
export function getThreadId(group: NotificationStack): string {
  for (const notification of group.notifications) {
    const threadId = match(notification.notification_metadata)
      .with({ tag: 'channel_message_reply' }, (m) => m.content.threadId ?? '')
      .with({ tag: 'channel_mention' }, (m) => m.content.threadId ?? '')
      .with({ tag: 'replied_to_document_comment_thread' }, (m) =>
        m.content.threadId.toString()
      )
      .with({ tag: 'mentioned_in_document_comment' }, (m) =>
        m.content.threadId.toString()
      )
      .with({ tag: 'commented_on_document' }, (m) =>
        m.content.threadId.toString()
      )
      .otherwise(() => '');
    if (threadId) return threadId;
  }
  return '';
}

/**
 * Stacks notifications by type for unrolled notification display.
 *
 * Stacking rules (applied independently to channel notifications and document
 * comment notifications):
 * - Replies, thread-mentions, and the root send for a thread all group into
 *   a single thread stack.
 * - Root-level new sends are grouped into a single stack.
 * - Root mentions each form their own stack.
 * - Any send/reply whose messageId matches a mention's messageId is shadowed
 *   (the mention is more informative).
 *
 * For document comments, a notification is treated as the root of its thread
 * when its commentId === threadId, otherwise as belonging to the thread.
 */
export function stackNotifications(
  notifications: UnifiedNotification[]
): NotificationStack[] {
  const channelViews = notifications
    .filter(isChannelNotification)
    .map(toChannelView)
    .filter((v): v is NormalizedView => v !== null);

  const docCommentViews = notifications
    .filter(isDocumentCommentNotification)
    .map(toDocCommentView)
    .filter((v): v is NormalizedView => v !== null);

  const channelStacks = stackNormalizedViews(channelViews, {
    send: 'channel_message_send',
    reply: 'channel_message_reply',
    mention: 'channel_mention',
  });

  const docCommentStacks = stackNormalizedViews(docCommentViews, {
    send: 'commented_on_document',
    reply: 'replied_to_document_comment_thread',
    mention: 'mentioned_in_document_comment',
  });

  const docMentions = notifications.filter(
    (n) => n.notification_metadata.tag === 'document_mention'
  );
  const others = notifications.filter(
    (n) =>
      !isChannelNotification(n) &&
      !isDocumentCommentNotification(n) &&
      n.notification_metadata.tag !== 'document_mention'
  );

  const groups: NotificationStack[] = [
    ...channelStacks,
    ...docCommentStacks,
    ...makeStack('document_mention', docMentions),
    ...others.flatMap((n) => makeStack(n.notification_metadata.tag, [n])),
  ];

  return groups.sort((a, b) =>
    compareDateDesc(
      a.notifications[0].created_at,
      b.notifications[0].created_at
    )
  );
}

type ViewRole = 'send' | 'reply' | 'mention';

interface NormalizedView {
  notification: UnifiedNotification;
  role: ViewRole;
  messageId: string;
  threadId: string | undefined;
}

interface DomainTags {
  send: NotificationType;
  reply: NotificationType;
  mention: NotificationType;
}

function toChannelView(n: UnifiedNotification): NormalizedView | null {
  return match(n.notification_metadata)
    .with({ tag: 'channel_message_send' }, (m) => ({
      notification: n,
      role: 'send' as const,
      messageId: m.content.messageId,
      threadId: undefined,
    }))
    .with({ tag: 'channel_message_reply' }, (m) => ({
      notification: n,
      role: 'reply' as const,
      messageId: m.content.messageId,
      threadId: m.content.threadId,
    }))
    .with({ tag: 'channel_mention' }, (m) => ({
      notification: n,
      role: 'mention' as const,
      messageId: m.content.messageId,
      threadId: m.content.threadId ?? undefined,
    }))
    .otherwise(() => null);
}

function toDocCommentView(n: UnifiedNotification): NormalizedView | null {
  return match(n.notification_metadata)
    .with({ tag: 'commented_on_document' }, (m) => {
      const messageId = m.content.commentId.toString();
      const threadId = m.content.threadId.toString();
      // A doc comment is the root of its thread when commentId === threadId;
      // otherwise it is a reply made on the doc owner's document.
      const isRoot = messageId === threadId;
      return {
        notification: n,
        role: isRoot ? ('send' as const) : ('reply' as const),
        messageId,
        threadId: isRoot ? undefined : threadId,
      };
    })
    .with({ tag: 'replied_to_document_comment_thread' }, (m) => ({
      notification: n,
      role: 'reply' as const,
      messageId: m.content.commentId.toString(),
      threadId: m.content.threadId.toString(),
    }))
    .with({ tag: 'mentioned_in_document_comment' }, (m) => {
      const messageId = m.content.commentId.toString();
      const threadId = m.content.threadId.toString();
      const isRoot = messageId === threadId;
      return {
        notification: n,
        role: 'mention' as const,
        messageId,
        threadId: isRoot ? undefined : threadId,
      };
    })
    .otherwise(() => null);
}

function stackNormalizedViews(
  views: NormalizedView[],
  tags: DomainTags
): NotificationStack[] {
  const mentions = views.filter((v) => v.role === 'mention');
  const rootMentions = mentions.filter((v) => v.threadId === undefined);
  const threadMentions = mentions.filter((v) => v.threadId !== undefined);

  const mentionedMsgIds = new Set(mentions.map((v) => v.messageId));

  const isShadowed = (v: NormalizedView) =>
    (v.role === 'send' || v.role === 'reply') &&
    mentionedMsgIds.has(v.messageId);

  // A thread is "active" if it has any reply or any thread-mention.
  const activeThreadIds = new Set(
    views
      .map((v) =>
        v.role === 'reply' || (v.role === 'mention' && v.threadId !== undefined)
          ? v.threadId
          : undefined
      )
      .filter((id): id is string => id !== undefined)
  );

  const replies = views
    .filter((v) => v.role === 'reply')
    .filter((v) => !isShadowed(v));

  const allSends = views.filter((v) => v.role === 'send');

  const isAbsorbedIntoThread = (v: NormalizedView) =>
    activeThreadIds.has(v.messageId);

  const newSends = allSends.filter(
    (v) => !isShadowed(v) && !isAbsorbedIntoThread(v)
  );
  const absorbedSends = allSends.filter(
    (v) => !isShadowed(v) && isAbsorbedIntoThread(v)
  );

  const absorbedRootMentions = rootMentions.filter((v) =>
    activeThreadIds.has(v.messageId)
  );
  const orphanRootMentions = rootMentions.filter(
    (v) => !activeThreadIds.has(v.messageId)
  );

  return [
    ...orphanRootMentions.flatMap((v) =>
      makeStack(tags.mention, [v.notification])
    ),
    ...makeStack(
      tags.send,
      newSends.map((v) => v.notification)
    ),
    ...makeThreadStacks(
      tags.reply,
      replies,
      threadMentions,
      absorbedSends,
      absorbedRootMentions
    ),
  ];
}

function sortByRecency(items: UnifiedNotification[]): UnifiedNotification[] {
  return [...items].sort((a, b) => compareDateDesc(a.created_at, b.created_at));
}

const groupBy: <T, K>(items: T[], keyFn: (item: T) => K) => Map<K, T[]> =
  Map.groupBy ??
  ((items, keyFn) => {
    const map = new Map();
    for (const item of items) {
      const key = keyFn(item);
      const group = map.get(key);
      if (group) {
        group.push(item);
      } else {
        map.set(key, [item]);
      }
    }
    return map;
  });

function makeStack(
  type: NotificationType,
  notifications: UnifiedNotification[]
): NotificationStack[] {
  if (notifications.length === 0) return [];
  return [{ type, notifications: sortByRecency(notifications) }];
}

function makeThreadStacks(
  replyTag: NotificationType,
  replies: NormalizedView[],
  threadMentions: NormalizedView[],
  absorbedSends: NormalizedView[],
  absorbedRootMentions: NormalizedView[]
): NotificationStack[] {
  // Key each view by its threadId. For absorbed sends and root mentions, their
  // messageId IS the threadId (they are the thread root).
  const keyOf = (v: NormalizedView): string => {
    if (v.role === 'reply') return v.threadId ?? '';
    if (v.role === 'mention') return v.threadId ?? v.messageId;
    return v.messageId;
  };

  const byThread = groupBy(
    [...replies, ...threadMentions, ...absorbedSends, ...absorbedRootMentions],
    keyOf
  );

  return [...byThread.entries()]
    .filter(([threadId]) => threadId !== '')
    .map(([, group]) => ({
      type: replyTag,
      notifications: sortByRecency(group.map((v) => v.notification)),
    }));
}
