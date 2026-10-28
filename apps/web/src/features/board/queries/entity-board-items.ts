import {
  type ConversationState,
  conversationState,
} from '@app/features/agents-view/core/conversation-state';
import { displaySubject } from '@app/features/email-compose/core/subject-text';
import type {
  ChannelEntity,
  ChannelThreadEntity,
  EntityData,
  GithubPullRequestEntity,
  WithNotification,
} from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import { getNotificationContent } from '@notifications/notification-metadata';
import {
  getNotificationSenderAvatarUrl,
  getNotificationSenderFallbackName,
} from '@notifications/notification-sender';
import type { UnifiedNotification } from '@notifications/types';
import { match, P } from 'ts-pattern';
import {
  type BoardAuthor,
  type BoardItem,
  type BoardItemKind,
  type BoardMessage,
  type BoardZone,
  MAX_ITEM_MESSAGES,
} from '../core/item';

/** What the adapter looks up outside the entity itself. */
export type BoardItemResolvers = {
  /** The signed-in user's Macro id (`macro|…`). */
  viewerId: string | undefined;
  /** A Macro user's display name, or the id's local part while loading. */
  userName: (userId: string) => string;
  /** A bot's display name from its sender details, when it is a bot. */
  botName: (senderId: string) => string | undefined;
  /** The current name of a channel, which entities may only snapshot. */
  channelName: (channelId: string, fallback: string) => string;
  /** Text for an item with nothing to say, e.g. an edited document. */
  updatedText: string;
  /** "Thread in #channel". */
  threadContext: (channel: string) => string;
  /** An agent run's state worth showing, or nothing while it rests. */
  agentStatus: (state: ConversationState) => string | undefined;
  /** "Open", "Merged" or "Closed". */
  pullRequestStatus: (
    state: GithubPullRequestEntity['metadata']['status']
  ) => string | undefined;
};

/** What each kind of entity contributes before unread state is counted. */
type ItemShape = Pick<BoardItem, 'zone' | 'kind' | 'title' | 'messages'> &
  Partial<Pick<BoardItem, 'context' | 'groupKey' | 'status' | 'face'>>;

/** Notifications that ask the viewer for something. */
const NEEDS_YOU_TAGS = new Set<string>([
  'channel_mention',
  'document_mention',
  'mentioned_in_document_comment',
  'task_assigned',
  'github_review_requested',
  'github_pr_mention',
  'agent_session_waiting_for_input',
  'agent_session_mentioned',
  'calendar_event_join_request',
  'entity_access_requested',
]);

const time = (value: unknown): number => {
  if (typeof value !== 'string' && !(value instanceof Date)) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

function attachedNotifications(
  entity: WithNotification<EntityData>
): UnifiedNotification[] {
  return entity.notifications?.() ?? [];
}

function userAuthor(id: string, resolve: BoardItemResolvers): BoardAuthor {
  const bot = resolve.botName(id);
  return {
    id,
    kind: bot ? 'agent' : 'person',
    name: bot ?? resolve.userName(id),
    isSelf: id === resolve.viewerId,
  };
}

function notificationAuthor(
  notification: UnifiedNotification,
  resolve: BoardItemResolvers
): BoardAuthor | undefined {
  if (notification.sender_id)
    return userAuthor(notification.sender_id, resolve);
  const name = getNotificationSenderFallbackName(notification);
  if (!name) return undefined;
  return {
    id: name,
    kind:
      notification.notification_metadata.tag === 'new_email'
        ? 'contact'
        : 'agent',
    name,
    isSelf: false,
    avatarUrl: getNotificationSenderAvatarUrl(notification),
  };
}

function notificationMessage(
  notification: UnifiedNotification,
  resolve: BoardItemResolvers
): BoardMessage | undefined {
  const text = getNotificationContent(notification)?.trim();
  if (!text) return undefined;
  return {
    id: notification.id,
    author: notificationAuthor(notification, resolve),
    text,
    at: time(notification.created_at),
    unread: !notificationIsRead(notification),
  };
}

/**
 * Newest messages last, without repeats of the same words from the same
 * person. A repeat (a message and its notification) keeps the first copy,
 * unread if either copy is.
 */
function conversation(messages: (BoardMessage | undefined)[]): BoardMessage[] {
  const kept = new Map<string, BoardMessage>();
  const ordered = messages
    .filter((message): message is BoardMessage => message !== undefined)
    .sort((a, b) => a.at - b.at);
  for (const message of ordered) {
    const key = `${message.author?.id ?? ''}:${message.text}`;
    const first = kept.get(key);
    kept.set(
      key,
      first ? { ...first, unread: first.unread || message.unread } : message
    );
  }
  return [...kept.values()].slice(-MAX_ITEM_MESSAGES);
}

function participantsOf(messages: BoardMessage[]): BoardAuthor[] {
  const people: BoardAuthor[] = [];
  for (const message of [...messages].reverse()) {
    const author = message.author;
    if (author && !people.some((person) => person.id === author.id)) {
      people.push(author);
    }
  }
  return people;
}

function channelZone(
  type: ChannelEntity['channelType'] | undefined
): BoardZone {
  return type === 'direct_message' ? 'dms' : 'channels';
}

function channelShape(
  entity: ChannelEntity,
  notifications: UnifiedNotification[],
  resolve: BoardItemResolvers
): ItemShape {
  const latest = entity.latestMessage;
  const messages = conversation([
    ...notifications.map((notification) =>
      notificationMessage(notification, resolve)
    ),
    latest && {
      id: latest.messageId,
      author: userAuthor(latest.senderId, resolve),
      text: latest.content,
      at: time(latest.createdAt),
      unread: false,
    },
  ]);
  const isDirect = entity.channelType === 'direct_message';
  const otherId = entity.participantIds?.find((id) => id !== resolve.viewerId);
  return {
    zone: channelZone(entity.channelType),
    kind: isDirect ? 'dm' : 'channel',
    title: resolve.channelName(entity.id, entity.name),
    groupKey: entity.id,
    face: isDirect && otherId ? userAuthor(otherId, resolve) : undefined,
    messages,
  };
}

function threadShape(
  entity: ChannelThreadEntity,
  notifications: UnifiedNotification[],
  resolve: BoardItemResolvers
): ItemShape {
  const channel = resolve.channelName(entity.channelId, entity.name);
  const messages = conversation([
    {
      id: entity.messageId,
      author: userAuthor(entity.senderId, resolve),
      text: entity.content,
      at: time(entity.createdAt),
      unread: false,
    },
    ...entity.thread.preview.map((reply) => ({
      id: reply.id,
      author: userAuthor(reply.sender_id, resolve),
      text: reply.content,
      at: time(reply.created_at),
      unread: false,
    })),
    ...notifications.map((notification) =>
      notificationMessage(notification, resolve)
    ),
  ]);
  return {
    zone: channelZone(entity.channelType),
    kind: 'thread',
    title: entity.content.split('\n')[0]?.slice(0, 80) || channel,
    context: resolve.threadContext(channel),
    groupKey: entity.channelId,
    messages,
  };
}

/** Everything else speaks only through its notifications. */
function notifiedShape(
  zone: BoardZone,
  kind: BoardItemKind,
  title: string,
  notifications: UnifiedNotification[],
  resolve: BoardItemResolvers,
  extra: { status?: string; context?: string; updatedAt?: number } = {}
): ItemShape {
  const messages = conversation(
    notifications.map((notification) =>
      notificationMessage(notification, resolve)
    )
  );
  return {
    zone,
    kind,
    title,
    status: extra.status,
    context: extra.context,
    messages:
      messages.length > 0 || !extra.updatedAt
        ? messages
        : [
            {
              id: `updated:${extra.updatedAt}`,
              text: resolve.updatedText,
              at: extra.updatedAt,
              unread: false,
            },
          ],
  };
}

/**
 * One Home feed entity as a board item: where it belongs, who said what in
 * it lately, and whether it is waiting on the viewer. Entities the board
 * does not show return undefined.
 */
export function toBoardItem(
  entity: WithNotification<EntityData>,
  resolve: BoardItemResolvers
): BoardItem | undefined {
  const notifications = attachedNotifications(entity).filter(
    (notification) => notification.state !== 'done'
  );
  const updatedAt = Math.max(
    time(entity.updatedAt),
    time(entity.notifiedAt),
    time(entity.sortTs)
  );

  const shape = match(entity)
    .returnType<ItemShape | undefined>()
    .with({ type: 'channel' }, (channel) =>
      channelShape(channel, notifications, resolve)
    )
    .with({ type: 'channel_thread' }, (thread) =>
      threadShape(thread, notifications, resolve)
    )
    .with({ type: 'email' }, (email) => {
      const sender: BoardAuthor | undefined =
        email.senderEmail || email.senderName
          ? {
              id: email.senderEmail ?? email.senderName ?? email.id,
              kind: 'contact',
              name: email.senderName || email.senderEmail || '',
              isSelf:
                !!email.senderEmail &&
                resolve.viewerId === `macro|${email.senderEmail}`,
            }
          : undefined;
      return {
        zone: 'email',
        kind: 'email',
        title: displaySubject(email.name),
        context: sender?.name,
        face: sender && !sender.isSelf ? sender : undefined,
        messages: email.snippet
          ? [
              {
                id: `${email.id}:snippet`,
                author: sender,
                text: email.snippet,
                at: updatedAt,
                unread: !email.isRead,
              },
            ]
          : [],
      };
    })
    .with({ type: 'document' }, (document) =>
      notifiedShape(
        'docs',
        document.subType?.type === 'task' ? 'task' : 'document',
        document.name,
        notifications,
        resolve,
        { updatedAt }
      )
    )
    .with({ type: 'project' }, (project) =>
      notifiedShape('docs', 'project', project.name, notifications, resolve, {
        updatedAt,
      })
    )
    .with({ type: 'agent_session' }, (session) =>
      notifiedShape('agents', 'agent', session.name, notifications, resolve, {
        status: resolve.agentStatus(
          conversationState(session.status, session.turnState)
        ),
        updatedAt,
      })
    )
    .with({ type: 'chat' }, (chat) =>
      notifiedShape('agents', 'chat', chat.name, notifications, resolve, {
        updatedAt,
      })
    )
    .with({ type: 'calendar_event' }, (event) =>
      notifiedShape('calendar', 'event', event.name, notifications, resolve)
    )
    .with({ type: 'call' }, (call) =>
      notifiedShape('calendar', 'call', call.name, notifications, resolve, {
        updatedAt,
      })
    )
    .with(
      { type: 'foreign', foreignSource: 'github_pull_request' },
      (pullRequest) =>
        notifiedShape(
          'code',
          'pull-request',
          pullRequest.metadata.name || pullRequest.name,
          notifications,
          resolve,
          {
            context: `${pullRequest.metadata.repo}#${pullRequest.metadata.number}`,
            status: resolve.pullRequestStatus(pullRequest.metadata.status),
            updatedAt,
          }
        )
    )
    // Kinds the board does not draw yet.
    .with({ type: 'foreign' }, () => undefined)
    .with(
      {
        type: P.union(
          'channel_message',
          'initiative',
          'crm_company',
          'crm_contact',
          'database',
          'form',
          'routine'
        ),
      },
      () => undefined
    )
    .exhaustive(() => undefined);
  if (!shape || !shape.title) return undefined;

  const unreadNotifications = notifications.filter(
    (notification) => !notificationIsRead(notification)
  );
  const emailUnread = entity.type === 'email' && !entity.isRead ? 1 : 0;
  const unreadCount = Math.max(unreadNotifications.length, emailUnread);
  const needsYou =
    unreadNotifications.some((notification) =>
      NEEDS_YOU_TAGS.has(notification.notification_metadata.tag)
    ) ||
    (shape.zone === 'dms' && unreadCount > 0);

  return {
    key: `${entity.type}:${entity.id}`,
    zone: shape.zone,
    kind: shape.kind,
    title: shape.title,
    context: shape.context,
    groupKey: shape.groupKey,
    status: shape.status,
    face: shape.face,
    messages: shape.messages,
    lastActivityAt: Math.max(
      updatedAt,
      ...shape.messages.map((message) => message.at)
    ),
    unreadCount,
    needsYou,
    participants: participantsOf(shape.messages),
  };
}
