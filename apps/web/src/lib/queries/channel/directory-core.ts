/**
 * The channel directory's records and how they compare with the REST channel
 * list. Pure: no app imports, so a script can run the same comparison.
 */
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type { ChannelMessage } from '@service-storage/generated/schemas/channelMessage';
import type { ChannelDirectoryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';

export type DirectoryChannelType =
  | 'direct_message'
  | 'private'
  | 'public'
  | 'team';

export type DirectoryRole = 'owner' | 'admin' | 'member';

export type DirectoryParticipant = {
  userId: string;
  role: DirectoryRole;
  joinedAt: string;
  leftAt: string | null;
};

export type DirectoryBotParticipant = {
  botId: string;
  role: DirectoryRole;
  joinedAt: string;
  leftAt: string | null;
};

export type DirectoryMessage = {
  messageId: string;
  threadId: string | null;
  senderId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  mentions: string[];
};

/** A channel as the directory holds it: one soup channel record. */
export type DirectoryChannel = {
  id: string;
  /** The name the viewer sees: a DM's other person, a group's others. */
  name: string | null;
  channelType: DirectoryChannelType;
  ownerId: string;
  organizationId: string | null;
  teamId: string | null;
  autoJoinTeam: boolean;
  createdAt: string;
  updatedAt: string;
  viewedAt: string | null;
  interactedAt: string | null;
  /** False for a public or team channel the viewer opened but never joined. */
  isParticipant: boolean;
  frecencyScore: number | null;
  /** People only; bots are in `botParticipants`. */
  participants: DirectoryParticipant[];
  botParticipants: DirectoryBotParticipant[];
  agentDm: { botId: string; name: string; avatarUrl: string | null } | null;
  latestMessage: DirectoryMessage | null;
  latestNonThreadMessage: DirectoryMessage | null;
};

function channelType(value: string): DirectoryChannelType {
  return match<string, DirectoryChannelType>(value.toLowerCase())
    .with('direct_message', () => 'direct_message')
    .with('private', () => 'private')
    .with('team', () => 'team')
    .otherwise(() => 'public');
}

function role(value: string): DirectoryRole {
  return match<string, DirectoryRole>(value.toLowerCase())
    .with('owner', () => 'owner')
    .with('admin', () => 'admin')
    .otherwise(() => 'member');
}

function message(
  value: ChannelDirectoryFieldsFragment['latestMessage']
): DirectoryMessage | null {
  if (!value) return null;
  return {
    messageId: value.messageId,
    threadId: value.threadId,
    senderId: value.senderId,
    content: value.content,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: value.deletedAt,
    mentions: [...value.mentions],
  };
}

/** Copies a cached or fetched channel record out of its store or response. */
export function toDirectoryChannel(
  record: ChannelDirectoryFieldsFragment
): DirectoryChannel {
  return {
    id: record.id,
    name: record.name,
    channelType: channelType(record.channelType),
    ownerId: record.ownerId,
    organizationId: record.organizationId,
    teamId: record.teamId,
    autoJoinTeam: record.autoJoinTeam,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    viewedAt: record.viewedAt,
    interactedAt: record.interactedAt,
    isParticipant: record.isParticipant,
    frecencyScore: record.frecencyScore,
    participants: record.participants.map((participant) => ({
      userId: participant.userId,
      role: role(participant.role),
      joinedAt: participant.joinedAt,
      leftAt: participant.leftAt,
    })),
    botParticipants: record.botParticipants.map((participant) => ({
      botId: participant.botId,
      role: role(participant.role),
      joinedAt: participant.joinedAt,
      leftAt: participant.leftAt,
    })),
    agentDm: record.agentDm
      ? {
          botId: record.agentDm.botId,
          name: record.agentDm.name,
          avatarUrl: record.agentDm.avatarUrl,
        }
      : null,
    latestMessage: message(record.latestMessage),
    latestNonThreadMessage: message(record.latestNonThreadMessage),
  };
}

/**
 * How a REST channel differs from its directory record. `derived_name` is
 * expected: the directory names a DM or unnamed group as the viewer sees it,
 * where REST has no name. The organization id is compared as a string, and
 * bots in REST's participants against `botParticipants`.
 */
export type DirectoryDifferenceKind =
  | 'missing_from_directory'
  | 'extra_in_directory'
  | 'derived_name'
  | 'name'
  | 'channel_type'
  | 'owner_id'
  | 'organization_id'
  | 'team_id'
  | 'auto_join_team'
  | 'created_at'
  | 'updated_at'
  | 'viewed_at'
  | 'interacted_at'
  | 'is_participant'
  | 'participants'
  | 'agent_dm'
  | 'latest_message'
  | 'latest_non_thread_message';

export type DirectoryDifference = {
  kind: DirectoryDifferenceKind;
  channelId: string;
};

// REST lists a bot among the participants under this prefix.
export const BOT_PRINCIPAL_PREFIX = 'bot|';

const RFC3339_INSTANT =
  /^(.+T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i;

/** Microseconds since the epoch, keeping the microseconds the server sends
 * and `Date.parse` drops: two updates in one millisecond still order. */
export function instantMicros(value: string): number {
  const parts = RFC3339_INSTANT.exec(value);
  if (!parts) return Date.parse(value) * 1000;
  const [, seconds, fraction = '', zone] = parts;
  return (
    Date.parse(`${seconds}${zone}`) * 1000 +
    Number(fraction.slice(0, 6).padEnd(6, '0'))
  );
}

/** Channels in the REST channel list's order, newest update first and then
 * by id, descending (`updated_at DESC, id DESC`), so a reader that keeps
 * the order of ties (a sort by name, the first match) picks as it did. */
export function inDirectoryOrder(
  channels: readonly DirectoryChannel[]
): DirectoryChannel[] {
  return channels
    .map((channel) => ({ channel, at: instantMicros(channel.updatedAt) }))
    .sort((a, b) => {
      if (a.at !== b.at) return b.at - a.at;
      if (a.channel.id === b.channel.id) return 0;
      return a.channel.id < b.channel.id ? 1 : -1;
    })
    .map(({ channel }) => channel);
}

/** Puts `channel` into `channels`, which are in directory order, where that
 * order places it. */
export function insertInDirectoryOrder(
  channels: DirectoryChannel[],
  channel: DirectoryChannel
) {
  const at = instantMicros(channel.updatedAt);
  // Whether `other` comes before `channel`.
  const before = (other: DirectoryChannel) => {
    const otherAt = instantMicros(other.updatedAt);
    if (otherAt !== at) return otherAt > at;
    return other.id > channel.id;
  };
  let low = 0;
  let high = channels.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const other = channels[middle];
    if (other && before(other)) low = middle + 1;
    else high = middle;
  }
  channels.splice(low, 0, channel);
}

function sameInstant(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (!left || !right) return !left && !right;
  return Date.parse(left) === Date.parse(right);
}

/** Mentions as a set: both lists name each mention once, in no promised order. */
function sameMentions(
  rest: ReadonlyArray<string>,
  directory: ReadonlyArray<string>
): boolean {
  const left = [...rest].sort();
  const right = [...directory].sort();
  return (
    left.length === right.length &&
    left.every((mention, index) => mention === right[index])
  );
}

function sameMessage(
  rest: ApiChannelWithLatest['latest_message'],
  directory: DirectoryMessage | null
): boolean {
  if (!rest || !directory) return !rest && !directory;
  return (
    rest.message_id === directory.messageId &&
    (rest.thread_id ?? null) === directory.threadId &&
    rest.sender_id === directory.senderId &&
    rest.content === directory.content &&
    sameMentions(rest.mentions, directory.mentions) &&
    sameInstant(rest.updated_at, directory.updatedAt) &&
    sameInstant(rest.deleted_at, directory.deletedAt)
  );
}

function sameAgentDm(
  rest: ApiChannelWithLatest['agent_dm'],
  directory: DirectoryChannel['agentDm']
): boolean {
  if (!rest || !directory) return !rest && !directory;
  return (
    rest.bot_id === directory.botId &&
    rest.name === directory.name &&
    (rest.avatar_url ?? null) === directory.avatarUrl
  );
}

/** Each member as `id|role|active`, so a bot in REST's list (`bot|<id>`)
 * matches the directory's `botParticipants` (the bare id). */
function memberSet(
  members: ReadonlyArray<{ id: string; role: string; leftAt?: unknown }>
): string[] {
  return members
    .map(
      (member) =>
        `${member.id}|${member.role.toLowerCase()}|${member.leftAt ? 'left' : 'active'}`
    )
    .sort();
}

function sameMembers(rest: ApiChannelWithLatest, directory: DirectoryChannel) {
  const restMembers = memberSet(
    rest.participants.map((participant) => ({
      id: participant.user_id,
      role: participant.role,
      leftAt: participant.left_at,
    }))
  );
  const directoryMembers = memberSet([
    ...directory.participants.map((participant) => ({
      id: participant.userId,
      role: participant.role,
      leftAt: participant.leftAt,
    })),
    ...directory.botParticipants.map((participant) => ({
      id: `${BOT_PRINCIPAL_PREFIX}${participant.botId}`,
      role: participant.role,
      leftAt: participant.leftAt,
    })),
  ]);
  return (
    restMembers.length === directoryMembers.length &&
    restMembers.every((member, index) => member === directoryMembers[index])
  );
}

function nameDifference(
  rest: ApiChannelWithLatest,
  directory: DirectoryChannel
): DirectoryDifferenceKind | undefined {
  const restName = rest.name ?? null;
  if (restName === directory.name) return undefined;
  // REST stores no name for a DM or an unnamed group; the directory derives
  // the one the viewer sees.
  const derived =
    !restName &&
    (directory.channelType === 'direct_message' ||
      directory.channelType === 'private');
  return derived ? 'derived_name' : 'name';
}

function restOrganizationId(rest: ApiChannelWithLatest): string | null {
  return rest.org_id === null || rest.org_id === undefined
    ? null
    : String(rest.org_id);
}

/** Each field's kind, paired with whether the two sides disagree on it. */
function fieldChecks(
  rest: ApiChannelWithLatest,
  directory: DirectoryChannel
): Array<[DirectoryDifferenceKind, boolean]> {
  return [
    ['channel_type', rest.channel_type !== directory.channelType],
    ['owner_id', rest.owner_id !== directory.ownerId],
    ['organization_id', restOrganizationId(rest) !== directory.organizationId],
    ['team_id', (rest.team_id ?? null) !== directory.teamId],
    [
      'auto_join_team',
      (rest.auto_join_team ?? false) !== directory.autoJoinTeam,
    ],
    ['created_at', !sameInstant(rest.created_at, directory.createdAt)],
    ['updated_at', !sameInstant(rest.updated_at, directory.updatedAt)],
    ['viewed_at', !sameInstant(rest.viewed_at, directory.viewedAt)],
    ['interacted_at', !sameInstant(rest.interacted_at, directory.interactedAt)],
    ['is_participant', rest.is_participant !== directory.isParticipant],
    ['participants', !sameMembers(rest, directory)],
    ['agent_dm', !sameAgentDm(rest.agent_dm, directory.agentDm)],
    [
      'latest_message',
      !sameMessage(rest.latest_message, directory.latestMessage),
    ],
    [
      'latest_non_thread_message',
      !sameMessage(
        rest.latest_non_thread_message,
        directory.latestNonThreadMessage
      ),
    ],
  ];
}

function channelDifferences(
  rest: ApiChannelWithLatest,
  directory: DirectoryChannel
): DirectoryDifferenceKind[] {
  const kinds = fieldChecks(rest, directory)
    .filter(([, differs]) => differs)
    .map(([kind]) => kind);
  const name = nameDifference(rest, directory);
  return name ? [name, ...kinds] : kinds;
}

/**
 * Every way the viewer's REST channel list differs from the channels the
 * directory says they joined. Pass the directory's joined channels only.
 */
export function compareChannelDirectory(
  rest: readonly ApiChannelWithLatest[],
  directory: readonly DirectoryChannel[]
): DirectoryDifference[] {
  const byId = new Map(directory.map((channel) => [channel.id, channel]));
  const differences: DirectoryDifference[] = [];
  const restIds = new Set<string>();
  for (const channel of rest) {
    restIds.add(channel.id);
    const record = byId.get(channel.id);
    if (!record) {
      differences.push({
        kind: 'missing_from_directory',
        channelId: channel.id,
      });
      continue;
    }
    for (const kind of channelDifferences(channel, record))
      differences.push({ kind, channelId: channel.id });
  }
  for (const channel of directory) {
    if (!restIds.has(channel.id))
      differences.push({ kind: 'extra_in_directory', channelId: channel.id });
  }
  return differences;
}

/** Counts differences by kind, for telemetry that names no channel. */
export function countDirectoryDifferences(
  differences: readonly DirectoryDifference[]
): Partial<Record<DirectoryDifferenceKind, number>> {
  const counts: Partial<Record<DirectoryDifferenceKind, number>> = {};
  for (const { kind } of differences) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

function channelMessage(value: DirectoryMessage | null): ChannelMessage | null {
  if (!value) return null;
  return {
    message_id: value.messageId,
    thread_id: value.threadId,
    sender_id: value.senderId,
    content: value.content,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
    deleted_at: value.deletedAt,
    mentions: value.mentions,
  };
}

const channelListItems = new WeakMap<DirectoryChannel, ApiChannelWithLatest>();

/**
 * A directory record in the channel list's shape, for readers written
 * against it (recipients, mentions, channel entities). Bots join the
 * participants as `bot|<id>`, as the list sent them. One record always maps
 * to the same object, so a list rebuilt from unchanged records keeps its
 * items.
 */
export function toChannelListItem(
  channel: DirectoryChannel
): ApiChannelWithLatest {
  const cached = channelListItems.get(channel);
  if (cached) return cached;
  const item: ApiChannelWithLatest = {
    id: channel.id,
    name: channel.name,
    channel_type: channel.channelType,
    owner_id: channel.ownerId,
    org_id:
      channel.organizationId === null ? null : Number(channel.organizationId),
    team_id: channel.teamId,
    auto_join_team: channel.autoJoinTeam,
    created_at: channel.createdAt,
    updated_at: channel.updatedAt,
    viewed_at: channel.viewedAt,
    interacted_at: channel.interactedAt,
    is_participant: channel.isParticipant,
    frecency_score: channel.frecencyScore,
    participants: [
      ...channel.participants.map((participant) => ({
        channel_id: channel.id,
        user_id: participant.userId,
        role: participant.role,
        joined_at: participant.joinedAt,
        left_at: participant.leftAt,
      })),
      ...channel.botParticipants.map((participant) => ({
        channel_id: channel.id,
        user_id: `${BOT_PRINCIPAL_PREFIX}${participant.botId}`,
        role: participant.role,
        joined_at: participant.joinedAt,
        left_at: participant.leftAt,
      })),
    ],
    ...(channel.agentDm
      ? {
          agent_dm: {
            bot_id: channel.agentDm.botId,
            name: channel.agentDm.name,
            avatar_url: channel.agentDm.avatarUrl,
          },
        }
      : {}),
    latest_message: channelMessage(channel.latestMessage),
    latest_non_thread_message: channelMessage(channel.latestNonThreadMessage),
  };
  channelListItems.set(channel, item);
  return item;
}
