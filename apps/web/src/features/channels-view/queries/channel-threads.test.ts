import { describe, expect, it } from 'vitest';
import {
  channelThreadsQueryArgs,
  isUnansweredOwnMessage,
} from './channel-threads';

describe('channelThreadsQueryArgs', () => {
  it('scopes threads to the selected conversation and the user', () => {
    const { body, params } = channelThreadsQueryArgs('user-1', 'channel-1');
    expect(params.sort_method).toBe('updated_at');
    // The backend takes one UUID per ChannelId literal, not a list.
    expect(body.cthf).toEqual({
      '&': [
        { l: { ChannelId: 'channel-1' } },
        { l: { Participant: 'user-1' } },
      ],
    });
  });

  it('returns only threads the user takes part in when unfiltered', () => {
    const { body } = channelThreadsQueryArgs('user-1', undefined);
    expect(body.cthf).toEqual({ l: { Participant: 'user-1' } });
    // Every other entity type is excluded.
    expect(body.chanf).toBeDefined();
    expect(body.df).toBeDefined();
  });
});

describe('isUnansweredOwnMessage', () => {
  const thread = (senderId: string, replyCount: number) =>
    ({ senderId, thread: { replyCount, preview: [] } }) as never;

  it('hides only the user’s own messages that have no replies', () => {
    expect(isUnansweredOwnMessage(thread('me', 0), 'me')).toBe(true);
    expect(isUnansweredOwnMessage(thread('me', 2), 'me')).toBe(false);
    expect(isUnansweredOwnMessage(thread('them', 0), 'me')).toBe(false);
  });
});
