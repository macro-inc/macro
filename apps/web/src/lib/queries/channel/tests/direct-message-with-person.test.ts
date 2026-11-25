import { expect, it } from 'vitest';
import { directMessageWithPerson } from '../directory-core';
import { directoryChannel, directoryParticipant } from './directory-channel';

const VIEWER = 'macro|viewer@example.com';
const PERSON = 'macro|person@example.com';
const OTHER = 'macro|other@example.com';
const BOT = '0190f0a0-0000-7000-8000-000000000001';

function dm(id: string, members: string[], overrides = {}) {
  return directoryChannel(id, {
    channelType: 'direct_message',
    participants: members.map((userId) => directoryParticipant(userId)),
    ...overrides,
  });
}

it('answers the DM whose members are just the two of them', () => {
  const channels = [dm('dm-1', [VIEWER, PERSON])];
  expect(directMessageWithPerson(channels, VIEWER, PERSON)).toBe('dm-1');
});

it('passes over groups, other people and other channel types', () => {
  const channels = [
    dm('group', [VIEWER, PERSON, OTHER]),
    dm('other', [VIEWER, OTHER]),
    directoryChannel('private', {
      channelType: 'private',
      participants: [VIEWER, PERSON].map((id) => directoryParticipant(id)),
    }),
  ];
  expect(directMessageWithPerson(channels, VIEWER, PERSON)).toBeUndefined();
});

it('passes over a DM a bot is still in, but not one a bot left', () => {
  const bot = (leftAt: string | null) => ({
    botId: BOT,
    role: 'member' as const,
    joinedAt: '2026-11-01T00:00:00+00:00',
    leftAt,
  });
  expect(
    directMessageWithPerson(
      [dm('with-bot', [VIEWER, PERSON], { botParticipants: [bot(null)] })],
      VIEWER,
      PERSON
    )
  ).toBeUndefined();
  expect(
    directMessageWithPerson(
      [
        dm('bot-left', [VIEWER, PERSON], {
          botParticipants: [bot('2026-11-02T00:00:00+00:00')],
        }),
      ],
      VIEWER,
      PERSON
    )
  ).toBe('bot-left');
});

it('leaves a DM the other person left to the server', () => {
  const channels = [
    directoryChannel('left', {
      channelType: 'direct_message',
      participants: [
        directoryParticipant(VIEWER),
        directoryParticipant(PERSON, { leftAt: '2026-11-02T00:00:00+00:00' }),
      ],
    }),
    dm('alone', [VIEWER]),
  ];
  expect(directMessageWithPerson(channels, VIEWER, PERSON)).toBeUndefined();
});

it('takes the oldest of several, to the microsecond, then the lowest id', () => {
  const channels = [
    dm('0000000b', [VIEWER, PERSON], {
      createdAt: '2026-11-01T00:00:00.000002+00:00',
    }),
    dm('0000000c', [VIEWER, PERSON], {
      createdAt: '2026-11-01T00:00:00.000001Z',
    }),
    dm('0000000a', [VIEWER, PERSON], {
      createdAt: '2026-11-01T00:00:00.000001+00:00',
    }),
  ];
  expect(directMessageWithPerson(channels, VIEWER, PERSON)).toBe('0000000a');
});

it('leaves the order to the server when a creation time does not parse', () => {
  const channels = [
    dm('0000000a', [VIEWER, PERSON], { createdAt: 'not a time' }),
    dm('0000000b', [VIEWER, PERSON], {
      createdAt: '2026-11-01T00:00:00.000001Z',
    }),
  ];
  expect(directMessageWithPerson(channels, VIEWER, PERSON)).toBeUndefined();
});
