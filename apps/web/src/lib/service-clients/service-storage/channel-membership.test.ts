import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import { createClient, type Exchange, subscriptionExchange } from '@urql/core';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type ChannelMembershipPatch,
  channelMembershipReceiptExchange,
  subscribeToChannelMembership,
} from './channel-membership';
import {
  SoupUpdatesDocument,
  type SoupUpdatesSubscription,
} from './graphql/generated/graphql';

type SoupPatch = SoupUpdatesSubscription['soupUpdates'][number];

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup) dispose();
  cleanup = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const update = (
  id: string,
  isParticipant: boolean,
  typename = 'GraphqlSoupChannel'
) =>
  ({
    __typename: 'SoupUpdated',
    item: {
      __typename: typename,
      id,
      channelType: 'public',
      isParticipant,
      createdAt: '2026-01-01T00:00:00Z',
    },
  }) as SoupPatch;
const deletion = (entityId: string, graphqlTypeName = 'GraphqlSoupChannel') =>
  ({
    __typename: 'GraphqlCacheDeletion',
    graphqlTypeName,
    entityId,
  }) as SoupPatch;

function listen() {
  const seen: ChannelMembershipPatch[] = [];
  cleanup.push(subscribeToChannelMembership((patch) => seen.push(patch)));
  return seen;
}

function subscribe(exchanges: Exchange[], onResult: () => void = () => {}) {
  let receive: (patches: SoupPatch[]) => void = () => {
    throw new Error('subscription is not attached');
  };
  const attached = Promise.withResolvers<void>();
  const client = createClient({
    url: 'https://soup.test/graphql',
    exchanges: [
      ...exchanges,
      subscriptionExchange({
        forwardSubscription: () => ({
          subscribe(sink) {
            receive = (patches) =>
              sink.next({ data: { soupUpdates: patches } });
            attached.resolve();
            return { unsubscribe() {} };
          },
        }),
      }),
    ],
  });
  const subscription = client
    .subscription(SoupUpdatesDocument, {})
    .subscribe(onResult);
  cleanup.push(() => subscription.unsubscribe());
  return { attached: attached.promise, emit: (p: SoupPatch[]) => receive(p) };
}

it('publishes each channel the viewer is shown in or out of, and each deleted channel', async () => {
  const seen = listen();
  const stream = subscribe([channelMembershipReceiptExchange()]);
  await stream.attached;

  stream.emit([
    update('joined', true),
    update('left', false),
    deletion('deleted'),
    update('a-document', true, 'GraphqlSoupDocument'),
    deletion('a-document', 'GraphqlSoupDocument'),
  ]);

  expect(seen).toEqual([
    { channelId: 'joined', member: true },
    { channelId: 'left', member: false },
    { channelId: 'deleted', member: false },
  ]);
});

it('publishes a leave before the cache has written it, under the receipt span', async () => {
  vi.useFakeTimers();
  const resume = Promise.withResolvers<void>();
  const writeStarted = Promise.withResolvers<void>();
  const noop = createNoopCacheHost();
  const host: CacheHost = {
    ...noop,
    disabled: false,
    writeQuery: vi.fn(async (args) => {
      writeStarted.resolve();
      await resume.promise;
      return await noop.writeQuery(args);
    }),
  };
  cleanup.push(() => host.dispose());
  // Which receipt each listener call ran inside.
  let receiving: string | undefined;
  const receipts: string[] = [];
  const receipt = vi.spyOn(Telemetry, 'span').mockImplementation(((
    name: string
  ) => {
    receipts.push(name);
    const id = `${name}#${receipts.length}`;
    return {
      run: <T>(operation: () => T): T => {
        receiving = id;
        try {
          return operation();
        } finally {
          receiving = undefined;
        }
      },
      setAttr() {},
      end() {},
    };
  }) as unknown as typeof Telemetry.span);
  const inside: (string | undefined)[] = [];
  cleanup.push(subscribeToChannelMembership(() => inside.push(receiving)));
  const seen = listen();
  const onResult = vi.fn();
  const stream = subscribe(
    [normalizedCacheExchange(host), channelMembershipReceiptExchange()],
    onResult
  );
  await stream.attached;

  stream.emit([update('joined', true)]);
  await writeStarted.promise;
  stream.emit([update('left', false)]);
  await vi.advanceTimersByTimeAsync(0);

  // The second frame waits behind the first one's write, and its leave is
  // already out.
  expect(seen).toEqual([
    { channelId: 'joined', member: true },
    { channelId: 'left', member: false },
  ]);
  expect(onResult).not.toHaveBeenCalled();
  expect(
    receipt.mock.calls.filter(([name]) => name === 'channel_membership.receive')
  ).toHaveLength(2);
  expect(inside).toEqual([
    'channel_membership.receive#1',
    'channel_membership.receive#2',
  ]);
  resume.resolve();
});

it('publishes nothing for a frame without channels, or to a listener that unsubscribed', async () => {
  const gone: ChannelMembershipPatch[] = [];
  const unsubscribe = subscribeToChannelMembership((patch) => gone.push(patch));
  unsubscribe();
  const seen = listen();
  const receipt = vi.spyOn(Telemetry, 'span');
  const stream = subscribe([channelMembershipReceiptExchange()]);
  await stream.attached;

  stream.emit([update('a-document', true, 'GraphqlSoupDocument')]);
  stream.emit([update('left', false)]);

  expect(gone).toEqual([]);
  expect(seen).toEqual([{ channelId: 'left', member: false }]);
  expect(
    receipt.mock.calls.filter(([name]) => name === 'channel_membership.receive')
  ).toHaveLength(1);
});

it('reaches every listener when one throws', async () => {
  vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  cleanup.push(
    subscribeToChannelMembership(() => {
      throw new Error('listener failed');
    })
  );
  const seen = listen();
  const stream = subscribe([channelMembershipReceiptExchange()]);
  await stream.attached;

  stream.emit([update('left', false)]);

  expect(seen).toEqual([{ channelId: 'left', member: false }]);
});
