import { CombinedError } from '@urql/core';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  graphql: true,
  cache: true,
  archive: vi.fn(),
  archiveBatch: vi.fn(),
  mutation: vi.fn(),
  refresh: vi.fn(),
  reminders: vi.fn(),
  revalidations: vi.fn(() => [] as unknown[]),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => mocks.graphql,
}));
vi.mock('@service-email/client', () => ({
  emailClient: {
    flagArchived: mocks.archive,
    flagArchivedBatch: mocks.archiveBatch,
  },
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ mutation: mocks.mutation }),
  graphqlCacheEnabled: () => mocks.cache,
}));
vi.mock('../reminders/email-collection', () => ({
  invalidateEmailReminderCollection: mocks.reminders,
}));
vi.mock('../soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
  getUnmaintainedGraphqlSoupRevalidations: mocks.revalidations,
}));

import { predictOptimisticMutation } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  SetEmailThreadArchivedDocument,
  SetEmailThreadsArchivedDocument,
  SoupDocument,
} from '@service-storage/graphql/generated/graphql';
import { soupOptimisticResolvers } from '../optimistic-resolvers';
import { archiveEmailThread, archiveEmailThreads } from './integration';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.graphql = true;
  mocks.cache = true;
  mocks.refresh.mockResolvedValue(undefined);
  mocks.revalidations.mockReturnValue([]);
});

describe('GraphQL email archive writes', () => {
  it.each([true, false])(
    'writes inboxVisible optimistically for archive=%s before the request settles',
    async (value) => {
      let finish!: () => void;
      const network = new Promise<void>((resolve) => {
        finish = resolve;
      });
      mocks.mutation.mockReturnValue({
        toPromise: async () => {
          await network;
          return {
            data: {
              setEmailThreadArchived: {
                __typename: 'GraphqlSoupEmailThread',
                id: 'thread',
                inboxVisible: !value,
              },
            },
          };
        },
      });
      const result = archiveEmailThread({ id: 'thread', value }, 'secondary');
      expect(mocks.mutation).toHaveBeenCalledWith(
        SetEmailThreadArchivedDocument,
        { input: { threadId: 'thread', archived: value } },
        expect.objectContaining({ optimisticMutation: { revalidations: [] } })
      );
      expect(
        predictOptimisticMutation(
          soupOptimisticResolvers,
          SetEmailThreadArchivedDocument,
          { input: { threadId: 'thread', archived: value } }
        )?.response
      ).toEqual({
        setEmailThreadArchived: {
          __typename: 'GraphqlSoupEmailThread',
          id: 'thread',
          inboxVisible: !value,
        },
      });
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.reminders).not.toHaveBeenCalled();
      finish();
      await expect(result).resolves.toBe('committed');
      expect(mocks.reminders).toHaveBeenCalledOnce();
      // The cached record carries the change to every list the cache
      // maintains; only the others are read again, by the exchange.
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.revalidations).toHaveBeenCalledOnce();
    }
  );

  it('refreshes lists after the write only without the normalized cache', async () => {
    mocks.cache = false;
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        data: { setEmailThreadArchived: { id: 'thread' } },
      }),
    });
    await expect(
      archiveEmailThread({ id: 'thread', value: true })
    ).resolves.toBe('committed');
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({
      target: { kind: 'email-archive', threadId: 'thread' },
    });
  });

  it('gives Done, Undo and Redo distinct ordered mutation intents', async () => {
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        data: { setEmailThreadArchived: { id: 'thread' } },
      }),
    });
    for (const value of [true, false, true])
      await archiveEmailThread({ id: 'thread', value });
    const calls = mocks.mutation.mock.calls;
    expect(calls.map(([, variables]) => variables.input.archived)).toEqual([
      true,
      false,
      true,
    ]);
    expect(calls).toHaveLength(3);
    // No caller-supplied UUID coalesces these separate intents. The resolver
    // exchange assigns their transaction IDs when each operation is prepared.
    expect(
      calls.every(
        ([, , context]) => context.optimisticMutation.uuid === undefined
      )
    ).toBe(true);
  });

  it('queues an offline write that reads only unmaintained lists on replay', async () => {
    const unmaintained = [
      { document: SoupDocument, variables: { input: { initial: {} } } },
    ];
    mocks.revalidations.mockReturnValue(unmaintained);
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'queued',
            transactionId: 'tx',
          },
        },
      }),
    });
    await expect(
      archiveEmailThread({ id: 'thread', value: true })
    ).resolves.toBe('queued');
    // Replay commits the record; only lists the cache does not maintain are
    // read again, even after a reload.
    expect(mocks.revalidations).toHaveBeenCalled();
    expect(
      mocks.mutation.mock.calls[0][2].optimisticMutation.revalidations
    ).toEqual(unmaintained);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.reminders).not.toHaveBeenCalled();
  });

  it.each([
    { error: new CombinedError({ graphQLErrors: ['not authorized'] }) },
    {
      extensions: {
        normalizedCacheMutationDisposition: {
          kind: 'permanently-failed',
          error: new Error('rejected'),
        },
      },
    },
    { data: {} },
  ])(
    'does not report a rejected/missing mutation reply as success: %j',
    async (reply) => {
      mocks.mutation.mockReturnValue({ toPromise: async () => reply });
      await expect(
        archiveEmailThread({ id: 'thread', value: true })
      ).rejects.toThrow();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.reminders).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])(
    'keeps archive=%s on REST when GraphQL is disabled',
    async (value) => {
      mocks.graphql = false;
      mocks.archive.mockResolvedValue(ok(undefined));
      await expect(
        archiveEmailThread({ id: 'thread', value }, 'secondary')
      ).resolves.toBe('committed');
      expect(mocks.archive).toHaveBeenCalledWith(
        { id: 'thread', value },
        'secondary'
      );
      expect(mocks.mutation).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.reminders).toHaveBeenCalledOnce();
    }
  );

  it('preserves REST failure behavior', async () => {
    mocks.graphql = false;
    mocks.archive.mockResolvedValue(err(new Error('archive failed')));
    await expect(
      archiveEmailThread({ id: 'thread', value: true })
    ).rejects.toThrow();
  });
});

describe('bulk email archive writes', () => {
  it('archives every selected thread with one GraphQL mutation and rejects only the threads the server names', async () => {
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        data: {
          setEmailThreadsArchived: {
            // A committed thread the server could not reload is absent, not failed.
            threads: [
              {
                __typename: 'GraphqlSoupEmailThread',
                id: 'skipped',
                inboxVisible: true,
              },
            ],
            failedThreadIds: ['skipped'],
          },
        },
      }),
    });
    const results = await archiveEmailThreads(
      ['archived', 'skipped', 'unreloaded'],
      true
    );
    expect(mocks.mutation).toHaveBeenCalledExactlyOnceWith(
      SetEmailThreadsArchivedDocument,
      {
        input: {
          threadIds: ['archived', 'skipped', 'unreloaded'],
          archived: true,
        },
      },
      expect.objectContaining({ optimisticMutation: { revalidations: [] } })
    );
    expect(
      predictOptimisticMutation(
        soupOptimisticResolvers,
        SetEmailThreadsArchivedDocument,
        { input: { threadIds: ['archived', 'skipped'], archived: true } }
      )?.response
    ).toEqual({
      setEmailThreadsArchived: {
        threads: [
          {
            __typename: 'GraphqlSoupEmailThread',
            id: 'archived',
            inboxVisible: false,
          },
          {
            __typename: 'GraphqlSoupEmailThread',
            id: 'skipped',
            inboxVisible: false,
          },
        ],
      },
    });
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'committed' });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'committed' });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.reminders).toHaveBeenCalledOnce();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it('refreshes lists for each changed thread only without the normalized cache', async () => {
    mocks.cache = false;
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        data: {
          setEmailThreadsArchived: {
            threads: [],
            failedThreadIds: ['skipped'],
          },
        },
      }),
    });
    await archiveEmailThreads(['archived', 'skipped'], true);
    expect(mocks.refresh.mock.calls).toEqual([
      [{ target: { kind: 'email-archive', threadId: 'archived' } }],
    ]);
  });

  it('settles every thread as queued when the GraphQL write is queued', async () => {
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'queued',
            transactionId: 'tx',
          },
        },
      }),
    });
    await expect(archiveEmailThreads(['a', 'b'], false)).resolves.toEqual([
      { status: 'fulfilled', value: 'queued' },
      { status: 'fulfilled', value: 'queued' },
    ]);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.reminders).not.toHaveBeenCalled();
  });

  it('rejects every thread of a failed request without throwing', async () => {
    const error = new CombinedError({ graphQLErrors: ['not authorized'] });
    mocks.mutation.mockReturnValue({ toPromise: async () => ({ error }) });
    const results = await archiveEmailThreads(['a', 'b'], true);
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(mocks.reminders).not.toHaveBeenCalled();
  });

  it('sends at most 100 threads per REST request when GraphQL is disabled', async () => {
    mocks.graphql = false;
    const ids = Array.from({ length: 101 }, (_, index) => `thread-${index}`);
    mocks.archiveBatch.mockImplementation(
      async ({ thread_ids }: { thread_ids: string[] }) =>
        ok({
          updated_thread_ids: thread_ids.filter((id) => id !== 'thread-0'),
          failed_thread_ids: thread_ids.filter((id) => id === 'thread-0'),
        })
    );
    const results = await archiveEmailThreads(ids, true);
    expect(mocks.archiveBatch.mock.calls).toEqual([
      [{ thread_ids: ids.slice(0, 100), value: true }],
      [{ thread_ids: ids.slice(100), value: true }],
    ]);
    expect(results[0].status).toBe('rejected');
    expect(results.slice(1)).toEqual(
      ids.slice(1).map(() => ({ status: 'fulfilled', value: 'committed' }))
    );
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(mocks.reminders).toHaveBeenCalledOnce();
  });
});
