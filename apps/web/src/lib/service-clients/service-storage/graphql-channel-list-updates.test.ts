import {
  optimisticContextOf,
  withOptimisticMutationDisposition,
} from '@graphql-cache/exchange/optimistic';
import type { CacheHost } from '@graphql-cache/host/types';
import { parseCacheRevision } from '@graphql-cache/protocol';
import type { Client, Operation } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGraphqlSoupRevalidations } from '../../queries/soup/graphql/active-queries';
import {
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  SoupDocument,
} from './graphql/generated/graphql';
import { createChannelListUpdatesHandler } from './graphql-channel-list-updates';
import type { GraphqlNotificationPatch } from './graphql-soup-websocket';
import { executeGraphqlUpdateNotifications } from './graphql-update-notifications';

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
  const handler = createChannelListUpdatesHandler({ query } as unknown as Pick<
    Client,
    'query'
  >);
  cleanup.push(handler.dispose);
  return { handler, query };
}

const deleted: GraphqlNotificationPatch = {
  __typename: 'GraphqlCacheDeletion',
  graphqlTypeName: 'GraphqlNotification',
  entityId: 'one',
};

const newNotification: GraphqlNotificationPatch = {
  __typename: 'GraphqlNewNotification',
  notification: {
    id: 'new',
    entityType: 'CHANNEL',
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
  const { query } = setup();
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
    { query } as unknown as Client,
    host as unknown as CacheHost
  );
  cleanup.push(handler.dispose);
  return { handler, query, host, writeResult };
}

describe('channel unread edge revalidation', () => {
  it('writes delivered unread evidence locally before starting background reconciliation', async () => {
    const { handler, query, host } = setupCached();
    await handler.onPatch(newNotification);
    expect(host.writeQuery).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(299);
    expect(query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledOnce();
  });

  it('falls back immediately if a local cache write fails', async () => {
    const { handler, query, host } = setupCached();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    host.writeQuery.mockRejectedValue(new Error('cache unavailable'));
    await handler.onPatch(newNotification);
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
    host.onCacheGenerationChanged.mock.calls[0][0]({ storage: 'reset' });
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
  it('refreshes channel dots and the Chat badge immediately on a new notification', async () => {
    const { handler, query } = setup();
    cleanup.push(
      registerGraphqlSoupRevalidations(() => [
        { document: ChannelUnreadPresenceDocument, variables: { input: {} } },
      ])
    );
    handler.onPatch(newNotification);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.map(([document]) => document)).toEqual([
      ChannelListSoupDocument,
      ChannelUnreadPresenceDocument,
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('replaces a pending debounce with an immediate new-notification refresh', async () => {
    const { handler, query } = setup();
    handler.onPatch(deleted);
    await vi.advanceTimersByTimeAsync(100);
    expect(query).not.toHaveBeenCalled();
    handler.onPatch(newNotification);
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
    handler.onPatch(newNotification);
    handler.onPatch(newNotification);
    handler.onPatch(deleted);
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledOnce();
    finish?.();
    await vi.advanceTimersByTimeAsync(299);
    expect(query).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps new-notification refreshes deferred while hidden', async () => {
    const { handler, query } = setup();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    handler.onPatch(newNotification);
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).not.toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(301);
    expect(query).toHaveBeenCalledOnce();
  });

  it('persists bounded revalidations with queued notification writes', async () => {
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
    const context = optimisticContextOf({
      context: mutation.mock.calls[0][2],
    } as Operation);
    expect(context?.revalidations).toHaveLength(1);
    expect(context?.revalidations[0].operationName).toBe('ChannelListSoup');
    expect(context?.revalidations[0].query).toMatch(/limit:\s*1/);
    expect(query).not.toHaveBeenCalled();
  });
  it('coalesces updates into bounded-query refreshes, never full history', async () => {
    const { handler, query } = setup();
    handler.onPatch(deleted);
    handler.onPatch(deleted);
    handler.reconnect();
    await vi.advanceTimersByTimeAsync(301);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]).toEqual([
      ChannelListSoupDocument,
      { input: { initial: { limit: 100 } } },
      { requestPolicy: 'network-only' },
    ]);
  });

  it('defers hidden-tab work and cancels scheduled work on disposal', async () => {
    const { handler, query } = setup();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    handler.onPatch(deleted);
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).not.toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(301);
    expect(query).toHaveBeenCalledOnce();
    handler.reconnect();
    handler.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledOnce();
  });
});
