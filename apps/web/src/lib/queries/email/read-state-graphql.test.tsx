import type { CacheWriteArgs } from '@graphql-cache/host/types';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountEmailMutation } from './tests/mutation';

const mocks = vi.hoisted(() => ({
  graphqlEnabled: true,
  markSeen: vi.fn(),
  updateLabel: vi.fn(),
  legacyPatch: vi.fn(),
  writeQuery: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => mocks.graphqlEnabled,
}));
vi.mock('@service-email/client', () => ({
  emailClient: {
    markThreadAsSeen: mocks.markSeen,
    updateThreadLabel: mocks.updateLabel,
  },
}));
vi.mock('../client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('../soup/cache', () => ({
  optimisticUpdateSoupEntity: mocks.legacyPatch,
  refetchSoupEntity: vi.fn(),
}));
vi.mock('../soup/normalized-cache', () => ({ invalidateAllSoup: vi.fn() }));
vi.mock('../undo', () => ({ useUndoableMutation: vi.fn() }));
vi.mock('./graphql/thread', () => ({
  createGraphqlEmailThreadQuery: vi.fn(),
  fetchGraphqlEmailThread: vi.fn(),
  mapGraphqlThreadError: vi.fn(),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.graphqlEnabled }),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@macro-inc/observability', () => ({ Telemetry: { error: vi.fn() } }));
vi.mock('@service-storage/graphql-soup', () => ({
  graphqlCacheEnabled: () => true,
  getGraphqlCacheHost: () => host,
  getGraphqlSoupCacheHost: () => host,
}));

import { emailKeys } from './keys';
import {
  useMarkThreadAsSeenMutation,
  useMarkThreadAsUnreadMutation,
} from './thread';

let client: QueryClient;
// Healthy cache boundary: no initialization, fallback, real browser storage, or
// websocket delivery is involved. Inspect the write intent before network success.
const host = {
  disabled: false,
  writeQuery: mocks.writeQuery,
  enqueueOptimisticMutation: mocks.enqueue,
};

function hasReadPatch(value: unknown, isRead: boolean): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value))
    return value.some((item) => hasReadPatch(item, isRead));
  const record = value as Record<string, unknown>;
  return (
    (record.__typename === 'GraphqlSoupEmailThread' &&
      record.id === 'thread' &&
      record.isRead === isRead) ||
    Object.values(record).some((item) => hasReadPatch(item, isRead))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.graphqlEnabled = true;
  mocks.legacyPatch.mockReturnValue({ rollback: vi.fn() });
  mocks.writeQuery.mockResolvedValue(undefined);
  mocks.enqueue.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(emailKeys.labels.queryKey, {
    labels: [
      { id: 'unread-label', linkId: 'inbox', providerLabelId: 'UNREAD' },
    ],
  });
});
afterEach(() => client.clear());

describe('email read state with GraphQL Soup', () => {
  it.each([
    { read: true, graphql: true },
    { read: false, graphql: true },
    { read: true, graphql: false },
    { read: false, graphql: false },
  ])(
    'propagates isRead=$read before the request settles (GraphQL=$graphql)',
    async ({ read, graphql }) => {
      mocks.graphqlEnabled = graphql;
      let finish!: () => void;
      const network = new Promise<ReturnType<typeof ok<void>>>((resolve) => {
        finish = () => resolve(ok(undefined));
      });
      const request = read ? mocks.markSeen : mocks.updateLabel;
      request.mockReturnValue(network);
      const mutation = mountEmailMutation(
        read ? useMarkThreadAsSeenMutation : useMarkThreadAsUnreadMutation,
        client
      );
      const result = mutation.mutateAsync({
        threadId: 'thread',
        linkId: 'inbox',
      });
      try {
        await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
        expect(mutation.isPending).toBe(true);
        const writes: CacheWriteArgs[] = [
          ...mocks.writeQuery.mock.calls.map(([args]) => args),
          ...mocks.enqueue.mock.calls.map(([args]) => args),
        ];
        if (graphql) {
          expect(
            writes.some((write) => hasReadPatch(write.data, read)),
            'A legacy Soup patch does not update GraphqlSoupEmailThread.isRead'
          ).toBe(true);
        } else {
          expect(writes).toEqual([]);
          expect(mocks.legacyPatch).toHaveBeenCalledWith(
            expect.objectContaining({
              tag: 'emailThread',
              data: { id: 'thread', isRead: read },
            })
          );
        }
      } finally {
        finish();
        await result;
      }
    }
  );
});
