import { thrownResultErrorHasCode } from '@core/util/result';
import { type Client, createClient, fetchExchange } from '@urql/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelWrites } from '../channel-writes';
import { graphqlMessage, keyOf } from './fixtures';
import { fakeClient, NOW, send, writeHost } from './write-fixtures';

// A send whose outcome the queue lost asks the server through the real
// `ChannelMessage` request: the urql client and the cache's store
// acknowledgement are the only stand-ins.
const network = vi.hoisted(() => ({
  client: undefined as Client | undefined,
  stored: undefined as Promise<string | undefined> | undefined,
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => network.client,
}));

vi.mock('@graphql-cache/exchange/normalized-cache-exchange', () => ({
  normalizedCacheResultMetadata: () => ({
    source: 'live-network',
    revision: '1',
    persistence: network.stored,
  }),
}));

const message = graphqlMessage(7);

const serverHasIt = () =>
  new Response(
    JSON.stringify({ data: { user: { channelMessage: message } } }),
    { headers: { 'content-type': 'application/json' } }
  );

function lostSend(fetcher: typeof fetch) {
  network.client = createClient({
    url: 'https://example.invalid/graphql',
    exchanges: [fetchExchange],
    fetch: fetcher,
  });
  const { client } = fakeClient(() => ({
    disposition: { kind: 'queued', transactionId: '4' },
  }));
  const device = writeHost();
  const writes = createChannelWrites({
    host: device.host,
    runtime: { notifyChanged: vi.fn() },
    client: () => client,
    now: () => NOW,
  });
  const outcome = async () => {
    try {
      return { id: (await writes.send(send(message.id))).id };
    } catch (error) {
      return {
        code: thrownResultErrorHasCode(error, 'DELIVERY_UNKNOWN')
          ? 'DELIVERY_UNKNOWN'
          : 'OTHER',
      };
    }
  };
  return {
    outcome: outcome(),
    device,
    exhaust: () =>
      device.settle({
        transactionId: '4',
        status: 'permanently-failed',
        errorCode: 'MUTATION_RETRY_EXHAUSTED',
        error: 'stopped after 3 server failures',
      }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  network.client = undefined;
  network.stored = undefined;
});

describe('asking the server about a lost send', () => {
  it('delivers a send the server answered for while the device still stores it', async () => {
    vi.useFakeTimers();
    const answer = Promise.withResolvers<Response>();
    const store = Promise.withResolvers<string>();
    network.stored = store.promise;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(answer.promise)
      .mockRejectedValue(new Error('connection dropped'));
    const send = lostSend(fetcher);
    await vi.advanceTimersByTimeAsync(0);
    send.exhaust();
    // The server answers six seconds in; its copy never finishes storing.
    await vi.advanceTimersByTimeAsync(6_000);
    answer.resolve(serverHasIt());
    await vi.advanceTimersByTimeAsync(6_000);
    try {
      expect(await send.outcome).toEqual({ id: message.id });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      store.resolve('1');
    }
  });

  it('asks again with a new request after one goes unanswered', async () => {
    vi.useFakeTimers();
    const unanswered = Promise.withResolvers<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(unanswered.promise)
      .mockImplementation(async () => serverHasIt());
    const send = lostSend(fetcher);
    await vi.advanceTimersByTimeAsync(0);
    send.exhaust();
    try {
      await vi.advanceTimersByTimeAsync(32_000);
      expect(await send.outcome).toEqual({ id: message.id });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      unanswered.reject(new Error('closing the first request'));
    }
  });

  it('asks again after the server had none, since a request in flight can still commit', async () => {
    vi.useFakeTimers();
    const none = () =>
      new Response(
        JSON.stringify({ data: { user: { channelMessage: null } } }),
        {
          headers: { 'content-type': 'application/json' },
        }
      );
    const firstAnswer = Promise.withResolvers<Response>();
    let committed = false;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(firstAnswer.promise)
      .mockImplementation(async () => (committed ? serverHasIt() : none()));
    const send = lostSend(fetcher);
    await vi.advanceTimersByTimeAsync(0);
    send.exhaust();
    await vi.advanceTimersByTimeAsync(0);
    // The send commits while the server's empty answer is on its way.
    committed = true;
    firstAnswer.resolve(none());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await send.outcome).toEqual({ id: message.id });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['the queue stopped retrying', 'the queue lost'])(
    'delivers a send another tab stored while asking, when %s it',
    async (how) => {
      vi.useFakeTimers();
      const answer = Promise.withResolvers<Response>();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockReturnValueOnce(answer.promise)
        .mockRejectedValue(new Error('connection dropped'));
      const send = lostSend(fetcher);
      await vi.advanceTimersByTimeAsync(0);
      if (how === 'the queue lost') send.device.restore();
      else send.exhaust();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      // Another tab's subscription stores the message after this tab read
      // the device, and this tab's request fails.
      send.device.device.records.set(keyOf(message), message);
      answer.reject(new Error('connection dropped'));
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await send.outcome).toEqual({ id: message.id });
    }
  );
});
