import type { EmailThreadPageQuery } from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const hostMock = vi.hoisted(() => vi.fn(() => undefined as unknown));
const cacheEnabledMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query: queryMock }),
  graphqlCacheEnabled: cacheEnabledMock,
  getGraphqlCacheHost: hostMock,
}));

import { EmailThreadPageDocument } from '@service-storage/graphql/generated/graphql';
import { fetchGraphqlEmailThread } from './thread';

const cachedPage: EmailThreadPageQuery = {
  user: {
    id: 'user-1',
    emailThread: {
      __typename: 'GraphqlSoupEmailThread',
      ownerId: 'user-1',
      entityType: 'EMAIL_THREAD',
      cacheProjection: null,
      displayName: null,
      emailName: null,
      snippet: null,
      senderEmail: null,
      senderName: null,
      senderPhotoUrl: null,
      isDraft: false,
      isSignal: false,
      isImportant: false,
      isFavorited: false,
      sortTs: '2026-08-06T12:00:00Z',
      viewedAt: null,
      frecencyScore: null,
      mailAllPreview: null,
      mailDraftPreview: null,
      mailSentPreview: null,
      mailDraftState: null,
      participants: [],
      attachments: [],
      properties: [],
      notifications: [],

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
    hostMock.mockReturnValue(undefined);
    cacheEnabledMock.mockReset();
    cacheEnabledMock.mockReturnValue(true);
  });

  it.each([false, true])(
    'resolves the durable local route before querying (queued=%s)',
    async (pending) => {
      hostMock.mockReturnValue({
        readRecordsByKeys: vi.fn(async () => ({
          revision: '1',
          records: [
            {
              recordKey: 'GraphqlSoupEmailThread:local-thread',
              record: { id: 'thread-1' },
              identity: { pending, mutationUuid: 'draft' },
            },
          ],
        })),
      });
      queryMock.mockReturnValue({
        toPromise: async () => ({ data: cachedPage }),
      });
      await expect(
        fetchGraphqlEmailThread('local-thread')
      ).resolves.toMatchObject({ db_id: 'thread-1' });
      expect(queryMock).toHaveBeenCalledWith(
        EmailThreadPageDocument,
        { threadId: 'thread-1', offset: 0, limit: 20 },
        { requestPolicy: pending ? 'cache-only' : 'cache-and-network' }
      );
      expect(queryMock).toHaveBeenCalledOnce();
    }
  );

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
