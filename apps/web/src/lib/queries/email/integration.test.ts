import { CombinedError } from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: undefined as unknown,
  mutation: vi.fn(),
  reminders: vi.fn(),
  revalidations: vi.fn(() => [] as unknown[]),
  refresh: vi.fn(async () => {}),
}));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client ?? { mutation: mocks.mutation },
}));
vi.mock('../reminders/email-collection', () => ({
  invalidateEmailReminderCollection: mocks.reminders,
}));
vi.mock('../soup/graphql/active-queries', () => ({
  getUnmaintainedGraphqlSoupRevalidations: mocks.revalidations,
  refreshActiveGraphqlSoupQueries: mocks.refresh,
}));

import { predictOptimisticMutation } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  SetEmailThreadArchivedDocument,
  SetEmailThreadsArchivedDocument,
  SoupDocument,
} from '@service-storage/graphql/generated/graphql';
import { soupOptimisticResolvers } from '../optimistic-resolvers';
import { createRevalidatingClient } from '../soup/graphql/revalidating-client.test-helpers';
import { archiveEmailThread, archiveEmailThreads } from './integration';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client = undefined;
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
      const result = archiveEmailThread({ id: 'thread', value });
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
      expect(mocks.reminders).not.toHaveBeenCalled();
      finish();
      await expect(result).resolves.toBe('committed');
      expect(mocks.reminders).toHaveBeenCalledOnce();
      // The cached record carries the change to every list the cache
      // maintains; only the others are read again, by the exchange.
      expect(mocks.revalidations).toHaveBeenCalledOnce();
    }
  );

  it('reads a mounted list once after the write without the normalized cache', async () => {
    const server = createRevalidatingClient(() => ({
      setEmailThreadArchived: {
        __typename: 'GraphqlSoupEmailThread',
        id: 'thread',
        inboxVisible: false,
      },
    }));
    mocks.client = server.client;
    const list = await server.mount(SoupDocument, {
      input: { initial: { limit: 50 } },
    });
    try {
      await expect(
        archiveEmailThread({ id: 'thread', value: true })
      ).resolves.toBe('committed');
      // The client's exchange read the list before the write settled; nothing
      // reads it a second time.
      expect(server.reads('Soup')).toBe(2);
    } finally {
      list.unsubscribe();
    }
  });

  it('recovers mounted lists after a committed archive whose cache write failed', async () => {
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        data: {
          setEmailThreadsArchived: {
            threads: [
              {
                __typename: 'GraphqlSoupEmailThread',
                id: 'thread',
                inboxVisible: false,
              },
            ],
            failedThreadIds: [],
          },
        },
        extensions: {
          __macroNormalizedCache: {
            source: 'live-network',
            cacheEffectsApplied: false,
          },
        },
      }),
    });
    await expect(archiveEmailThreads(['thread'], true)).resolves.toEqual([
      { status: 'fulfilled', value: 'committed' },
    ]);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.mutation).toHaveBeenCalledOnce();
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
      expect(mocks.reminders).not.toHaveBeenCalled();
    }
  );
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
    expect(mocks.reminders).toHaveBeenCalledOnce();
  });

  it.each([50, 100])(
    'reads a mounted list once per request after archiving %i threads without the normalized cache',
    async (count) => {
      const server = createRevalidatingClient(() => ({
        setEmailThreadsArchived: { threads: [], failedThreadIds: [] },
      }));
      mocks.client = server.client;
      const list = await server.mount(SoupDocument, {
        input: { initial: { limit: 50 } },
      });
      try {
        const ids = Array.from({ length: count }, (_, i) => `thread-${i}`);
        const results = await archiveEmailThreads(ids, true);
        expect(results.every((result) => result.status === 'fulfilled')).toBe(
          true
        );
        // One request of up to 100 threads, one read of the list after it,
        // however many threads changed.
        expect(server.reads('Soup')).toBe(2);
      } finally {
        list.unsubscribe();
      }
    }
  );

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

  it('sends at most 100 threads per request', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `thread-${index}`);
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        data: {
          setEmailThreadsArchived: {
            threads: [],
            failedThreadIds: ['thread-0'],
          },
        },
      }),
    });
    const results = await archiveEmailThreads(ids, true);
    expect(mocks.mutation.mock.calls.map(([, variables]) => variables)).toEqual(
      [
        { input: { threadIds: ids.slice(0, 100), archived: true } },
        { input: { threadIds: ids.slice(100), archived: true } },
      ]
    );
    expect(results[0].status).toBe('rejected');
    expect(results.slice(1)).toEqual(
      ids.slice(1).map(() => ({ status: 'fulfilled', value: 'committed' }))
    );
    expect(mocks.reminders).toHaveBeenCalledOnce();
  });
});
