import {
  networkRevalidationExchange,
  networkRevalidationIncomplete,
  registerNetworkRevalidation,
} from '@graphql-cache/exchange/network-revalidation-exchange';
import { withOptimisticMutationDisposition } from '@graphql-cache/exchange/optimistic';
import type { CacheHost } from '@graphql-cache/host/types';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import {
  type Client,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';
import {
  channelNotificationRefresh,
  disposeChannelNotificationRefresh,
} from '../../queries/channel/notification-refresh';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '../../queries/soup/graphql/active-queries';
import {
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  SoupDocument,
  type SoupUpdatesSubscription,
} from './graphql/generated/graphql';
import { createChannelListUpdatesHandler } from './graphql-channel-list-updates';
import type { GraphqlNotificationPatch } from './graphql-soup-websocket';
import {
  executeGraphqlUpdateNotifications,
  executeGraphqlUpdateNotificationsForEntities,
} from './graphql-update-notifications';

let cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  for (const dispose of cleanup) dispose();
  cleanup = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup() {
  const query = vi.fn(
    (_document: unknown, _variables: unknown, _context: unknown) => ({
      toPromise: async () => ({ data: {} }),
    })
  );
  cleanup.push(
    registerGraphqlSoupRevalidations(() => [
      {
        document: ChannelListSoupDocument,
        variables: { input: { initial: { limit: 100 } } },
      },
      {
        document: SoupDocument,
        variables: { input: { initial: { limit: 100 } } },
      },
    ])
  );
  const client = { query } as unknown as Client;
  const coordinator = channelNotificationRefresh(client);
  cleanup.push(
    coordinator.register(
      {
        document: ChannelListSoupDocument,
        variables: { input: { initial: { limit: 100 } } },
      },
      { enabled: true, fetching: false, filtered: true, notificationIds: [] }
    )
  );
  cleanup.push(() => disposeChannelNotificationRefresh(client));
  const handler = createChannelListUpdatesHandler(client);
  cleanup.push(handler.dispose);
  return { handler, query, client, coordinator };
}

const deleted: GraphqlNotificationPatch = {
  __typename: 'GraphqlCacheDeletion',
  graphqlTypeName: 'GraphqlNotification',
  entityId: 'one',
};

const newNotification: GraphqlNotificationPatch = {
  __typename: 'GraphqlNewNotification',
  notification: {
    __typename: 'GraphqlNotification',
    id: 'new',
    entityType: 'CHANNEL',
    targetEntityType: 'CHANNEL',
    entityId: 'channel',
    eventType: 'channel_message_send',
    state: 'UNSEEN',
    sent: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    viewedAt: null,
    senderId: 'sender',
    metadata: {
      __typename: 'GraphqlChannelMessageSendMetadata',
      channelMessageSendSender: 'sender',
      channelMessageSendMessageId: 'message',
      channelMessageSendChannelType: 'PRIVATE',
      channelMessageSendMessageContent: 'Hello',
      channelMessageSendHasAttachments: false,
      channelMessageSendSenderDisplayName: null,
      channelMessageSendChannelName: 'Channel',
      channelMessageSendSenderProfilePictureUrl: null,
    },
  },
};

function setupCached() {
  const { query, client, coordinator } = setup();
  const writeResult = {
    revision: parseCacheRevision('1'),
    revisionAdvanced: true,
    changed: [],
    affectedOps: [],
    reset: false,
  };
  const host = {
    writeQuery: vi.fn<CacheHost['writeQuery']>().mockResolvedValue(writeResult),
    readQuery: vi
      .fn<CacheHost['readQuery']>()
      .mockResolvedValue({ kind: 'miss' }),
    onCacheGenerationChanged: vi.fn<CacheHost['onCacheGenerationChanged']>(
      () => () => {}
    ),
  };
  const handler = createChannelListUpdatesHandler(
    client,
    host as unknown as CacheHost
  );
  cleanup.push(handler.dispose);
  return { handler, query, host, writeResult, coordinator };
}

describe('channel unread edge revalidation', () => {
  it('does not replay queued notification frames into a new session generation', async () => {
    const { handler, host, writeResult } = setupCached();
    const entered = Promise.withResolvers<void>();
    const held = Promise.withResolvers<typeof writeResult>();
    const generation = cacheSessionGeneration.capture();
    host.writeQuery.mockImplementationOnce(() => {
      entered.resolve();
      return held.promise;
    });
    const first = handler.onPatch(newNotification);
    const second = handler.onPatch(newNotification);
    await entered.promise;
    await cacheSessionGeneration.transition(async () => {});
    held.resolve(writeResult);
    await Promise.all([first, second]);
    expect(host.writeQuery).toHaveBeenCalledOnce();
    expect(host.writeQuery).toHaveBeenCalledWith(
      expect.objectContaining({ generation })
    );
  });

  it('writes delivered unread evidence locally before starting background reconciliation', async () => {
    const { handler, query, host } = setupCached();
    await handler.onPatch(newNotification);
    expect(host.writeQuery).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(99);
    expect(query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledOnce();
  });

  it('reconciles even if a local cache write fails', async () => {
    const { handler, query, host } = setupCached();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    host.writeQuery.mockRejectedValue(new Error('cache unavailable'));
    await handler.onPatch(newNotification);
    await vi.advanceTimersByTimeAsync(100);
    expect(query).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('serializes deliveries and drops queued patches after cache replacement', async () => {
    const { handler, host, writeResult } = setupCached();
    let finish: (() => void) | undefined;
    host.writeQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(writeResult);
        })
    );
    const first = handler.onPatch(newNotification);
    const second = handler.onPatch(newNotification);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.writeQuery).toHaveBeenCalledOnce();
    host.onCacheGenerationChanged.mock.calls[0][0]({
      storage: 'reset',
      queue: 'reset',
    });
    finish?.();
    await Promise.all([first, second]);
    expect(host.writeQuery).toHaveBeenCalledOnce();
  });

  it('does not start cache or network work after disposal', async () => {
    const { handler, host, query } = setupCached();
    handler.dispose();
    await handler.onPatch(newNotification);
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.writeQuery).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it('batches refreshes for channel dots and the Chat badge', async () => {
    const { handler, query, coordinator } = setup();
    cleanup.push(
      coordinator.register(
        { document: ChannelUnreadPresenceDocument, variables: { input: {} } },
        { enabled: true, fetching: false, filtered: true, notificationIds: [] }
      )
    );
    cleanup.push(
      registerGraphqlSoupRevalidations(() => [
        { document: ChannelUnreadPresenceDocument, variables: { input: {} } },
      ])
    );
    await handler.onPatch(newNotification);
    await vi.advanceTimersByTimeAsync(100);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.map(([document]) => document)).toEqual([
      ChannelListSoupDocument,
      ChannelUnreadPresenceDocument,
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('coalesces new notifications with pending deletions', async () => {
    const { handler, query } = setup();
    await handler.onPatch(deleted);
    await vi.advanceTimersByTimeAsync(50);
    expect(query).not.toHaveBeenCalled();
    await handler.onPatch(newNotification);
    await vi.advanceTimersByTimeAsync(50);
    expect(query).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledOnce();
  });

  it('coalesces a burst during the leading refresh into one trailing refresh', async () => {
    const { handler, query } = setup();
    let finish: (() => void) | undefined;
    const pending = new Promise<{ data: object }>((resolve) => {
      finish = () => resolve({ data: {} });
    });
    query.mockImplementationOnce(() => ({ toPromise: () => pending }));
    await handler.onPatch(newNotification);
    await vi.advanceTimersByTimeAsync(100);
    await handler.onPatch(newNotification);
    await handler.onPatch(deleted);
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledOnce();
    finish?.();
    await vi.advanceTimersByTimeAsync(99);
    expect(query).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps new-notification refreshes deferred while hidden', async () => {
    const { handler, query } = setup();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await handler.onPatch(newNotification);
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).not.toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(301);
    expect(query).toHaveBeenCalledOnce();
  });

  it('passes bounded revalidations to the local resolver for queued notification writes', async () => {
    const { query } = setup();
    const mutation = vi.fn((_document, _variables, context) => ({
      toPromise: async () =>
        withOptimisticMutationDisposition(
          {
            operation: { context } as Operation,
            data: { updateNotifications: [] },
            stale: false,
            hasNext: false,
          },
          { kind: 'queued', transactionId: 'pending' }
        ),
    }));
    await executeGraphqlUpdateNotifications(
      { mutation, query } as unknown as Client,
      {
        notificationIds: ['one'],
        operation: 'MARK_SEEN',
      }
    );
    expect(mutation.mock.calls[0][2].optimisticMutation.revalidations).toEqual([
      {
        document: ChannelListSoupDocument,
        variables: { input: { initial: { limit: 100 } } },
      },
    ]);
    expect(query).not.toHaveBeenCalled();
  });

  it('reads channel lists after a queued write whose exchange read failed', async () => {
    cleanup.push(
      registerGraphqlSoupRevalidations(() => [
        {
          document: ChannelListSoupDocument,
          variables: { input: { initial: { limit: 100 } } },
        },
      ])
    );
    const channelReads = vi.fn();
    // A disabled host: the queue commits the write, the exchange reads.
    const server: Exchange = () => (operations$) =>
      pipe(
        operations$,
        filter((operation) => operation.kind !== 'teardown'),
        map((operation): OperationResult => {
          if (operation.kind === 'query') {
            channelReads();
            return { operation, data: {}, stale: false, hasNext: false };
          }
          return withOptimisticMutationDisposition(
            {
              operation,
              data: { updateNotifications: [] },
              stale: false,
              hasNext: false,
            },
            { kind: 'committed' }
          );
        })
      );
    const client = createClient({
      url: 'http://graphql.test',
      exchanges: [networkRevalidationExchange(), server],
    });
    // A mounted list whose read fails.
    cleanup.push(
      registerNetworkRevalidation(client, {
        active: () => true,
        gone: () => false,
        revalidate: () => Promise.reject(new Error('offline')),
      })
    );

    const result = await executeGraphqlUpdateNotifications(client, {
      notificationIds: ['one'],
      operation: 'MARK_DONE',
    });

    expect(networkRevalidationIncomplete(result)).toBe(true);
    expect(channelReads).toHaveBeenCalledOnce();
  });

  it('coalesces updates into bounded-query refreshes, never full history', async () => {
    const { handler, query } = setup();
    await handler.onPatch(deleted);
    await handler.onPatch(deleted);
    handler.reconnect();
    await vi.advanceTimersByTimeAsync(301);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]).toEqual([
      ChannelListSoupDocument,
      { input: { initial: { limit: 100 } } },
      { requestPolicy: 'network-only' },
    ]);
  });

  it('defers hidden-tab work and cancels scheduled work on client disposal', async () => {
    const { handler, query, client } = setup();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await handler.onPatch(deleted);
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).not.toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(301);
    expect(query).toHaveBeenCalledOnce();
    handler.reconnect();
    handler.dispose();
    disposeChannelNotificationRefresh(client);
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledOnce();
  });
});

describe('new channel pushes', () => {
  const channelPush = (
    overrides: { createdAt?: string; isParticipant?: boolean } = {}
  ) =>
    ({
      __typename: 'SoupUpdated',
      item: {
        __typename: 'GraphqlSoupChannel',
        id: 'new-dm',
        channelType: 'direct_message',
        isParticipant: true,
        createdAt: new Date().toISOString(),
        ...overrides,
      },
    }) as SoupUpdatesSubscription['soupUpdates'][number];

  it('asks lists to wait for a channel the viewer was just added to', () => {
    const { handler, coordinator } = setup();
    const expectChannel = vi.spyOn(coordinator, 'expectChannel');

    handler.onSoupUpdates([channelPush()]);

    expect(expectChannel).toHaveBeenCalledExactlyOnceWith({
      id: 'new-dm',
      channelType: 'direct_message',
    });
  });

  it('ignores older channels and channels the viewer is not in', () => {
    const { handler, coordinator } = setup();
    const expectChannel = vi.spyOn(coordinator, 'expectChannel');

    handler.onSoupUpdates([
      channelPush({ createdAt: '2026-01-01T00:00:00Z' }),
      channelPush({ isParticipant: false }),
    ]);

    expect(expectChannel).not.toHaveBeenCalled();
  });
});

/** A client whose exchange reads mounted queries again after each write, and
 * whose one mounted list read succeeds or fails. */
function revalidatingClient(listRead: () => Promise<void>) {
  const server: Exchange = () => (operations$) =>
    pipe(
      operations$,
      filter((operation) => operation.kind !== 'teardown'),
      map((operation): OperationResult => {
        if (operation.kind === 'query')
          return { operation, data: {}, stale: false, hasNext: false };
        return {
          operation,
          data: {
            updateNotifications: [],
            updateNotificationsForEntity: [],
          },
          stale: false,
          hasNext: false,
        };
      })
    );
  const client = createClient({
    url: 'http://graphql.test',
    exchanges: [networkRevalidationExchange(), server],
  });
  cleanup.push(
    registerNetworkRevalidation(client, {
      active: () => true,
      gone: () => false,
      revalidate: listRead,
    })
  );
  const listRefresh = vi.fn(async () => {});
  cleanup.push(
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: listRefresh,
    })
  );
  return { client, listRefresh };
}

describe('a notification write whose exchange read failed', () => {
  const writes = {
    ids: (client: Client) =>
      executeGraphqlUpdateNotifications(client, {
        notificationIds: ['one'],
        operation: 'MARK_DONE',
      }),
    entity: (client: Client) =>
      executeGraphqlUpdateNotificationsForEntities(client, {
        entities: [{ entityId: 'doc', entityType: 'DOCUMENT' }],
        operation: 'MARK_DONE',
      }),
  };

  for (const [name, write] of Object.entries(writes)) {
    it(`reads each mounted list again in its own order (${name})`, async () => {
      const { client, listRefresh } = revalidatingClient(() =>
        Promise.reject(new Error('offline'))
      );
      await write(client);
      expect(listRefresh).toHaveBeenCalledOnce();
    });

    it(`leaves the lists to the exchange when its read succeeded (${name})`, async () => {
      const { client, listRefresh } = revalidatingClient(async () => {});
      await write(client);
      expect(listRefresh).not.toHaveBeenCalled();
    });
  }
});
