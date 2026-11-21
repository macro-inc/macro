import type {
  ChannelMessageBaseFieldsFragment,
  ChannelMessageFieldsFragment,
  ChannelTimelineActivityFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import type {
  CallEntryStatus,
  Message,
  MessageListItem,
  MessageTimelineEntry,
  TimelineActivity,
} from '@service-storage/messages';
import { match } from 'ts-pattern';
import {
  normalizeChannelMessageSender,
  normalizeMessageSender,
} from '../message-sender';

export type ChannelTimelineRecord =
  | ChannelMessageFieldsFragment
  | ChannelTimelineActivityFieldsFragment;

/** One cached message in the shape every channel surface already renders. */
export function mapChannelMessage(
  record: ChannelMessageBaseFieldsFragment
): Message {
  return normalizeMessageSender({
    id: record.id,
    parent: { type: 'channel', id: record.channelId },
    thread_id: record.threadId,
    kind: match(record.kind)
      .with('CALL_ROOT', () => 'call_root' as const)
      .otherwise(() => 'message' as const),
    sender_id: record.senderId,
    // REST leaves the field out for everyone but call guests.
    ...(record.guestName !== null && { guest_name: record.guestName }),
    imported_author:
      record.importedAuthorName === null
        ? null
        : { name: record.importedAuthorName },
    bot_profile: record.botProfile && {
      name: record.botProfile.name,
      avatar_url: record.botProfile.avatarUrl,
    },
    mentions: record.mentions.map((mention) => ({
      entity_type: mention.entityType,
      entity_id: mention.entityId,
    })),
    triggered_by: record.triggeredBy,
    triggered_via: record.triggeredVia,
    content: record.content,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    edited_at: record.editedAt,
    deleted_at: record.deletedAt,
    attachments: record.attachments.map((attachment) => ({
      id: attachment.attachmentId,
      entity_type: attachment.entityType,
      entity_id: attachment.entityId,
      width: attachment.width,
      height: attachment.height,
      created_at: attachment.createdAt,
    })),
    reactions: record.reactions.map((reaction) => ({
      emoji: reaction.emoji,
      users: reaction.users,
    })),
  });
}

/** A root with its thread state and reply preview, or undefined for a reply. */
export function mapChannelRoot(
  record: ChannelMessageFieldsFragment
): MessageListItem | undefined {
  const thread = record.thread;
  if (!thread) return undefined;
  return normalizeChannelMessageSender({
    ...mapChannelMessage(record),
    state: {
      root_id: record.id,
      user_id: thread.userId,
      created_at: thread.createdAt,
      updated_at: thread.updatedAt,
      resolved: thread.resolved,
      deleted_at: thread.deletedAt,
      anchor: null,
    },
    thread: {
      reply_count: thread.replyCount,
      latest_reply_at: thread.latestReplyAt,
      preview: thread.preview.map(mapChannelMessage),
    },
  });
}

function mapCallStatus(
  call: NonNullable<ChannelMessageFieldsFragment['call']>
): CallEntryStatus | undefined {
  return match(call.state)
    .with('LIVE', () => ({ state: 'live' as const }))
    .with('RECORD_DELETED', () => ({
      state: 'record_deleted' as const,
    }))
    .with('ENDED', () =>
      call.endedAt === null || call.durationMs === null
        ? undefined
        : {
            state: 'ended' as const,
            ended_at: call.endedAt,
            duration_ms: call.durationMs,
          }
    )
    .otherwise(() => undefined);
}

export function mapChannelActivity(
  record: ChannelTimelineActivityFieldsFragment
): TimelineActivity {
  return {
    id: record.id,
    actor_id: record.actorId,
    occurred_at: record.occurredAt,
    action: record.action,
    ...(record.payload === null ? {} : { payload: record.payload }),
  };
}

/**
 * One timeline row. Undefined for a record that is not a row of the channel
 * list: a reply, or a call root whose status this client cannot read.
 */
export function mapChannelTimelineEntry(
  record: ChannelTimelineRecord
): MessageTimelineEntry | undefined {
  if (record.__typename === 'GraphqlChannelTimelineActivity') {
    return { type: 'activity', activity: mapChannelActivity(record) };
  }
  const message = mapChannelRoot(record);
  if (!message) return undefined;
  if (record.kind !== 'CALL_ROOT') {
    return { type: 'message', message };
  }
  const status = record.call && mapCallStatus(record.call);
  return status ? { type: 'call', message, status } : undefined;
}
