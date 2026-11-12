import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { expect, it } from 'vitest';
import { buildContactContextFacts } from './context-facts';

it('uses source-order interaction but viewed-first one-to-one command activity, never a group target', () => {
  const result = buildContactContextFacts({
    viewer: 'macro|self@example.com',
    channels: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        channel_type: ChannelType.direct_message,
        name: 'Peer',
        updated_at: '2026-01-02T00:00:00Z',
        viewed_at: '2026-01-03T00:00:00Z',
        participants: [
          { user_id: 'macro|self@example.com' },
          { user_id: 'macro|peer@example.com' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        channel_type: ChannelType.direct_message,
        name: 'Group',
        updated_at: '2026-01-04T00:00:00Z',
        participants: [
          { user_id: 'macro|self@example.com' },
          { user_id: 'macro|peer@example.com' },
          { user_id: 'macro|other@example.com' },
        ],
      },
    ],
    activity: [
      {
        channel_id: '00000000-0000-4000-8000-000000000001',
        viewed_at: '2026-01-05T00:00:00Z',
      },
    ],
    links: [
      { email_address: 'PEER@example.com', is_primary: false },
      { email_address: 'self@example.com', is_primary: true },
    ],
    cachedChannels: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Cached peer label',
        channelType: 'direct_message',
        participantIds: ['macro|self@example.com', 'macro|peer@example.com'],
        ownerId: 'macro|self@example.com',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-06T00:00:00Z',
      },
    ],
  });
  expect(result.size).toBe(1);
  expect(result.get('macro|peer@example.com')).toEqual({
    lastInteractionMs: Date.parse('2026-01-04T00:00:00Z'),
    secondaryInbox: true,
    directMessage: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Cached peer label',
      timestampMs: Date.parse('2026-01-05T00:00:00Z'),
    },
  });
});

it('excludes the viewer case-insensitively from peers and command targets', () => {
  const result = buildContactContextFacts({
    viewer: 'MACRO|SELF@example.com',
    activity: [],
    links: [],
    channels: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        channel_type: ChannelType.direct_message,
        name: 'Peer',
        updated_at: '2026-01-02T00:00:00Z',
        viewed_at: '2026-01-03T00:00:00Z',
        participants: [
          { user_id: 'macro|SELF@example.com' },
          { user_id: 'MACRO|PEER@example.com' },
        ],
      },
    ],
    cachedChannels: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Peer',
        channelType: 'direct_message',
        participantIds: ['MACRO|SELF@example.com', 'MACRO|PEER@example.com'],
        ownerId: 'macro|self@example.com',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-04T00:00:00Z',
      },
    ],
  });
  expect([...result.keys()]).toEqual(['macro|peer@example.com']);
  expect(result.get('macro|peer@example.com')?.directMessage?.id).toBe(
    '00000000-0000-4000-8000-000000000001'
  );
});

it('ignores malformed peers and oversized labels without losing valid activity or other rows', () => {
  const result = buildContactContextFacts({
    viewer: 'macro|self@example.com',
    activity: [],
    links: [],
    cachedChannels: [],
    channels: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        channel_type: ChannelType.direct_message,
        name: 'é'.repeat(2049),
        updated_at: '1970-01-01T00:00:00Z',
        participants: [{ user_id: 'macro|peer@example.com' }],
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        channel_type: ChannelType.direct_message,
        name: 'Bad',
        updated_at: 'not-a-date',
        participants: [{ user_id: 'not-a-user' }],
      },
    ],
  });
  expect(result.size).toBe(1);
  expect(result.get('macro|peer@example.com')).toEqual({
    lastInteractionMs: 0,
    directMessage: null,
    secondaryInbox: false,
  });
});
