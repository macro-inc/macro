import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { parseCacheRevision } from '@graphql-cache/protocol';
import type {
  BotFieldsFragment,
  BotIdentitiesQuery,
  BotUpdatesSubscription,
  MentionableBotsQuery,
} from '@service-storage/graphql/generated/graphql';
import { QueryClient } from '@tanstack/solid-query';
import {
  type Client,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { map, pipe } from 'wonka';
import { agentKeys } from '../agents/keys';
import { channelKeys } from '../channel/keys';
import { botKeys } from './keys';
import { useLiveRestBots } from './live-rest-bots';

let testQueryClient: QueryClient;
let client: Client;
let realtime = true;

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => client,
  graphqlSoupRealtimeActive: () => realtime,
}));

import { createBotUpdatesHandler } from './bot-updates';
import {
  handleBotProfileChanged,
  recoverGatewayBotProfiles,
} from './gateway-profile-bridge';
import {
  createBotIdentities,
  createBotIdentity,
  createMentionableBots,
} from './graphql-bots';

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

/**
 * The server: answers `user.bots` from `rows` and `mentionableBots` with the
 * `mentionable` ids, and records every request.
 */
function createServer(
  rows: Map<string, BotFieldsFragment>,
  mentionable: string[] = []
) {
  const requests: string[][] = [];
  const listRequests: (string | null)[] = [];
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      map((operation: Operation): OperationResult => {
        const variables = operation.variables as {
          ids?: string[];
          channelId?: string | null;
        };
        if (variables.ids === undefined) {
          if (operation.kind === 'query')
            listRequests.push(variables.channelId ?? null);
          const data: MentionableBotsQuery = {
            user: {
              id: 'viewer',
              mentionableBots: mentionable.flatMap((id) => rows.get(id) ?? []),
            },
          };
          return { operation, data, stale: false, hasNext: false };
        }
        const ids = variables.ids;
        if (operation.kind === 'query') requests.push(ids);
        const data: BotIdentitiesQuery = {
          user: {
            id: 'viewer',
            bots: ids.flatMap((id) => rows.get(id) ?? []),
          },
        };
        return { operation, data, stale: false, hasNext: false };
      })
    );
  return { requests, listRequests, exchange };
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
  realtime = true;
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  realtime = false;
  recoverGatewayBotProfiles();
  testQueryClient.clear();
});

describe('createBotIdentity', () => {
  it('reads every mounted bot in one request and shows the payload copy until it answers', async () => {
    const server = createServer(
      new Map([
        [RELEASE_BOT, bot(RELEASE_BOT, 'Shipper')],
        [REVIEW_BOT, bot(REVIEW_BOT, 'Reviewer')],
      ])
    );
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });

    const release = mounted(() =>
      createBotIdentity(
        () => RELEASE_BOT,
        () => ({ name: 'Release bot' })
      )
    );
    const review = mounted(() => createBotIdentity(() => REVIEW_BOT));

    expect(release.data()?.name).toBe('Release bot');
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

  it('refreshes the settings lists on every change, and channel bot lists only on a deletion', () => {
    client = createClient({
      url: '/graphql',
      exchanges: [createServer(new Map()).exchange],
    });
    const channelBotsKey = channelKeys.channelBots('channel-1').queryKey;
    testQueryClient.setQueryData(agentKeys.list.queryKey, []);
    testQueryClient.setQueryData(botKeys.list.queryKey, []);
    testQueryClient.setQueryData(botKeys.detail(RELEASE_BOT).queryKey, {});
    testQueryClient.setQueryData(channelBotsKey, []);
    const handler = createBotUpdatesHandler(client);

    handler.onResult(pushed([bot(RELEASE_BOT, 'Shipper')], true));

    for (const queryKey of [
      agentKeys.list.queryKey,
      botKeys.list.queryKey,
      botKeys.detail(RELEASE_BOT).queryKey,
    ]) {
      expect(testQueryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    // A channel's rows read the bot's name from its identity; only who is
    // in the channel comes from this list.
    expect(testQueryClient.getQueryState(channelBotsKey)?.isInvalidated).toBe(
      false
    );

    handler.onResult(
      pushed(
        [{ ...bot(RELEASE_BOT, 'Shipper'), deletedAt: '2026-11-17T00:00:00Z' }],
        true
      )
    );
    expect(testQueryClient.getQueryState(channelBotsKey)?.isInvalidated).toBe(
      true
    );
  });
});

describe('gateway bot_profile_changed bridge', () => {
  const change = {
    id: RELEASE_BOT,
    name: 'Shipper',
    avatar_url: 'https://static.example/shipper.png',
    deleted_at: null,
    owner: { type: 'user', user_id: 'macro|owner@example.com' },
  };

  it('applies the pushed profile on a client without the Soup websocket', async () => {
    realtime = false;
    const rows = new Map([[RELEASE_BOT, bot(RELEASE_BOT, 'Release bot')]]);
    const server = createServer(rows);
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });
    const release = mounted(() => createBotIdentity(() => RELEASE_BOT));
    await vi.waitFor(() => expect(release.data()?.name).toBe('Release bot'));

    handleBotProfileChanged(change);

    expect(release.data()).toMatchObject({
      name: 'Shipper',
      handle: 'release-bot',
      avatarUrl: 'https://static.example/shipper.png',
    });
    expect(server.requests).toEqual([[RELEASE_BOT]]);
  });

  it('drops gateway profiles and reads again when the gateway reconnects', async () => {
    realtime = false;
    const rows = new Map([[RELEASE_BOT, bot(RELEASE_BOT, 'Release bot')]]);
    const server = createServer(rows);
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });
    const release = mounted(() => createBotIdentity(() => RELEASE_BOT));
    await vi.waitFor(() => expect(release.data()?.name).toBe('Release bot'));
    handleBotProfileChanged(change);

    rows.set(RELEASE_BOT, bot(RELEASE_BOT, 'Deployer'));
    recoverGatewayBotProfiles();

    await vi.waitFor(() => expect(release.data()?.name).toBe('Deployer'));
    expect(server.requests).toEqual([[RELEASE_BOT], [RELEASE_BOT]]);
  });

  it('is ignored where botUpdates delivers the change', async () => {
    const rows = new Map([[RELEASE_BOT, bot(RELEASE_BOT, 'Release bot')]]);
    client = createClient({
      url: '/graphql',
      exchanges: [createServer(rows).exchange],
    });
    const release = mounted(() => createBotIdentity(() => RELEASE_BOT));
    await vi.waitFor(() => expect(release.data()?.name).toBe('Release bot'));

    handleBotProfileChanged(change);

    expect(release.data()?.name).toBe('Release bot');
  });
});

describe('createMentionableBots', () => {
  const NEW_BOT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

  function mountList(rows: Map<string, BotFieldsFragment>, ids: string[]) {
    const server = createServer(rows, ids);
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });
    const list = mounted(() => createMentionableBots(() => 'channel-1'));
    return { server, list };
  }

  it('lists the channel scope and keeps it through a rename the cache applied', async () => {
    const rows = new Map([[RELEASE_BOT, bot(RELEASE_BOT, 'Release bot')]]);
    const { server, list } = mountList(rows, [RELEASE_BOT]);
    await vi.waitFor(() =>
      expect(list.bots().map((row) => row.name)).toEqual(['Release bot'])
    );

    createBotUpdatesHandler(client).onResult(
      pushed([bot(RELEASE_BOT, 'Shipper')], true)
    );

    await Promise.resolve();
    expect(server.listRequests).toEqual(['channel-1']);
  });

  it('reads again for a bot it lacks, and for a deletion', async () => {
    const rows = new Map([[RELEASE_BOT, bot(RELEASE_BOT, 'Release bot')]]);
    const ids = [RELEASE_BOT];
    const { server, list } = mountList(rows, ids);
    await vi.waitFor(() => expect(list.bots()).toHaveLength(1));
    const handler = createBotUpdatesHandler(client);

    rows.set(NEW_BOT, bot(NEW_BOT, 'Newcomer'));
    ids.push(NEW_BOT);
    handler.onResult(pushed([bot(NEW_BOT, 'Newcomer')], true));
    await vi.waitFor(() =>
      expect(list.bots().map((row) => row.name)).toEqual([
        'Release bot',
        'Newcomer',
      ])
    );

    ids.splice(0, 1);
    handler.onResult(
      pushed(
        [
          {
            ...bot(RELEASE_BOT, 'Release bot'),
            deletedAt: '2026-11-17T00:00:00Z',
          },
        ],
        true
      )
    );
    await vi.waitFor(() =>
      expect(list.bots().map((row) => row.name)).toEqual(['Newcomer'])
    );
    expect(server.listRequests).toHaveLength(3);
  });

  it('reads again on reconnect', async () => {
    const rows = new Map([[RELEASE_BOT, bot(RELEASE_BOT, 'Release bot')]]);
    const { server, list } = mountList(rows, [RELEASE_BOT]);
    await vi.waitFor(() => expect(list.bots()).toHaveLength(1));

    createBotUpdatesHandler(client).reconnect();

    await vi.waitFor(() => expect(server.listRequests).toHaveLength(2));
  });
});

describe('createBotIdentities', () => {
  it('reads the identities of ids another list supplies, in one request', async () => {
    const rows = new Map([
      [RELEASE_BOT, bot(RELEASE_BOT, 'Shipper')],
      [REVIEW_BOT, bot(REVIEW_BOT, 'Reviewer')],
    ]);
    const server = createServer(rows);
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });

    const identity = mounted(() =>
      createBotIdentities(() => [RELEASE_BOT, REVIEW_BOT, RELEASE_BOT])
    );

    await vi.waitFor(() => expect(identity(REVIEW_BOT)?.name).toBe('Reviewer'));
    expect(identity(RELEASE_BOT)?.name).toBe('Shipper');
    expect(server.requests).toEqual([[RELEASE_BOT, REVIEW_BOT]]);
  });
});

describe('useLiveRestBots', () => {
  it('renames a REST-listed bot from a push without refetching the list', async () => {
    const rows = new Map([[RELEASE_BOT, bot(RELEASE_BOT, 'Release bot')]]);
    const server = createServer(rows);
    client = createClient({ url: '/graphql', exchanges: [server.exchange] });
    const restRows = [
      {
        id: RELEASE_BOT,
        name: 'Release bot',
        handle: 'release-bot',
        avatar_url: null,
        description: 'Ships things',
      },
    ];
    const bots = mounted(() => useLiveRestBots(() => restRows));
    expect(bots()[0]?.name).toBe('Release bot');
    await vi.waitFor(() => expect(server.requests).toHaveLength(1));

    rows.set(RELEASE_BOT, bot(RELEASE_BOT, 'Shipper'));
    createBotUpdatesHandler(client).onResult(
      pushed([bot(RELEASE_BOT, 'Shipper')], false)
    );

    await vi.waitFor(() => expect(bots()[0]?.name).toBe('Shipper'));
    expect(bots()[0]?.description).toBe('Ships things');
  });
});
