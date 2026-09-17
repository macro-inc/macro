import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountEmailMutation } from './tests/mutation';

const mocks = vi.hoisted(() => ({
  graphqlEnabled: true,
  markSeen: vi.fn(),
  updateLabel: vi.fn(),
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
vi.mock('../soup/graphql/active-queries', () => ({
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
  UpdateEmailThreadReadLabelDocument,
} from '@service-storage/graphql/generated/graphql';
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
              : { updateEmailThreadLabel: { id: 'thread', isRead: false } },
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
            read
              ? MarkEmailThreadSeenDocument
              : UpdateEmailThreadReadLabelDocument
          );
          expect(variables).toEqual({
            input: read
              ? { threadId: 'thread' }
              : { threadId: 'thread', labelId: 'unread-label', value: true },
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

  it('does not refetch server membership over a queued offline read update', async () => {
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
    const mutation = mountEmailMutation(useMarkThreadAsSeenMutation, client);
    await mutation.mutateAsync({ threadId: 'thread' });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.markSeen).not.toHaveBeenCalled();
  });
});
