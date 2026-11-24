import type { AgentDmProfile } from '@service-storage/generated/schemas/agentDmProfile';
import { describe, expect, it } from 'vitest';
import {
  compareChannelDirectory,
  countDirectoryDifferences,
  inDirectoryOrder,
  instantMicros,
  isMessageDestinationChannel,
  toDirectoryChannel,
} from './directory-core';
import {
  directoryChannel,
  directoryParticipant,
} from './tests/directory-channel';
import { channelRecord, restChannel } from './tests/directory-fixtures';

const message = {
  messageId: 'm1',
  channelId: 'a',
  threadId: null,
  senderId: 'macro|owner@example.com',
  content: 'hello',
  createdAt: '2026-11-03T00:00:00+00:00',
  updatedAt: '2026-11-03T00:00:00+00:00',
  deletedAt: null,
  mentions: [],
};
const restMessage = {
  message_id: 'm1',
  thread_id: null,
  sender_id: 'macro|owner@example.com',
  content: 'hello',
  created_at: '2026-11-03T00:00:00Z',
  updated_at: '2026-11-03T00:00:00Z',
  deleted_at: null,
  mentions: [],
};

describe('channel directory comparison', () => {
  it('finds no difference between matching records in their two formats', () => {
    const directory = toDirectoryChannel(
      channelRecord('a', {
        latestMessage: message,
        latestNonThreadMessage: message,
      })
    );
    const rest = restChannel('a', {
      latest_message: restMessage,
      latest_non_thread_message: restMessage,
    });

    expect(compareChannelDirectory([rest], [directory])).toEqual([]);
  });

  it('matches a bot in the REST participants against botParticipants', () => {
    const directory = toDirectoryChannel(
      channelRecord('a', {
        botParticipants: [
          {
            channelId: 'a',
            botId: '00000000-0000-0000-0000-00000000b071',
            role: 'MEMBER',
            joinedAt: '2026-11-02T00:00:00+00:00',
            leftAt: null,
          },
        ],
      })
    );
    const rest = restChannel('a');
    rest.participants.push({
      channel_id: 'a',
      user_id: 'bot|00000000-0000-0000-0000-00000000b071',
      role: 'member',
      joined_at: '2026-11-02T00:00:00Z',
      left_at: null,
    });

    expect(compareChannelDirectory([rest], [directory])).toEqual([]);
  });

  it('marks a viewer-derived DM name as expected and other names as differences', () => {
    const dm = toDirectoryChannel(
      channelRecord('dm', { channelType: 'DIRECT_MESSAGE', name: 'Ada' })
    );
    const renamed = toDirectoryChannel(channelRecord('a', { name: 'new' }));

    expect(
      compareChannelDirectory(
        [
          restChannel('dm', { channel_type: 'direct_message', name: null }),
          restChannel('a', { name: 'old' }),
        ],
        [dm, renamed]
      )
    ).toEqual([
      { kind: 'derived_name', channelId: 'dm' },
      { kind: 'name', channelId: 'a' },
    ]);
  });

  it('reports each field and membership difference by kind', () => {
    const directory = [
      toDirectoryChannel(
        channelRecord('a', {
          organizationId: '8',
          viewedAt: '2026-11-04T00:00:00+00:00',
          latestMessage: message,
        })
      ),
      toDirectoryChannel(channelRecord('extra')),
    ];
    const rest = [
      restChannel('a', {
        participants: [],
        latest_message: { ...restMessage, content: 'edited' },
      }),
      restChannel('missing'),
    ];

    const differences = compareChannelDirectory(rest, directory);

    expect(countDirectoryDifferences(differences)).toEqual({
      organization_id: 1,
      viewed_at: 1,
      participants: 1,
      latest_message: 1,
      missing_from_directory: 1,
      extra_in_directory: 1,
    });
  });

  it('reports a latest message whose mentions differ, in any order', () => {
    const mentioned = {
      ...message,
      mentions: ['USER:macro|a@example.com', 'DOCUMENT:d1'],
    };
    const directory = toDirectoryChannel(
      channelRecord('a', {
        latestMessage: mentioned,
        latestNonThreadMessage: mentioned,
      })
    );
    const rest = (mentions: string[]) =>
      restChannel('a', {
        latest_message: { ...restMessage, mentions },
        latest_non_thread_message: {
          ...restMessage,
          mentions: ['DOCUMENT:d1', 'USER:macro|a@example.com'],
        },
      });

    expect(
      compareChannelDirectory(
        [rest(['DOCUMENT:d1', 'USER:macro|a@example.com'])],
        [directory]
      )
    ).toEqual([]);
    expect(
      compareChannelDirectory([rest(['DOCUMENT:d1'])], [directory])
    ).toEqual([{ kind: 'latest_message', channelId: 'a' }]);
  });

  it('reports an agent DM whose persona name or avatar differs', () => {
    const agentDm = {
      botId: '00000000-0000-0000-0000-00000000b071',
      name: 'Scout',
      avatarUrl: null,
    };
    const directory = toDirectoryChannel(channelRecord('a', { agentDm }));
    const persona: AgentDmProfile = {
      bot_id: agentDm.botId,
      name: agentDm.name,
      avatar_url: null,
    };
    const kinds = (agent_dm: AgentDmProfile | undefined) =>
      compareChannelDirectory([restChannel('a', { agent_dm })], [directory]);

    expect(kinds(persona)).toEqual([]);
    expect(kinds({ ...persona, name: 'Renamed' })).toEqual([
      { kind: 'agent_dm', channelId: 'a' },
    ]);
    expect(
      kinds({ ...persona, avatar_url: 'https://example.com/a.png' })
    ).toEqual([{ kind: 'agent_dm', channelId: 'a' }]);
    expect(kinds(undefined)).toEqual([{ kind: 'agent_dm', channelId: 'a' }]);
  });

  it('counts a left member as a difference from an active one', () => {
    const directory = toDirectoryChannel(
      channelRecord('a', {
        participants: [
          {
            channelId: 'a',
            userId: 'macro|owner@example.com',
            role: 'OWNER',
            joinedAt: '2026-11-01T00:00:00+00:00',
            leftAt: '2026-11-05T00:00:00+00:00',
          },
        ],
      })
    );

    expect(
      compareChannelDirectory([restChannel('a')], [directory]).map(
        ({ kind }) => kind
      )
    ).toEqual(['participants']);
  });
});

describe('inDirectoryOrder', () => {
  const at = (id: string, updatedAt: string) =>
    directoryChannel(id, { updatedAt });
  const order = (channels: Parameters<typeof inDirectoryOrder>[0]) =>
    inDirectoryOrder(channels).map(({ id }) => id);

  it('lists the newest update first, as the REST channel list does', () => {
    expect(
      order([
        at('a', '2026-11-01T00:00:00+00:00'),
        at('b', '2026-11-03T00:00:00+00:00'),
        at('c', '2026-11-02T00:00:00+00:00'),
      ])
    ).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie by id, descending', () => {
    const tie = '2026-11-01T00:00:00+00:00';
    expect(
      order([
        at('01a1f7a8-0000-7000-8000-000000000001', tie),
        at('01a1f7a8-0000-7000-8000-000000000003', tie),
        at('01a1f7a8-0000-7000-8000-000000000002', tie),
      ])
    ).toEqual([
      '01a1f7a8-0000-7000-8000-000000000003',
      '01a1f7a8-0000-7000-8000-000000000002',
      '01a1f7a8-0000-7000-8000-000000000001',
    ]);
  });

  it('orders updates within one millisecond by their microseconds', () => {
    expect(
      order([
        at('a', '2026-11-20T06:33:17.159544+00:00'),
        at('b', '2026-11-20T06:33:17.159911+00:00'),
      ])
    ).toEqual(['b', 'a']);
  });

  it('compares instants, whatever offset they are written in', () => {
    expect(instantMicros('2026-11-20T06:33:17.159544Z')).toBe(
      instantMicros('2026-11-20T08:33:17.159544+02:00')
    );
    expect(instantMicros('2026-11-20T06:33:17Z')).toBe(
      Date.parse('2026-11-20T06:33:17Z') * 1000
    );
  });
});

describe('message destination channels', () => {
  it('offers every channel and group chat whatever its size, but no DM', () => {
    const solo = directoryChannel('solo', {
      participants: [directoryParticipant('macro|owner@example.com')],
    });
    const pair = directoryChannel('pair', {
      channelType: 'private',
      participants: [
        directoryParticipant('macro|owner@example.com'),
        directoryParticipant('macro|other@example.com'),
      ],
    });
    const team = directoryChannel('team', { channelType: 'team' });
    const dm = directoryChannel('dm', {
      channelType: 'direct_message',
      participants: [
        directoryParticipant('macro|owner@example.com'),
        directoryParticipant('macro|other@example.com'),
      ],
    });

    expect(
      [solo, pair, team, dm]
        .filter(isMessageDestinationChannel)
        .map((c) => c.id)
    ).toEqual(['solo', 'pair', 'team']);
  });
});
