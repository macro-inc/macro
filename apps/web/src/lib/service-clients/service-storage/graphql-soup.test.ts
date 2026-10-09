import type { NormalizedCacheExchangeOptions } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import type { BrowserTursoCacheRolloutDecision } from '@graphql-cache/rollout-policy';
import type { Operation } from '@urql/core';
import { parse } from 'graphql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChannelListItemFieldsFragment,
  ChannelListNotificationFieldsFragment,
  GraphqlSoupEntityType,
  SoupItemFieldsFragment,
} from './graphql/generated/graphql';

it('preserves initiative identity, properties, and metadata separately from folders', async () => {
  const { mapGraphqlSoupItem } = await import('./graphql-soup');
  expect(
    mapGraphqlSoupItem({
      __typename: 'GraphqlSoupInitiative',
      id: 'initiative',
      entityType: 'INITIATIVE',
      displayName: 'Launch',
      metadata: {
        ownerId: 'owner',
        createdAt: '2026-09-01',
        updatedAt: '2026-09-26',
        viewedAt: null,
      },
      viewerPermission: {
        __typename: 'GraphqlAccessLevelPermission',
        accessLevel: 'EDIT',
      },
      properties: [],
      notifications: [],
      isFavorited: false,
      frecencyScore: null,
      cacheProjection: null,
    })
  ).toMatchObject({
    tag: 'initiative',
    data: {
      id: 'initiative',
      name: 'Launch',
      ownerId: 'owner',
      properties: [],
      updatedAt: '2026-09-26',
    },
  });
});

it('preserves the scheduled occurrence identity on reminder notifications', async () => {
  const { mapGraphqlNotification } = await import('./graphql-soup');
  const mapped = mapGraphqlNotification({
    __typename: 'GraphqlNotification',
    id: 'notification-1',
    entityId: 'thread-1',
    entityType: 'EMAIL_THREAD',
    eventType: 'reminder',
    state: 'UNSEEN',
    sent: true,
    senderId: null,
    viewedAt: null,
    createdAt: '2026-09-21T10:00:00Z',
    updatedAt: '2026-09-21T10:00:00Z',
    metadata: {
      __typename: 'GraphqlReminderMetadata',
      reminderReminderId: 'reminder-1',
      reminderDescription: 'Follow up',
      reminderScheduledFor: '2026-09-21T10:00:00Z',
    },
  });
  expect(mapped.entity_type).toBe('email_thread');
  expect(mapped.entity_id).toBe('thread-1');
  expect(mapped.notification_metadata).toEqual({
    tag: 'reminder',
    content: {
      reminderId: 'reminder-1',
      description: 'Follow up',
      scheduledFor: '2026-09-21T10:00:00Z',
    },
  });
});

it('maps agent sessions without discarding persona, favorites or notifications', async () => {
  const { mapGraphqlSoupItem } = await import('./graphql-soup');
  const mapped = mapGraphqlSoupItem({
    __typename: 'GraphqlSoupAgentSession',
    id: 'session',
    entityType: 'AGENT_SESSION',
    displayName: 'Fix mentions',
    sessionName: 'Fix mentions',
    isArchived: false,
    ownerId: 'macro|owner@example.com',
    botId: 'bot',
    harness: 'cursor',
    repoUrl: 'https://github.com/macro/macro',
    repoBranch: 'main',
    pullRequestUrl: 'https://github.com/macro/macro/pull/6712',
    workingBranch: 'fix-icons',
    pullRequestState: 'MERGED',
    pullRequestId: 'linked-pr',
    turnState: 'idle',
    bot: {
      id: 'bot',
      name: 'Ada',
      avatarUrl: null,
    },
    threadId: null,
    status: 'acp_ready',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
    viewedAt: null,
    cacheProjection: null,
    isFavorited: true,
    notifications: [],
    properties: [],
    frecencyScore: 5,
  });
  expect(mapped).toMatchObject({
    tag: 'agentSession',
    is_favorited: true,
    frecency_score: 5,
    data: {
      id: 'session',
      name: 'Fix mentions',
      bot: { name: 'Ada' },
      harness: 'cursor',
      repoUrl: 'https://github.com/macro/macro',
      repoBranch: 'main',
      pullRequestUrl: 'https://github.com/macro/macro/pull/6712',
      workingBranch: 'fix-icons',
      pullRequestState: 'merged',
      pullRequestId: 'linked-pr',
      turnState: 'idle',
      status: 'acp_ready',
      notifications: [],
    },
  });
});

const mocks = vi.hoisted(() => {
  let enabled = true;
  let graphqlEnabled = true;
  let tauri = false;
  let releaseApi: (() => void) | undefined;
  let markApiStarted: (() => void) | undefined;
  const apiStarted = () =>
    new Promise<void>((resolve) => {
      markApiStarted = resolve;
    });
  let queuedMutationCount = 0;
  let initializationErrorHandler: ((error: Error) => void) | undefined;
  let supersededHandler: (() => void) | undefined;
  const cleanupOrder: string[] = [];
  const host = {
    disabled: false,
    dispose: vi.fn(() => cleanupOrder.push('host')),
    enqueueOptimisticMutation: vi.fn(async () => {
      queuedMutationCount += 1;
      return { transactionId: 'tx-1' };
    }),
    commitOptimisticWrite: vi.fn(async () => {
      queuedMutationCount -= 1;
      return {
        changed: [],
        affectedOps: [],
        reset: false,
        revalidations: [],
      };
    }),
  };
  const apiCall = vi.fn(async () => {
    markApiStarted?.();
    await new Promise<void>((resolve) => {
      releaseApi = resolve;
    });
    return { data: { committed: true } };
  });
  const plainClient = { kind: 'plain' };
  const realtimeClient = { kind: 'realtime' };
  const replaceSubscriptions = vi.fn();
  const platformFetch = vi.fn();
  const toastFailure = vi.fn();
  return {
    get enabled() {
      return enabled;
    },
    set enabled(value: boolean) {
      enabled = value;
    },
    get graphqlEnabled() {
      return graphqlEnabled;
    },
    set graphqlEnabled(value: boolean) {
      graphqlEnabled = value;
    },
    get tauri() {
      return tauri;
    },
    set tauri(value: boolean) {
      tauri = value;
    },
    host,
    apiCall,
    apiStarted,
    releaseApi: () => releaseApi?.(),
    resetQueue: () => {
      queuedMutationCount = 0;
      cleanupOrder.length = 0;
      initializationErrorHandler = undefined;
      supersededHandler = undefined;
    },
    queueDepth: () => queuedMutationCount,
    recordSubscriptionDisposal: () => cleanupOrder.push('subscriptions'),
    cleanupOrder: () => [...cleanupOrder],
    failInitialization: (
      error = new Error('injected initialization failure')
    ) => initializationErrorHandler?.(error),
    supersede: () => supersededHandler?.(),
    reloadForNewerBuild: vi.fn(),
    plainClient,
    realtimeClient,
    replaceSubscriptions,
    platformFetch,
    toastFailure,
    telemetryError: vi.fn(),
    normalizedCacheExchange: vi.fn(
      (host: unknown, _options?: NormalizedCacheExchangeOptions) => ({
        kind: 'cache',
        host,
      })
    ),
    createWorkerCacheHost: vi.fn(
      (options: {
        onInitializationError?: (error: Error) => void;
        onSuperseded?: () => void;
      }) => {
        initializationErrorHandler = options.onInitializationError;
        supersededHandler = options.onSuperseded;
        return host;
      }
    ),
    createTauriCacheHost: vi.fn(
      (options: { onInitializationError?: (error: Error) => void }) => {
        initializationErrorHandler = options.onInitializationError;
        return host;
      }
    ),
  };
});

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toastFailure },
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_BEARER_TOKEN_AUTH: false,
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => mocks.graphqlEnabled,
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'document-storage-service': 'http://dss.test' },
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchToken: vi.fn() }));
vi.mock('@core/util/reloadForNewerBuild', () => ({
  reloadForNewerBuild: mocks.reloadForNewerBuild,
}));
vi.mock('@core/util/platform', () => ({ isTauri: () => mocks.tauri }));
// Recovery lifecycle is covered with its real store in local-drafts.test.ts.
vi.mock('@queries/email/local-drafts', () => ({
  localDraftQueueLifecycle: () => ({}),
}));
vi.mock('@core/util/platformFetch', () => ({
  platformFetch: mocks.platformFetch,
}));
vi.mock('@graphql-cache/rollout', () => ({
  getBrowserTursoCacheRolloutDecision: (): BrowserTursoCacheRolloutDecision => {
    const enabled = mocks.tauri ? mocks.graphqlEnabled : mocks.enabled;
    return {
      enabled,
      cohort: mocks.tauri ? 'unknown' : enabled ? 'treatment' : 'control',
      reason: mocks.tauri
        ? 'tauri-native-unchanged'
        : enabled
          ? 'graphql-transport-enabled'
          : 'graphql-transport-disabled',
      nativeCacheUnchanged: mocks.tauri,
    };
  },
}));
vi.mock('@graphql-cache/index', () => ({
  createWorkerCacheHost: mocks.createWorkerCacheHost,
  createTauriCacheHost: mocks.createTauriCacheHost,
  entityFromArgument: () => () => undefined,
}));
vi.mock('@graphql-cache/lifecycle', () => ({
  registerCacheHost: () => () => undefined,
}));
vi.mock('@graphql-cache/scope', () => ({
  getOrCreateCacheScope: () => 'anonymous-scope',
}));
vi.mock('@graphql-cache/exchange/normalized-cache-exchange', () => ({
  normalizedCacheExchange: mocks.normalizedCacheExchange,
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    error: mocks.telemetryError,
    span: (_name: string, work: (span: unknown) => Promise<unknown>) =>
      work({
        event: vi.fn(),
        setAttr: vi.fn(),
      }),
  },
}));
vi.mock('@service-auth/fetch', () => ({ getMacroApiToken: vi.fn() }));
vi.mock('graphql-ws', () => ({
  createClient: () => ({ subscribe: vi.fn(), dispose: vi.fn() }),
}));
vi.mock('../../queries/optimistic-resolvers', () => ({
  soupOptimisticResolvers: [],
}));
vi.mock('./graphql/generated/graphql', () => ({
  GroupSoupDocument: {},
  SoupDocument: {},
}));
vi.mock('./graphql-soup-websocket', () => ({
  SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS: 0,
  shouldRetryGraphqlSoupWebSocket: () => false,
  createGraphqlSoupWebSocketUrlResolver: () => () => 'ws://dss.test',
  createGraphqlSoupSubscriptionsLifecycle: () => ({
    replace: mocks.replaceSubscriptions,
    dispose: vi.fn(() => mocks.recordSubscriptionDisposal()),
  }),
}));
vi.mock('@urql/core', () => ({
  fetchExchange: { kind: 'fetch' },
  subscriptionExchange: () => ({ kind: 'subscription' }),
  createClient: (options: {
    exchanges: Array<{ kind?: string; host?: typeof mocks.host }>;
  }) => {
    const cacheExchange = options.exchanges.find(
      ({ kind }) => kind === 'cache'
    );
    if (!cacheExchange?.host) {
      return options.exchanges.some(({ kind }) => kind === 'subscription')
        ? mocks.realtimeClient
        : mocks.plainClient;
    }
    const host = cacheExchange.host;
    return {
      kind: 'cached',
      mutation: () => ({
        toPromise: async () => {
          await host.enqueueOptimisticMutation();
          const response = await mocks.apiCall();
          await host.commitOptimisticWrite();
          return response;
        },
      }),
    };
  },
}));

it('maps the unread alias without pretending it is the full notification edge', async () => {
  const { mapGraphqlSoupItem } = await import('./graphql-soup');
  const item = {
    __typename: 'GraphqlSoupChannel',
    id: 'channel',
    entityType: 'CHANNEL',
    displayName: 'Channel',
    channelName: 'Channel',
    channelType: 'private',
    ownerId: 'owner',
    organizationId: null,
    channelTeamId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    viewedAt: null,
    interactedAt: null,
    isParticipant: true,
    participants: [],
    latestMessage: null,
    latestNonThreadMessage: null,
    cacheProjection: null,
    frecencyScore: null,
    isFavorited: false,
    unreadNotifications: [
      { id: 'one', state: 'UNSEEN', createdAt: '2026-01-01' },
    ],
  } satisfies ChannelListItemFieldsFragment;
  expect(mapGraphqlSoupItem(item)).toMatchObject({
    tag: 'channel',
    data: {
      notifications: undefined,
      unreadNotifications: [
        { id: 'one', state: 'unseen', createdAt: '2026-01-01' },
      ],
    },
  });
});

describe('legacy channel list notifications', () => {
  const notification = (
    metadata: ChannelListNotificationFieldsFragment['metadata']
  ): ChannelListNotificationFieldsFragment => ({
    __typename: 'GraphqlNotification',
    id: 'notification',
    eventType: 'channel_message_send',
    entityId: 'channel',
    entityType: 'CHANNEL',
    state: 'UNSEEN',
    sent: true,
    senderId: 'sender',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    viewedAt: null,
    metadata,
  });

  it('maps unread sends without inventing missing presentation content', async () => {
    const { mapGraphqlNotification } = await import('./graphql-soup');
    const mapped = mapGraphqlNotification(
      notification({
        __typename: 'GraphqlChannelMessageSendMetadata',
        channelMessageSendSender: 'sender',
        channelMessageSendMessageId: 'message',
        channelMessageSendChannelType: 'PRIVATE',
      })
    );
    expect(mapped).toMatchObject({
      id: 'notification',
      entity_id: 'channel',
      entity_type: 'channel',
      state: 'unseen',
      sender_id: 'sender',
      notification_metadata: {
        tag: 'channel_message_send',
        content: {
          messageId: 'message',
          channelType: 'private',
          sender: 'sender',
        },
      },
    });
    expect(mapped.notification_metadata.content).not.toHaveProperty(
      'messageContent',
      ''
    );
    expect(mapped.notification_metadata.content).toHaveProperty(
      'messageContent',
      undefined
    );
    expect(
      mapGraphqlNotification({
        ...notification({
          __typename: 'GraphqlChannelMessageSendMetadata',
          channelMessageSendSender: 'sender',
          channelMessageSendMessageId: 'message',
          channelMessageSendChannelType: 'PRIVATE',
        }),
        state: 'SEEN',
        viewedAt: '2026-01-02T00:00:00Z',
      })
    ).toMatchObject({ state: 'seen', viewed_at: '2026-01-02T00:00:00Z' });
  });

  it('preserves mention and reply thread membership and message targets', async () => {
    const { mapGraphqlNotification } = await import('./graphql-soup');
    const { scopeChannelNotificationsForEntity } = await import(
      '../../../features/soup/entity-notifications'
    );
    const mapped = [
      notification({
        __typename: 'GraphqlChannelMessageSendMetadata',
        channelMessageSendSender: 'sender',
        channelMessageSendMessageId: 'top-level',
        channelMessageSendChannelType: 'PRIVATE',
      }),
      {
        ...notification({
          __typename: 'GraphqlChannelMentionMetadata',
          channelMentionMessageId: 'mention',
          channelMentionThreadId: 'thread',
          channelMentionMessageContent: 'Mention',
          channelMentionChannelType: 'PRIVATE',
        }),
        id: 'mention-notification',
        eventType: 'channel_mention',
      },
      {
        ...notification({
          __typename: 'GraphqlChannelReplyMetadata',
          channelReplyMessageId: 'reply',
          channelReplyThreadId: 'thread',
          channelReplyMessageContent: 'Reply',
          channelReplyChannelType: 'PRIVATE',
          channelReplyUserId: 'sender',
          channelReplyThreadParentSenderId: 'parent-sender',
        }),
        id: 'reply-notification',
        eventType: 'channel_message_reply',
      },
    ].map(mapGraphqlNotification);
    expect(
      scopeChannelNotificationsForEntity({ type: 'channel' }, mapped).map(
        (n) => n.id
      )
    ).toEqual(['notification']);
    expect(
      scopeChannelNotificationsForEntity(
        { type: 'channel_thread', messageId: 'thread' },
        mapped
      ).map((n) => n.id)
    ).toEqual(['mention-notification', 'reply-notification']);
    expect(mapped[1].notification_metadata).toMatchObject({
      tag: 'channel_mention',
      content: { messageId: 'mention', threadId: 'thread' },
    });
    expect(mapped[2].notification_metadata).toMatchObject({
      tag: 'channel_message_reply',
      content: { messageId: 'reply', threadId: 'thread' },
    });
  });
});

describe('GraphQL Soup chat models', () => {
  it.each(['openai/gpt-5.6', 'anthropic/claude-sonnet-5', null])(
    'preserves the saved model (%s) in the shared soup shape',
    async (model) => {
      const { mapGraphqlSoupItem } = await import('./graphql-soup');
      const item = {
        __typename: 'GraphqlSoupChat',
        id: 'chat-model',
        chatName: 'Chat',
        model,
        ownerId: 'macro|owner@example.com',
        entityType: 'CHAT' as GraphqlSoupEntityType,
        displayName: 'Chat',
        projectId: null,
        viewedAt: null,
        deletedAt: null,
        cacheProjection: null,
        frecencyScore: null,
        isPersistent: true,
        isFavorited: false,
        createdAt: '2026-09-11T00:00:00Z',
        updatedAt: '2026-09-11T00:00:00Z',
        properties: [],
        notifications: [],
      } satisfies SoupItemFieldsFragment;

      expect(mapGraphqlSoupItem(item)).toMatchObject({
        tag: 'chat',
        data: { id: item.id, model },
      });
    }
  );
});

describe('GraphQL Soup document sub types', () => {
  it.each([
    [
      { __typename: 'GraphqlTaskSubType', isCompleted: true },
      { type: 'task', is_completed: true },
    ],
    [{ __typename: 'GraphqlSkillSubType' }, { type: 'skill' }],
    [
      { __typename: 'GraphqlInitiativeDescriptionSubType' },
      { type: 'initiative_description' },
    ],
  ] as const)(
    'maps %j to the shared soup sub type %j',
    async (subType, expected) => {
      const { mapGraphqlSoupItem } = await import('./graphql-soup');
      const item = {
        __typename: 'GraphqlSoupDocument',
        id: 'doc-sub-type',
        entityType: 'DOCUMENT' as GraphqlSoupEntityType,
        displayName: 'Plan',
        documentName: 'Plan',
        ownerId: 'macro|owner@example.com',
        fileType: 'md',
        projectId: null,
        viewedAt: null,
        deletedAt: null,
        cacheProjection: null,
        frecencyScore: null,
        isFavorited: false,
        createdAt: '2026-09-11T00:00:00Z',
        updatedAt: '2026-09-11T00:00:00Z',
        subType,
        properties: [],
        notifications: [],
      } satisfies SoupItemFieldsFragment;

      expect(mapGraphqlSoupItem(item)).toMatchObject({
        tag: 'document',
        data: { id: item.id, subType: expected },
      });
    }
  );
});

describe('GraphQL Soup browser cache session gate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.graphqlEnabled = true;
    mocks.tauri = false;
    mocks.resetQueue();
    mocks.platformFetch.mockReset();
    mocks.telemetryError.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps an old client compatible with a server that has the additive field', async () => {
    mocks.platformFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { user: { soup: { items: [] } } } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    const soup = await import('./graphql-soup');
    const response = await soup.dssGraphqlFetch('http://dss.test/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query: 'query LegacySoup { user { soup { items { __typename id } } } }',
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.platformFetch).toHaveBeenCalledOnce();
    expect(soup.graphqlSoupProjectionSupported()).toBe(true);
  });

  it('strips client-only directives from GraphQL transport documents', async () => {
    mocks.platformFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { user: { id: 'user-1' } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const soup = await import('./graphql-soup');
    const query = `query Soup($includeId: Boolean!) {
      user {
        id @include(if: $includeId)
        soup { items { cacheProjection @cacheOnly } }
      }
    }`;
    await soup.dssGraphqlFetch('http://dss.test/graphql', {
      method: 'POST',
      body: JSON.stringify({ query, variables: { includeId: true } }),
    });

    expect(mocks.platformFetch).toHaveBeenCalledOnce();
    const transport = mocks.platformFetch.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(transport.body as string) as {
      query: string;
      variables: { includeId: boolean };
    };
    expect(payload.query).not.toContain('@cacheOnly');
    expect(payload.query).toContain('cacheProjection');
    expect(payload.query).toContain('@include');
    expect(payload.variables).toEqual({ includeId: true });
  });

  it.each([
    'Cannot query field "cacheProjection" on type "GraphqlSoupEntity".',
    'Unknown field "cacheProjection" on type "GraphqlSoupEntity".',
  ])(
    'retries a new client against an old server without projection local authority: %s',
    async (validationMessage) => {
      mocks.platformFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ errors: [{ message: validationMessage }] }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ data: { user: { soup: { items: [] } } } }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
        );
      const soup = await import('./graphql-soup');
      const query = `query Soup {
        user { soup { items { __typename id cacheProjection @cacheOnly } } }
      }`;
      const response = await soup.dssGraphqlFetch('http://dss.test/graphql', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });

      expect(response.status).toBe(200);
      expect(mocks.platformFetch).toHaveBeenCalledTimes(2);
      const retry = mocks.platformFetch.mock.calls[1]?.[1] as RequestInit;
      expect(JSON.parse(retry.body as string).query).not.toContain(
        'cacheProjection'
      );
      expect(soup.graphqlSoupProjectionSupported()).toBe(false);
    }
  );

  it('keeps GraphQL notification subscriptions active when the cache is disabled', async () => {
    mocks.enabled = false;
    const soup = await import('./graphql-soup');

    expect(soup.graphqlCacheEnabled()).toBe(false);
    expect(soup.getGraphqlSoupClient()).toBe(mocks.realtimeClient);
    expect(mocks.replaceSubscriptions).toHaveBeenCalledWith(
      mocks.realtimeClient
    );
  });

  it('latches an activated client through a flag change until navigation', async () => {
    const apiStarted = mocks.apiStarted();
    const soup = await import('./graphql-soup');
    const client = soup.getGraphqlSoupClient() as unknown as {
      mutation(): { toPromise(): Promise<unknown> };
    };
    const mutation = client.mutation().toPromise();
    await apiStarted;

    mocks.enabled = false;
    expect(soup.getGraphqlSoupClient()).toBe(client);
    expect(soup.graphqlCacheEnabled()).toBe(true);
    expect(mocks.queueDepth()).toBe(1);
    expect(mocks.host.dispose).not.toHaveBeenCalled();

    mocks.releaseApi();
    await expect(mutation).resolves.toEqual({ data: { committed: true } });
    expect(mocks.apiCall).toHaveBeenCalledOnce();
    expect(mocks.host.enqueueOptimisticMutation).toHaveBeenCalledOnce();
    expect(mocks.host.commitOptimisticWrite).toHaveBeenCalledOnce();
    expect(mocks.queueDepth()).toBe(0);
    expect(mocks.host.dispose).not.toHaveBeenCalled();
  });

  it.each(['query', 'mutation', 'subscription'] as const)(
    'reports handled cache-disposed failures for %s without exporting operation payloads',
    async (kind) => {
      const soup = await import('./graphql-soup');
      soup.getGraphqlSoupClient();
      const error = new Error('cache worker host was disposed');
      const operation: Operation = {
        kind,
        key: 42,
        query: parse('query PrivateDocument { user { id } }'),
        variables: { privateValue: 'do-not-export' },
        context: { url: 'http://dss.test', requestPolicy: 'cache-first' },
      };
      const report =
        mocks.normalizedCacheExchange.mock.calls[0]?.[1]?.onCacheError;

      const { CacheNavigationError } = await import(
        '@graphql-cache/host/navigation-error'
      );
      report?.(new CacheNavigationError(), operation);
      report?.(
        Object.assign(new Error('owner lock is held by another context'), {
          errorCode: 'owner-lock-unavailable',
        }),
        operation
      );
      expect(mocks.telemetryError).not.toHaveBeenCalled();
      report?.(error, operation);

      expect(mocks.telemetryError).toHaveBeenCalledExactlyOnceWith(error, {
        'error.source': 'graphql-cache',
        'cache.backend': 'turso-wasm-opfs',
        'cache.phase': 'operation',
        'cache.operation_kind': kind,
      });
    }
  );

  it.each([
    ['navigation', 'admitted-enqueue-uncertain', false],
    ['transport', 'admitted-enqueue-uncertain', true],
    ['abrupt', 'admitted-enqueue-uncertain', true],
    ['message-only', 'admitted-enqueue-uncertain', true],
    ['missing', 'admitted-enqueue-uncertain', true],
    ['navigation', undefined, true],
  ] as const)(
    'classifies wrapped cache errors by cause %s and code %s (report: %s)',
    async (causeKind, errorCode, shouldReport) => {
      const soup = await import('./graphql-soup');
      soup.getGraphqlSoupClient();
      const { CacheNavigationError } = await import(
        '@graphql-cache/host/navigation-error'
      );
      const navigation = new CacheNavigationError();
      const causes = {
        navigation,
        transport: new Error('coordinator MessagePort messageerror'),
        abrupt: new Error('cache worker host was abruptly disposed'),
        'message-only': new Error(navigation.message),
        missing: undefined,
      };
      const error = Object.assign(
        new Error('admitted optimistic enqueue outcome is uncertain', {
          cause: causes[causeKind],
        }),
        { name: 'CacheResponseError', errorCode }
      );
      const operation: Operation = {
        kind: 'mutation',
        key: 42,
        query: parse('mutation PrivateMutation { update }'),
        variables: { privateValue: 'do-not-export' },
        context: { url: 'http://dss.test', requestPolicy: 'cache-first' },
      };
      const report =
        mocks.normalizedCacheExchange.mock.calls[0]?.[1]?.onCacheError;
      expect(report).toBeDefined();
      report?.(error, operation);

      if (shouldReport) {
        expect(mocks.telemetryError).toHaveBeenCalledExactlyOnceWith(error, {
          'error.source': 'graphql-cache',
          'cache.backend': 'turso-wasm-opfs',
          'cache.phase': 'operation',
          'cache.operation_kind': 'mutation',
        });
      } else {
        expect(mocks.telemetryError).not.toHaveBeenCalled();
      }
    }
  );

  it.each([
    { native: false, backend: 'turso-wasm-opfs' },
    { native: true, backend: 'native' },
  ])(
    'reports $backend initialization failures once despite in-flight operation errors',
    async ({ native, backend }) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mocks.tauri = native;
      const soup = await import('./graphql-soup');
      soup.getGraphqlSoupClient();
      const report =
        mocks.normalizedCacheExchange.mock.calls[0]?.[1]?.onCacheError;
      expect(report).toBeDefined();
      const operation: Operation = {
        kind: 'query',
        key: 42,
        query: parse('query { user { id } }'),
        variables: {},
        context: { url: 'http://dss.test', requestPolicy: 'cache-first' },
      };
      const error = new Error('injected initialization failure');

      mocks.failInitialization(error);
      // Rejected in-flight reads reach the exchange after the host reports
      // initialization failure. Cleanup can also reject outstanding work.
      await Promise.resolve();
      report?.(error, operation);
      report?.(new Error('cache worker host was disposed'), operation);

      expect(mocks.telemetryError).toHaveBeenCalledExactlyOnceWith(error, {
        'error.source': 'graphql-cache',
        'cache.backend': backend,
        'cache.phase': 'initialization',
      });
      expect(soup.getGraphqlSoupClient()).toBe(mocks.realtimeClient);
      expect(soup.getGraphqlCacheHost()).toBeUndefined();
      expect(soup.graphqlCacheEnabled()).toBe(false);
    }
  );

  it('reports synchronous cache construction failures before falling back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('cache worker construction failed');
    mocks.createWorkerCacheHost.mockImplementationOnce(() => {
      throw error;
    });
    const soup = await import('./graphql-soup');

    expect(soup.getGraphqlSoupClient()).toBe(mocks.realtimeClient);
    expect(mocks.telemetryError).toHaveBeenCalledExactlyOnceWith(error, {
      'error.source': 'graphql-cache',
      'cache.backend': 'turso-wasm-opfs',
      'cache.phase': 'initialization',
    });
  });

  it('does not let telemetry failures prevent terminal-cache fallback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.telemetryError.mockImplementationOnce(() => {
      throw new Error('telemetry unavailable');
    });
    const soup = await import('./graphql-soup');
    soup.getGraphqlSoupClient();

    expect(() => mocks.failInitialization()).not.toThrow();
    expect(mocks.telemetryError).toHaveBeenCalledOnce();
    expect(soup.getGraphqlSoupClient()).toBe(mocks.realtimeClient);
    expect(mocks.cleanupOrder()).toEqual(['subscriptions', 'host']);
  });

  it('unsubscribes cache operations before disposing a failed host', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const soup = await import('./graphql-soup');
    const cachedClient = soup.getGraphqlSoupClient();

    const error = new Error('injected initialization failure');
    mocks.failInitialization(error);

    expect(mocks.telemetryError).toHaveBeenCalledExactlyOnceWith(error, {
      'error.source': 'graphql-cache',
      'cache.backend': 'turso-wasm-opfs',
      'cache.phase': 'initialization',
    });
    // Late failure notifications from the old host do not emit duplicate logs.
    mocks.failInitialization(error);
    expect(mocks.telemetryError).toHaveBeenCalledOnce();
    expect(cachedClient).not.toBe(mocks.realtimeClient);
    expect(soup.getGraphqlSoupClient()).toBe(mocks.realtimeClient);
    expect(soup.graphqlCacheEnabled()).toBe(false);
    expect(mocks.cleanupOrder()).toEqual(['subscriptions', 'host']);
    expect(mocks.toastFailure).toHaveBeenCalledWith('Local cache unavailable', {
      subtext: 'Macro will continue without local caching for this session.',
    });
    expect(warn).toHaveBeenCalledWith(
      'graphql cache async init failed; using uncached client',
      expect.objectContaining({ message: 'injected initialization failure' })
    );
  });

  it('retires a failed host so the replaced client degrades instead of rejecting', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const soup = await import('./graphql-soup');
    soup.getGraphqlSoupClient();
    const exchangeHost = mocks.normalizedCacheExchange.mock.calls[0]?.[0] as
      | CacheHost
      | undefined;
    expect(exchangeHost?.disabled).toBe(false);

    mocks.failInitialization();

    // Operations still running on the old client, and callers that captured
    // the host, now miss to the network rather than "host was disposed".
    expect(mocks.host.dispose).toHaveBeenCalledOnce();
    expect(exchangeHost?.disabled).toBe(true);
    await expect(
      exchangeHost?.readQuery({ query: 'query Q { user { id } }' })
    ).resolves.toEqual({ kind: 'miss' });
    await expect(
      exchangeHost?.search({ profile: 'quick-access-v1', limit: 10 })
    ).resolves.toEqual({ documents: [], nextCursor: null });
  });

  it('moves reactive cache readers off a host abandoned mid-session', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const soup = await import('./graphql-soup');
    soup.getGraphqlSoupClient();
    const { createMemo, createRoot } = await import('solid-js');
    const readers = createRoot((dispose) => ({
      dispose,
      enabled: createMemo(() => soup.graphqlCacheEnabled()),
      host: createMemo(() => soup.getGraphqlSoupCacheHost()),
    }));
    expect(readers.enabled()).toBe(true);
    expect(readers.host()).toBeDefined();

    mocks.failInitialization();

    expect(readers.enabled()).toBe(false);
    expect(readers.host()).toBeUndefined();
    readers.dispose();
  });

  it('requests a native update and uses the existing fallback when draft recovery commands are unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.tauri = true;
    const soup = await import('./graphql-soup');
    const { NativeCacheUpgradeRequiredError } = await import(
      '@graphql-cache/host/tauri-host'
    );
    const cached = soup.getGraphqlSoupClient();
    mocks.failInitialization(new NativeCacheUpgradeRequiredError());
    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'Macro update required',
      expect.objectContaining({
        subtext: expect.stringContaining('queued drafts are preserved'),
      })
    );
    expect(soup.graphqlCacheEnabled()).toBe(false);
    expect(soup.getGraphqlSoupClient()).not.toBe(cached);
    expect(mocks.host.dispose).toHaveBeenCalledOnce();
    expect(() => soup.assertEmailDraftQueueAvailable()).toThrow(
      'queued changes are preserved'
    );
  });

  it.each([
    ['SaveEmailDraft', 'saveEmailDraft'],
    ['DeleteEmailDraft', 'deleteEmailDraft'],
  ])(
    'prevents %s from overtaking preserved mutations through fallback transport',
    async (name, field) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const soup = await import('./graphql-soup');
      soup.getGraphqlSoupClient();
      // Initialization may fail after callers have already captured a client.
      mocks.failInitialization();
      await expect(
        soup.dssGraphqlFetch('https://dss.test/graphql', {
          method: 'POST',
          body: JSON.stringify({
            query: `mutation ${name} { ${field}(input: { draftId: "draft" }) { __typename } }`,
          }),
        })
      ).rejects.toThrow('queued changes are preserved');
      expect(mocks.platformFetch).not.toHaveBeenCalled();

      mocks.platformFetch.mockResolvedValueOnce(new Response('{}'));
      await soup.dssGraphqlFetch('https://dss.test/graphql', {
        method: 'POST',
        body: JSON.stringify({ query: 'query Read { user { id } }' }),
      });
      expect(mocks.platformFetch).toHaveBeenCalledOnce();
    }
  );

  it('falls back quietly while another context holds the database', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const soup = await import('./graphql-soup');
    const cachedClient = soup.getGraphqlSoupClient();

    mocks.failInitialization(
      Object.assign(new Error('owner lock is held by another context'), {
        errorCode: 'owner-lock-unavailable',
      })
    );

    // Expected after a deploy or while a closing tab lets go: no toast and no
    // error report, but the cache is off for this page session and its host
    // is retired.
    expect(mocks.toastFailure).not.toHaveBeenCalled();
    expect(mocks.telemetryError).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledExactlyOnceWith(
      '[graphql-cache] owner lock is held by another context; using the network until reload'
    );
    expect(mocks.host.dispose).toHaveBeenCalledOnce();
    expect(soup.graphqlCacheEnabled()).toBe(false);
    expect(soup.getGraphqlSoupClient()).not.toBe(cachedClient);
  });

  it('moves the page to a newer build that took the database over', async () => {
    const soup = await import('./graphql-soup');
    soup.getGraphqlSoupClient();
    expect(mocks.reloadForNewerBuild).not.toHaveBeenCalled();

    mocks.supersede();

    expect(mocks.reloadForNewerBuild).toHaveBeenCalledOnce();
    expect(mocks.toastFailure).not.toHaveBeenCalled();
  });

  it('imports and uses the native path without constructing browser workers', async () => {
    const WorkerConstructor = vi.fn(() => {
      throw new Error('browser worker must not be constructed on Tauri');
    });
    vi.stubGlobal('Worker', WorkerConstructor);
    vi.stubGlobal('SharedWorker', WorkerConstructor);
    mocks.tauri = true;
    mocks.enabled = false;

    const soup = await import('./graphql-soup');
    const nativeClient = soup.getGraphqlSoupClient();
    mocks.graphqlEnabled = false;

    expect(soup.graphqlCacheEnabled()).toBe(false);
    expect(soup.getGraphqlSoupClient()).toBe(mocks.plainClient);
    expect(nativeClient).not.toBe(mocks.plainClient);
    expect(mocks.host.dispose).not.toHaveBeenCalled();
    expect(mocks.createTauriCacheHost).toHaveBeenCalledOnce();
    expect(mocks.createWorkerCacheHost).not.toHaveBeenCalled();
    expect(WorkerConstructor).not.toHaveBeenCalled();
  });
});
