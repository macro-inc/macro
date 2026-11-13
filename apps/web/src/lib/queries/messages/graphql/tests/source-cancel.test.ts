import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (result: unknown) => void;

const client = vi.hoisted(() => ({
  listeners: [] as Listener[],
  unsubscribed: 0,
  options: [] as unknown[],
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => undefined,
  getUncachedGraphqlSoupClient: () => ({
    query: (_document: unknown, _variables: unknown, options: unknown) => {
      client.options.push(options);
      return {
        subscribe: (listener: Listener) => {
          client.listeners.push(listener);
          return {
            unsubscribe: () => {
              client.unsubscribed += 1;
            },
          };
        },
      };
    },
  }),
}));

import { fetchLatestChannelPage } from '../source';

const ANSWER = {
  data: {
    user: {
      id: 'user',
      channelMessages: {
        timeline: {
          seq: 3,
          entries: [],
          olderCursor: null,
          newerCursor: null,
        },
      },
    },
  },
  stale: false,
  hasNext: false,
};

beforeEach(() => {
  client.listeners = [];
  client.unsubscribed = 0;
  client.options = [];
});

describe('a server read of a channel', () => {
  it('is cancelled by unsubscribing when its signal aborts', async () => {
    const controller = new AbortController();
    const read = fetchLatestChannelPage('channel', controller.signal);
    expect(client.unsubscribed).toBe(0);
    controller.abort(new Error('cancelled'));
    await expect(read).rejects.toThrow('cancelled');
    expect(client.unsubscribed).toBe(1);
    // A late answer is ignored.
    client.listeners[0]?.(ANSWER);
    expect(client.unsubscribed).toBe(1);
  });

  it('never starts when its signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(
      fetchLatestChannelPage('channel', controller.signal)
    ).rejects.toThrow('cancelled');
    expect(client.listeners).toHaveLength(0);
  });

  it('answers with the first complete result and unsubscribes', async () => {
    const read = fetchLatestChannelPage('channel');
    client.listeners[0]?.({ ...ANSWER, stale: true });
    client.listeners[0]?.(ANSWER);
    await expect(read).resolves.toMatchObject({ seq: 3 });
    expect(client.unsubscribed).toBe(1);
  });
});
