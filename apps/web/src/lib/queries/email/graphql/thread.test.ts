import type {
  EmailThreadPageQuery,
  EmailThreadPageQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  CombinedError,
  type GraphQLRequest,
  makeOperation,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject } from 'wonka';

const queryMock = vi.hoisted(() => vi.fn());
const executeQueryMock = vi.hoisted(() => vi.fn());
const hostMock = vi.hoisted(() => vi.fn(() => undefined as unknown));
const cacheEnabledMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({
    query: queryMock,
    executeQuery: executeQueryMock,
  }),
  graphqlCacheEnabled: cacheEnabledMock,
  getGraphqlCacheHost: hostMock,
}));

import { EmailThreadPageDocument } from '@service-storage/graphql/generated/graphql';
import {
  createGraphqlEmailThreadQuery,
  fetchGraphqlEmailThread,
} from './thread';

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

it('exposes the resolved identity across queue settlement without confusing a different route', async () => {
  let canonical = 'local-thread';
  let changed = () => {};
  const unsubscribe = vi.fn();
  cacheEnabledMock.mockReturnValue(true);
  hostMock.mockReturnValue({
    readRecordsByKeys: vi.fn(async () => ({
      revision: '1',
      records: [
        {
          recordKey: `GraphqlSoupEmailThread:${canonical}`,
          record: { id: canonical },
          identity: {
            pending: canonical === 'local-thread',
            mutationUuid: 'draft',
          },
        },
      ],
    })),
    onCacheChanged: (callback: () => void) => {
      changed = callback;
      return unsubscribe;
    },
  });
  const executions: Array<{ id: string; emit(id: string): void }> = [];
  executeQueryMock.mockImplementation(
    (
      request: GraphQLRequest<
        EmailThreadPageQuery,
        EmailThreadPageQueryVariables
      >,
      context: Partial<OperationContext>
    ) => {
      const stream = makeSubject<OperationResult<EmailThreadPageQuery>>();
      const operation = makeOperation('query', request, {
        url: '/graphql',
        requestPolicy: 'cache-first',
        ...context,
      });
      executions.push({
        id: String(request.variables.threadId),
        emit: (id) =>
          stream.next({
            operation,
            stale: false,
            hasNext: false,
            data: {
              user: {
                ...cachedPage.user,
                emailThread: { ...cachedPage.user.emailThread!, id },
              },
            },
          }),
      });
      return stream.source;
    }
  );
  const [route, setRoute] = createSignal('local-thread');
  const root = createRoot((dispose) => ({
    dispose,
    ...createGraphqlEmailThreadQuery(route, () => ({ enabled: true })),
  }));
  try {
    await vi.waitFor(() => expect(executions).toHaveLength(1));
    expect(executions[0].id).toBe('local-thread');
    executions[0].emit('local-thread');
    expect(root.query.data?.pages[0].db_id).toBe('local-thread');
    canonical = 'server-thread';
    changed();
    await vi.waitFor(() => expect(executions).toHaveLength(2));
    expect(root.resolvedThreadId()).toBe('server-thread');
    expect(executions[1].id).toBe('server-thread');
    executions[1].emit('server-thread');
    expect(root.query.data?.pages[0].db_id).toBe('server-thread');

    canonical = 'other-thread';
    setRoute('other-thread');
    expect(root.resolvedThreadId()).toBe('other-thread');
    await vi.waitFor(() => expect(executions).toHaveLength(3));
    expect(root.query.data).toBeUndefined();
    executions[2].emit('other-thread');
    expect(root.query.data?.pages[0].db_id).toBe('other-thread');
  } finally {
    root.dispose();
  }
  expect(unsubscribe).toHaveBeenCalledOnce();
});
