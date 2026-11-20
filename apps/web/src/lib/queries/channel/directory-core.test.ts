import { describe, expect, it } from 'vitest';
import {
  compareChannelDirectory,
  countDirectoryDifferences,
  toDirectoryChannel,
} from './directory-core';
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
            botId: 'bot-1',
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
      user_id: 'bot-1',
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
