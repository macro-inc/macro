import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearNotifiedFloors } from '@queries/soup/normalized-cache/notified-floor';
import {
  clearOwnTouchFloors,
  ownTouchStamp,
} from '@queries/soup/normalized-cache/own-touch';
import { mapGraphqlSoupItem } from '@service-storage/graphql-soup';
import { afterEach, describe, expect, it, vi } from 'vitest';
import corpus from '../../../../../../../crates/soup_filter_cache_adapter/src/channel_list_row/corpus.json';
import { mapSoupPageToEntityList } from '../transform-utils';
import {
  type ChannelListRow,
  channelListRow,
  finishChannelListRow,
  isChannelListRow,
} from './channel-list-row';

vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: {},
  itemToSafeName: vi.fn(),
}));
vi.mock('@core/context/channels', () => ({ useChannelDirectory: vi.fn() }));
vi.mock('@core/user', () => ({ emailToId: vi.fn() }));

type Json = Record<string, unknown>;

/** Today's pipeline: GraphQL record → REST Soup item → entity. */
function mapped(record: Json) {
  const item = mapGraphqlSoupItem(record as never);
  return item
    ? mapSoupPageToEntityList(
        { items: [item], next_cursor: undefined },
        { showSupportedForeignEntities: false }
      )[0]
    : undefined;
}

const message = (id: string, extra: Json = {}): Json => ({
  messageId: `m-${id}`,
  channelId: `c-${id}`,
  threadId: null,
  senderId: `u-${id}`,
  content: `hello ${id}`,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  deletedAt: null,
  mentions: [],
  ...extra,
});

const channel = (id: string, extra: Json = {}): Json => ({
  __typename: 'GraphqlSoupChannel',
  cacheProjection: null,
  id,
  entityType: 'CHANNEL',
  displayName: `channel ${id}`,
  isFavorited: false,
  frecencyScore: 1.5,
  channelName: `channel ${id}`,
  channelType: 'PUBLIC',
  ownerId: 'u-owner',
  organizationId: 7,
  channelTeamId: null,
  autoJoinTeam: false,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  viewedAt: null,
  interactedAt: null,
  isParticipant: true,
  participants: [
    {
      channelId: id,
      userId: 'u-1',
      role: 'OWNER',
      joinedAt: '2026-10-01T00:00:00Z',
      leftAt: null,
    },
  ],
  botParticipants: [],
  agentDm: null,
  latestMessage: message(id),
  latestNonThreadMessage: message(id),
  unreadNotifications: [],
  unreadMentions: [],
  ...extra,
});

/** Every null, absent and empty case the row's fields have. */
const HAND_CASES: Array<[string, Json]> = [
  ['plain', channel('plain')],
  ['null name', channel('null-name', { channelName: null })],
  ['empty name', channel('empty-name', { channelName: '' })],
  [
    'direct message, team',
    channel('dm', { channelType: 'DIRECT_MESSAGE', channelTeamId: 'team-1' }),
  ],
  ['private', channel('private', { channelType: 'PRIVATE' })],
  ['team', channel('team', { channelType: 'TEAM', channelTeamId: 'team-2' })],
  ['null participation', channel('null-participant', { isParticipant: null })],
  ['not a participant', channel('outsider', { isParticipant: false })],
  ['viewed', channel('viewed', { viewedAt: '2026-11-02T00:00:00Z' })],
  [
    'interacted only',
    channel('interacted', { interactedAt: '2026-11-03T00:00:00Z' }),
  ],
  [
    'viewed and interacted',
    channel('both', {
      viewedAt: '2026-11-02T00:00:00Z',
      interactedAt: '2026-11-03T00:00:00Z',
    }),
  ],
  [
    'null messages',
    channel('no-messages', {
      latestMessage: null,
      latestNonThreadMessage: null,
    }),
  ],
  [
    'thread message with mentions',
    channel('thread', {
      latestMessage: message('thread', {
        threadId: 't-1',
        mentions: ['u-2', 'u-3'],
      }),
    }),
  ],
  [
    'null mentions',
    channel('null-mentions', {
      latestMessage: message('null-mentions', { mentions: null }),
    }),
  ],
  ['null frecency', channel('no-frecency', { frecencyScore: null })],
  ['favorited', channel('favorite', { isFavorited: true })],
  [
    'no unread edges (older payload)',
    (() => {
      const {
        unreadNotifications: _notifications,
        unreadMentions: _mentions,
        ...rest
      } = channel('legacy');
      return rest;
    })(),
  ],
  [
    'unread edges',
    channel('unread', {
      unreadNotifications: [
        { id: 'n-1', state: 'UNSEEN', createdAt: '2026-11-04T00:00:00Z' },
      ],
      unreadMentions: [
        { id: 'n-2', state: 'UNSEEN' },
        { id: 'n-3', state: 'SEEN' },
        { id: 'n-4', state: 'DONE' },
      ],
    }),
  ],
  [
    'participants who left, in order',
    channel('left', {
      participants: ['u-9', 'u-1', 'u-5'].map((userId, index) => ({
        channelId: 'left',
        userId,
        role: 'MEMBER',
        joinedAt: '2026-10-01T00:00:00Z',
        leftAt: index === 1 ? '2026-10-05T00:00:00Z' : null,
      })),
    }),
  ],
  ['no participants', channel('empty', { participants: [] })],
];

/** A small seeded generator (mulberry32), so the corpus is reproducible. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function generated(count: number, seed: number): Array<[string, Json]> {
  const next = random(seed);
  const pick = <T,>(values: readonly T[]): T =>
    values[Math.floor(next() * values.length)];
  const maybe = <T,>(value: T): T | null => (next() < 0.3 ? null : value);
  const date = () =>
    new Date(Date.UTC(2026, 0, 1) + Math.floor(next() * 3e10)).toISOString();
  return Array.from({ length: count }, (_, index) => {
    const id = `g-${seed}-${index}`;
    const record = channel(id, {
      channelName: pick([`name ${index}`, '', null]),
      channelType: pick(['PUBLIC', 'PRIVATE', 'DIRECT_MESSAGE', 'TEAM']),
      channelTeamId: maybe(`team-${index % 5}`),
      isFavorited: pick([true, false, null]),
      frecencyScore: maybe(Math.round(next() * 1000) / 10),
      viewedAt: maybe(date()),
      interactedAt: maybe(date()),
      isParticipant: pick([true, false, null]),
      participants: Array.from(
        { length: Math.floor(next() * 4) },
        (_, at) => ({
          channelId: id,
          userId: `u-${Math.floor(next() * 20)}-${at}`,
          role: 'MEMBER',
          joinedAt: date(),
          leftAt: maybe(date()),
        })
      ),
      latestMessage: maybe(
        message(id, {
          threadId: maybe(`t-${index}`),
          mentions: next() < 0.2 ? null : [`u-${index}`],
          createdAt: date(),
        })
      ),
      latestNonThreadMessage: maybe(message(`${id}-root`, { createdAt: date() })),
      unreadNotifications: Array.from(
        { length: Math.floor(next() * 2) },
        (_, at) => ({
          id: `n-${index}-${at}`,
          state: pick(['UNSEEN', 'SEEN', 'DONE']),
          createdAt: date(),
        })
      ),
      unreadMentions: Array.from(
        { length: Math.floor(next() * 11) },
        (_, at) => ({
          id: `m-${index}-${at}`,
          state: pick(['UNSEEN', 'SEEN', 'DONE']),
        })
      ),
    });
    if (next() < 0.1) {
      delete record.unreadNotifications;
      delete record.unreadMentions;
    }
    return [id, record];
  });
}

const CORPUS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../crates/soup_filter_cache_adapter/src/channel_list_row/corpus.json'
);

afterEach(() => {
  clearOwnTouchFloors();
  clearNotifiedFloors();
});

describe('channel-list rows', () => {
  const cases = [...HAND_CASES, ...generated(1_000, 12_278)];

  it('finish to the entities today’s mappers build', () => {
    for (const [name, record] of cases) {
      const row = channelListRow(record as never) as ChannelListRow;
      expect(isChannelListRow(row), name).toBe(true);
      expect(finishChannelListRow(row), name).toEqual(mapped(record));
    }
  });

  it('match the rows the engine shapes', () => {
    const committed = [...HAND_CASES, ...generated(100, 12_278)];
    const rows = committed.map(([name, record]) => ({
      name,
      record,
      row: channelListRow(record as never),
    }));
    if (process.env.UPDATE_CHANNEL_LIST_ROW_CORPUS === '1') {
      writeFileSync(
        CORPUS_PATH,
        `[\n${rows.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`
      );
    }
    expect(rows).toEqual(corpus);
  });

  it('send other Soup types as selected', () => {
    const document = { __typename: 'GraphqlSoupDocument', id: 'd-1' };
    expect(channelListRow(document)).toBe(document);
    expect(isChannelListRow(document)).toBe(false);
  });

  it('pick up a floor raised after the row was finished', () => {
    const row = channelListRow(channel('floor') as never) as ChannelListRow;
    const before = finishChannelListRow(row);
    expect(finishChannelListRow(row)).toBe(before);
    const stamp = ownTouchStamp('floor');
    const after = finishChannelListRow(row);
    expect(after).not.toBe(before);
    expect(after.touchedAt).toBe(stamp);
    expect(after).toEqual(mapped(channel('floor')));
  });
});
