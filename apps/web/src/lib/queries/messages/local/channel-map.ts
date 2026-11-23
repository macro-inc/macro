import type {
  ChannelMessageBaseFieldsFragment,
  ChannelMessageFieldsFragment,
  ChannelTimelineActivityFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import type {
  CallEntryStatus,
  Message,
  MessageCursor,
  MessageListItem,
  MessageTimelineEntry,
  TimelineActivity,
} from '@service-storage/messages';
import { match } from 'ts-pattern';
import {
  normalizeChannelMessageSender,
  normalizeMessageSender,
} from '../message-sender';

const MICROS_DIGITS = 20;
const FRACTION_DIGITS = 6;
const TIMESTAMP_FRACTION = /\.(\d+)/;
const ROOT_SORT_KEY = /^(\d{20})-([0-9a-f-]{36})$/;
/** Replies without an import order sort after imported ones. */
const LIVE_REPLY_ORDER = '~';

export const CHANNEL_MESSAGE_TYPENAME = 'GraphqlChannelMessage';
export const CHANNEL_ACTIVITY_TYPENAME = 'GraphqlChannelTimelineActivity';

export const channelMessageKey = (id: string) =>
  `${CHANNEL_MESSAGE_TYPENAME}:${id}`;

export const channelActivityKey = (id: string) =>
  `${CHANNEL_ACTIVITY_TYPENAME}:${id}`;

/**
 * Microseconds since the epoch of an RFC 3339 timestamp. `Date` keeps only
 * milliseconds, and the server orders by the stored microseconds.
 */
export function timestampMicros(timestamp: string): bigint | undefined {
  const seconds = Date.parse(timestamp.replace(TIMESTAMP_FRACTION, ''));
  if (Number.isNaN(seconds)) return undefined;
  const fraction = (TIMESTAMP_FRACTION.exec(timestamp)?.[1] ?? '')
    .slice(0, FRACTION_DIGITS)
    .padEnd(FRACTION_DIGITS, '0');
  return BigInt(seconds) * 1000n + BigInt(fraction);
}

/**
 * The server's sort key of a root message or activity: its position in the
 * channel timeline. Undefined when the timestamp cannot be read.
 */
export function rootSortKey(createdAt: string, id: string): string | undefined {
  const micros = timestampMicros(createdAt);
  if (micros === undefined || micros < 0n) return undefined;
  return `${micros.toString().padStart(MICROS_DIGITS, '0')}-${id.toLowerCase()}`;
}

export function sortKeyFromCursor(cursor: MessageCursor): string | undefined {
  return rootSortKey(cursor.created_at, cursor.id);
}

/** The REST cursor naming the same position as a root sort key. */
export function cursorFromSortKey(sortKey: string): MessageCursor | undefined {
  const match = ROOT_SORT_KEY.exec(sortKey);
  if (!match) return undefined;
  const micros = BigInt(match[1]);
  const date = new Date(Number(micros / 1000n));
  if (Number.isNaN(date.getTime())) return undefined;
  const subMillis = (micros % 1000n).toString().padStart(3, '0');
  return {
    created_at: date.toISOString().replace('Z', `${subMillis}Z`),
    id: match[2],
  };
}

/**
 * How far past its own time a message the server has not placed yet sorts.
 * Larger than any gap between this device's clock and the server's.
 */
const UNPLACED_AHEAD_MICROS = 366n * 24n * 60n * 60n * 1_000_000n;

/**
 * The sort key of a message this device sent and the server has not placed.
 * The server gives a message the time it arrives, which is later than the
 * time it was written and than every message already placed, so until then
 * the message sorts after all placed ones, in the order it was written.
 */
export function unplacedSortKey(
  createdAt: string,
  id: string,
  reply: boolean
): string | undefined {
  const micros = timestampMicros(createdAt);
  if (micros === undefined || micros < 0n) return undefined;
  const position = `${(micros + UNPLACED_AHEAD_MICROS)
    .toString()
    .padStart(MICROS_DIGITS, '0')}-${id.toLowerCase()}`;
  return reply ? `${LIVE_REPLY_ORDER}-${position}` : position;
}

/** Both cache keys an id removed from a channel may be held under. */
export const channelEntryKeys = (id: string): string[] => [
  channelMessageKey(id),
  channelActivityKey(id),
];

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
