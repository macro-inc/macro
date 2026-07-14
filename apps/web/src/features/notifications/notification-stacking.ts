import type { NotificationType } from '@core/types';
import { compareDateDesc } from '@core/util/date';
import { match } from 'ts-pattern';
import {
  isChannelNotification,
  isDocumentCommentNotification,
} from './notification-helpers';
import type { UnifiedNotification } from './types';

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
 *
 * Returns '' for stack types that represent standalone (non-thread) groups —
 * the "new sends" stack and orphan root mentions for either domain.
 */
export function getThreadId(group: NotificationStack): string {
  // Standalone-group stack types do not represent a thread.
  if (
    group.type === 'channel_message_send' ||
    group.type === 'channel_mention' ||
    group.type === 'commented_on_document' ||
    group.type === 'mentioned_in_document_comment'
  ) {
    return '';
  }
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
 * Channel rules:
 * - Replies, thread-mentions, and the root send for a thread all group into
 *   a single thread stack.
 * - Root-level new sends are grouped into a single stack.
 * - Root mentions each form their own stack.
 * - Any send/reply whose messageId matches a mention's messageId is shadowed
 *   (the mention is more informative).
 *
 * Document comment rules (`commented_on_document` cannot be statically
 * distinguished as root vs. reply — the metadata only carries `commentId` and
 * `threadId`, which come from independent id namespaces — so grouping is
 * inferred from peers within the same threadId):
 * - A threadId is a "thread" when it has any reply notification or 2+
 *   notifications of any kind. All notifications for that threadId fold into
 *   a single thread stack.
 * - Otherwise the lone notification is treated as standalone:
 *   - `commented_on_document` standalones bundle into a "new comments" stack.
 *   - `mentioned_in_document_comment` standalones each form their own stack.
 *   - A lone `replied_to_document_comment_thread` is still a thread stack.
 * - Mention shadowing applies the same way as for channels.
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

  const docCommentStacks = stackDocCommentViews(docCommentViews);

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
  // commentId and threadId come from separate DB tables (Comment.id and
  // Thread.id), so equality between them carries no meaning. Roots vs.
  // replies are inferred at the stacking layer from peers sharing a threadId.
  return match(n.notification_metadata)
    .with({ tag: 'commented_on_document' }, (m) => ({
      notification: n,
      role: 'send' as const,
      messageId: m.content.commentId.toString(),
      threadId: m.content.threadId.toString(),
    }))
    .with({ tag: 'replied_to_document_comment_thread' }, (m) => ({
      notification: n,
      role: 'reply' as const,
      messageId: m.content.commentId.toString(),
      threadId: m.content.threadId.toString(),
    }))
    .with({ tag: 'mentioned_in_document_comment' }, (m) => ({
      notification: n,
      role: 'mention' as const,
      messageId: m.content.commentId.toString(),
      threadId: m.content.threadId.toString(),
    }))
    .otherwise(() => null);
}

function stackDocCommentViews(views: NormalizedView[]): NotificationStack[] {
  const mentionedMsgIds = new Set(
    views.filter((v) => v.role === 'mention').map((v) => v.messageId)
  );

  const filtered = views.filter(
    (v) => v.role === 'mention' || !mentionedMsgIds.has(v.messageId)
  );

  const byThread = groupBy(filtered, (v) => v.threadId ?? '');

  const standaloneSends: NormalizedView[] = [];
  const stacks: NotificationStack[] = [];

  for (const [threadId, group] of byThread) {
    if (threadId === '') continue;

    const isThread = group.length >= 2 || group.some((v) => v.role === 'reply');

    if (isThread) {
      stacks.push({
        type: 'replied_to_document_comment_thread',
        notifications: sortByRecency(group.map((v) => v.notification)),
      });
      continue;
    }

    const v = group[0];
    if (v.role === 'send') {
      standaloneSends.push(v);
    } else if (v.role === 'mention') {
      stacks.push({
        type: 'mentioned_in_document_comment',
        notifications: [v.notification],
      });
    }
  }

  if (standaloneSends.length > 0) {
    stacks.push({
      type: 'commented_on_document',
      notifications: sortByRecency(standaloneSends.map((v) => v.notification)),
    });
  }

  return stacks;
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
