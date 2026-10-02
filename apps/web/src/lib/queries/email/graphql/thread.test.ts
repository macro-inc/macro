import type {
  EmailThreadPageQuery,
  EmailThreadPageQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  CombinedError,
  createClient,
  type Exchange,
  fetchExchange,
  type GraphQLRequest,
  makeOperation,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filter, makeSubject, pipe } from 'wonka';

vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => true,
}));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));

const queryMock = vi.hoisted(() => vi.fn());
const executeQueryMock = vi.hoisted(() => vi.fn());
const hostMock = vi.hoisted(() => vi.fn(() => undefined as unknown));
const cacheEnabledMock = vi.hoisted(() => vi.fn(() => true));
const initializeClientMock = vi.hoisted(() => vi.fn());
const activeClientMock = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', () => {
  const client = { query: queryMock, executeQuery: executeQueryMock };
  return {
    getGraphqlSoupClient: () => {
      initializeClientMock();
      return activeClientMock() ?? client;
    },
    graphqlCacheEnabled: cacheEnabledMock,
    getGraphqlCacheHost: hostMock,
  };
});

beforeEach(() => activeClientMock.mockReset());

import { EmailThreadPageDocument } from '@service-storage/graphql/generated/graphql';
import {
  refreshActiveGraphqlSoupQueries,
  registerActiveGraphqlSoupQuery,
} from '../../soup/graphql/active-queries';
import { archiveEmailThread } from '../integration';
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

function threadMessages(offset: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    __typename: 'GraphqlSoupEmailMessage' as const,
    id: `message-${offset + i}`,
    threadId: 'thread-1',
    linkId: 'link-1',
    providerId: null,
    replyingToId: null,
    subject: 'Subject',
    snippet: null,
    internalDateTs: null,
    sentAt: null,
    isRead: true,
    isStarred: false,
    isSent: false,
    isDraft: false,
    hasAttachments: false,
    scheduledSendTime: null,
    from: null,
    to: [],
    cc: [],
    bcc: [],
    labels: [],
    bodyText: null,
    bodyHtmlSanitized: null,
    bodyMacro: null,
    calendarInvitations: [],
    bodyReplyless: null,
    attachments: [],
    attachmentsDraft: [],
    attachmentsForwarded: [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  }));
}

describe('open-thread revalidation without normalized caching', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    vi.restoreAllMocks();
  });

  function setup(
    options: {
      enabled?: () => boolean;
      messageCount?: number;
      cached?: boolean;
      threadId?: string;
      identity?: 'unreadable' | 'local' | 'alias';
      missingHost?: boolean;
    } = {}
  ) {
    initializeClientMock.mockReset();
    cacheEnabledMock.mockReturnValue(options.cached ?? false);
    const readIdentity = vi.fn(async () => {
      if (options.identity === 'unreadable')
        throw new Error('identity unavailable');
      const id =
        options.identity === 'alias'
          ? 'thread-1'
          : (options.threadId ?? 'thread-1');
      return {
        revision: '1',
        records: options.identity
          ? [
              {
                recordKey: `GraphqlSoupEmailThread:${id}`,
                record: {
                  id,
                  cacheProjection:
                    options.identity === 'local' ? null : 'server-capsule',
                },
                identity: { pending: options.identity === 'local' },
              },
            ]
          : [],
      };
    });
    let notifyIdentityChange = () => {};
    hostMock.mockReturnValue(
      options.cached && !options.missingHost
        ? {
            readRecordsByKeys: readIdentity,
            onCacheChanged: (callback: () => void) => {
              notifyIdentityChange = callback;
              return () => {};
            },
          }
        : undefined
    );
    const server = { inboxVisible: false, failThreadRead: false };
    const reads: number[] = [];
    const readIds: string[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        operationName: string;
        variables: {
          threadId?: string;
          offset?: number;
          input?: { threadId: string; archived: boolean };
        };
      };
      const respond = (body: unknown) =>
        new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json' },
        });
      if (body.operationName === 'SetEmailThreadArchived') {
        const { threadId, archived } = body.variables.input!;
        if (threadId === 'thread-1') server.inboxVisible = !archived;
        return respond({
          data: {
            setEmailThreadArchived: {
              __typename: 'GraphqlSoupEmailThread',
              id: threadId,
              inboxVisible: !archived,
            },
          },
        });
      }
      if (body.operationName !== 'EmailThreadPage')
        throw new Error(`Unexpected query ${body.operationName}`);
      const offset = body.variables.offset ?? 0;
      reads.push(offset);
      readIds.push(body.variables.threadId!);
      if (server.failThreadRead)
        return respond({ errors: [{ message: 'thread refresh failed' }] });
      return respond({
        data: {
          user: {
            ...cachedPage.user,
            emailThread: {
              ...cachedPage.user.emailThread!,
              id: body.variables.threadId,
              inboxVisible: server.inboxVisible,
              messages: threadMessages(
                offset,
                Math.min(20, Math.max(0, (options.messageCount ?? 0) - offset))
              ),
            },
          },
        },
      });
    });
    // Model cache-only reads while a cache is active. fetchExchange alone does
    // not enforce this policy, which is why known local drafts must be disabled
    // entirely after the session switches to the fetch-only client.
    const cacheOnlyGuard: Exchange =
      ({ forward }) =>
      (operations) =>
        forward(
          pipe(
            operations,
            filter(
              (operation) =>
                operation.kind !== 'query' ||
                operation.context.requestPolicy !== 'cache-only' ||
                !cacheEnabledMock()
            )
          )
        );
    const client = createClient({
      url: 'http://example.test/graphql',
      preferGetMethod: false,
      exchanges: [cacheOnlyGuard, fetchExchange],
      fetch,
    });
    activeClientMock.mockReturnValue(client);
    let listInboxVisible = false;
    cleanup.push(
      registerActiveGraphqlSoupQuery({
        isEnabled: () => true,
        refresh: async () => {
          listInboxVisible = server.inboxVisible;
        },
      })
    );
    const root = createRoot((dispose) => ({
      dispose,
      ...createGraphqlEmailThreadQuery(
        () => options.threadId ?? 'thread-1',
        () => ({ enabled: options.enabled?.() ?? true })
      ),
    }));
    cleanup.push(root.dispose);
    return {
      ...root,
      server,
      reads,
      readIds,
      readIdentity,
      notifyIdentityChange: () => notifyIdentityChange(),
      listInboxVisible: () => listInboxVisible,
    };
  }

  it('updates an open thread after a list unarchive without a REST-cache wrapper', async () => {
    const f = setup();
    await vi.waitFor(() =>
      expect(f.query.data?.pages[0].inbox_visible).toBe(false)
    );
    await expect(
      archiveEmailThread({ id: 'thread-1', value: false })
    ).resolves.toBe('committed');
    expect(f.listInboxVisible()).toBe(true);
    expect(f.query.data?.pages[0].inbox_visible).toBe(true);
    expect(f.reads).toEqual([0, 0]);
    await archiveEmailThread({ id: 'thread-1', value: true });
    expect(f.query.data?.pages[0].inbox_visible).toBe(false);
  });

  it('refreshes all loaded message pages without resetting pagination', async () => {
    const f = setup({ messageCount: 22 });
    await vi.waitFor(() => expect(f.query.isSuccess).toBe(true));
    await f.query.fetchNextPage();
    expect(f.query.data?.pageParams).toEqual([0, 20]);
    await archiveEmailThread({ id: 'thread-1', value: false });
    expect(f.reads).toEqual([0, 20, 0, 20]);
    expect(f.query.data?.pageParams).toEqual([0, 20]);
    expect(f.query.data?.pages.map((page) => page.inbox_visible)).toEqual([
      true,
      true,
    ]);
  });

  it('does not force network refreshes when the normalized cache owns updates', async () => {
    const f = setup({ cached: true });
    await vi.waitFor(() => expect(f.query.isSuccess).toBe(true));
    await archiveEmailThread({ id: 'thread-1', value: false });
    expect(f.reads).toEqual([0]);
  });

  it('stops refreshing when a mounted reader is disabled', async () => {
    const [enabled, setEnabled] = createSignal(true);
    const f = setup({ enabled });
    await vi.waitFor(() => expect(f.query.isSuccess).toBe(true));
    setEnabled(false);
    await archiveEmailThread({ id: 'thread-1', value: false });
    expect(f.reads).toEqual([0]);
  });

  it('does not activate a disabled GraphQL reader, including the REST facade path', async () => {
    const f = setup({ enabled: () => false });
    await archiveEmailThread({ id: 'thread-1', value: false });
    expect(f.reads).toEqual([]);
  });

  it('unregisters an open-thread reader when it unmounts', async () => {
    const f = setup();
    await vi.waitFor(() => expect(f.query.isSuccess).toBe(true));
    f.dispose();
    await archiveEmailThread({ id: 'thread-1', value: false });
    expect(f.reads).toEqual([0]);
  });

  it('starts participating if the session falls back from normalized caching', async () => {
    const f = setup({ cached: true });
    await vi.waitFor(() => expect(f.query.isSuccess).toBe(true));
    cacheEnabledMock.mockReturnValue(false);
    hostMock.mockReturnValue(undefined);
    await archiveEmailThread({ id: 'thread-1', value: false });
    expect(f.query.data?.pages[0].inbox_visible).toBe(true);
    expect(f.reads).toEqual([0, 0]);
  });

  it('does not roll back a committed archive because the thread refresh fails', async () => {
    const f = setup();
    await vi.waitFor(() => expect(f.query.isSuccess).toBe(true));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    f.server.failThreadRead = true;
    await expect(
      archiveEmailThread({ id: 'thread-1', value: false })
    ).resolves.toBe('committed');
    expect(f.server.inboxVisible).toBe(true);
    expect(f.query.error).toBeDefined();
    f.server.failThreadRead = false;
    await refreshActiveGraphqlSoupQueries({
      throwOnError: true,
      target: { kind: 'email-archive', threadId: 'thread-1' },
    });
    expect(f.query.data?.pages[0].inbox_visible).toBe(true);
  });

  it('leaves open threads alone during generic refreshes used by seen/unread and unrelated mutations', async () => {
    const f = setup();
    await vi.waitFor(() => expect(f.query.isSuccess).toBe(true));
    f.server.failThreadRead = true;
    await refreshActiveGraphqlSoupQueries({ throwOnError: true });
    expect(f.reads).toEqual([0]);
    expect(f.query.error).toBeNull();
    await archiveEmailThread({ id: 'another-thread', value: false });
    expect(f.reads).toEqual([0]);
    expect(f.query.error).toBeNull();
  });

  it('refreshes only the matching open thread for archive/unarchive', async () => {
    const f = setup();
    const other = createRoot((dispose) => ({
      dispose,
      ...createGraphqlEmailThreadQuery(
        () => 'other-thread',
        () => ({ enabled: true })
      ),
    }));
    cleanup.push(other.dispose);
    await vi.waitFor(() =>
      expect(f.query.isSuccess && other.query.isSuccess).toBe(true)
    );
    await archiveEmailThread({ id: 'thread-1', value: false });
    expect(f.query.data?.pages[0].inbox_visible).toBe(true);
    expect(f.readIds.filter((id) => id === 'thread-1')).toHaveLength(2);
    expect(f.readIds.filter((id) => id === 'other-thread')).toHaveLength(1);
  });

  it.each([false, true])(
    'recovers uncertain server identity after cache fallback (missing host=%s)',
    async (missingHost) => {
      const [cached, setCached] = createSignal(true);
      const f = setup({ cached: true, identity: 'unreadable', missingHost });
      cacheEnabledMock.mockImplementation(cached);
      if (missingHost) await new Promise((resolve) => setTimeout(resolve, 0));
      else await vi.waitFor(() => expect(f.query.isEnabled).toBe(true));
      expect(f.reads).toEqual([]); // Unknown while cache is active: no network.
      setCached(false);
      await vi.waitFor(() => expect(f.query.isSuccess).toBe(true));
      expect(f.reads).toEqual([0]);
      await archiveEmailThread({ id: 'thread-1', value: false });
      expect(f.query.data?.pages[0].inbox_visible).toBe(true);
      expect(f.reads).toEqual([0, 0]);
    }
  );

  it('keeps a positively known local draft off the network after a later identity failure', async () => {
    const [cached, setCached] = createSignal(true);
    const f = setup({
      cached: true,
      threadId: 'local-thread',
      identity: 'local',
    });
    cacheEnabledMock.mockImplementation(cached);
    await vi.waitFor(() => expect(f.query.isEnabled).toBe(true));
    expect(f.reads).toEqual([]);
    f.readIdentity.mockImplementationOnce(async () => {
      setCached(false);
      throw new Error('cache retired during identity lookup');
    });
    f.notifyIdentityChange();
    await vi.waitFor(() => expect(f.readIdentity).toHaveBeenCalledTimes(2));
    await refreshActiveGraphqlSoupQueries({
      throwOnError: true,
      target: { kind: 'email-archive', threadId: 'local-thread' },
    });
    expect(f.reads).toEqual([]);
  });

  it('preserves a resolved server alias when the cache retires during an identity read', async () => {
    const [cached, setCached] = createSignal(true);
    const f = setup({
      cached: true,
      threadId: 'local-alias',
      identity: 'alias',
    });
    cacheEnabledMock.mockImplementation(cached);
    await vi.waitFor(() => expect(f.query.isSuccess).toBe(true));
    expect(f.resolvedThreadId()).toBe('thread-1');
    f.readIdentity.mockImplementationOnce(async () => {
      setCached(false);
      throw new Error('cache retired during identity lookup');
    });
    f.notifyIdentityChange();
    await vi.waitFor(() => expect(f.readIdentity).toHaveBeenCalledTimes(2));
    await archiveEmailThread({ id: 'thread-1', value: false });
    expect(f.resolvedThreadId()).toBe('thread-1');
    expect(f.readIds.every((id) => id === 'thread-1')).toBe(true);
    expect(f.query.data?.pages[0].inbox_visible).toBe(true);
  });
});

function failCacheInitialization(asynchronously: boolean) {
  const retiredClient = { query: vi.fn(), executeQuery: vi.fn() };
  const fallbackClient = { query: queryMock, executeQuery: executeQueryMock };
  const fallback = () => {
    cacheEnabledMock.mockReturnValue(false);
    hostMock.mockReturnValue(undefined);
    activeClientMock.mockReturnValue(fallbackClient);
  };
  cacheEnabledMock.mockReturnValue(true);
  activeClientMock.mockReturnValue(retiredClient);
  initializeClientMock.mockReset();
  initializeClientMock.mockImplementationOnce(() => {
    if (!asynchronously) fallback();
  });
  hostMock.mockReturnValue({
    readRecordsByKeys: vi.fn(async () => {
      fallback();
      throw new Error('cache initialization failed');
    }),
    onCacheChanged: () => () => {},
  });
  return retiredClient;
}

describe('fetchGraphqlEmailThread', () => {
  beforeEach(() => {
    queryMock.mockReset();
    initializeClientMock.mockReset();
    hostMock.mockReturnValue({
      readRecordsByKeys: vi.fn(async () => ({ revision: '1', records: [] })),
    });
    cacheEnabledMock.mockReset();
    cacheEnabledMock.mockReturnValue(true);
  });

  it('does not fetch a positively identified local draft after its cache retires', async () => {
    hostMock.mockReturnValue({
      readRecordsByKeys: vi.fn(async () => {
        cacheEnabledMock.mockReturnValue(false);
        return {
          revision: '1',
          records: [
            {
              recordKey: 'GraphqlSoupEmailThread:local-thread',
              record: { id: 'local-thread', cacheProjection: null },
              identity: { pending: true },
            },
          ],
        };
      }),
    });
    await expect(fetchGraphqlEmailThread('local-thread')).rejects.toThrow(
      'cache is unavailable for this local draft'
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'loads through the fallback client after cache initialization fails (async=%s)',
    async (asynchronously) => {
      const retiredClient = failCacheInitialization(asynchronously);
      queryMock.mockReturnValue({
        toPromise: async () => ({ data: cachedPage }),
      });

      await expect(fetchGraphqlEmailThread('thread-1')).resolves.toMatchObject({
        db_id: 'thread-1',
      });
      expect(retiredClient.query).not.toHaveBeenCalled();
      expect(queryMock).toHaveBeenCalledExactlyOnceWith(
        EmailThreadPageDocument,
        { threadId: 'thread-1', offset: 0, limit: 20 },
        { requestPolicy: 'cache-and-network' }
      );
    }
  );

  it.each([false, true])(
    'resolves the durable local route before querying (queued=%s)',
    async (pending) => {
      hostMock.mockReturnValue({
        readRecordsByKeys: vi.fn(async () => ({
          revision: '1',
          records: [
            {
              recordKey: 'GraphqlSoupEmailThread:local-thread',
              record: { id: 'thread-1', cacheProjection: 'server-capsule' },
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
        { requestPolicy: 'cache-and-network' }
      );
      expect(queryMock).toHaveBeenCalledOnce();
    }
  );

  it.each([
    { canonical: 'local-thread', capsule: null, policy: 'cache-only' },
    { canonical: 'thread-1', capsule: null, policy: 'cache-and-network' },
    {
      canonical: 'local-thread',
      capsule: undefined,
      policy: 'cache-and-network',
    },
  ])(
    'uses $policy for pending identity $canonical with capsule $capsule',
    async ({ canonical, capsule, policy }) => {
      hostMock.mockReturnValue({
        readRecordsByKeys: vi.fn(async () => ({
          revision: '1',
          records: [
            {
              recordKey: 'GraphqlSoupEmailThread:local-thread',
              record: { id: canonical, cacheProjection: capsule },
              identity: { pending: true, mutationUuid: 'draft' },
            },
          ],
        })),
      });
      queryMock.mockReturnValue({
        toPromise: async () => ({ data: cachedPage }),
      });
      await fetchGraphqlEmailThread('local-thread');
      expect(queryMock).toHaveBeenCalledWith(
        EmailThreadPageDocument,
        { threadId: canonical, offset: 0, limit: 20 },
        { requestPolicy: policy }
      );
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

it.each([false, true])(
  'enables live thread queries after cache initialization fails (async=%s)',
  async (asynchronously) => {
    executeQueryMock.mockReset();
    const retiredClient = failCacheInitialization(asynchronously);
    const stream = makeSubject<OperationResult<EmailThreadPageQuery>>();
    executeQueryMock.mockReturnValue(stream.source);
    const root = createRoot((dispose) => ({
      dispose,
      ...createGraphqlEmailThreadQuery(
        () => 'thread-1',
        () => ({ enabled: true })
      ),
    }));
    try {
      await vi.waitFor(() => expect(executeQueryMock).toHaveBeenCalledOnce());
      expect(retiredClient.executeQuery).not.toHaveBeenCalled();
      const [request, context] = executeQueryMock.mock.calls[0];
      expect(request.variables.threadId).toBe('thread-1');
      expect(context.requestPolicy).toBe('cache-and-network');
      stream.next({
        operation: makeOperation('query', request, {
          url: '/graphql',
          ...context,
        }),
        stale: false,
        hasNext: false,
        data: cachedPage,
      });
      expect(root.query.data?.pages[0].db_id).toBe('thread-1');
    } finally {
      root.dispose();
    }
  }
);

it('exposes the resolved identity across queue settlement without confusing a different route', async () => {
  let canonical = 'local-thread';
  let changed = () => {};
  const unsubscribe = vi.fn();
  cacheEnabledMock.mockReturnValue(true);
  hostMock.mockReturnValue(undefined);
  initializeClientMock.mockImplementation(() =>
    hostMock.mockReturnValue({
      readRecordsByKeys: vi.fn(async () => ({
        revision: '1',
        records: [
          {
            recordKey: `GraphqlSoupEmailThread:${canonical}`,
            record: {
              id: canonical,
              cacheProjection:
                canonical === 'local-thread' ? null : 'server-capsule',
            },
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
    })
  );
  const executions: Array<{
    id: string;
    policy: string | undefined;
    emit(id: string): void;
  }> = [];
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
        policy: context.requestPolicy,
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
    expect(executions[0].policy).toBe('cache-only');
    executions[0].emit('local-thread');
    expect(root.query.data?.pages[0].db_id).toBe('local-thread');
    canonical = 'server-thread';
    changed();
    await vi.waitFor(() => expect(executions).toHaveLength(2));
    expect(root.resolvedThreadId()).toBe('server-thread');
    expect(executions[1].id).toBe('server-thread');
    expect(executions[1].policy).toBe('cache-and-network');
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

it('keeps identity-read failures cache-only and recovers on a cache change', async () => {
  initializeClientMock.mockReset();
  executeQueryMock.mockReset();
  cacheEnabledMock.mockReturnValue(true);
  let changed = () => {};
  const read = vi.fn().mockRejectedValue(new Error('storage unavailable'));
  hostMock.mockReturnValue({
    readRecordsByKeys: read,
    onCacheChanged: (callback: () => void) => {
      changed = callback;
      return () => {};
    },
  });
  executeQueryMock.mockImplementation(() => makeSubject().source);
  const root = createRoot((dispose) => ({
    dispose,
    ...createGraphqlEmailThreadQuery(
      () => 'local-thread',
      () => ({ enabled: true })
    ),
  }));
  try {
    await vi.waitFor(() => expect(executeQueryMock).toHaveBeenCalledOnce());
    expect(executeQueryMock.mock.calls[0][1].requestPolicy).toBe('cache-only');
    read.mockResolvedValue({
      revision: '2',
      records: [
        {
          recordKey: 'GraphqlSoupEmailThread:local-thread',
          record: { id: 'server-thread', cacheProjection: 'server-capsule' },
          identity: { pending: false },
        },
      ],
    });
    changed();
    await vi.waitFor(() =>
      expect(root.resolvedThreadId()).toBe('server-thread')
    );
    expect(executeQueryMock.mock.calls.at(-1)?.[0].variables.threadId).toBe(
      'server-thread'
    );
    expect(executeQueryMock.mock.calls.at(-1)?.[1].requestPolicy).toBe(
      'cache-and-network'
    );
  } finally {
    root.dispose();
  }
});

it('does not query a local route when cache initialization fails', async () => {
  initializeClientMock.mockReset();
  executeQueryMock.mockReset();
  queryMock.mockReset();
  cacheEnabledMock.mockReturnValue(true);
  hostMock.mockReturnValue(undefined);
  const root = createRoot((dispose) => ({
    dispose,
    ...createGraphqlEmailThreadQuery(
      () => 'local-thread',
      () => ({ enabled: true })
    ),
  }));
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(executeQueryMock).not.toHaveBeenCalled();
    await expect(fetchGraphqlEmailThread('local-thread')).rejects.toThrow(
      'identity is unknown'
    );
    expect(queryMock).not.toHaveBeenCalled();
  } finally {
    root.dispose();
  }
});

it('preserves loaded older pages while saving a reply to an existing server thread', async () => {
  initializeClientMock.mockReset();
  executeQueryMock.mockReset();
  cacheEnabledMock.mockReturnValue(true);
  let pending = false;
  let changed = () => {};
  hostMock.mockReturnValue({
    readRecordsByKeys: vi.fn(async () => ({
      revision: '1',
      records: [
        {
          recordKey: 'GraphqlSoupEmailThread:thread-1',
          record: { id: 'thread-1', cacheProjection: 'server-capsule' },
          identity: { pending, mutationUuid: 'draft' },
        },
      ],
    })),
    onCacheChanged: (callback: () => void) => {
      changed = callback;
      return () => {};
    },
  });
  const executions: Array<{
    offset: number;
    policy: string | undefined;
    emit(): void;
  }> = [];
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
        offset: request.variables.offset,
        policy: context.requestPolicy,
        emit() {
          stream.next({
            operation,
            stale: false,
            hasNext: false,
            data: {
              user: {
                ...cachedPage.user,
                emailThread: {
                  ...cachedPage.user.emailThread!,
                  messages: threadMessages(request.variables.offset, 20),
                },
              },
            },
          });
        },
      });
      return stream.source;
    }
  );
  const root = createRoot((dispose) => ({
    dispose,
    ...createGraphqlEmailThreadQuery(
      () => 'thread-1',
      () => ({ enabled: true })
    ),
  }));
  try {
    await vi.waitFor(() => expect(executions).toHaveLength(1));
    executions[0].emit();
    const fetchNext = root.query.fetchNextPage();
    await vi.waitFor(() => expect(executions).toHaveLength(2));
    expect(executions[1].offset).toBe(20);
    executions[1].emit();
    await fetchNext;
    expect(root.query.data?.pages).toHaveLength(2);
    pending = true;
    changed();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executions).toHaveLength(2);
    expect(root.query.data?.pages).toHaveLength(2);
    pending = false;
    changed();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executions).toHaveLength(2);
    expect(root.query.data?.pages).toHaveLength(2);
  } finally {
    root.dispose();
  }
});
