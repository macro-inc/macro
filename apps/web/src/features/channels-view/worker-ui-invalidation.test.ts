import { type ChannelEntity, isChannelEntity } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { Client, OperationResult } from '@urql/core';
import {
  createComponent,
  createComputed,
  createMemo,
  createRoot,
  createSignal,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject } from 'wonka';
import {
  TEST_AUTHORITY_GENERATION,
  testAuthority,
} from '../../lib/graphql-cache/authority-fixture';
import type { CacheHost } from '../../lib/graphql-cache/host/types';
import { createWorkerCacheHost } from '../../lib/graphql-cache/host/worker-host';
import {
  LinkedMessageChannel,
  type LinkedMessagePort,
  originLocks,
} from '../../lib/graphql-cache/host/worker-host.integration-helpers';
import {
  type EntityFilterCacheArgs,
  type EntityFilterCacheResult,
  parseCacheRevision,
} from '../../lib/graphql-cache/protocol';
import { installCacheCoordinatorWorker } from '../../lib/graphql-cache/worker/cache-coordinator-runtime';
import { installCacheEngineWorker } from '../../lib/graphql-cache/worker/cache-engine-runtime';
import { CoordinatorRouter } from '../../lib/graphql-cache/worker/coordinator-router';
import { CacheWorkerCore } from '../../lib/graphql-cache/worker/worker-core';

const runtimeState = vi.hoisted(() => ({
  engine: undefined as ReturnType<typeof createChannelCacheEngine> | undefined,
  host: undefined as CacheHost | undefined,
  client: undefined as Client | undefined,
}));

vi.mock('../../lib/graphql-cache/worker/wasm-module', async () => {
  const { cacheDatabaseIdentity } = await import(
    '../../lib/graphql-cache/worker/coordinator-protocol'
  );
  return {
    cacheWasmLinearMemoryBytes: () => 0,
    setCompiledEngineExchange: () => {},
    loadCacheWasm: async () => ({
      cacheDatabaseIdentity,
      openCache: async () => {
        if (!runtimeState.engine)
          throw new Error('test engine not initialized');
        return runtimeState.engine;
      },
      openCacheWithOutcome: async (
        _scope: string,
        _hotCapacity?: number,
        awaitStorageGrant?: () => Promise<void>
      ) => {
        if (!runtimeState.engine)
          throw new Error('test engine not initialized');
        await awaitStorageGrant?.();
        return {
          engine: runtimeState.engine,
          outcome: 'opened-existing' as const,
        };
      },
    }),
  };
});

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user-1',
  useIsAuthenticated: () => () => true,
}));

vi.mock(
  '../../lib/service-clients/service-storage/graphql-soup',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../lib/service-clients/service-storage/graphql-soup')
      >();
    return {
      ...actual,
      getGraphqlSoupCacheHost: () => runtimeState.host,
      getGraphqlSoupClient: () => {
        if (!runtimeState.client)
          throw new Error('test client not initialized');
        return runtimeState.client;
      },
      graphqlSoupProjectionSupported: () => true,
      hasGraphqlCacheHost: () => Boolean(runtimeState.host),
    };
  }
);

import { disposeChannelNotificationRefresh } from '../../lib/queries/channel/notification-refresh';
import {
  channelIdWindow,
  useChannelWindow,
} from '../../lib/queries/channel/window';
import { createGraphqlSoupAstItemsQuery } from '../../lib/queries/soup/graphql/items';

type WireNotification = {
  id: string;
  state: 'UNREAD' | 'READ';
  createdAt: string;
};

type WireChannel = {
  __typename: 'GraphqlSoupChannel';
  id: string;
  channelName: string;
  channelType: 'TEAM';
  ownerId: string;
  organizationId: string | null;
  channelTeamId: string | null;
  createdAt: string;
  updatedAt: string;
  isFavorited: boolean;
  isParticipant: boolean;
  viewedAt: string | null;
  interactedAt: string | null;
  latestMessage: null;
  latestNonThreadMessage: null;
  participants: Array<{
    channelId: string;
    userId: string;
    role: string;
    joinedAt: string;
    leftAt: string | null;
  }>;
  notifications: [];
  unreadNotifications: WireNotification[];
  unreadMentions: [];
};

function makeWireChannel(
  id: string,
  overrides: Partial<WireChannel> = {}
): WireChannel {
  return {
    __typename: 'GraphqlSoupChannel',
    id,
    channelName: `Channel ${id}`,
    channelType: 'TEAM',
    ownerId: 'owner-1',
    organizationId: 'org-1',
    channelTeamId: 'team-1',
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    isFavorited: false,
    isParticipant: true,
    viewedAt: null,
    interactedAt: null,
    latestMessage: null,
    latestNonThreadMessage: null,
    participants: [
      {
        channelId: id,
        userId: 'user-1',
        role: 'MEMBER',
        joinedAt: '2026-11-25T10:00:00.000Z',
        leftAt: null,
      },
    ],
    notifications: [],
    unreadNotifications: [],
    unreadMentions: [],
    ...overrides,
  };
}

type TrackedView = {
  id: string;
  observationId: string;
  filter: (channel: WireChannel) => boolean;
  lastKeys: string[];
  lastRecords: Map<string, string>;
};

function predicateForFilter(
  filters: Record<string, unknown> | undefined
): (channel: WireChannel) => boolean {
  const serialized = JSON.stringify(filters ?? {});
  const ids = serialized.match(/ch-[a-z0-9-]+/g);
  if (ids && ids.length > 0) {
    const allowed = new Set(ids);
    return (channel) => allowed.has(channel.id);
  }
  return (channel) => channel.isParticipant;
}

/**
 * Stateful in-memory channel cache engine behind the real `CacheWorkerCore`.
 * Computes real `observationId`s and `unchangedViews` proofs from each view's
 * matching keys and projected record contents.
 */
function createChannelCacheEngine(initial: WireChannel[]) {
  const channels = new Map<string, WireChannel>(
    initial.map((ch) => [`GraphqlSoupChannel:${ch.id}`, structuredClone(ch)])
  );
  const views = new Map<string, TrackedView>();
  const entityFilterCalls = new Map<string, number>();
  let revision = 1;

  const evaluateMatches = (filter: (channel: WireChannel) => boolean) => {
    const matched = [...channels.entries()]
      .filter(([, record]) => filter(record))
      .sort(([a], [b]) => a.localeCompare(b));
    return {
      keys: matched.map(([key]) => key),
      serialized: new Map(
        matched.map(([key, record]) => [key, JSON.stringify(record)])
      ),
      records: matched,
    };
  };

  const applyChannelData = (data: unknown): string[] => {
    const payload = data as { channels?: WireChannel[] } | undefined;
    const changed: string[] = [];
    for (const incoming of payload?.channels ?? []) {
      const key = `GraphqlSoupChannel:${incoming.id}`;
      channels.set(key, structuredClone(incoming));
      changed.push(key);
    }
    return changed;
  };

  const computeUnchangedViews = (): string[] => {
    const unchanged: string[] = [];
    for (const view of views.values()) {
      const next = evaluateMatches(view.filter);
      const sameKeys =
        next.keys.length === view.lastKeys.length &&
        next.keys.every((key, index) => key === view.lastKeys[index]);
      const sameRows =
        sameKeys &&
        next.keys.every(
          (key) => next.serialized.get(key) === view.lastRecords.get(key)
        );
      if (sameRows) unchanged.push(view.observationId);
    }
    return unchanged;
  };

  return {
    entityFilterCalls,
    evictChannel: (id: string) => {
      channels.delete(`GraphqlSoupChannel:${id}`);
    },
    currentAuthority: async (identity: string) => testAuthority(identity),
    currentRevision: async () => parseCacheRevision(String(revision)),
    currentStorageGeneration: async () =>
      '00000000-0000-7000-8000-000000000001',
    readQuery: async () => ({ kind: 'miss' as const }),
    readRecordsByKeys: async () => ({
      revision: parseCacheRevision(String(revision)),
      records: [],
    }),
    entityFilter: async (
      args: EntityFilterCacheArgs
    ): Promise<EntityFilterCacheResult> => {
      const live = args.liveQuery;
      if (!live) {
        return {
          kind: 'reconciled',
          revision: parseCacheRevision(String(revision)),
          keys: [],
          retainedKeys: [],
          optimistic: false,
        };
      }
      if (live.release) {
        views.delete(live.id);
        return {
          kind: 'live-query',
          revision: parseCacheRevision(String(revision)),
          reset: false,
          upserts: [],
          patches: [],
          removed: [],
          retainedKeys: [],
          optimistic: false,
        };
      }

      entityFilterCalls.set(live.id, (entityFilterCalls.get(live.id) ?? 0) + 1);
      const filter = predicateForFilter(
        args.filters as Record<string, unknown> | undefined
      );
      const next = evaluateMatches(filter);
      const existing = views.get(live.id);
      const observationId = existing?.observationId ?? `obs:${live.id}`;

      if (!existing) {
        views.set(live.id, {
          id: live.id,
          observationId,
          filter,
          lastKeys: next.keys,
          lastRecords: next.serialized,
        });
        return {
          kind: 'live-query',
          revision: parseCacheRevision(String(revision)),
          observationId,
          reset: true,
          keys: next.keys,
          upserts: next.records.map(([recordKey, record]) => ({
            recordKey,
            record: structuredClone(record),
            identity: { mutationUuid: null, pending: false },
          })),
          patches: [],
          removed: [],
          retainedKeys: [],
          optimistic: false,
        };
      }

      const prevKeySet = new Set(existing.lastKeys);
      const nextKeySet = new Set(next.keys);
      const removed = existing.lastKeys.filter((key) => !nextKeySet.has(key));
      const upserts: Array<{
        recordKey: string;
        record: WireChannel;
        identity: { mutationUuid: null; pending: false };
      }> = [];
      const patches: Array<{
        recordKey: string;
        fields: Array<{ path: string[]; value: unknown }>;
        identity: { mutationUuid: null; pending: false };
      }> = [];

      for (const [recordKey, record] of next.records) {
        if (!prevKeySet.has(recordKey)) {
          upserts.push({
            recordKey,
            record: structuredClone(record),
            identity: { mutationUuid: null, pending: false },
          });
          continue;
        }
        const prevJson = existing.lastRecords.get(recordKey);
        const nextJson = next.serialized.get(recordKey);
        if (prevJson !== nextJson && prevJson !== undefined) {
          const prevRecord = JSON.parse(prevJson) as WireChannel;
          const fields: Array<{ path: string[]; value: unknown }> = [];
          for (const field of [
            'unreadNotifications',
            'channelName',
            'isParticipant',
            'updatedAt',
          ] as const) {
            if (
              JSON.stringify(prevRecord[field]) !==
              JSON.stringify(record[field])
            ) {
              fields.push({
                path: [field],
                value: structuredClone(record[field]),
              });
            }
          }
          if (fields.length > 0) {
            patches.push({
              recordKey,
              fields,
              identity: { mutationUuid: null, pending: false },
            });
          }
        }
      }

      existing.lastKeys = next.keys;
      existing.lastRecords = next.serialized;
      return {
        kind: 'live-query',
        revision: parseCacheRevision(String(revision)),
        observationId,
        reset: false,
        keys: next.keys,
        upserts,
        patches,
        removed,
        retainedKeys: [],
        optimistic: false,
      };
    },
    hydrateQuery: async (
      _query: string,
      _operationName: string | undefined,
      _variables: Record<string, unknown> | undefined,
      data: unknown
    ) => {
      const changed = applyChannelData(data);
      revision += 1;
      return {
        data: null,
        revision: parseCacheRevision(String(revision)),
        revisionAdvanced: true,
        reset: false,
        changed,
        affectedOps: [],
        unchangedViews: computeUnchangedViews(),
      };
    },
    writeQuery: async (
      _meta: unknown,
      _query: string,
      _operationName: string | undefined,
      _variables: Record<string, unknown> | undefined,
      data: unknown
    ) => {
      const changed = applyChannelData(data);
      revision += 1;
      // Foreground write_query omits unchangedViews in cache-wasm shell.rs:539.
      return {
        revision: parseCacheRevision(String(revision)),
        revisionAdvanced: true,
        reset: false,
        changed,
        affectedOps: [],
      };
    },
  };
}

describe('worker-to-UI invalidation through CacheWorkerCore and CoordinatorCore', () => {
  beforeEach(() => {
    const locks = originLocks();
    localStorage.clear();
    localStorage.setItem('graphql-cache:scope', 'worker-ui-test');

    const router = new CoordinatorRouter({
      verifyTabLockHeld: async () => true,
      watchTabLock: () => () => undefined,
    });

    vi.stubGlobal('MessageChannel', LinkedMessageChannel);
    vi.stubGlobal(
      'SharedWorker',
      class {
        onerror: ((event: ErrorEvent) => unknown) | null = null;
        readonly port: LinkedMessagePort;

        constructor() {
          const channel = new LinkedMessageChannel();
          this.port = channel.port1;
          installCacheCoordinatorWorker({
            endpoint: channel.port2 as unknown as MessagePort,
            router,
          });
        }
      }
    );
    vi.stubGlobal(
      'Worker',
      class {
        onerror: ((event: ErrorEvent) => unknown) | null = null;
        onmessageerror: ((event: MessageEvent) => unknown) | null = null;
        private readonly scope = {
          onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
          close: () => {},
        };

        constructor() {
          installCacheEngineWorker({
            scope: this.scope,
            createCore: (options) => new CacheWorkerCore(options),
            findOwnerLock: async () => ({}),
          });
        }

        postMessage(message: unknown, transfer: Transferable[]): void {
          this.scope.onmessage?.({
            data: message,
            ports: transfer,
          } as unknown as MessageEvent);
        }

        terminate(): void {}
      }
    );
    vi.stubGlobal('navigator', {
      locks,
      storage: { getDirectory: vi.fn() },
    });

    runtimeState.client = {
      executeQuery: () => makeSubject().source,
    } as unknown as Client;
  });

  afterEach(async () => {
    if (runtimeState.client) {
      disposeChannelNotificationRefresh(runtimeState.client);
    }
    await runtimeState.host?.dispose();
    runtimeState.host = undefined;
    runtimeState.engine = undefined;
    runtimeState.client = undefined;
    vi.unstubAllGlobals();
  });

  it('propagates membership and unread-count changes from the cache worker to the UI while skipping unchanged views', async () => {
    const engine = createChannelCacheEngine([
      makeWireChannel('ch-1', { isParticipant: true }),
      makeWireChannel('ch-2', { isParticipant: true }),
      makeWireChannel('ch-3', { isParticipant: false }),
      makeWireChannel('ch-4', { isParticipant: false }),
      makeWireChannel('ch-other', { isParticipant: false }),
    ]);
    runtimeState.engine = engine;
    const host = createWorkerCacheHost({
      scope: 'worker-ui-test',
      requestTimeoutMs: 2_000,
      onInitializationError: vi.fn(),
      telemetry: { record: vi.fn(), flush: vi.fn() },
    });
    runtimeState.host = host;

    const joinedArgs = () => ({
      params: { limit: 50, sort_method: 'created_at' as const },
      body: { chanf: { l: { IsParticipant: true } } } as never,
    });
    const byIdArgs = () => ({
      params: { limit: 50, sort_method: 'created_at' as const },
      body: {
        chanf: {
          '|': [{ l: { ChannelId: 'ch-3' } }, { l: { ChannelId: 'ch-4' } }],
        },
      } as never,
    });

    const {
      joinedQuery,
      byIdQuery,
      joinedIds,
      joinedUnread,
      byIdUnread,
      dispose,
    } = createRoot((dispose) => {
      const joinedQuery = createGraphqlSoupAstItemsQuery(joinedArgs, () => ({
        enabled: true,
        projection: 'channel-list',
        cacheFirstEntities: [
          { entityType: 'CHANNEL', entityId: 'ch-1' },
          { entityType: 'CHANNEL', entityId: 'ch-2' },
        ],
      }));
      const byIdQuery = createGraphqlSoupAstItemsQuery(byIdArgs, () => ({
        enabled: true,
        projection: 'channel-list',
        cacheFirstEntities: [
          { entityType: 'CHANNEL', entityId: 'ch-3' },
          { entityType: 'CHANNEL', entityId: 'ch-4' },
        ],
      }));
      const joinedChannels = createMemo(() =>
        (joinedQuery.data()?.entities ?? []).filter(isChannelEntity)
      );
      const byIdChannels = createMemo(() =>
        (byIdQuery.data()?.entities ?? []).filter(isChannelEntity)
      );
      const joinedIds = createMemo(() => joinedChannels().map((ch) => ch.id));
      const joinedUnread = createMemo(() =>
        Object.fromEntries(
          joinedChannels().map((ch) => [
            ch.id,
            ch.unreadNotifications?.length ?? 0,
          ])
        )
      );
      const byIdUnread = createMemo(() =>
        Object.fromEntries(
          byIdChannels().map((ch) => [
            ch.id,
            ch.unreadNotifications?.length ?? 0,
          ])
        )
      );
      return {
        joinedQuery,
        byIdQuery,
        joinedIds,
        joinedUnread,
        byIdUnread,
        dispose,
      };
    });

    try {
      await vi.waitFor(() => {
        expect(joinedQuery.cacheStatus?.()).toBe('ready');
        expect(byIdQuery.cacheStatus?.()).toBe('ready');
      });
      expect(joinedIds()).toEqual(['ch-1', 'ch-2']);
      expect(joinedUnread()).toEqual({ 'ch-1': 0, 'ch-2': 0 });
      expect(byIdUnread()).toEqual({ 'ch-3': 0, 'ch-4': 0 });

      const initialCalls = new Map(engine.entityFilterCalls);
      expect(initialCalls.size).toBe(2);
      const [joinedViewId, byIdViewId] = [...initialCalls.keys()];
      const ch2Before = joinedQuery
        .data()
        ?.entities.find(
          (entity): entity is ChannelEntity =>
            isChannelEntity(entity) && entity.id === 'ch-2'
        );

      // 1. Unrelated hydration flows through CacheWorkerCore -> Coordinator ->
      // WorkerCacheHost with unchangedViews covering both live queries:
      // neither view should re-run entityFilter.
      await host.hydrateQuery({
        generation: TEST_AUTHORITY_GENERATION,
        query: 'query HydrateUnrelated { channels { id } }',
        data: {
          channels: [
            makeWireChannel('ch-other', {
              isParticipant: false,
              channelName: 'Renamed unrelated channel',
            }),
          ],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(engine.entityFilterCalls.get(joinedViewId)).toBe(
        initialCalls.get(joinedViewId)
      );
      expect(engine.entityFilterCalls.get(byIdViewId)).toBe(
        initialCalls.get(byIdViewId)
      );

      // 2. Real unread-count change on ch-1 through the worker: joinedView
      // refreshes and updates the UI unread count while byIdView skips.
      await host.hydrateQuery({
        generation: TEST_AUTHORITY_GENERATION,
        query:
          'query HydrateUnread { channels { id unreadNotifications { id } } }',
        data: {
          channels: [
            makeWireChannel('ch-1', {
              isParticipant: true,
              unreadNotifications: [
                {
                  id: 'notif-1',
                  state: 'UNREAD',
                  createdAt: '2026-11-25T12:00:00.000Z',
                },
              ],
            }),
          ],
        },
      });
      await vi.waitFor(() => {
        expect(joinedUnread()).toEqual({ 'ch-1': 1, 'ch-2': 0 });
      });
      expect(engine.entityFilterCalls.get(joinedViewId)).toBe(
        (initialCalls.get(joinedViewId) ?? 0) + 1
      );
      expect(engine.entityFilterCalls.get(byIdViewId)).toBe(
        initialCalls.get(byIdViewId)
      );
      // Unchanged sibling ch-2 keeps its projected ChannelEntity identity.
      const ch2AfterUnread = joinedQuery
        .data()
        ?.entities.find(
          (entity): entity is ChannelEntity =>
            isChannelEntity(entity) && entity.id === 'ch-2'
        );
      expect(ch2AfterUnread).toBe(ch2Before);

      // 3. Real membership change through the worker: viewer leaves ch-1 and
      // joins ch-5. joinedView drops ch-1 and adds ch-5 in the UI while
      // byIdView still skips.
      await host.hydrateQuery({
        generation: TEST_AUTHORITY_GENERATION,
        query: 'query HydrateMembership { channels { id isParticipant } }',
        data: {
          channels: [
            makeWireChannel('ch-1', { isParticipant: false }),
            makeWireChannel('ch-5', { isParticipant: true }),
          ],
        },
      });
      await vi.waitFor(() => {
        expect(joinedIds()).toEqual(['ch-2', 'ch-5']);
      });
      expect(engine.entityFilterCalls.get(byIdViewId)).toBe(
        initialCalls.get(byIdViewId)
      );

      // 4. Foreground writeQuery (which omits unchangedViews, matching
      // cache-wasm shell.rs) updates ch-3's unread count in the UI.
      await host.writeQuery({
        generation: TEST_AUTHORITY_GENERATION,
        query:
          'query WriteUnread { channels { id unreadNotifications { id } } }',
        data: {
          channels: [
            makeWireChannel('ch-3', {
              isParticipant: false,
              unreadNotifications: [
                {
                  id: 'notif-3a',
                  state: 'UNREAD',
                  createdAt: '2026-11-25T12:01:00.000Z',
                },
                {
                  id: 'notif-3b',
                  state: 'UNREAD',
                  createdAt: '2026-11-25T12:02:00.000Z',
                },
              ],
            }),
          ],
        },
      });
      await vi.waitFor(() => {
        expect(byIdUnread()).toEqual({ 'ch-3': 2, 'ch-4': 0 });
      });
    } finally {
      dispose();
    }
  });

  it('keeps a channel that moves to another window chunk visible across a cache miss and a 50 ms network fetch', async () => {
    const initialIds = Array.from(
      { length: 60 },
      (_, index) => `ch-${String(index).padStart(4, '0')}`
    );
    const engine = createChannelCacheEngine(
      initialIds.map((id) => makeWireChannel(id, { isParticipant: true }))
    );
    runtimeState.engine = engine;
    const host = createWorkerCacheHost({
      scope: 'worker-ui-test',
      requestTimeoutMs: 2_000,
      onInitializationError: vi.fn(),
      telemetry: { record: vi.fn(), flush: vi.fn() },
    });
    runtimeState.host = host;

    let networkFetches = 0;
    const pendingFetches: Promise<void>[] = [];
    let fetchStarted!: () => void;
    const fetchStartedPromise = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    let releaseFetch!: () => void;
    const releaseFetchPromise = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    runtimeState.client = {
      executeQuery: (
        request: { variables?: unknown },
        opts?: Record<string, unknown>
      ) => {
        const subject = makeSubject<OperationResult>();
        const serialized = JSON.stringify(request?.variables ?? {});
        if (serialized.includes('ch-0000')) {
          networkFetches += 1;
          fetchStarted();
          pendingFetches.push(
            (async () => {
              await releaseFetchPromise;
              const restored = makeWireChannel('ch-0000', {
                isParticipant: true,
                channelName: 'Restored ch-0000',
              });
              await host.writeQuery({
                generation: TEST_AUTHORITY_GENERATION,
                query:
                  'query MissingChannels { user { soup { items { id } } } }',
                data: { channels: [restored] },
              });
              subject.next({
                operation: { ...request, context: opts ?? {} } as never,
                data: {
                  user: {
                    soup: {
                      items: [restored],
                      nextCursor: null,
                    },
                  },
                },
                stale: false,
                hasNext: false,
              });
              subject.complete();
            })()
          );
        }
        return subject.source;
      },
    } as unknown as Client;

    const queryClient = new QueryClient();
    let result!: ReturnType<typeof useChannelWindow>;
    let setIds!: (next: string[]) => void;
    let watchCompaction = false;
    const missingSnapshots: Array<{ ids: string[]; loading: boolean }> = [];
    // What a sidebar shows: the window's records and those it retained.
    const visible = () => [...result.channels(), ...result.retained()];

    const dispose = createRoot((dispose) => {
      const [ids, updateIds] = createSignal(initialIds);
      setIds = updateIds;
      createComponent(QueryClientProvider, {
        client: queryClient,
        get children() {
          result = useChannelWindow(
            () => channelIdWindow([{ key: 'section', ids: ids() }]),
            () => true
          );
          createComputed(() => {
            const list = visible();
            if (watchCompaction && !list.some((ch) => ch.id === 'ch-0000')) {
              missingSnapshots.push({
                ids: list.map((ch) => ch.id).sort(),
                loading: result.isLoading(),
              });
            }
          });
          return null;
        },
      });
      return dispose;
    });

    try {
      await vi.waitFor(
        () => {
          expect(result.channels()).toHaveLength(60);
        },
        { timeout: 10_000 }
      );

      // Evict ch-0000 from the local cache so the chunk it moves to misses it
      // and falls back to the network fetch.
      engine.evictChannel('ch-0000');
      watchCompaction = true;

      // Every chunk changes: ch-0000 leaves block 0 for the new block 0 of
      // fewer IDs, which looks up all four again.
      const surviving = ['ch-0000', 'ch-0025', 'ch-0040', 'ch-0059'];
      setIds(surviving);

      // Wait until the real missing-entity network lookup starts, hold it open
      // for 50 ms, and confirm ch-0000 stays visible the entire time.
      await fetchStartedPromise;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(visible().some((ch) => ch.id === 'ch-0000')).toBe(true);
      expect(missingSnapshots).toEqual([]);

      releaseFetch();
      await Promise.all(pendingFetches);
      await vi.waitFor(() => {
        const ch0 = result.channels().find((ch) => ch.id === 'ch-0000');
        expect(ch0?.name).toBe('Restored ch-0000');
      });
      expect(networkFetches).toBeGreaterThanOrEqual(1);
      expect(missingSnapshots).toEqual([]);
    } finally {
      releaseFetch();
      dispose();
      queryClient.clear();
    }
  });
});
