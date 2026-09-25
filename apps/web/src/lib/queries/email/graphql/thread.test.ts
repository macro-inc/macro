import type { EmailThreadPageQuery } from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const cacheEnabledMock = vi.hoisted(() => vi.fn(() => true));
const deleteRecordsMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query: queryMock }),
  getGraphqlCacheHost: () => ({ deleteRecords: deleteRecordsMock }),
  graphqlCacheEnabled: cacheEnabledMock,
}));

const liveNetwork = { __macroNormalizedCache: { source: 'live-network' } };
const missingThreadPage: EmailThreadPageQuery = {
  user: { id: 'user-1', emailThread: null },
};

import { EmailThreadPageDocument } from '@service-storage/graphql/generated/graphql';
import { fetchGraphqlEmailThread } from './thread';

const cachedPage: EmailThreadPageQuery = {
  user: {
    id: 'user-1',
    emailThread: {
      __typename: 'GraphqlSoupEmailThread',
      id: 'thread-1',
      providerId: 'provider-thread-1',
      linkId: 'link-1',
      inboxVisible: true,
      isRead: false,
      projectId: null,
      latestInboundMessageTs: '2026-08-06T12:00:00Z',
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-06T12:02:00Z',
      viewerPermission: {
        __typename: 'GraphqlAccessLevelPermission',
        accessLevel: 'OWNER',
      },
      labels: [],
      messages: [],
    },
  },
};

describe('fetchGraphqlEmailThread', () => {
  beforeEach(() => {
    queryMock.mockReset();
    deleteRecordsMock.mockClear();
    cacheEnabledMock.mockReset();
    cacheEnabledMock.mockReturnValue(true);
  });

  it('evicts a thread the server reports missing from the local cache', async () => {
    queryMock.mockReturnValueOnce({
      toPromise: async () => ({
        data: missingThreadPage,
        extensions: liveNetwork,
      }),
    });

    await expect(fetchGraphqlEmailThread('thread-1')).rejects.toMatchObject({
      errors: [{ code: 'NOT_FOUND' }],
    });
    expect(deleteRecordsMock).toHaveBeenCalledWith([
      'GraphqlSoupEmailThread:thread-1',
    ]);
  });

  it('keeps the local thread when only the cache answered without it', async () => {
    queryMock
      .mockReturnValueOnce({
        toPromise: async () => ({
          error: new CombinedError({ networkError: new Error('offline') }),
        }),
      })
      .mockReturnValueOnce({
        toPromise: async () => ({
          data: missingThreadPage,
          extensions: {
            __macroNormalizedCache: { source: 'normalized-cache-hit' },
          },
        }),
      });

    await expect(fetchGraphqlEmailThread('thread-1')).rejects.toMatchObject({
      errors: [{ code: 'NOT_FOUND' }],
    });
    expect(deleteRecordsMock).not.toHaveBeenCalled();
  });

  it('falls back to the persisted operation after a network failure', async () => {
    queryMock
      .mockReturnValueOnce({
        toPromise: async () => ({
          error: new CombinedError({ networkError: new Error('offline') }),
        }),
      })
      .mockReturnValueOnce({
        toPromise: async () => ({ data: cachedPage }),
      });

    await expect(fetchGraphqlEmailThread('thread-1')).resolves.toMatchObject({
      db_id: 'thread-1',
      provider_id: 'provider-thread-1',
      access_level: 'owner',
    });

    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      EmailThreadPageDocument,
      { threadId: 'thread-1', offset: 0, limit: 20 },
      { requestPolicy: 'cache-and-network' }
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      EmailThreadPageDocument,
      { threadId: 'thread-1', offset: 0, limit: 20 },
      { requestPolicy: 'cache-only' }
    );
  });

  it('skips the persisted fallback while the cache is inactive', async () => {
    cacheEnabledMock.mockReturnValue(false);
    queryMock.mockReturnValueOnce({
      toPromise: async () => ({
        error: new CombinedError({ networkError: new Error('offline') }),
      }),
    });

    await expect(fetchGraphqlEmailThread('thread-1')).rejects.toMatchObject({
      errors: [{ code: 'UNKNOWN', message: 'offline' }],
    });
    expect(queryMock).toHaveBeenCalledOnce();
  });

  it('surfaces a typed error when the thread was not persisted', async () => {
    const networkError = new CombinedError({
      networkError: new Error('offline'),
    });
    queryMock
      .mockReturnValueOnce({
        toPromise: async () => ({ error: networkError }),
      })
      .mockReturnValueOnce({
        toPromise: async () => ({}),
      });

    await expect(fetchGraphqlEmailThread('thread-1')).rejects.toMatchObject({
      errors: [{ code: 'UNKNOWN', message: 'offline' }],
    });

    // The persisted fallback was attempted before giving up.
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      EmailThreadPageDocument,
      { threadId: 'thread-1', offset: 0, limit: 20 },
      { requestPolicy: 'cache-only' }
    );
  });
});
