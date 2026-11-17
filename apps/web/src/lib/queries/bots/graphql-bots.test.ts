import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { parseCacheRevision } from '@graphql-cache/protocol';
import type {
  BotFieldsFragment,
  BotIdentitiesQuery,
  BotUpdatesSubscription,
} from '@service-storage/graphql/generated/graphql';
import { QueryClient } from '@tanstack/solid-query';
import {
  type Client,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { createComputed, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { map, pipe } from 'wonka';
import { agentKeys } from '../agents/keys';
import { channelKeys } from '../channel/keys';
import { botKeys } from './keys';

let testQueryClient: QueryClient;
let client: Client;

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => client,
}));

import { createBotUpdatesHandler } from './bot-updates';
import { createBotIdentity } from './graphql-bots';

const RELEASE_BOT = '5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f';
const REVIEW_BOT = '0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b';

function bot(id: string, name: string): BotFieldsFragment {
  return {
    id,
    name,
    handle: name.toLowerCase().replace(/ /g, '-'),
    avatarUrl: null,
    deletedAt: null,
    isSystem: false,
  };
}

/** The server: answers `user.bots` from `rows` and records every request. */
function createServer(rows: Map<string, BotFieldsFragment>) {
  const requests: string[][] = [];
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      map((operation: Operation): OperationResult => {
        const ids = (operation.variables as { ids: string[] }).ids;
        if (operation.kind === 'query') requests.push(ids);
        const data: BotIdentitiesQuery = {
          user: {
            id: 'macro|viewer@example.com',
            bots: ids.flatMap((id) => rows.get(id) ?? []),
          },
        };
        return { operation, data, stale: false, hasNext: false };
      })
    );
  return { requests, exchange };
}

function pushed(
  bots: BotFieldsFragment[],
  cacheEffectsApplied: boolean
): OperationResult<BotUpdatesSubscription> {
  return {
    operation: {} as Operation,
    data: { botUpdates: bots },
    stale: false,
    hasNext: true,
    extensions: {
      __macroNormalizedCache: { source: 'live-network', cacheEffectsApplied },
    },
  };
}

function mount<T>(factory: () => T) {
  return createRoot((dispose) => ({ value: factory(), dispose }));
}

let disposers: Array<() => void> = [];
function mounted<T>(factory: () => T): T {
  const root = mount(factory);
  disposers.push(root.dispose);
  return root.value;
}

beforeEach(() => {
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  testQueryClient.clear();
});

describe('createBotIdentity', () => {
  it('reads every mounted bot in one request', async () => {
    const server = createServer(
      new Map([
        [RELEASE_BOT, bot(RELEASE_BOT, 'Shipper')],
        [REVIEW_BOT, bot(REVIEW_BOT, 'Reviewer')],
      ])
    );
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });

    const release = mounted(() => createBotIdentity(() => RELEASE_BOT));
    const review = mounted(() => createBotIdentity(() => REVIEW_BOT));

    expect(release.data()).toBeUndefined();
    expect(review.data()).toBeUndefined();
    await vi.waitFor(() => expect(release.data()?.name).toBe('Shipper'));
    expect(review.data()?.name).toBe('Reviewer');
    expect(server.requests).toEqual([[RELEASE_BOT, REVIEW_BOT]]);
  });

  it('reads null for an id no bot has, and nothing for a malformed id', async () => {
    const server = createServer(new Map());
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });

    const unknown = mounted(() => createBotIdentity(() => RELEASE_BOT));
    const malformed = mounted(() => createBotIdentity(() => 'not-a-bot'));

    await vi.waitFor(() => expect(unknown.data()).toBeNull());
    expect(malformed.data()).toBeUndefined();
    expect(server.requests).toEqual([[RELEASE_BOT]]);
  });

  it('keeps a missing bot missing while its batch reads again', async () => {
    const server = createServer(new Map());
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });
    const unknown = mounted(() => createBotIdentity(() => RELEASE_BOT));
    await vi.waitFor(() => expect(unknown.data()).toBeNull());
    const seen: (BotIdentity | null | undefined)[] = [];
    mounted(() => createComputed(() => seen.push(unknown.data())));

    createBotUpdatesHandler(client).reconnect();

    await vi.waitFor(() => expect(server.requests).toHaveLength(2));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen.every((value) => value === null)).toBe(true);
  });
});

describe('botUpdates', () => {
  it('re-renders a mounted bot from the normalized cache without a request', async () => {
    const server = createServer(new Map());
    let opKey = 0;
    let cachedName = 'Release bot';
    let affected!: (keys: number[]) => void;
    const watchQuery = vi
      .fn()
      .mockImplementation(async (args: { opKey: number }) => {
        opKey = args.opKey;
        return {
          kind: 'hit',
          revision: parseCacheRevision('1'),
          data: {
            user: { id: 'viewer', bots: [bot(RELEASE_BOT, cachedName)] },
          },
        };
      });
    client = createClient({
      url: '/graphql',
      exchanges: [
        normalizedCacheExchange({
          ...createNoopCacheHost(),
          disabled: false,
          watchQuery,
          onOpsAffected: (listener) => {
            affected = listener;
            return () => {};
          },
        }),
        server.exchange,
      ],
    });
    const release = mounted(() => createBotIdentity(() => RELEASE_BOT));
    await vi.waitFor(() => expect(release.data()?.name).toBe('Release bot'));
    const requestsBeforePush = server.requests.length;

    // The push replaced `GraphqlBot:<id>`; the cache rereads the query.
    cachedName = 'Shipper';
    createBotUpdatesHandler(client).onResult(
      pushed([bot(RELEASE_BOT, 'Shipper')], true)
    );
    affected([opKey]);

    await vi.waitFor(() => expect(release.data()?.name).toBe('Shipper'));
    expect(server.requests.length).toBe(requestsBeforePush);
  });

  it('reads again only the bots a push reached when the normalized cache did not apply it', async () => {
    const rows = new Map([
      [RELEASE_BOT, bot(RELEASE_BOT, 'Release bot')],
      [REVIEW_BOT, bot(REVIEW_BOT, 'Reviewer')],
    ]);
    const server = createServer(rows);
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });
    const release = mounted(() => createBotIdentity(() => RELEASE_BOT));
    await vi.waitFor(() => expect(release.data()?.name).toBe('Release bot'));
    const review = mounted(() => createBotIdentity(() => REVIEW_BOT));
    await vi.waitFor(() => expect(review.data()?.name).toBe('Reviewer'));

    rows.set(RELEASE_BOT, bot(RELEASE_BOT, 'Shipper'));
    createBotUpdatesHandler(client).onResult(
      pushed([bot(RELEASE_BOT, 'Shipper')], false)
    );

    await vi.waitFor(() => expect(release.data()?.name).toBe('Shipper'));
    expect(server.requests).toEqual([
      [RELEASE_BOT],
      [REVIEW_BOT],
      [RELEASE_BOT],
    ]);
  });

  it('reads every mounted bot again on reconnect', async () => {
    const rows = new Map([[RELEASE_BOT, bot(RELEASE_BOT, 'Release bot')]]);
    const server = createServer(rows);
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });
    const release = mounted(() => createBotIdentity(() => RELEASE_BOT));
    await vi.waitFor(() => expect(release.data()?.name).toBe('Release bot'));

    // Renamed while the socket was down.
    rows.set(RELEASE_BOT, bot(RELEASE_BOT, 'Deployer'));
    createBotUpdatesHandler(client).reconnect();

    await vi.waitFor(() => expect(release.data()?.name).toBe('Deployer'));
    expect(server.requests).toEqual([[RELEASE_BOT], [RELEASE_BOT]]);
  });

  it('refreshes the REST bot lists settings and the mention menu still read', () => {
    client = createClient({
      url: '/graphql',
      exchanges: [createServer(new Map()).exchange],
    });
    testQueryClient.setQueryData(agentKeys.list.queryKey, []);
    testQueryClient.setQueryData(botKeys.list.queryKey, []);
    testQueryClient.setQueryData(botKeys.detail(RELEASE_BOT).queryKey, {});
    testQueryClient.setQueryData(
      channelKeys.channelBots('channel-1').queryKey,
      []
    );

    createBotUpdatesHandler(client).onResult(
      pushed([bot(RELEASE_BOT, 'Shipper')], true)
    );

    for (const queryKey of [
      agentKeys.list.queryKey,
      botKeys.list.queryKey,
      botKeys.detail(RELEASE_BOT).queryKey,
      channelKeys.channelBots('channel-1').queryKey,
    ]) {
      expect(testQueryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
  });
});
