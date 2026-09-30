import { describe, expect, it } from 'vitest';
import { channelThreadsQueryArgs } from './channel-threads';

// Threads user-1 takes part in, minus their roots nobody has replied to.
const INVOLVED = {
  '&': [
    { l: { Participant: 'user-1' } },
    {
      '!': {
        '&': [{ l: { RootSender: 'user-1' } }, { l: { HasReplies: false } }],
      },
    },
  ],
};

describe('channelThreadsQueryArgs', () => {
  it('scopes threads to the selected conversation and the user', () => {
    const { body, params } = channelThreadsQueryArgs('user-1', 'channel-1');
    expect(params.sort_method).toBe('updated_at');
    // The backend takes one UUID per ChannelId literal, not a list.
    expect(body.cthf).toEqual({
      '&': [{ l: { ChannelId: 'channel-1' } }, INVOLVED],
    });
  });

  it('drops only unanswered roots from the user’s threads when unfiltered', () => {
    const { body } = channelThreadsQueryArgs('user-1', undefined);
    expect(body.cthf).toEqual(INVOLVED);
    // Every other entity type is excluded.
    expect(body.chanf).toBeDefined();
    expect(body.df).toBeDefined();
  });
});
