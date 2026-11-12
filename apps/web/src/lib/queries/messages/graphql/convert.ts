import type {
  ChannelActivityFieldsFragment,
  ChannelMessageFieldsFragment,
  ChannelRootFieldsFragment,
  ChannelTimelinePageFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import type {
  CallEntryStatus,
  Message,
  MessageCursor,
  MessageListItem,
  MessageTimelineEntry,
  MessageTimelinePage,
  TimelineActivity,
} from '@service-storage/messages';
import { match } from 'ts-pattern';

type GraphqlEntry = ChannelTimelinePageFieldsFragment['entries'][number];
type GraphqlRootEntry = ChannelRootFieldsFragment & {
  __typename: 'GraphqlChannelMessage';
};
type GraphqlCursor = NonNullable<
  ChannelTimelinePageFieldsFragment['olderCursor']
>;

/** A channel page as the cache stores it, with the sequence number it was read at. */
export type ChannelTimelineRead = {
  seq: number;
  page: MessageTimelinePage;
};

/**
 * The timeline's own message shape for a GraphQL channel message. Each value
 * is the one the REST route returns for the same message.
 */
export function messageFromGraphql(
  message: ChannelMessageFieldsFragment
): Message {
  return {
    id: message.id,
    parent: { type: 'channel', id: message.channelId },
    thread_id: message.threadId,
    kind: message.kind === 'CALL_ROOT' ? 'call_root' : 'message',
    sender_id: message.senderId,
    guest_name: message.guestName,
    imported_author: message.importedAuthor,
    bot_profile: message.botProfile && {
      name: message.botProfile.name,
      avatar_url: message.botProfile.avatarUrl,
    },
    mentions: message.mentions.map((mention) => ({
      entity_type: mention.entityType,
      entity_id: mention.entityId,
    })),
    triggered_by: message.triggeredBy,
    triggered_via: message.triggeredVia,
    content: message.content,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
    edited_at: message.editedAt,
    deleted_at: message.deletedAt,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.attachmentId,
      entity_type: attachment.entityType,
      entity_id: attachment.entityId,
      width: attachment.width,
      height: attachment.height,
      created_at: attachment.createdAt,
    })),
    reactions: message.reactions.map((reaction) => ({
      emoji: reaction.emoji,
      users: [...reaction.users],
    })),
  };
}

function rootFromGraphql(root: ChannelRootFieldsFragment): MessageListItem {
  // The server sends a summary with every root; a reply read as a root has
  // none, and reads as a thread with no replies.
  const thread = root.thread;
  return {
    ...messageFromGraphql(root),
    state: {
      root_id: root.id,
      user_id: thread?.userId ?? root.senderId,
      resolved: thread?.resolved ?? false,
      anchor: null,
      created_at: thread?.createdAt ?? root.createdAt,
      updated_at: thread?.updatedAt ?? root.createdAt,
      deleted_at: thread?.deletedAt ?? null,
    },
    thread: {
      reply_count: thread?.replyCount ?? 0,
      latest_reply_at: thread?.latestReplyAt ?? null,
      preview: (thread?.preview ?? []).map(messageFromGraphql),
    },
  };
}

function callStatusFromGraphql(
  call: NonNullable<ChannelRootFieldsFragment['call']>
): CallEntryStatus {
  return match(call.state)
    .with('LIVE', (): CallEntryStatus => ({ state: 'live' }))
    .with(
      'ENDED',
      (): CallEntryStatus => ({
        state: 'ended',
        ended_at: call.endedAt ?? '',
        duration_ms: call.durationMs ?? 0,
      })
    )
    .with(
      'RECORD_DELETED',
      (): CallEntryStatus => ({ state: 'record_deleted' })
    )
    .exhaustive((): CallEntryStatus => ({ state: 'record_deleted' }));
}

export function activityFromGraphql(
  activity: ChannelActivityFieldsFragment
): TimelineActivity {
  return {
    id: activity.id,
    actor_id: activity.actorId,
    occurred_at: activity.occurredAt,
    action: activity.action,
    payload: activity.payload,
  };
}

export function entryFromGraphql(entry: GraphqlEntry): MessageTimelineEntry {
  if (entry.__typename === 'GraphqlChannelTimelineActivity') {
    return { type: 'activity', activity: activityFromGraphql(entry) };
  }
  const message = rootFromGraphql(entry);
  return entry.call
    ? { type: 'call', message, status: callStatusFromGraphql(entry.call) }
    : { type: 'message', message };
}

function cursorFromGraphql(cursor: GraphqlCursor | null): MessageCursor | null {
  return cursor && { created_at: cursor.createdAt, id: cursor.entryId };
}

export function cursorToGraphql(cursor: MessageCursor): GraphqlCursor {
  return { createdAt: cursor.created_at, entryId: cursor.id };
}

/** A GraphQL page carries the REST page's rows in its order, newest first. */
export function timelinePageFromGraphql(
  page: ChannelTimelinePageFieldsFragment
): ChannelTimelineRead {
  return {
    seq: page.seq,
    page: {
      entries: page.entries.map(entryFromGraphql),
      next_cursor: cursorFromGraphql(page.olderCursor),
      previous_cursor: cursorFromGraphql(page.newerCursor),
    },
  };
}

/** The cache's spelling of a timeline message; the inverse of `messageFromGraphql`. */
function messageToGraphql(message: Message): ChannelMessageFieldsFragment {
  return {
    id: message.id,
    channelId: message.parent.id,
    threadId: message.thread_id ?? null,
    kind: message.kind === 'call_root' ? 'CALL_ROOT' : 'MESSAGE',
    senderId: message.sender_id,
    guestName: message.guest_name ?? null,
    importedAuthor: message.imported_author
      ? { name: message.imported_author.name }
      : null,
    botProfile: message.bot_profile
      ? {
          name: message.bot_profile.name,
          avatarUrl: message.bot_profile.avatar_url ?? null,
        }
      : null,
    mentions: message.mentions.map((mention) => ({
      entityType: mention.entity_type,
      entityId: mention.entity_id,
    })),
    triggeredBy: message.triggered_by ?? null,
    triggeredVia: message.triggered_via ?? null,
    content: message.content,
    createdAt: message.created_at,
    updatedAt: message.updated_at,
    editedAt: message.edited_at ?? null,
    deletedAt: message.deleted_at ?? null,
    attachments: message.attachments.map((attachment) => ({
      attachmentId: attachment.id,
      entityType: attachment.entity_type,
      entityId: attachment.entity_id,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      createdAt: attachment.created_at,
    })),
    reactions: message.reactions.map((reaction) => ({
      emoji: reaction.emoji,
      users: [...reaction.users],
    })),
  };
}

function callStatusToGraphql(
  status: CallEntryStatus
): NonNullable<ChannelRootFieldsFragment['call']> {
  return match(status)
    .with({ state: 'live' }, () => ({
      state: 'LIVE' as const,
      endedAt: null,
      durationMs: null,
    }))
    .with({ state: 'ended' }, (ended) => ({
      state: 'ENDED' as const,
      endedAt: ended.ended_at,
      durationMs: ended.duration_ms,
    }))
    .with({ state: 'record_deleted' }, () => ({
      state: 'RECORD_DELETED' as const,
      endedAt: null,
      durationMs: null,
    }))
    .exhaustive(() => ({
      state: 'RECORD_DELETED' as const,
      endedAt: null,
      durationMs: null,
    }));
}

function rootToGraphql(
  item: MessageListItem,
  status: CallEntryStatus | null
): GraphqlRootEntry {
  return {
    __typename: 'GraphqlChannelMessage',
    ...messageToGraphql(item),
    thread: {
      userId: item.state.user_id,
      resolved: item.state.resolved,
      createdAt: item.state.created_at,
      updatedAt: item.state.updated_at,
      deletedAt: item.state.deleted_at ?? null,
      replyCount: item.thread.reply_count,
      latestReplyAt: item.thread.latest_reply_at ?? null,
      preview: item.thread.preview.map(messageToGraphql),
    },
    call: status && callStatusToGraphql(status),
  };
}

export function entryToGraphql(entry: MessageTimelineEntry): GraphqlEntry {
  if (entry.type === 'activity') {
    const { activity } = entry;
    return {
      __typename: 'GraphqlChannelTimelineActivity',
      id: activity.id,
      actorId: activity.actor_id,
      occurredAt: activity.occurred_at,
      action: activity.action,
      payload: activity.payload ?? null,
    };
  }
  return rootToGraphql(
    entry.message,
    entry.type === 'call' ? entry.status : null
  );
}

/** The cache's spelling of a newest-first page read at `seq`. */
export function timelinePageToGraphql(
  read: ChannelTimelineRead
): ChannelTimelinePageFieldsFragment {
  return {
    seq: read.seq,
    entries: read.page.entries.map(entryToGraphql),
    olderCursor: read.page.next_cursor
      ? cursorToGraphql(read.page.next_cursor)
      : null,
    newerCursor: read.page.previous_cursor
      ? cursorToGraphql(read.page.previous_cursor)
      : null,
  };
}
