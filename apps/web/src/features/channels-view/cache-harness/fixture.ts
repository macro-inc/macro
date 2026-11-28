/**
 * A deterministic Chat account at production scale, served by the fixture
 * network (`@graphql-cache/headless/fixture-network`): channels with their
 * participants, latest messages, notifications, favorites and sections, and a
 * root value that answers the Soup reads the Chat data path makes, counting
 * the rows each read asks for and returns.
 *
 * The mix follows the "chat" tier of the cache-pressure benchmark: member
 * channels of about 75 participants each. One seed gives one account, and 2N
 * is N plus older channels (`ERA_CHANNELS`), so the two differ only in what
 * the account holds beyond its first pages.
 */
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelLabelsList } from '@service-storage/generated/schemas/channelLabelsList';
import { match } from 'ts-pattern';

export const VIEWER_ID = 'user-1';
const TEAM_ID = 'team-1';
const ORGANIZATION_ID = '1';
const PEOPLE = 400;
const PARTICIPANTS_PER_CHANNEL = 75;
const FAVORITES = 12;
const SHARED_SECTIONS = 6;
const SHARED_SECTION_SIZE = 30;
const PERSONAL_SECTIONS = 4;
const PERSONAL_SECTION_SIZE = 20;
/** The server's page size when a request names none (GraphQL Soup's
 * `limit.unwrap_or(20)`), and the bounds it clamps a requested one to
 * (Soup's `limit.clamp(1, 500)`). */
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;
const U16_MAX = 65_535;
/** The fixture's clock: every timestamp is before it. */
export const FIXTURE_NOW = Date.parse('2026-11-20T12:00:00.000Z');
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
/** Channels come in eras of this many: each era's activity spans the two
 * years before the next one's, so the first 3,500 channels are the same, and
 * the most recent, at every size. 2N adds only an older tail that no first
 * page shows, and a count that differs between N and 2N grows with the
 * account rather than with what is on screen. */
const ERA_CHANNELS = 3_500;

type FixtureChannelType = 'public' | 'private' | 'direct_message' | 'team';

type FixtureNotification = {
  id: string;
  eventType: 'channel_message_send' | 'channel_mention';
  state: 'UNSEEN' | 'SEEN';
  createdAt: string;
  senderId: string;
  messageId: string;
  topLevel: boolean;
};

type FixtureMessage = {
  messageId: string;
  senderId: string;
  content: string;
  createdAt: string;
};

type FixtureChannel = {
  id: string;
  name: string;
  channelType: FixtureChannelType;
  ownerId: string;
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
  viewedAt: string | null;
  interactedAt: string | null;
  participantIds: string[];
  latestMessage: FixtureMessage | null;
  notifications: FixtureNotification[];
};

/** What the fixture's resolvers served, counted per read. */
export type FixtureReads = {
  /** Root `user` field calls by field name (`soup`, `soupEntity`, ...). */
  fields: Record<string, number>;
  /** Rows the reads asked for: page limits, plus 1 per entity read. */
  rowsRequested: number;
  /** Channel ids named by `channelId` literals (by-id reads). */
  idsRequested: number;
  /** Rows the reads returned. */
  rowsReturned: number;
  /** Filter shapes the fixture does not evaluate; a faithful run has none. */
  unsupported: string[];
};

export type ChatFixture = {
  channels: readonly FixtureChannel[];
  favoriteChannelIds: readonly string[];
  labels(scope: string | undefined): ChannelLabelsList;
  /** The root value for `createFixtureNetwork`. */
  rootValue(): unknown;
  /** Reads served so far; `readsSince` subtracts a snapshot. */
  reads(): FixtureReads;
  readsSince(mark: FixtureReads): FixtureReads;
  /** A new top-level message from another member: the channel's latest
   * message, update time and an unseen notification change, as the server's
   * record would after the send. Returns the frames the server pushes to the
   * viewer for it, by subscription. */
  deliverMessage(channelId: string, at: number): MessageFrames;
};

/** Root values for the subscriptions a delivered message reaches: the
 * channel's hydrated record (`SoupUpdates`) and the viewer's new notification
 * (`NotificationUpdates`). */
type MessageFrames = {
  SoupUpdates: { soupUpdates: unknown[] };
  NotificationUpdates: { notificationUpdates: unknown };
};

/** mulberry32: small, fast and the same on every run. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function uuidFor(prefix: number, index: number): string {
  const tail = index.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8${prefix.toString(16).padStart(3, '0')}-${tail}`;
}

function personId(index: number): string {
  return `person-${String(index).padStart(4, '0')}`;
}

function personName(id: string): string {
  return `Person ${id.slice('person-'.length)}`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function pickParticipants(random: () => number, count: number): string[] {
  const chosen = new Set<string>();
  while (chosen.size < count)
    chosen.add(personId(1 + Math.floor(random() * PEOPLE)));
  return [VIEWER_ID, ...chosen];
}

function channelTypeFor(roll: number): FixtureChannelType {
  if (roll < 0.1) return 'team';
  if (roll < 0.45) return 'public';
  if (roll < 0.6) return 'private';
  return 'direct_message';
}

function createChannel(random: () => number, index: number): FixtureChannel {
  const id = uuidFor(1, index);
  const channelType = channelTypeFor(random());
  const groupDm = channelType === 'direct_message' && random() < 0.2;
  const participantCount = match(channelType)
    .with('direct_message', () => (groupDm ? 2 + Math.floor(random() * 6) : 1))
    .otherwise(() => PARTICIPANTS_PER_CHANNEL - 1);
  const participantIds = pickParticipants(random, participantCount);
  const others = participantIds.slice(1);
  const eraEnd = FIXTURE_NOW - Math.floor(index / ERA_CHANNELS) * TWO_YEARS_MS;
  const createdAt = eraEnd - TWO_YEARS_MS * random();
  const active = random() < 0.85;
  const lastActivity = active
    ? createdAt + (eraEnd - createdAt) * random()
    : createdAt;
  const latestMessage: FixtureMessage | null = active
    ? {
        messageId: uuidFor(2, index),
        senderId: others[Math.floor(random() * others.length)] ?? VIEWER_ID,
        content: `Message ${index}`,
        createdAt: iso(lastActivity),
      }
    : null;
  const viewed = random() < 0.6;
  const interacted = random() < 0.4;
  const notifications: FixtureNotification[] = [];
  const addNotification = (
    eventType: FixtureNotification['eventType'],
    state: FixtureNotification['state']
  ) => {
    notifications.push({
      id: uuidFor(3, index * 4 + notifications.length),
      eventType,
      state,
      createdAt: iso(lastActivity),
      senderId: latestMessage?.senderId ?? VIEWER_ID,
      messageId: latestMessage?.messageId ?? uuidFor(2, index),
      topLevel: eventType === 'channel_message_send',
    });
  };
  if (latestMessage) {
    if (random() < 0.08) addNotification('channel_message_send', 'UNSEEN');
    if (random() < 0.02) addNotification('channel_mention', 'UNSEEN');
    if (random() < 0.3) addNotification('channel_message_send', 'SEEN');
  }
  const name = match(channelType)
    .with('direct_message', () => others.slice(0, 3).map(personName).join(', '))
    .otherwise((type) => `${type}-channel-${index}`);
  return {
    id,
    name,
    channelType,
    ownerId:
      channelType === 'direct_message' ? VIEWER_ID : (others[0] ?? VIEWER_ID),
    teamId: channelType === 'team' ? TEAM_ID : null,
    createdAt: iso(createdAt),
    updatedAt: iso(lastActivity),
    viewedAt: viewed
      ? iso(lastActivity + (eraEnd - lastActivity) * random())
      : null,
    interactedAt: interacted ? iso(lastActivity) : null,
    participantIds,
    latestMessage,
    notifications,
  };
}

type ChannelLiteral = {
  channelId?: string;
  channelType?: string;
  importance?: boolean;
  isParticipant?: boolean;
  notificationState?: string;
  teamId?: string;
  organizationId?: number;
};

type ChannelExpr = {
  and?: { left: ChannelExpr; right: ChannelExpr };
  or?: { left: ChannelExpr; right: ChannelExpr };
  not?: ChannelExpr;
  literal?: ChannelLiteral;
};

type SoupInitial = {
  limit?: number | null;
  sortMethod?: string | null;
  sortDirection?: string | null;
  filters?: Record<string, unknown> | null;
};

type SoupInput = {
  initial?: SoupInitial | null;
  continuation?: { cursor: string } | null;
};

type Page = { ids: readonly string[]; offset: number; limit: number };

function literalIds(expr: ChannelExpr | undefined): number {
  if (!expr) return 0;
  return (
    (expr.literal?.channelId ? 1 : 0) +
    literalIds(expr.and?.left) +
    literalIds(expr.and?.right) +
    literalIds(expr.or?.left) +
    literalIds(expr.or?.right) +
    literalIds(expr.not)
  );
}

function timestamp(value: string | null): number {
  return value === null ? Number.NEGATIVE_INFINITY : Date.parse(value);
}

function sortKey(channel: FixtureChannel, method: string): number {
  return match(method)
    .with('CREATED_AT', () => timestamp(channel.createdAt))
    .with('VIEWED_AT', () => timestamp(channel.viewedAt))
    .with('VIEWED_UPDATED', () =>
      timestamp(channel.viewedAt ?? channel.updatedAt)
    )
    .otherwise(() => timestamp(channel.updatedAt));
}

/** Builds the account for `channelCount` channels. */
export function createChatFixture(
  channelCount: number,
  seed = 0x5eed
): ChatFixture {
  const random = createRandom(seed);
  const channels = Array.from({ length: channelCount }, (_, index) =>
    createChannel(random, index)
  );
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  // Favorites, sections and their members are drawn from the first N/2
  // channels' worth of a fixed stream, so N and 2N share them.
  const memberRandom = createRandom(seed ^ 0xa11);
  const sharedPool = channels.filter(
    (channel) => channel.channelType !== 'direct_message'
  );
  const drawFrom = (pool: readonly FixtureChannel[], count: number) => {
    const chosen = new Set<string>();
    const bound = Math.min(pool.length, 1_750);
    while (chosen.size < Math.min(count, bound)) {
      const channel = pool[Math.floor(memberRandom() * bound)];
      if (channel) chosen.add(channel.id);
    }
    return [...chosen];
  };
  const favoriteChannelIds = drawFrom(channels, FAVORITES);
  const favoriteSet = new Set(favoriteChannelIds);
  const makeLabels = (
    scope: 'team' | 'personal',
    count: number,
    size: number
  ): ChannelLabel[] =>
    Array.from({ length: count }, (_, index) => {
      const channelIds = drawFrom(
        scope === 'team' ? sharedPool : channels,
        size
      );
      return {
        id: uuidFor(scope === 'team' ? 4 : 5, index),
        name: `${scope} section ${index + 1}`,
        channelCount: channelIds.length,
        channelIds,
        explicitChannelIds: channelIds,
        createdAt: iso(FIXTURE_NOW - TWO_YEARS_MS / 2),
        updatedAt: iso(FIXTURE_NOW - TWO_YEARS_MS / 4),
        sortOrder: index,
        teamId: scope === 'team' ? TEAM_ID : undefined,
      };
    });
  const teamLabels = makeLabels('team', SHARED_SECTIONS, SHARED_SECTION_SIZE);
  const personalLabels = makeLabels(
    'personal',
    PERSONAL_SECTIONS,
    PERSONAL_SECTION_SIZE
  );

  const reads: FixtureReads = {
    fields: {},
    rowsRequested: 0,
    idsRequested: 0,
    rowsReturned: 0,
    unsupported: [],
  };
  const countField = (name: string) => {
    reads.fields[name] = (reads.fields[name] ?? 0) + 1;
  };
  const unsupported = (shape: string) => {
    if (!reads.unsupported.includes(shape)) reads.unsupported.push(shape);
  };

  const matchesLiteral = (
    channel: FixtureChannel,
    literal: ChannelLiteral
  ): boolean => {
    const [key, ...rest] = Object.keys(literal);
    if (rest.length > 0)
      unsupported(`literal with keys ${Object.keys(literal)}`);
    return match(key)
      .with('channelId', () => channel.id === literal.channelId)
      .with(
        'channelType',
        () => channel.channelType === literal.channelType?.toLowerCase()
      )
      .with(
        'importance',
        () =>
          (channel.interactedAt !== null || channel.viewedAt !== null) ===
          literal.importance
      )
      .with('isParticipant', () => literal.isParticipant === true)
      .with('notificationState', () =>
        channel.notifications.some(
          (notification) => notification.state === literal.notificationState
        )
      )
      .with('teamId', () => channel.teamId === literal.teamId)
      .with('organizationId', () => true)
      .otherwise(() => {
        unsupported(`channel literal ${key}`);
        return false;
      });
  };
  const matchesExpr = (channel: FixtureChannel, expr: ChannelExpr): boolean => {
    if (expr.and)
      return (
        matchesExpr(channel, expr.and.left) &&
        matchesExpr(channel, expr.and.right)
      );
    if (expr.or)
      return (
        matchesExpr(channel, expr.or.left) ||
        matchesExpr(channel, expr.or.right)
      );
    if (expr.not) return !matchesExpr(channel, expr.not);
    if (expr.literal) return matchesLiteral(channel, expr.literal);
    unsupported('empty channel expression');
    return false;
  };

  const cursors = new Map<string, Page>();
  const serve = (page: Page) => {
    const ids = page.ids.slice(page.offset, page.offset + page.limit);
    const next = page.offset + page.limit;
    let nextCursor: string | null = null;
    // As the server pages (`models_pagination`'s cursor): a full page gets a
    // cursor even when no row follows, so a client that reads to the end
    // asks for one more, empty page.
    if (ids.length >= page.limit) {
      nextCursor = `cursor-${cursors.size + 1}`;
      cursors.set(nextCursor, { ...page, offset: next });
    }
    reads.rowsRequested += page.limit;
    reads.rowsReturned += ids.length;
    return {
      items: ids.flatMap((id) => {
        const channel = byId.get(id);
        return channel ? [channelObject(channel)] : [];
      }),
      nextCursor,
    };
  };
  const soup = ({ input }: { input: SoupInput }) => {
    countField('soup');
    if (input.continuation) {
      const page = cursors.get(input.continuation.cursor);
      if (!page) {
        unsupported('unknown cursor');
        return { items: [], nextCursor: null };
      }
      return serve(page);
    }
    const initial = input.initial ?? {};
    const filters = initial.filters ?? undefined;
    const channelFilter = filters?.channelFilter as ChannelExpr | undefined;
    // Filters on other entity types restrict only those types, and the
    // account holds none; anything else is a shape the fixture does not read.
    for (const key of Object.keys(filters ?? {}))
      if (!key.endsWith('Filter')) unsupported(`filter ${key}`);
    reads.idsRequested += literalIds(channelFilter);
    const method = initial.sortMethod ?? 'UPDATED_AT';
    const direction = initial.sortDirection === 'ASC' ? 1 : -1;
    // Soup reads an absent type filter as every item of that type.
    const matched = channels.filter(
      (channel) =>
        channelFilter === undefined || matchesExpr(channel, channelFilter)
    );
    matched.sort(
      (a, b) =>
        direction * (sortKey(a, method) - sortKey(b, method)) ||
        a.id.localeCompare(b.id)
    );
    const requested = initial.limit ?? DEFAULT_LIMIT;
    // The schema takes a page size as a `u16`: anything else is an input
    // error there, not a page.
    if (!Number.isInteger(requested) || requested < 0 || requested > U16_MAX) {
      unsupported(`limit ${requested}`);
      return { items: [], nextCursor: null };
    }
    return serve({
      ids: matched.map((channel) => channel.id),
      offset: 0,
      limit: Math.min(Math.max(requested, MIN_LIMIT), MAX_LIMIT),
    });
  };

  const notificationObject = (
    channel: FixtureChannel,
    notification: FixtureNotification
  ) => ({
    __typename: 'GraphqlNotification',
    id: notification.id,
    eventType: notification.eventType,
    entityType: 'CHANNEL',
    targetEntityType: 'CHANNEL',
    entityId: channel.id,
    sent: true,
    state: notification.state,
    createdAt: notification.createdAt,
    viewedAt: notification.state === 'SEEN' ? notification.createdAt : null,
    updatedAt: notification.createdAt,
    senderId: notification.senderId,
    metadata:
      notification.eventType === 'channel_mention'
        ? {
            __typename: 'GraphqlChannelMentionMetadata',
            messageId: notification.messageId,
            messageContent: 'A mention',
            hasAttachments: false,
            threadId: null,
            senderDisplayName: personName(notification.senderId),
            channelType: channel.channelType.toUpperCase(),
            channelName: channel.name,
            senderProfilePictureUrl: null,
          }
        : {
            __typename: 'GraphqlChannelMessageSendMetadata',
            sender: notification.senderId,
            senderDisplayName: personName(notification.senderId),
            messageContent: 'A message',
            messageId: notification.messageId,
            hasAttachments: false,
            channelType: channel.channelType.toUpperCase(),
            channelName: channel.name,
            senderProfilePictureUrl: null,
          },
  });

  type NotificationArgs = {
    filter?: {
      states?: string[] | null;
      eventTypes?: string[] | null;
      topLevelMessagesOnly?: boolean | null;
      channelFeedOnly?: boolean | null;
    } | null;
    limit?: number | null;
  };

  const messageObject = (channel: FixtureChannel) =>
    channel.latestMessage && {
      messageId: channel.latestMessage.messageId,
      channelId: channel.id,
      threadId: null,
      senderId: channel.latestMessage.senderId,
      content: channel.latestMessage.content,
      createdAt: channel.latestMessage.createdAt,
      updatedAt: channel.latestMessage.createdAt,
      deletedAt: null,
      mentions: [],
    };

  function channelObject(channel: FixtureChannel) {
    return {
      __typename: 'GraphqlSoupChannel',
      id: channel.id,
      entityType: 'CHANNEL',
      cacheProjection: null,
      displayName: channel.name,
      metadata: {
        ownerId: channel.ownerId,
        ownerType: 'USER',
        parent: null,
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt,
        viewedAt: channel.viewedAt,
        deletedAt: null,
      },
      name: channel.name,
      channelType: channel.channelType,
      ownerId: channel.ownerId,
      organizationId: channel.channelType === 'team' ? ORGANIZATION_ID : null,
      teamId: channel.teamId,
      autoJoinTeam: channel.channelType === 'team',
      agentDm: null,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
      viewedAt: channel.viewedAt,
      interactedAt: channel.interactedAt,
      isParticipant: true,
      participantCount: channel.participantIds.length,
      participantIds: channel.participantIds,
      participants: () =>
        channel.participantIds.map((userId) => ({
          channelId: channel.id,
          userId,
          role: userId === channel.ownerId ? 'owner' : 'member',
          joinedAt: channel.createdAt,
          leftAt: null,
        })),
      botParticipants: [],
      latestMessage: () => messageObject(channel),
      latestNonThreadMessage: () => messageObject(channel),
      properties: [],
      notifications: ({ filter, limit }: NotificationArgs) =>
        channel.notifications
          .filter(
            (notification) =>
              (!filter?.states || filter.states.includes(notification.state)) &&
              (!filter?.eventTypes ||
                filter.eventTypes.includes(notification.eventType)) &&
              (!filter?.topLevelMessagesOnly || notification.topLevel)
          )
          .slice(0, limit ?? undefined)
          .map((notification) => notificationObject(channel, notification)),
      isFavorited: favoriteSet.has(channel.id),
      viewerPermission: null,
      activity: () => [],
      frecencyScore: null,
    };
  }

  const user = {
    __typename: 'GraphqlUser',
    id: VIEWER_ID,
    emailLinks: () => {
      countField('emailLinks');
      return [];
    },
    soup,
    soupEntity: ({
      input,
    }: {
      input: { entityType: string; entityId: string };
    }) => {
      countField('soupEntity');
      reads.rowsRequested += 1;
      const channel =
        input.entityType === 'CHANNEL' ? byId.get(input.entityId) : undefined;
      if (!channel) return null;
      reads.rowsReturned += 1;
      return channelObject(channel);
    },
    channelViewedAt: ({ channelId }: { channelId: string }) => {
      countField('channelViewedAt');
      return byId.get(channelId)?.viewedAt ?? null;
    },
    directMessageChannelId: ({ userId }: { userId: string }) => {
      countField('directMessageChannelId');
      return (
        channels.find(
          (channel) =>
            channel.channelType === 'direct_message' &&
            channel.participantIds.length === 2 &&
            channel.participantIds.includes(userId)
        )?.id ?? null
      );
    },
    favorites: ({
      filter,
    }: {
      filter?: { entityTypes?: string[]; entityIds?: string[] } | null;
    }) => {
      countField('favorites');
      const types = filter?.entityTypes ?? [];
      if (types.length > 0 && !types.includes('CHANNEL')) return [];
      return favoriteChannelIds.flatMap((id, index) => {
        const channel = byId.get(id);
        if (!channel) return [];
        reads.rowsReturned += 1;
        return [
          {
            __typename: 'GraphqlFavorite',
            id: uuidFor(6, index),
            entityType: 'CHANNEL',
            entityId: id,
            sortOrder: index,
            createdAt: channel.createdAt,
            fileType: null,
            documentSubType: null,
            channelType: channel.channelType,
            channelId: id,
          },
        ];
      });
    },
  };

  const snapshot = (): FixtureReads => ({
    fields: { ...reads.fields },
    rowsRequested: reads.rowsRequested,
    idsRequested: reads.idsRequested,
    rowsReturned: reads.rowsReturned,
    unsupported: [...reads.unsupported],
  });

  return {
    channels,
    favoriteChannelIds,
    labels: (scope) => {
      const personal = scope === 'personal';
      return {
        labels: personal ? personalLabels : teamLabels,
        scope: personal ? 'personal' : 'team',
        teamId: personal ? undefined : TEAM_ID,
      };
    },
    rootValue: () => ({ user }),
    reads: snapshot,
    readsSince: (mark) => {
      const now = snapshot();
      const fields: Record<string, number> = {};
      for (const [name, count] of Object.entries(now.fields)) {
        const delta = count - (mark.fields[name] ?? 0);
        if (delta) fields[name] = delta;
      }
      return {
        fields,
        rowsRequested: now.rowsRequested - mark.rowsRequested,
        idsRequested: now.idsRequested - mark.idsRequested,
        rowsReturned: now.rowsReturned - mark.rowsReturned,
        unsupported: now.unsupported.filter(
          (shape) => !mark.unsupported.includes(shape)
        ),
      };
    },
    deliverMessage: (channelId, at) => {
      const channel = byId.get(channelId);
      if (!channel) throw new Error(`no fixture channel ${channelId}`);
      const index = channels.indexOf(channel);
      const sender =
        channel.participantIds.find((id) => id !== VIEWER_ID) ?? VIEWER_ID;
      const messageId = uuidFor(7, index);
      channel.latestMessage = {
        messageId,
        senderId: sender,
        content: 'A new message',
        createdAt: iso(at),
      };
      channel.updatedAt = iso(at);
      const notification: FixtureNotification = {
        id: uuidFor(8, index),
        eventType: 'channel_message_send',
        state: 'UNSEEN',
        createdAt: iso(at),
        senderId: sender,
        messageId,
        topLevel: true,
      };
      // Newest first, as the server lists them.
      channel.notifications.unshift(notification);
      return {
        SoupUpdates: {
          soupUpdates: [
            { __typename: 'SoupUpdated', item: channelObject(channel) },
          ],
        },
        NotificationUpdates: {
          notificationUpdates: {
            __typename: 'GraphqlNewNotification',
            notification: notificationObject(channel, notification),
          },
        },
      };
    },
  };
}
