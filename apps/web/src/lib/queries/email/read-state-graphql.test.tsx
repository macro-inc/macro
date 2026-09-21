import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountEmailMutation } from './tests/mutation';

const mocks = vi.hoisted(() => ({
  graphqlEnabled: true,
  markSeen: vi.fn(),
  updateLabel: vi.fn(),
  getLabels: vi.fn(),
  legacyPatch: vi.fn(),
  graphqlMutation: vi.fn(),
  refresh: vi.fn(),
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
    getUserLabels: mocks.getLabels,
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
vi.mock('../soup/graphql/active-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../soup/graphql/active-queries')>()),
  refreshActiveGraphqlSoupQueries: mocks.refresh,
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
  getGraphqlSoupClient: () => ({ mutation: mocks.graphqlMutation }),
}));

import {
  MarkEmailThreadSeenDocument,
  MarkEmailThreadUnreadDocument,
  SoupDocument,
} from '@service-storage/graphql/generated/graphql';
import { stringifyDocument } from '@urql/core';
import { registerGraphqlSoupRevalidations } from '../soup/graphql/active-queries';
import { emailKeys } from './keys';
import {
  useMarkThreadAsSeenMutation,
  useMarkThreadAsUnreadMutation,
} from './thread';

let client: QueryClient;

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
  vi.resetAllMocks();
  mocks.graphqlEnabled = true;
  mocks.legacyPatch.mockReturnValue({ rollback: vi.fn() });
  mocks.refresh.mockResolvedValue(undefined);
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
      const network = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const restRequest = read ? mocks.markSeen : mocks.updateLabel;
      restRequest.mockImplementation(async () => {
        await network;
        return ok(undefined);
      });
      // Inspect the actual optimistic context sent to the normalized exchange,
      // before allowing the GraphQL network result through. No uncached fallback.
      mocks.graphqlMutation.mockReturnValue({
        toPromise: async () => {
          await network;
          return {
            data: read
              ? { markEmailThreadSeen: { id: 'thread', isRead: true } }
              : { markEmailThreadUnread: { id: 'thread', isRead: false } },
          };
        },
      });
      const mutation = mountEmailMutation(
        read ? useMarkThreadAsSeenMutation : useMarkThreadAsUnreadMutation,
        client
      );
      const result = mutation.mutateAsync({
        threadId: 'thread',
        linkId: 'inbox',
      });
      try {
        await vi.waitFor(() =>
          expect(
            graphql ? mocks.graphqlMutation : restRequest
          ).toHaveBeenCalledOnce()
        );
        expect(mutation.isPending).toBe(true);
        if (graphql) {
          const [document, variables, context] =
            mocks.graphqlMutation.mock.calls[0];
          expect(document).toBe(
            read ? MarkEmailThreadSeenDocument : MarkEmailThreadUnreadDocument
          );
          expect(variables).toEqual({
            input: { threadId: 'thread' },
          });
          expect(
            hasReadPatch(
              context.normalizedCacheOptimistic.optimisticResponse,
              read
            ),
            'A legacy Soup patch does not update GraphqlSoupEmailThread.isRead'
          ).toBe(true);
          expect(restRequest).not.toHaveBeenCalled();
          expect(mocks.legacyPatch).not.toHaveBeenCalled();
        } else {
          expect(mocks.graphqlMutation).not.toHaveBeenCalled();
          expect(mocks.legacyPatch).toHaveBeenCalledWith(
            expect.objectContaining({
              tag: 'emailThread',
              data: { id: 'thread', isRead: read },
            })
          );
        }
        expect(mocks.refresh).not.toHaveBeenCalled();
      } finally {
        finish();
        await result;
      }
      expect(mocks.refresh).toHaveBeenCalledTimes(graphql ? 1 : 0);
    }
  );

  it.each(['missing', 'stale'] as const)(
    'starts unread optimism without fetching %s labels',
    async (labelsState) => {
      if (labelsState === 'missing') {
        client.removeQueries({ queryKey: emailKeys.labels.queryKey });
      } else {
        client.setQueryData(
          emailKeys.labels.queryKey,
          { labels: [] },
          {
            updatedAt: Date.now() - 10 * 60 * 1000,
          }
        );
      }
      let finish!: () => void;
      const network = new Promise<void>((resolve) => {
        finish = resolve;
      });
      // A label request would block forever. The GraphQL path must not need it.
      mocks.getLabels.mockReturnValue(new Promise(() => {}));
      mocks.graphqlMutation.mockReturnValue({
        toPromise: async () => {
          await network;
          return {
            data: { markEmailThreadUnread: { id: 'thread', isRead: false } },
          };
        },
      });
      const mutation = mountEmailMutation(
        useMarkThreadAsUnreadMutation,
        client
      );
      const result = mutation.mutateAsync({
        threadId: 'thread',
        linkId: 'secondary-inbox',
      });
      try {
        await vi.waitFor(() =>
          expect(mocks.graphqlMutation).toHaveBeenCalledOnce()
        );
        const [document, variables, context] =
          mocks.graphqlMutation.mock.calls[0];
        expect(document).toBe(MarkEmailThreadUnreadDocument);
        expect(variables).toEqual({ input: { threadId: 'thread' } });
        expect(
          hasReadPatch(
            context.normalizedCacheOptimistic.optimisticResponse,
            false
          )
        ).toBe(true);
        expect(mutation.isPending).toBe(true);
        expect(mocks.getLabels).not.toHaveBeenCalled();
        expect(mocks.legacyPatch).not.toHaveBeenCalled();
        expect(mocks.refresh).not.toHaveBeenCalled();
      } finally {
        finish();
        await result;
      }
      expect(mocks.refresh).toHaveBeenCalledOnce();
    }
  );

  it.each([useMarkThreadAsSeenMutation, useMarkThreadAsUnreadMutation])(
    'queues membership revalidation without refetching over offline optimism',
    async (useMutation) => {
      const variables = { input: { initial: { limit: 50 } } };
      const unregister = registerGraphqlSoupRevalidations(() => [
        { document: SoupDocument, variables },
      ]);
      mocks.graphqlMutation.mockReturnValue({
        toPromise: async () => ({
          extensions: {
            normalizedCacheMutationDisposition: {
              kind: 'queued',
              transactionId: 'tx',
            },
          },
        }),
      });
      try {
        const mutation = mountEmailMutation(useMutation, client);
        await mutation.mutateAsync({ threadId: 'thread' });
        expect(
          mocks.graphqlMutation.mock.calls[0][2].normalizedCacheOptimistic
            .revalidations
        ).toEqual([
          {
            query: stringifyDocument(SoupDocument),
            operationName: 'Soup',
            variablesJson: JSON.stringify(variables),
          },
        ]);
        expect(mocks.refresh).not.toHaveBeenCalled();
        expect(mocks.markSeen).not.toHaveBeenCalled();
      } finally {
        unregister();
      }
    }
  );
});
