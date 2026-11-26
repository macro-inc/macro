import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountEmailMutation } from './tests/mutation';

const mocks = vi.hoisted(() => ({
  cacheEnabled: true,
  getCacheHost: vi.fn(),
  getLabels: vi.fn(),
  graphqlMutation: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@service-email/client', () => ({
  emailClient: { getUserLabels: mocks.getLabels },
}));
vi.mock('../client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('../soup/cache', () => ({ refetchSoupEntity: vi.fn() }));
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
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@macro-inc/observability', () => ({ Telemetry: { error: vi.fn() } }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlCacheHost: mocks.getCacheHost,
  getGraphqlSoupClient: () => ({ mutation: mocks.graphqlMutation }),
  graphqlCacheEnabled: () => mocks.cacheEnabled,
}));

import { predictOptimisticMutation } from '@graphql-cache/exchange/optimistic-resolvers';
import type { MutationSettlement } from '@graphql-cache/protocol';
import {
  MarkEmailThreadSeenDocument,
  MarkEmailThreadUnreadDocument,
  SoupDocument,
} from '@service-storage/graphql/generated/graphql';
import { soupOptimisticResolvers } from '../optimistic-resolvers';
import { registerGraphqlSoupRevalidations } from '../soup/graphql/active-queries';
import { soupKeys } from '../soup/keys';
import { emailKeys } from './keys';
import { markEmailThreadUnread } from './read-state';
import {
  trackExternalThreadArchive,
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
  mocks.cacheEnabled = true;
  mocks.refresh.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(emailKeys.labels.queryKey, {
    labels: [
      { id: 'unread-label', linkId: 'inbox', providerLabelId: 'UNREAD' },
    ],
  });
});
afterEach(() => client.clear());

describe('external archive disposition', () => {
  it.each(['queued', 'committed', 'failed'] as const)(
    'reads previews again only once a %s archive can be reconciled',
    async (disposition) => {
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      await trackExternalThreadArchive(
        disposition === 'failed'
          ? Promise.reject(new Error('archive failed'))
          : Promise.resolve(disposition)
      );
      expect(invalidate).toHaveBeenCalledTimes(
        disposition === 'queued' ? 0 : 1
      );
    }
  );
});

describe('email read state with GraphQL Soup', () => {
  it('retains a queued refusal that arrives before the admission result', async () => {
    let reportSettlement!: (settlement: MutationSettlement) => void;
    const stop = vi.fn();
    const stopGeneration = vi.fn();
    mocks.getCacheHost.mockReturnValue({
      onMutationSettled: (listener: typeof reportSettlement) => {
        reportSettlement = listener;
        return stop;
      },
      onCacheGenerationChanged: () => stopGeneration,
    });
    mocks.graphqlMutation.mockImplementation((_document, _params, context) => ({
      toPromise: async () => {
        reportSettlement({
          transactionId: 'other',
          mutationUuid: 'another-write',
          status: 'committed',
        });
        reportSettlement({
          transactionId: 'unread',
          mutationUuid: context.optimisticMutation.uuid,
          status: 'permanently-failed',
          error: 'refused by the mailbox',
        });
        return {
          extensions: {
            normalizedCacheMutationDisposition: {
              kind: 'queued',
              transactionId: 'unread',
            },
          },
        };
      },
    }));

    const result = await markEmailThreadUnread({ threadId: 'thread' }, true);

    if (result.kind !== 'queued') throw new Error('expected a queued write');
    await expect(result.settlement).resolves.toBe('permanently-failed');
    expect(stop).toHaveBeenCalledOnce();
    expect(stopGeneration).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    'propagates isRead=%s before the request settles',
    async (read) => {
      const folderKeys = ['spam', 'trash'].map(
        (emailView) =>
          soupKeys.astItems({
            params: {},
            body: { emailView },
            transport: 'rest',
          }).queryKey
      );
      const allKey = soupKeys.astItems({
        params: {},
        body: { emailView: 'all' },
      }).queryKey;
      for (const key of [...folderKeys, allKey])
        client.setQueryData(key, { pages: [] });
      let finish!: () => void;
      const network = new Promise<void>((resolve) => {
        finish = resolve;
      });
      // The call supplies variables; the shared registry supplies the optimistic fields.
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
        () =>
          read
            ? useMarkThreadAsSeenMutation()
            : useMarkThreadAsUnreadMutation(),
        client
      );
      const result = mutation.mutateAsync({ threadId: 'thread' });
      try {
        await vi.waitFor(() =>
          expect(mocks.graphqlMutation).toHaveBeenCalledOnce()
        );
        expect(mutation.isPending).toBe(true);
        const [document, variables] = mocks.graphqlMutation.mock.calls[0];
        expect(document).toBe(
          read ? MarkEmailThreadSeenDocument : MarkEmailThreadUnreadDocument
        );
        expect(variables).toEqual({
          input: { threadId: 'thread' },
        });
        expect(
          hasReadPatch(
            predictOptimisticMutation(
              soupOptimisticResolvers,
              document,
              variables
            )?.response,
            read
          ),
          'A legacy Soup patch does not update GraphqlSoupEmailThread.isRead'
        ).toBe(true);
        expect(mocks.refresh).not.toHaveBeenCalled();
      } finally {
        finish();
        await result;
      }
      // Shared-cache lists stay local; isolated folder previews need a new read.
      expect(mocks.refresh).not.toHaveBeenCalled();
      for (const key of folderKeys)
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(client.getQueryState(allKey)?.isInvalidated).toBe(false);
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
      const result = mutation.mutateAsync({ threadId: 'thread' });
      try {
        await vi.waitFor(() =>
          expect(mocks.graphqlMutation).toHaveBeenCalledOnce()
        );
        const [document, variables] = mocks.graphqlMutation.mock.calls[0];
        expect(document).toBe(MarkEmailThreadUnreadDocument);
        expect(variables).toEqual({ input: { threadId: 'thread' } });
        expect(
          hasReadPatch(
            predictOptimisticMutation(
              soupOptimisticResolvers,
              document,
              variables
            )?.response,
            false
          )
        ).toBe(true);
        expect(mutation.isPending).toBe(true);
        expect(mocks.getLabels).not.toHaveBeenCalled();
        expect(mocks.refresh).not.toHaveBeenCalled();
      } finally {
        finish();
        await result;
      }
      expect(mocks.refresh).not.toHaveBeenCalled();
    }
  );

  it.each([useMarkThreadAsSeenMutation, useMarkThreadAsUnreadMutation])(
    'refreshes lists only without the normalized cache',
    async (useMutation) => {
      mocks.cacheEnabled = false;
      mocks.graphqlMutation.mockReturnValue({
        toPromise: async () => ({
          data: {
            markEmailThreadSeen: { id: 'thread', isRead: true },
            markEmailThreadUnread: { id: 'thread', isRead: false },
          },
        }),
      });
      const mutation = mountEmailMutation(() => useMutation(), client);
      await mutation.mutateAsync({ threadId: 'thread' });
      expect(mocks.refresh).toHaveBeenCalledOnce();
    }
  );

  it.each([useMarkThreadAsSeenMutation, useMarkThreadAsUnreadMutation])(
    'queues an offline write that reads only unmaintained lists on replay',
    async (useMutation) => {
      const variables = { input: { initial: { limit: 50 } } };
      const grouped = { input: { initial: { limit: 20 } } };
      const unregisterMaintained = registerGraphqlSoupRevalidations(
        () => [{ document: SoupDocument, variables }],
        undefined,
        () => true
      );
      const unregisterGrouped = registerGraphqlSoupRevalidations(() => [
        { document: SoupDocument, variables: grouped },
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
        const mutation = mountEmailMutation(() => useMutation(), client);
        await mutation.mutateAsync({ threadId: 'thread' });
        // Replay commits the record, which the maintained list reads; only
        // the list the cache cannot keep current is read again.
        expect(
          mocks.graphqlMutation.mock.calls[0][2].optimisticMutation
            .revalidations
        ).toEqual([{ document: SoupDocument, variables: grouped }]);
        expect(mocks.refresh).not.toHaveBeenCalled();
      } finally {
        unregisterMaintained();
        unregisterGrouped();
      }
    }
  );
});
