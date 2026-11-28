import type { ChannelEntity } from '@entity';
import { resolveNotifiedAt } from '@queries/soup/normalized-cache/notified-floor';
import { resolveOwnTouch } from '@queries/soup/normalized-cache/own-touch';
import type { ChannelListItemFieldsFragment } from '@service-storage/graphql/generated/graphql';
import type { GraphqlSoupItem } from '@service-storage/graphql-soup';
import { match } from 'ts-pattern';
import { CHANNEL_LIST_ROW_NAME } from '../../../graphql-cache/protocol';

/** The live-view row name hosts that shape rows accept (`live_row_shape`). */
export const CHANNEL_LIST_ROW = CHANNEL_LIST_ROW_NAME;

type ChannelRecord = Extract<
  ChannelListItemFieldsFragment,
  { __typename: 'GraphqlSoupChannel' }
>;

type ChannelListMessage = {
  messageId: string;
  threadId?: string;
  content: string;
  mentions: string[];
  senderId: string;
  createdAt: string;
};

/**
 * What a channel list shows of a channel, in `ChannelEntity`'s names. The
 * engine shapes it (`crates/soup_filter_cache_adapter/src/channel_list_row.rs`);
 * `channelListRow` is the same function for hosts that send selected records.
 * A value the entity leaves `undefined` is absent; a null message stays null.
 * Rows are immutable: a change is a new row.
 */
export type ChannelListRow = {
  __typename: 'GraphqlSoupChannel';
  id: string;
  name: string | null;
  channelType: ChannelEntity['channelType'];
  teamId?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  participantIds: string[];
  isParticipant: boolean;
  viewedAt?: string;
  interactedAt?: string;
  latestMessage?: ChannelListMessage | null;
  latestRootMessage?: ChannelListMessage | null;
  frecencyScore: number;
  isFavorited?: boolean;
  unreadNotifications?: NonNullable<ChannelEntity['unreadNotifications']>;
  unreadMentions?: NonNullable<ChannelEntity['unreadMentions']>;
};

const ROWS = new WeakSet<object>();

/** Whether a Soup record is a shaped channel-list row, not a selected record. */
export function isChannelListRow(record: object): record is ChannelListRow {
  return ROWS.has(record);
}

/** Marks a row a host shaped, so it is finished rather than mapped. */
export function adoptChannelListRow(row: object): void {
  if ((row as { __typename?: unknown }).__typename === 'GraphqlSoupChannel')
    ROWS.add(row);
}

// The state comes from the network: anything else reads as seen.
const notificationState = (state: string): 'unseen' | 'seen' | 'done' =>
  match<string, 'unseen' | 'seen' | 'done'>(state)
    .with('UNSEEN', () => 'unseen')
    .with('DONE', () => 'done')
    .otherwise(() => 'seen');

function message(
  value: ChannelRecord['latestMessage'] | undefined
): ChannelListMessage | null | undefined {
  if (!value) return value;
  return {
    messageId: value.messageId ?? null,
    ...(value.threadId != null ? { threadId: value.threadId } : {}),
    content: value.content ?? null,
    mentions: value.mentions ?? [],
    senderId: value.senderId ?? null,
    createdAt: value.createdAt ?? null,
  };
}

/**
 * The row for one selected record, as the engine shapes it. A record of another Soup type is
 * returned as it is, for the general mapper.
 */
export function channelListRow<T extends { __typename: string }>(
  record: T
): T | ChannelListRow {
  if (record.__typename !== 'GraphqlSoupChannel') return record;
  const channel = record as unknown as ChannelRecord &
    Partial<
      Pick<
        Extract<
          ChannelListItemFieldsFragment,
          { __typename: 'GraphqlSoupChannel' }
        >,
        'unreadNotifications' | 'unreadMentions'
      >
    >;
  const viewedAt = channel.viewedAt ?? channel.interactedAt;
  const row: ChannelListRow = {
    __typename: 'GraphqlSoupChannel',
    id: channel.id,
    name: channel.channelName ?? null,
    // A thin record (a page wrote too few fields) shapes with nulls, as the
    // engine shapes it, rather than throwing.
    channelType: (typeof channel.channelType === 'string'
      ? channel.channelType.toLowerCase()
      : (channel.channelType ?? null)) as ChannelListRow['channelType'],
    ...(channel.channelTeamId != null ? { teamId: channel.channelTeamId } : {}),
    ownerId: channel.ownerId ?? null,
    createdAt: channel.createdAt ?? null,
    updatedAt: channel.updatedAt ?? null,
    participantIds: (Array.isArray(channel.participants)
      ? channel.participants
      : []
    ).map((participant) => participant.userId ?? null),
    isParticipant: channel.isParticipant ?? true,
    ...(viewedAt != null ? { viewedAt } : {}),
    ...(channel.interactedAt != null
      ? { interactedAt: channel.interactedAt }
      : {}),
    ...('latestMessage' in channel
      ? { latestMessage: message(channel.latestMessage) }
      : {}),
    ...('latestNonThreadMessage' in channel
      ? { latestRootMessage: message(channel.latestNonThreadMessage) }
      : {}),
    frecencyScore: channel.frecencyScore ?? 0,
    ...('isFavorited' in channel ? { isFavorited: channel.isFavorited } : {}),
    ...(Array.isArray(channel.unreadNotifications)
      ? {
          unreadNotifications: channel.unreadNotifications.map(
            (notification) => ({
              id: notification.id,
              state: notificationState(notification.state),
              createdAt: notification.createdAt,
            })
          ),
        }
      : {}),
    ...(Array.isArray(channel.unreadMentions)
      ? {
          unreadMentions: channel.unreadMentions.map((mention) => ({
            id: mention.id,
            state: notificationState(mention.state),
          })),
        }
      : {}),
  };
  ROWS.add(row);
  return row;
}

type Finished = {
  entity: ChannelEntity;
  touchedAt: string | null | undefined;
  notifiedAt: string | null | undefined;
};

const finished = new WeakMap<ChannelListRow, Finished>();

/**
 * The entity a channel list shows for a row: the name's fallback, then the
 * own-touch and notified floors, as `mapApiSoupItemToEntity` applies them.
 * Each row is finished once; a floor raised since is noticed on the next
 * lookup, which compares the two floors with the ones it used.
 */
export function finishChannelListRow(row: ChannelListRow): ChannelEntity {
  const touchedAt = resolveOwnTouch(row.id, null);
  const notifiedAt = resolveNotifiedAt(row.id, null);
  const previous = finished.get(row);
  if (
    previous &&
    previous.touchedAt === touchedAt &&
    previous.notifiedAt === notifiedAt
  )
    return previous.entity;
  const entity: ChannelEntity = {
    type: 'channel',
    unreadNotifications: row.unreadNotifications,
    unreadMentions: row.unreadMentions,
    id: row.id,
    name: row.name || 'Unknown Channel',
    channelType: row.channelType,
    teamId: row.teamId,
    ownerId: row.ownerId,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    participantIds: row.participantIds,
    isParticipant: row.isParticipant,
    viewedAt: row.viewedAt,
    interactedAt: row.interactedAt,
    latestMessage: row.latestMessage ?? undefined,
    latestRootMessage: row.latestRootMessage ?? undefined,
    frecencyScore: row.frecencyScore,
    ...(touchedAt ? { touchedAt } : {}),
    ...(notifiedAt ? { notifiedAt } : {}),
    isFavorited: row.isFavorited,
  };
  finished.set(row, { entity, touchedAt, notifiedAt });
  return entity;
}

/**
 * The `row` option of a channel-list live view: a host-shaped row is adopted
 * as it is, and a selected record from a host without row shapes is shaped
 * here.
 */
export const CHANNEL_LIST_LIVE_ROW = {
  name: CHANNEL_LIST_ROW,
  toRow: (
    record: object,
    shaped: boolean
  ): GraphqlSoupItem | ChannelListRow => {
    if (!shaped) return channelListRow(record as GraphqlSoupItem);
    adoptChannelListRow(record);
    return record as GraphqlSoupItem | ChannelListRow;
  },
} as const;
