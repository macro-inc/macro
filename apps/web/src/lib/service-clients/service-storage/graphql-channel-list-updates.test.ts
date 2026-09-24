import {
  optimisticContextOf,
  withOptimisticMutationDisposition,
} from '@graphql-cache/exchange/optimistic';
import type { Client, Operation } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGraphqlSoupRevalidations } from '../../queries/soup/graphql/active-queries';
import {
  ChannelListSoupDocument,
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
  const query = vi.fn(() => ({ toPromise: async () => ({ data: {} }) }));
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

describe('channel unread edge revalidation', () => {
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
