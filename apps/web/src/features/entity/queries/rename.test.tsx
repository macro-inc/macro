import { withOptimisticMutationDisposition } from '@graphql-cache/exchange/optimistic';
import { optimisticResolversExchange } from '@graphql-cache/exchange/optimistic-resolvers';
import type { CacheHost } from '@graphql-cache/host/types';
import type { MutationSettlement } from '@graphql-cache/protocol';
import { entityOptimisticResolvers } from '@queries/entity-optimistic-resolvers';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import {
  type Client,
  createClient,
  type Exchange,
  type Operation,
} from '@urql/core';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';

const mocks = vi.hoisted(() => ({
  client: undefined as Client | undefined,
  host: undefined as
    | Pick<CacheHost, 'onMutationSettled' | 'onCacheGenerationChanged'>
    | undefined,
  preview: vi.fn(),
  history: vi.fn(),
  soup: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@core/component/FileList/itemOperations', () => ({
  renameItem: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toast },
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => true,
}));
vi.mock('@queries/agent-session/entity-mutations', () => ({
  renameAgentSession: vi.fn(),
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return cache;
  },
}));
vi.mock('@queries/history/history', () => ({
  setHistoryItemName: mocks.history,
}));
vi.mock('@queries/preview', () => ({ setPreviewName: mocks.preview }));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: vi.fn(),
  optimisticUpdateSoupEntity: mocks.soup,
}));
vi.mock('@service-storage/client', () => ({
  ChannelTypeEnum: { DirectMessage: 'direct_message' },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getEntityGraphqlClient: () => mocks.client,
  getGraphqlCacheHost: () => mocks.host,
}));

import { callKeys } from '@queries/call/keys';
import { channelKeys } from '@queries/channel/keys';
import { createRenameDssEntityMutation } from './rename';

let cache: QueryClient;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  cache.clear();
  vi.clearAllMocks();
});

it.each(['channel', 'call'] as const)(
  'does not leave a rejected queued %s rename in legacy caches',
  async (type) => {
    cache = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const listeners = new Set<(settlement: MutationSettlement) => void>();
    mocks.host = {
      onMutationSettled(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onCacheGenerationChanged: () => () => {},
    };
    const operations: Operation[] = [];
    const exchange: Exchange = () => (source) =>
      pipe(
        source,
        filter((operation) => operation.kind === 'mutation'),
        map((operation) => {
          operations.push(operation);
          return withOptimisticMutationDisposition(
            { operation, stale: false, hasNext: false },
            { kind: 'queued', transactionId: 'queued' }
          );
        })
      );
    mocks.client = createClient({
      url: 'http://test.invalid',
      exchanges: [
        optimisticResolversExchange(entityOptimisticResolvers),
        exchange,
      ],
    });
    const key =
      type === 'channel'
        ? channelKeys.listChannels.queryKey
        : callKeys.record('entity').queryKey;
    const original =
      type === 'channel'
        ? [{ id: 'entity', name: 'Before' }]
        : { id: 'entity', customName: 'Before' };
    cache.setQueryData(key, original);
    const invalidate = vi.spyOn(cache, 'invalidateQueries');
    let mutation!: ReturnType<typeof createRenameDssEntityMutation>;
    dispose = render(
      () => (
        <QueryClientProvider client={cache}>
          {(() => {
            mutation = createRenameDssEntityMutation();
            return null;
          })()}
        </QueryClientProvider>
      ),
      document.createElement('div')
    );
    const result = await mutation.mutateAsync({
      entity: { id: 'entity', type, name: 'Before' },
      newName: 'Queued',
    });
    expect(result).toEqual({ success: true, queued: true });
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.soup).not.toHaveBeenCalled();
    expect(cache.getQueryData(key)).toEqual(original);
    expect(mocks.toast).not.toHaveBeenCalled();
    const context = operations[0].context.optimisticMutation;
    if (!context) throw new Error('Missing optimistic context');
    for (const listener of [...listeners])
      listener({
        transactionId: 'queued',
        mutationUuid: context.uuid,
        status: 'permanently-failed',
        error: 'Denied',
      });
    expect(cache.getQueryData(key)).toEqual(original);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    expect(listeners.size).toBe(0);
  }
);
