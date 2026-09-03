import type { BrowserTursoCacheRolloutDecision } from '@graphql-cache/rollout-policy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    },
    queueDepth: () => queuedMutationCount,
    recordSubscriptionDisposal: () => cleanupOrder.push('subscriptions'),
    cleanupOrder: () => [...cleanupOrder],
    failInitialization: () =>
      initializationErrorHandler?.(
        new Error('injected initialization failure')
      ),
    plainClient,
    realtimeClient,
    replaceSubscriptions,
    platformFetch,
    createWorkerCacheHost: vi.fn(
      (options: { onInitializationError?: (error: Error) => void }) => {
        initializationErrorHandler = options.onInitializationError;
        return host;
      }
    ),
    createTauriCacheHost: vi.fn(() => host),
  };
});

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_BEARER_TOKEN_AUTH: false,
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => mocks.graphqlEnabled,
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'document-storage-service': 'http://dss.test' },
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchToken: vi.fn() }));
vi.mock('@core/util/platform', () => ({ isTauri: () => mocks.tauri }));
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
  normalizedCacheExchange: (host: unknown) => ({ kind: 'cache', host }),
}));
vi.mock('@service-auth/fetch', () => ({ getMacroApiToken: vi.fn() }));
vi.mock('graphql-ws', () => ({
  createClient: () => ({ subscribe: vi.fn(), dispose: vi.fn() }),
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

describe('GraphQL Soup browser cache session gate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.graphqlEnabled = true;
    mocks.tauri = false;
    mocks.resetQueue();
    mocks.platformFetch.mockReset();
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

  it('unsubscribes cache operations before disposing a failed host', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const soup = await import('./graphql-soup');
    const cachedClient = soup.getGraphqlSoupClient();

    mocks.failInitialization();

    expect(cachedClient).not.toBe(mocks.realtimeClient);
    expect(soup.getGraphqlSoupClient()).toBe(mocks.realtimeClient);
    expect(soup.graphqlCacheEnabled()).toBe(false);
    expect(mocks.cleanupOrder()).toEqual(['subscriptions', 'host']);
    expect(warn).toHaveBeenCalledWith(
      'graphql cache async init failed; using uncached client',
      expect.objectContaining({ message: 'injected initialization failure' })
    );
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
