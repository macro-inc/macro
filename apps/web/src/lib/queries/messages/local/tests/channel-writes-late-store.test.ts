import 'fake-indexeddb/auto';
import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { type Client, createClient, fetchExchange } from '@urql/core';
import { afterEach, expect, it, vi } from 'vitest';
import { createChannelWrites } from '../channel-writes';
import { graphqlMessage, keyOf } from './fixtures';
import { fakeClient, NOW, send, writeHost } from './write-fixtures';

const network = vi.hoisted(() => ({ client: undefined as Client | undefined }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => network.client,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  network.client = undefined;
});

function recoveringSend(hasMessage: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('probe forbids external fetch');
    })
  );
  const postMessage = vi.fn();
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      postMessage = postMessage;
      close() {}
    }
  );
  const notifyChanged = vi.fn();
  const message = graphqlMessage(7);
  const queued = writeHost();
  const base = createNoopCacheHost();
  const stores: Array<(ok?: boolean) => void> = [];
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: { user: { channelMessage: hasMessage ? message : null } },
        }),
        { headers: { 'content-type': 'application/json' } }
      )
  );
  network.client = createClient({
    url: 'https://example.invalid/graphql',
    exchanges: [
      normalizedCacheExchange({
        ...base,
        disabled: false,
        async writeQuery(request) {
          const done = Promise.withResolvers<boolean>();
          stores.push((ok = true) => done.resolve(ok));
          if (!(await done.promise)) throw new Error('device rejected store');
          if (hasMessage) queued.device.records.set(keyOf(message), message);
          return await base.writeQuery(request);
        },
      }),
      fetchExchange,
    ],
    fetch,
  });
  const { client } = fakeClient(() => ({
    disposition: { kind: 'queued', transactionId: '4' },
  }));
  const writes = createChannelWrites({
    host: queued.host,
    runtime: { notifyChanged },
    now: () => NOW,
    client: () => client,
  });
  const outcome = (async () => {
    try {
      return (await writes.send(send(message.id))).id;
    } catch {
      return 'unknown';
    }
  })();
  return {
    outcome,
    message,
    stores,
    fetch,
    notifyChanged,
    postMessage,
    exhaust() {
      queued.settle({
        transactionId: '4',
        status: 'permanently-failed',
        errorCode: 'MUTATION_RETRY_EXHAUSTED',
        error: 'test retry exhaustion',
      });
    },
  };
}

it('does not notify local views or other tabs for three late stores of empty lookup responses', async () => {
  vi.useFakeTimers();
  const send = recoveringSend(false);
  await vi.advanceTimersByTimeAsync(0);
  send.exhaust();
  await vi.advanceTimersByTimeAsync(17_000);
  expect(await send.outcome).toBe('unknown');
  expect(send.fetch).toHaveBeenCalledTimes(3);

  send.notifyChanged.mockClear();
  send.postMessage.mockClear();
  for (let index = 0; index < 3; index += 1) {
    // The normalized exchange serializes stores for the lookup key.
    expect(send.stores).toHaveLength(index + 1);
    send.stores[index]();
    await vi.advanceTimersByTimeAsync(0);
  }
  expect({
    local: send.notifyChanged.mock.calls.length,
    broadcasts: send.postMessage.mock.calls.length,
  }).toEqual({ local: 0, broadcasts: 0 });
});

it.each([true, false])(
  'notifies exactly once per tab only when a late copy stores successfully (%s)',
  async (stored) => {
    vi.useFakeTimers();
    const send = recoveringSend(true);
    await vi.advanceTimersByTimeAsync(0);
    send.exhaust();
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await send.outcome).toBe(send.message.id);

    send.notifyChanged.mockClear();
    send.postMessage.mockClear();
    expect(send.stores).toHaveLength(1);
    send.stores[0](stored);
    await vi.advanceTimersByTimeAsync(0);
    expect(send.notifyChanged).toHaveBeenCalledTimes(stored ? 1 : 0);
    expect(send.postMessage).toHaveBeenCalledTimes(stored ? 1 : 0);
  }
);
