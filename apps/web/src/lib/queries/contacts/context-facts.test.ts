import { expect, it } from 'vitest';
import { buildContactContextFacts, type ContextChannel } from './context-facts';

const SELF = 'macro|self@example.com';
const PEER = 'macro|peer@example.com';

function dm(
  id: string,
  userIds: string[],
  fields: Partial<ContextChannel> = {}
): ContextChannel {
  return {
    id,
    name: 'Peer',
    channelType: 'direct_message',
    updatedAt: '2026-01-02T00:00:00Z',
    viewedAt: null,
    participants: userIds.map((userId) => ({ userId })),
    botParticipants: [],
    ...fields,
  };
}

it('uses first-other interaction but viewed-first one-to-one command activity, never a group target', () => {
  const result = buildContactContextFacts({
    viewer: SELF,
    channels: [
      dm('00000000-0000-4000-8000-000000000001', [SELF, PEER], {
        name: 'Peer label',
        viewedAt: '2026-01-05T00:00:00Z',
      }),
      dm(
        '00000000-0000-4000-8000-000000000002',
        [SELF, PEER, 'macro|other@example.com'],
        { name: 'Group', updatedAt: '2026-01-04T00:00:00Z' }
      ),
    ],
    links: [
      { email_address: 'PEER@example.com', is_primary: false },
      { email_address: 'self@example.com', is_primary: true },
    ],
  });
  expect(result.size).toBe(1);
  expect(result.get(PEER)).toEqual({
    lastInteractionMs: Date.parse('2026-01-04T00:00:00Z'),
    secondaryInbox: true,
    directMessage: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Peer label',
      timestampMs: Date.parse('2026-01-05T00:00:00Z'),
    },
  });
});

it('falls back to the update time for a DM never viewed', () => {
  const result = buildContactContextFacts({
    viewer: SELF,
    channels: [dm('00000000-0000-4000-8000-000000000001', [SELF, PEER])],
    links: [],
  });
  expect(result.get(PEER)?.directMessage?.timestampMs).toBe(
    Date.parse('2026-01-02T00:00:00Z')
  );
});

it('never targets a DM a bot is also in', () => {
  const result = buildContactContextFacts({
    viewer: SELF,
    channels: [
      dm('00000000-0000-4000-8000-000000000001', [SELF, PEER], {
        botParticipants: [{ botId: 'bot-1' }],
      }),
    ],
    links: [],
  });
  expect(result.get(PEER)).toEqual({
    lastInteractionMs: Date.parse('2026-01-02T00:00:00Z'),
    directMessage: null,
    secondaryInbox: false,
  });
});

it('excludes the viewer case-insensitively from peers and command targets', () => {
  const result = buildContactContextFacts({
    viewer: 'MACRO|SELF@example.com',
    links: [],
    channels: [
      dm('00000000-0000-4000-8000-000000000001', [
        'macro|SELF@example.com',
        'MACRO|PEER@example.com',
      ]),
    ],
  });
  expect([...result.keys()]).toEqual([PEER]);
  expect(result.get(PEER)?.directMessage?.id).toBe(
    '00000000-0000-4000-8000-000000000001'
  );
});

it('ignores malformed peers and oversized labels without losing valid activity or other rows', () => {
  const result = buildContactContextFacts({
    viewer: SELF,
    links: [],
    channels: [
      dm('00000000-0000-4000-8000-000000000001', [PEER], {
        name: 'é'.repeat(2049),
        updatedAt: '1970-01-01T00:00:00Z',
      }),
      dm('00000000-0000-4000-8000-000000000002', ['not-a-user'], {
        name: 'Bad',
        updatedAt: 'not-a-date',
      }),
    ],
  });
  expect(result.size).toBe(1);
  expect(result.get(PEER)).toEqual({
    lastInteractionMs: 0,
    directMessage: null,
    secondaryInbox: false,
  });
});

it('skips channels other than DMs', () => {
  const result = buildContactContextFacts({
    viewer: SELF,
    links: [],
    channels: [
      dm('00000000-0000-4000-8000-000000000001', [SELF, PEER], {
        channelType: 'private',
      }),
    ],
  });
  expect(result.size).toBe(0);
});
