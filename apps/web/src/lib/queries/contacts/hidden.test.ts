import { describe, expect, it } from 'vitest';
import {
  directMessageCounterparty,
  isHiddenContactEmail,
  isHiddenDirectMessage,
  isHiddenUserId,
  withoutHiddenDirectMessages,
} from './hidden';

const hidden = new Set(['macro|aunt@example.com']);

describe('hidden contacts', () => {
  it('matches a hidden user id ignoring case', () => {
    expect(isHiddenUserId('macro|Aunt@example.com', hidden)).toBe(true);
    expect(isHiddenUserId('macro|colleague@example.com', hidden)).toBe(false);
  });

  it('matches an email to its macro user id', () => {
    expect(isHiddenContactEmail(' Aunt@example.com ', hidden)).toBe(true);
    expect(isHiddenContactEmail('colleague@example.com', hidden)).toBe(false);
  });

  it('hides only a one-to-one direct message with that person', () => {
    const dm = {
      channelType: 'direct_message',
      participantIds: ['macro|me@example.com', 'macro|aunt@example.com'],
    };
    const group = {
      channelType: 'direct_message',
      participantIds: [
        'macro|me@example.com',
        'macro|aunt@example.com',
        'macro|colleague@example.com',
      ],
    };
    const agent = {
      channelType: 'direct_message',
      participantIds: ['macro|me@example.com', 'bot|assistant'],
    };
    const channel = {
      channelType: 'public',
      participantIds: ['macro|me@example.com', 'macro|aunt@example.com'],
    };

    expect(directMessageCounterparty(dm, 'macro|me@example.com')).toBe(
      'macro|aunt@example.com'
    );
    expect(isHiddenDirectMessage(dm, hidden)).toBe(true);
    expect(isHiddenDirectMessage(group, hidden)).toBe(false);
    expect(isHiddenDirectMessage(agent, hidden)).toBe(false);
    expect(isHiddenDirectMessage(channel, hidden)).toBe(false);

    expect(withoutHiddenDirectMessages([dm, group, channel], hidden)).toEqual([
      group,
      channel,
    ]);
  });

  it('returns the same list when nobody is hidden', () => {
    const channels = [
      {
        channelType: 'direct_message',
        participantIds: ['macro|me@example.com', 'macro|aunt@example.com'],
      },
    ];
    expect(withoutHiddenDirectMessages(channels, new Set())).toBe(channels);
  });
});
